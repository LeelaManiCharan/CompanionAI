# Implementation Plan: AI Companion Check-in

## Overview

TypeScript implementation of the design, built incrementally at the workspace root (so Vercel builds from repo root). Order: scaffold → pure `src/core` modules with property tests → data layer (`src/data`) → server routes (`src/server`, `src/app/api`) → browser services (`src/services`) → UI pages → notifications/service worker → tab coordination → backup service + UI → deployment readiness. Every step is wired into what came before; nothing is left orphaned.

Dependency versions below were checked against the npm registry and all resolve; pin them exactly (no `^`/`~`).

## Tasks

- [x] 1. Scaffold the Next.js project at the workspace root
  - [x] 1.1 Create project scaffolding and tooling config
    - `package.json` with exact versions: next 15.5.28, react / react-dom 19.1.10, idb 8.0.4, zod 3.25.76, @supabase/supabase-js 2.118.0, geist 1.8.1; dev: typescript 5.9.3, @types/react 19.3.0, @types/react-dom 19.3.0, @types/node 20.19.43, @types/dom-speech-recognition 0.0.12, tailwindcss 4.3.3, @tailwindcss/postcss 4.3.3, postcss 8.5.30, vitest 5.0.5, fast-check 4.10.2, fake-indexeddb 6.2.6, jsdom 30.1.3, @testing-library/react 16.3.3, eslint 9.39.5, eslint-config-next 15.5.28. Run `npm install`; if any version fails to install, pick the nearest existing exact version and record it in `package.json`
    - Scripts: `dev`, `build` (`next build`), `start`, `lint` (`eslint .` with flat `eslint.config.mjs` extending next core-web-vitals + typescript), `typecheck` (`tsc --noEmit`), `test` (`vitest --run`)
    - `tsconfig.json` (strict, `@/*` → `src/*`), `postcss.config.mjs` (`@tailwindcss/postcss`), `vitest.config.ts` with two projects: `core` (node env, `fake-indexeddb/auto` setup, `tests/**/*.test.ts` except `tests/ui/**`) and `ui` (jsdom env, `tests/ui/**/*.test.tsx`)
    - `next.config.ts` with `headers()` applying `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, `X-Frame-Options: DENY` to `/:path*`
    - `.gitignore` ignoring `node_modules`, `.next`, `out`, `coverage`, `.vercel`, `*.tsbuildinfo`, `.env*` with `!.env.example`
    - `.env.example` with placeholders only: `GEMINI_API_KEY=your-gemini-api-key-here`, `GEMINI_MODEL=gemini-2.0-flash`
    - `src/app/globals.css`: `@import "tailwindcss";` plus the design's `@theme` tokens (white / dark green `#14532D` / grey palette, danger red only for errors; no orange, purple, or gradients), base 15px/1.6 body, `:focus-visible` ring, `prefers-reduced-motion` rule
    - Placeholder `src/app/layout.tsx` (Geist fonts, metadata) and `src/app/page.tsx` so `npm run build` succeeds
    - _Requirements: 21.1, 21.4, 21.10, 7.12, 7.13_
  - [ ] 1.2 Write config smoke tests
    - `tests/config.test.ts`: `next.config.ts` headers include the four security headers; `.gitignore` covers `.env*` with `!.env.example`, `node_modules`, `.next`; `.env.example` holds only placeholder values
    - _Requirements: 21.4, 21.10, 7.13_

- [x] 2. Core data models, validators, and secret helpers
  - [x] 2.1 Implement zod models and input validators
    - `src/core/models.ts`: `SCHEMA_VERSION = 1`, `Timestamp` (UTC ms `Z`), Profile, Settings (without `cloudStoreConfig`), Chat, Message, Memory, ActivityLog, Summary, BackupMeta, CheckIn (+ `snoozeFiredAt`), ProfileMeta, BrowserRecord (+ `cloudStoreConfig`, `epoch`), ordering refinements (`updatedAt ≥ createdAt`, etc.), inferred types
    - `src/core/validators.ts`: display name (1–40 trimmed), Bot_Name (1–30), message text (1–4,000, non-whitespace), Ollama base URL / model, API key (1–256, no internal whitespace), HH:MM override, passphrase (8–128), Supabase URL (https), bucket name, memory content (1–500), summary (≤ 1,500); defaults (`Sunny`, `calm`, `auto`, `http://localhost:11434`, `llama3.1:8b`)
    - `tests/arbitraries.ts`: shared fast-check generators (consistent datasets with 1–3 profiles, UTC ms timestamps, fixed IANA time-zone list incl. `Australia/Lord_Howe` and `Pacific/Chatham`, Unicode/astral strings)
    - _Requirements: 1.1, 1.7, 2.1, 2.3, 2.6, 4.1, 4.6, 6.2, 6.3, 6.14, 7.5, 7.6, 12.4, 12.5, 18.1, 18.16, 19.1–19.13, 19.15_
  - [x] 2.2 Implement `maskKey` and `redactSecrets` in `src/core/secrets.ts`
    - _Requirements: 7.4, 7.8_
  - [ ] 2.3 Write property test for schema validation
    - **Property 12: Record validation accepts exactly the data models** (schema and input-validator part)
    - **Validates: Requirements 1.1, 1.7, 2.1, 2.6, 4.1, 4.6, 6.3, 6.14, 7.5, 7.6, 12.5, 19.1–19.11, 19.13**
  - [ ] 2.4 Write property test for key masking and redaction
    - **Property 11: API key masking and redaction**
    - **Validates: Requirements 7.4, 7.8**

- [x] 3. Safety_Monitor and Context_Builder
  - [x] 3.1 Implement `normalizeForMatch` and `detectCrisis` in `src/core/safety.ts`
    - Curated phrase list normalized at module load, whole-word matching, no network access; static 988 fallback reply and voice crisis line constants
    - _Requirements: 14.1, 14.3, 14.6, 14.8, 20.31_
  - [x] 3.2 Implement `buildContext`, `rankMemories`, `trimToByteBudget` in `src/core/context.ts`
    - Fixed system section order (persona with verbatim Bot_Name/Tone, AI/not-therapist/no-diagnosis/real-world-relationship rules, optional safety instruction, summary, memories); last 20 messages oldest first; profile filter; gemini 64 KB trim from oldest
    - _Requirements: 2.4, 2.5, 9.1, 9.2, 9.3, 9.4, 9.9, 14.4, 15.1, 15.4, 20.22, 6.24_
  - [ ] 3.3 Write property test for safety normalization
    - **Property 7: Safety_Monitor normalization**
    - **Validates: Requirements 14.1, 20.31**
  - [ ] 3.4 Write property test for context builder
    - **Property 5: Context builder limits, ordering, and required content**
    - **Validates: Requirements 2.4, 9.1, 9.2, 9.3, 9.4, 14.4, 15.1, 15.4, 20.22**
  - [ ] 3.5 Write property test for byte-budget trimming
    - **Property 6: 64 KB trimming drops oldest first**
    - **Validates: Requirements 6.24**

- [x] 4. Memory core logic
  - [x] 4.1 Implement `parseExtraction`, `mergeMemories`, `appendCapped`, `forgetChat` in `src/core/memory.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.9, 8.10, 8.11, 10.3, 10.4, 20.26_
  - [ ] 4.2 Write property test for source cap
    - **Property 2: Source-cap invariant**
    - **Validates: Requirements 8.3, 8.10, 8.11**
  - [ ] 4.3 Write property test for de-duplication
    - **Property 3: Memory de-duplication**
    - **Validates: Requirements 8.4**
  - [ ] 4.4 Write property test for extraction parsing
    - **Property 4: Extraction output parsing**
    - **Validates: Requirements 8.1, 8.2, 8.9, 20.26**

- [x] 5. Scheduling core logic
  - [x] 5.1 Implement `localDate`, `computePreferredTime`, `resolveLocalTime`, `evaluateSchedule`, `activeSecondsOnDate` in `src/core/schedule.ts`
    - All functions take explicit `now` and IANA `timeZone`; DST gap → first valid instant, overlap → first occurrence; earlier dates never evaluated
    - _Requirements: 12.1, 12.3, 12.4, 12.6, 12.7, 12.8, 12.9, 12.10, 13.5, 15.5, 15.8, 20.11–20.15_
  - [ ] 5.2 Write property test for preferred time
    - **Property 20: Preferred check-in time**
    - **Validates: Requirements 12.1, 12.3, 12.4**
  - [ ] 5.3 Write property test for DST-safe resolution
    - **Property 21: DST-safe local time resolution**
    - **Validates: Requirements 20.12**
  - [ ] 5.4 Write property test for one check-in / one snooze per date
    - **Property 22: At most one check-in and one snooze reminder per date**
    - **Validates: Requirements 12.7, 12.8, 12.9, 12.10, 13.5, 20.15**
  - [ ] 5.5 Write property test for midnight clipping
    - **Property 23: Daily active time clips at local midnight**
    - **Validates: Requirements 15.5, 15.8**

- [x] 6. Provider selection, list selectors, and call state machine
  - [x] 6.1 Implement `select` in `src/core/providerSelect.ts` and `pickActiveProfile`, `homeChatList`, `sortMessages` in `src/core/selectors.ts`
    - _Requirements: 6.4, 6.5, 6.6, 6.20, 20.16, 1.6, 1.8, 3.3, 4.4_
  - [x] 6.2 Implement the pure call reducer in `src/core/callMachine.ts`
    - States checking → unsupported / requestingMic → micDenied / speaking ⇄ listening ⇄ thinking → ended; orthogonal `muted`; 3-restart limit; 15 s fallback caption; late-reply speak/skip rule; echo-guard decision; crisis line before reply
    - _Requirements: 5.1–5.14, 14.3, 20.31_
  - [ ] 6.3 Write property test for provider selection
    - **Property 24: Provider selection**
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.20, 20.16**
  - [ ] 6.4 Write property test for profile selection and list ordering
    - **Property 25: Active profile selection and listing order**
    - **Validates: Requirements 1.6, 1.8, 3.3, 4.4**
  - [ ] 6.5 Write unit tests for call machine transitions
    - Mute/unmute, 3 recognizer failures, 15 s fallback then late reply with/without new speech, echo discard, crisis-first ordering, end-call from every state
    - _Requirements: 5.6, 5.7, 5.8, 5.11–5.14, 14.3, 20.31_

- [x] 7. Backup serializer and crypto framing
  - [x] 7.1 Implement `serializeBackup` / `parseBackup` in `src/core/backup.ts`
    - Canonical JSON (deep-sorted keys, 2-space indent, collections sorted by `id`/`profileId`), SHA-256 checksum over `{exportedAt, schemaVersion, data}`, parse order: size (> 50 MB) → JSON → schema version → checksum → required fields → referential integrity → ≤ 3 profiles; browser record, `checkIns`, `backupMeta` excluded
    - _Requirements: 17.1–17.8, 19.14, 19.15, 20.27_
  - [x] 7.2 Implement `encryptBackup` / `decryptBackup` in `src/core/crypto.ts`
    - `ACB1` magic ‖ iterations u32 BE ‖ salt 16 B ‖ IV 12 B ‖ AES-GCM-256 ciphertext; PBKDF2-SHA-256 default 600,000 iterations (injectable for tests); passphrase/key only in locals; `OperationError` → `decrypt_failed`
    - _Requirements: 18.15, 18.17, 18.18, 18.20_
  - [x] 7.3 Write property test for backup round-trip and determinism
    - **Property 15: Backup round-trip and determinism**
    - **Validates: Requirements 17.1, 17.3, 17.7, 17.8**
  - [ ] 7.4 Write property test for backup error classification
    - **Property 17: Backup error classification**
    - **Validates: Requirements 17.4, 17.5, 20.27**
  - [x] 7.5 Write property test for encrypt/decrypt round-trip
    - **Property 18: Encrypt/decrypt round-trip** (test-only 1,000 iterations, plaintext ≤ 256 KB)
    - **Validates: Requirements 18.15, 18.20**
  - [ ] 7.6 Write property test for wrong passphrase / tampering
    - **Property 19: Wrong passphrase or tampering fails closed**
    - **Validates: Requirements 18.17**

- [ ] 8. Checkpoint - core modules
  - Run `npm run build`, `npm run lint`, and `npx vitest run`; fix any failures. Ensure all tests pass, ask the user if questions arise.

- [x] 9. Data layer (IndexedDB repository)
  - [x] 9.1 Implement DB schema, open, and migrations in `src/data/db.ts`
    - Stores and indexes from the design's Data Models table; ordered `migrations[v]` inside the version-change transaction; `VersionError` / migration failure → `read_only`; IndexedDB missing/blocked → `unavailable` (reported within 3 s)
    - _Requirements: 16.3, 16.6, 16.7, 16.8, 19.15_
  - [x] 9.2 Implement repository and live queries in `src/data/repository.ts` and `src/data/useLiveQuery.ts`
    - `put`/`tx` with zod validation, referential-integrity checks inside the transaction, `profileId === op.profileId` guard, `Result` errors (`validation` with model + fields, `write_failed`, `read_only`, `stale`), profile-scoped reads (`listChats`, `messagesByChat` with limit/before), post-commit change hook (BroadcastChannel wiring arrives in task 23)
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 19.10, 19.11, 19.12, 20.8_
  - [ ] 9.3 Write property test for write/read round-trip
    - **Property 13: Local store write/read round-trip** (including close/reopen)
    - **Validates: Requirements 16.5, 2.8**
  - [ ] 9.4 Write property test for repository rejection of invalid records
    - **Property 12: Record validation accepts exactly the data models** (repository part: rejected writes name model and field, stored version unchanged)
    - **Validates: Requirements 19.10, 19.11, 19.12**
  - [ ] 9.5 Write unit tests for migration failure and newer-version handling
    - _Requirements: 16.6, 16.7, 16.8_

- [ ] 10. Server routes (Generate_Route and Provider_Status_Route)
  - [x] 10.1 Implement server helpers in `src/server/`
    - `rateLimiter.ts` (sliding window 20 / 60 s per IP, `Retry-After`), `safeLog.ts` (only `route, status, code, task, ms`), `schema.ts` (`GenerateRequestSchema.strict()`), `gemini.ts` (role mapping, merge consecutive turns, synthetic leading user turn, `x-goog-api-key` header, JSON mime for `extract_memories`, `GEMINI_MODEL` default `gemini-2.0-flash`)
    - _Requirements: 6A.3, 6A.5, 6A.9, 6A.11, 6A.12, 21.3_
  - [x] 10.2 Implement `handleGenerate` and route files
    - `src/server/handleGenerate.ts` with injected `env`, `fetch`, `now`, `limiter`: 415 → 503 → 429 → 413 (header and streamed byte count) → 400 `invalid_json` / `invalid_request` + `fields` → upstream with 50 s abort (504 / 429 `gemini_quota` / 502 / 200 `{text}`), top-level 500 `internal_error`
    - `src/app/api/generate/route.ts` (`runtime="nodejs"`, `maxDuration=60`, `dynamic="force-dynamic"`, 405 `Allow: POST` for other methods) and `src/app/api/provider-status/route.ts` (GET `{geminiAvailable, model}`, 405 `Allow: GET`)
    - _Requirements: 6A.1–6A.14, 21.3, 21.11_
  - [ ] 10.3 Write property test for generate route request validation
    - **Property 8: Generate route request validation**
    - **Validates: Requirements 6A.2, 6A.3, 6A.4**
  - [ ] 10.4 Write property test for rate limiter
    - **Property 9: Rate limiter window bound**
    - **Validates: Requirements 6A.5, 6A.6**
  - [ ] 10.5 Write property test for server key hygiene
    - **Property 10: Server key hygiene**
    - **Validates: Requirements 6A.11, 6A.12**
  - [ ] 10.6 Write unit tests for route methods and upstream mapping
    - 405 + `Allow`, 415, 503 when key missing, 504 on abort, 429 on `RESOURCE_EXHAUSTED`, 502 generic, provider-status shape
    - _Requirements: 6A.1, 6A.7, 6A.8, 6A.9, 6A.10, 6A.14_

- [x] 11. Profile and settings services
  - [x] 11.1 Implement `src/services/profileService.ts` and `src/services/settingsService.ts`
    - Create (max 3, defaults Settings/ProfileMeta/Summary in one tx), select (stamp `lastUsedAt`), delete with full cascade in one tx, startup/post-delete selection via `pickActiveProfile`; Bot_Name/Tone/provider/Ollama/override/tracking/notification saves with validation and unchanged-on-failure semantics; browser record bootstrap (namespace id ≥ 128 bits base64url, `cloudStoreConfig` save/clear)
    - _Requirements: 1.1–1.9, 2.1–2.3, 2.6–2.8, 6.2, 6.3, 6.14, 7.5, 7.6, 7.10, 11.4, 12.4, 12.5, 18.1, 18.14_
  - [ ] 11.2 Write unit tests for profile and settings services
    - Limit of 3, cascade delete isolation, failed write leaves state unchanged, defaults on create
    - _Requirements: 1.2, 1.4, 1.9, 2.3, 2.7_

- [x] 12. Model_Router and providers
  - [x] 12.1 Implement providers in `src/services/providers/ollama.ts` and `src/services/providers/gemini.ts`
    - Ollama `POST {baseUrl}/api/chat` (`companion → assistant`, `format:"json"` for extraction), health check `/api/tags` 2 s, TypeError → `unreachable`, 404 "not found" → `model_not_installed`; Gemini proxy uses relative `/api/generate` only, maps 429/503/504/other
    - _Requirements: 6.1, 6.11, 6.12, 6.13, 6.15, 6.18, 6.19_
  - [x] 12.2 Implement `src/services/modelRouter.ts`
    - Active provider state + `subscribe`, `refresh` triggers (start, profile change, mode/URL save, > 60 s stale), provider-status fetch, offline handling, per-request snapshot, auto-mode fallback resend once, `PrivacyNoticeGate` with acknowledgement write, `notice_declined` / `no_model`, combined 60 s timeout, `test()` and retry with current settings
    - _Requirements: 6.1, 6.4–6.10, 6.16, 6.17, 6.20, 6.21, 6.22, 6.25, 6.26, 20.16_
  - [ ] 12.3 Write unit tests for router with mocked fetch
    - Auto fallback on unreachable, ollama mode never calls route, gemini mode never calls Ollama, privacy gate continue/cancel, gemini unavailable, offline
    - _Requirements: 6.5, 6.6, 6.9, 6.17, 6.20, 6.21, 6.22_

- [ ] 13. Chat, memory, and deletion services
  - [x] 13.1 Implement `src/services/chatService.ts`
    - New chat, send (safety scan → save user msg → crisis signal → context → router → guarded companion write on profile/chat/epoch), 10,000-char truncation, empty reply = failure, crisis fallback reply, retry same message, call-active delete guard
    - _Requirements: 4.1, 4.2, 4.5, 4.7, 4.8, 14.1, 14.2, 14.8, 20.7, 20.9, 20.10, 20.24, 20.25_
  - [x] 13.2 Implement `src/services/memoryService.ts`
    - Extraction after reply (user msg + preceding companion msg), per-message retry queue (max 3), guarded merge writes, `newMemoriesSinceSummary` counting, summary regeneration triggers (chat end, ≥ 10 new, chat deletion, `summaryStale` on load) with 1,500-char truncation, memory edit/delete, summary edit; wire extraction into `chatService`
    - _Requirements: 8.1–8.11, 9.5–9.9, 10.5, 10.9, 10.10, 20.7_
  - [x] 13.3 Implement `src/services/chatDeletion.ts`
    - Single readwrite tx: delete chat + messages, apply `forgetChat`, clear summary, set `summaryStale`; post-commit regeneration; reset-profile action keeping Profile and Settings
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_
  - [ ] 13.4 Write property test for forgetting invariant
    - **Property 1: Forgetting invariant** (over `fake-indexeddb`)
    - **Validates: Requirements 10.2, 10.3, 10.4, 10.6**
  - [ ] 13.5 Write property test for no cross-profile writes
    - **Property 14: No cross-profile writes** (interleaved ops, profile switches, deletions, epoch bumps, random delays)
    - **Validates: Requirements 9.4, 10.10, 20.7, 20.8, 20.10, 20.29**
  - [ ] 13.6 Write unit tests for chat flow, delete rollback, and summary triggers
    - Save failure keeps input and sends nothing, timeout keeps user msg only, injected tx failure rolls back delete, summary triggers
    - _Requirements: 4.7, 4.8, 9.5, 10.8, 10.9_

- [ ] 14. Activity tracker and check-in scheduler services
  - [x] 14.1 Implement `src/services/activityTracker.ts`
    - Sessions on `visibilitychange`/`pagehide`, write only if tracking stayed enabled, recompute preferred time on new session, break-suggestion check (deferred during call, `lastBreakSuggestionDate`), clear-all
    - _Requirements: 11.2, 11.3, 11.5, 11.8, 12.2, 15.5, 15.6, 15.7, 15.8_
  - [x] 14.2 Implement `src/services/scheduler.ts`
    - 15 s ticker (leader-gated hook for task 23), date/offset change detection, resume detection (> 45 s jump, visible), persist trigger before emitting, prompt-on-open, snooze (one per date), completion on chat send / call start
    - _Requirements: 12.6–12.10, 13.5, 20.11–20.15_
  - [ ] 14.3 Write unit tests for activity sessions and scheduler wiring
    - _Requirements: 11.2, 11.3, 12.6, 12.9, 20.14_

- [ ] 15. Checkpoint - data, server, services
  - Run `npm run build`, `npm run lint`, and `npx vitest run`; fix any failures. Ensure all tests pass, ask the user if questions arise.

- [ ] 16. App shell and design system
  - [x] 16.1 Implement UI primitives in `src/components/ui/`
    - Button (primary/secondary/ghost/danger, 36/44 px), IconButton, Card, Badge (mono), Field/TextInput/Textarea with live counter, Switch (`role="switch"`), Dialog (native `<dialog>`, focus trap), InlineAlert, Toast (`aria-live="polite"`), EmptyState, Skeleton; tokens only from `globals.css`
    - _Requirements: 3.2, 5.1_
  - [x] 16.2 Implement `AppRoot`, safety/provider components, and layout wiring
    - `AppRoot` (client): open DB, migrations, browser record bootstrap, active profile, repo-mode banners, `storage.persist()`/`estimate()` notices, router refresh, start activity tracker + scheduler; SSR-safe skeleton
    - `SafetyProvider` + `CrisisPanel` (non-modal `alertdialog`, 988 call/text and 911, stays until dismissed), `HelpButton`, `ProviderBadge` (fallback wording), `PrivacyNoticeDialog` resolving the router gate, `AiDisclaimer`
    - Minimal zero-profile creation screen with activity disclosure (full Profiles page in task 21); update `src/app/layout.tsx`
    - _Requirements: 1.5, 6.7, 6.8, 6.21, 6.22, 11.1, 11.7, 14.2, 14.5, 14.7, 14.9, 15.3, 16.2, 16.7, 16.8, 20.19, 20.20, 20.30_
  - [ ] 16.3 Write component tests for shell pieces
    - CrisisPanel content and persistence, ProviderBadge wording, PrivacyNoticeDialog continue/cancel, accessible names and keyboard focus
    - _Requirements: 6.8, 6.22, 14.2, 14.7_

- [ ] 17. Home page
  - [x] 17.1 Implement `src/app/page.tsx`
    - Header (profile name, Bot_Name, ProviderBadge, Help), check-in hero (status, preferred time in mono, Start call, Open chat), check-in prompt with snooze, recent chats (≤ 50) or empty state, nav to Settings/Profiles/Backup, load-error alert keeping controls, disclaimer footer, break suggestion toast
    - _Requirements: 3.1–3.7, 12.10, 13.5, 14.5, 15.3, 15.5_
  - [ ] 17.2 Write component tests for Home page
    - _Requirements: 3.3, 3.4, 3.5, 3.7_

- [ ] 18. Chat page
  - [x] 18.1 Implement `src/app/chat/page.tsx`, `src/app/chat/[id]/page.tsx`, and `src/components/chat/`
    - Chat rail + conversation (two-column ≥ 1024 px), bubbles with mono timestamps, 4,000-char limit and counter, disabled submit for empty/pending, typing indicator, provider-specific error alerts with retry (Ollama guidance with `OLLAMA_ORIGINS=<origin>`, `ollama pull <model>`, busy/quota, no model, notice declined), delete with confirm, 500-message window with "Load earlier", ProviderBadge, Help
    - _Requirements: 4.1–4.9, 6.11, 6.12, 6.13, 6.18, 6.19, 6.20, 6.22, 10.1, 10.2, 20.23_
  - [ ] 18.2 Write component tests for Chat page
    - _Requirements: 4.3, 4.6, 4.7, 4.8, 4.9_

- [ ] 19. Voice call
  - [x] 19.1 Implement speech adapter and call controller in `src/services/voice/`
    - Wrap `SpeechRecognition`/`speechSynthesis`, mic permission via `getUserMedia` (tracks stopped), drive `callMachine`, store greeting/transcripts/replies in the call's Chat via `chatService`, 15 s caption fallback, end-call within 1 s, end call before profile switch, offline notice flag
    - _Requirements: 5.1–5.14, 14.3, 20.6, 20.17, 20.31_
  - [x] 19.2 Implement `src/app/call/page.tsx`
    - Full-viewport `#0F3D22` screen, avatar ring states, Bot_Name, MM:SS timer, `aria-live` captions, Mute (`aria-pressed`) and End buttons, Help + ProviderBadge, unsupported / mic-denied / recognition-failed states with "Open chat", crisis panel during call
    - _Requirements: 5.1, 5.7, 5.9, 5.10, 5.12, 6.7, 14.5, 20.17_
  - [ ] 19.3 Write tests for the voice controller with fake speech APIs
    - _Requirements: 5.2–5.8, 5.11, 20.6_

- [ ] 20. Settings page
  - [x] 20.1 Implement `src/app/settings/page.tsx`
    - Sticky in-page nav; Companion (name, tone segmented control); Model (mode, Ollama URL/model, test buttons, always-visible Gemini privacy + no-auth/quota notice, gemini-unavailable state); Activity (consent, toggle, clear link); Check-ins (override HH:MM, clear); Cloud backup fields (Supabase URL, masked anon key, bucket, namespace id copy/replace, RLS notice, "Shared by all profiles in this browser"); Danger zone (reset, delete profile)
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 6.2, 6.3, 6.14, 6.17, 6.23, 6.25, 6A.13, 7.3, 7.4, 7.6, 7.10, 7.11, 10.7, 11.4, 12.4, 12.5, 18.1, 18.14, 18.19_
  - [ ] 20.2 Write component tests for Settings validation and masking
    - _Requirements: 2.6, 6.14, 7.4, 7.6, 12.5_

- [ ] 21. Memories, Activity, and Profiles pages
  - [x] 21.1 Implement `src/app/memories/page.tsx`
    - Category filter, newest-first list, inline edit with 500-char counter, delete confirm, Profile_Summary editor with 1,500-char counter and over-limit rejection, empty state
    - _Requirements: 8.6, 8.7, 8.8, 9.7, 9.8_
  - [x] 21.2 Implement `src/app/activity/page.tsx`
    - Sessions table newest first (mono times/durations), disclosure text, clear-all with confirm, empty state, error handling
    - _Requirements: 11.5, 11.6, 11.8_
  - [x] 21.3 Implement `src/app/profiles/page.tsx`
    - Profile cards (≤ 3), create form with validation (keep text on error), limit message, select, delete with name-confirm dialog, post-delete selection
    - _Requirements: 1.1–1.4, 1.7, 1.8, 1.9_
  - [ ] 21.4 Write component tests for Memories, Activity, and Profiles pages
    - _Requirements: 1.2, 1.7, 8.6, 8.7, 9.8, 11.6_

- [ ] 22. Notifications and service worker
  - [x] 22.1 Implement `src/services/notifications.ts` and `public/sw.js`
    - Register SW (fallback to page `new Notification()` on failure), `showNotification` with `tag: checkin-{profileId}-{date}`, title with Bot_Name, body 1–120 chars; SW `notificationclick` closes, focuses existing client + `postMessage({type:"open-call"})` or opens `/call?from=checkin`
    - _Requirements: 13.3, 13.4, 13.7, 13.9_
  - [x] 22.2 Wire notifications into scheduler, Settings toggle, and AppRoot
    - Permission request only from toggle click (default → request once, granted → enable, denied/dismissed → off + in-app message, unsupported → disabled + message); scheduler triggers notify; AppRoot handles `open-call` message and `?from=checkin`
    - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6, 13.8_
  - [ ] 22.3 Write unit tests for notification permission branches
    - _Requirements: 13.1, 13.2, 13.6, 13.8, 13.9_

- [ ] 23. Tab coordination
  - [x] 23.1 Implement `src/services/tabCoordinator.ts`
    - Web Locks leader (`companion-leader`) with BroadcastChannel heartbeat fallback (1 s / 3 s), `companion-call` lock + `call-state` broadcast, `companion-db` change broadcasts with deleted ids, `reload-all` on epoch bump
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.29_
  - [x] 23.2 Wire Tab_Coordinator into repository, AppRoot, scheduler, call controls, and views
    - Repository post-commit hook broadcasts; `useLiveQuery` re-runs on broadcasts; scheduler/notifications leader-gated; call buttons disabled with "call in progress in another tab"; deleted Profile/Chat views navigate away with toast and apply Req 1.8
    - _Requirements: 20.1, 20.3, 20.4, 20.5, 1.8_
  - [ ] 23.3 Write unit tests with BroadcastChannel polyfill and Web Locks stub
    - _Requirements: 20.1, 20.3, 20.4, 20.5_

- [ ] 24. Backup service and backup UI
  - [x] 24.1 Implement `src/services/backupService.ts`
    - Supabase client with custom fetch (30 s timeout, only configured URL), guards (offline, unconfigured, no key, passphrase length) sending zero requests, upload to `{namespaceId}/backup-{ts}-{rand6}.acb` + BackupMeta, list (limit 50, name desc), download → decrypt → parse → single restore tx (keeps `browser`/`backupMeta`, clears `checkIns`) → epoch bump + `reload-all`, export/import local file (≤ 50 MB), `key_rejected` without retry, `redactSecrets` on all messages
    - _Requirements: 7.2, 7.3, 7.7, 7.8, 7.9, 7.14, 18.2, 18.4–18.13, 18.15–18.18, 20.16, 20.18, 20.27, 20.29_
  - [x] 24.2 Implement backup UI and wire it into Settings, Home, and the zero-profile screen
    - Backup / Restore / Export / Import controls with passphrase dialog, progress state and disabled controls, backup list with local time and KB/MB size, replace-all confirm, success/error messages, offline disable/re-enable, disabled during active call; Home "Back up now" card with last backup; zero-profile Restore/Import with inline Cloud_Store fields and namespace id
    - _Requirements: 18.3, 18.4, 18.6, 18.7, 18.9, 18.12, 18.13, 18.16, 18.17, 20.16, 20.18, 20.21, 20.28_
  - [ ] 24.3 Write property test for secret exclusion from backups
    - **Property 16: Backups never contain browser-level secrets**
    - **Validates: Requirements 7.9, 17.2, 18.18, 19.14, 19.15**
  - [ ] 24.4 Write unit tests for backup service with mocked Supabase client
    - Path prefix, list sort/limit, 30 s timeout, 401 → `key_rejected`, zero requests when unconfigured/offline/bad passphrase, decrypt failure leaves store unchanged
    - _Requirements: 7.3, 7.7, 18.4, 18.5, 18.6, 18.16, 18.17_

- [ ] 25. Checkpoint - full app
  - Run `npm run build`, `npm run lint`, and `npx vitest run`; fix any failures. Ensure all tests pass, ask the user if questions arise.

- [ ] 26. Deployment readiness
  - [x] 26.1 Write `README.md`
    - Local dev commands; Vercel env vars `GEMINI_API_KEY` (required, never `NEXT_PUBLIC_`) and `GEMINI_MODEL` (optional, default `gemini-2.0-flash`) and where to set them; Ollama install, `ollama pull llama3.1:8b`, and starting with `OLLAMA_ORIGINS=https://<vercel-domain>` on Windows (PowerShell), macOS, and Linux; Chrome/Edge recommendation; Supabase setup (create bucket `companion-backups`, storage RLS policy SQL scoping anon read/write to the namespace prefix, values entered per user in Settings, not env vars); warnings: no auth on `/api/generate`, shared free-tier quota, best-effort rate limit, chat context sent to Google when Gemini is used, encrypted backups protected by anon key + namespace id + passphrase
    - _Requirements: 6A.13, 18.19, 21.5, 21.6, 21.7, 21.8_
  - [x] 26.2 Add client bundle secret check
    - `scripts/check-bundle.mjs` scanning `.next/static` for `GEMINI_API_KEY`, `generativelanguage.googleapis.com`, and a test key value; add `check:bundle` script to `package.json`
    - _Requirements: 6.15, 7.1, 7.12_
  - [-] 26.3 Initialize git and create the initial local commit
    - Only if no repository exists at the workspace root: `git init -b main`, stage specific project files (confirm no `.env*` other than `.env.example` and no `node_modules`/`.next` are staged), commit "Initial commit: AI Companion Check-in POC"
    - Do NOT add a remote, do NOT push, do NOT deploy (handled separately with user confirmation)
    - _Requirements: 7.13, 21.2_

- [ ] 27. Final checkpoint
  - Run `npm run build`, `npm run lint`, `npx vitest run`, and `npm run check:bundle`; fix any failures. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Required property tests: Property 1 (forgetting), 8 (generate route validation), 14 (no cross-profile writes), 15 (backup round-trip), 18 (encrypt/decrypt round-trip).
- Each property test uses fast-check with `numRuns: 100` and a tag comment `// Feature: ai-companion-checkin, Property N: <title>`.
- Time-dependent code takes `now` and `timeZone` parameters, so property tests need no global clock mocks.
- `cloudStoreConfig` lives in the browser-level record per the design deviation from Req 19.2.
- Manual-only checks (real tabs, real Ollama/Supabase, voice in Chrome/Edge, 10,000-message load time) are out of scope for these coding tasks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1", "4.1", "5.1", "6.1", "6.2", "7.1", "7.2"] },
    { "id": 3, "tasks": ["2.4", "3.2", "3.3", "4.2", "4.3", "4.4", "5.2", "5.3", "5.4", "5.5", "6.3", "6.4", "6.5", "7.3", "7.4", "7.5", "7.6"] },
    { "id": 4, "tasks": ["3.4", "3.5", "9.1", "10.1"] },
    { "id": 5, "tasks": ["9.2", "10.2"] },
    { "id": 6, "tasks": ["9.3", "9.4", "9.5", "10.3", "10.4", "10.5", "10.6", "11.1", "12.1"] },
    { "id": 7, "tasks": ["11.2", "12.2"] },
    { "id": 8, "tasks": ["12.3", "13.1", "13.3", "14.1"] },
    { "id": 9, "tasks": ["13.2", "14.2"] },
    { "id": 10, "tasks": ["13.4", "13.5", "13.6", "14.3", "16.1"] },
    { "id": 11, "tasks": ["16.2"] },
    { "id": 12, "tasks": ["16.3", "17.1", "18.1", "19.1", "20.1", "21.1", "21.2", "21.3", "22.1", "23.1", "24.1"] },
    { "id": 13, "tasks": ["17.2", "18.2", "19.2", "20.2", "21.4", "22.3", "23.3", "24.3", "24.4"] },
    { "id": 14, "tasks": ["19.3", "22.2"] },
    { "id": 15, "tasks": ["23.2"] },
    { "id": 16, "tasks": ["24.2"] },
    { "id": 17, "tasks": ["26.1", "26.2"] },
    { "id": 18, "tasks": ["26.3"] }
  ]
}
```
