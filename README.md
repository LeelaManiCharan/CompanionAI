# AI Companion Check-in

A local-first AI companion web app. It runs daily check-ins, supports voice calls in Chrome/Edge, remembers things you tell it (memories you can review and delete), and can back up your data to Supabase Storage with client-side AES-GCM encryption.

All app data lives in your browser's IndexedDB. Replies come from a local [Ollama](https://ollama.com) model when available, with a hosted Google Gemini fallback through the app's `/api/generate` route.

## Local development

Requirements: Node.js ≥ 22.12.

```bash
npm install
cp .env.example .env.local   # then set GEMINI_API_KEY (optional for local-only use)
npm run dev                  # http://localhost:3000
```

## Deploy to Vercel

1. Push this repo to GitHub, then in Vercel choose **Add New → Project** and import it. The framework (Next.js) is detected automatically.
2. In **Project → Settings → Environment Variables**, add:

   | Name | Required | Value |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | Yes, for the hosted fallback | Free key from [Google AI Studio](https://aistudio.google.com/app/apikey) |
   | `GEMINI_MODEL` | No | Defaults to `gemini-flash-latest`. Preferred model for chat replies |
   | `GEMINI_FALLBACK_MODELS` | No | Comma list tried in order when a model returns 429 (quota) or 404. Defaults to `gemini-flash-lite-latest` |
   | `GEMINI_LITE_MODEL` | No | Tried first for background tasks (memory/reminder extraction, summaries, connection tests). Defaults to `gemini-flash-lite-latest` |

   Free-tier note: each Gemini model has its own small free quota, and one chat message can trigger a few calls (reply plus background extraction). When a model hits its quota, `/api/generate` skips it for the `retryDelay` Google returns (60 s if none) and uses the next model in the chain. `gemini-flash-lite-latest` has a separate quota from `gemini-flash-latest`, so keeping it as a fallback helps. `gemini-2.5-flash*` ids may return 404 for new API keys.

   Never prefix these with `NEXT_PUBLIC_`. That would ship the key to every browser. The key is only read server-side by `/api/generate`.
3. Redeploy after adding or changing environment variables. Existing deployments don't pick them up.

## Using local Ollama with the deployed site

The deployed site talks to Ollama at `http://localhost:11434` directly from your browser, so Ollama must allow your site's origin.

1. Install Ollama from [ollama.com/download](https://ollama.com/download).
2. Pull the default model:

   ```bash
   ollama pull llama3.1:8b
   ```
3. Allow your Vercel origin, then restart Ollama:

   - Windows (PowerShell), then quit Ollama from the tray and start it again:

     ```powershell
     setx OLLAMA_ORIGINS "https://<your-app>.vercel.app"
     ```
   - macOS, then quit and reopen the Ollama app:

     ```bash
     launchctl setenv OLLAMA_ORIGINS "https://<your-app>.vercel.app"
     ```
   - Linux (systemd): run `sudo systemctl edit ollama.service`, add the following, then `sudo systemctl daemon-reload && sudo systemctl restart ollama`:

     ```ini
     [Service]
     Environment="OLLAMA_ORIGINS=https://<your-app>.vercel.app"
     ```

Use Chrome or Edge. They support both the Web Speech APIs used for voice calls and requests from an HTTPS page to `localhost`. The browser may show a local-network access permission prompt the first time. Allow it, or the app will fall back to Gemini.

## Supabase backup setup (optional)

1. Create a project at [supabase.com](https://supabase.com).
2. In **Storage**, create a **private** bucket named `companion-backups`.
3. In the **SQL Editor**, run:

   ```sql
   create policy "companion backups: anon read"
   on storage.objects for select to anon
   using (bucket_id = 'companion-backups');

   create policy "companion backups: anon insert"
   on storage.objects for insert to anon
   with check (bucket_id = 'companion-backups');
   ```

4. In the app, open **Settings → Cloud backup** and enter the project URL and anon key (from **Project Settings → API**). Choose a backup passphrase.

These values are stored per browser. They are not environment variables, and each user brings their own Supabase project.

Backups are saved as `<namespace-id>/backup-<timestamp>-<rand>.acb`. There's no user authentication, so a backup is protected only by the anon key, the random per-browser namespace ID, and your passphrase (AES-GCM encryption happens in the browser before upload). Anyone with your anon key could list or download the encrypted files, so pick a strong passphrase. A lost passphrase can't be recovered.

## Privacy and limits

- Your data stays in your browser's IndexedDB unless you export it or run a cloud backup.
- When the hosted Gemini fallback is used, the chat context (recent messages, relevant memories, and the persona prompt) is sent through `/api/generate` to Google. Local Ollama keeps everything on your machine.
- `/api/generate` has no authentication. It applies a best-effort limit of 20 requests per minute per IP, and all visitors share your Gemini free-tier quota.
- This app is not a therapist and is not a substitute for professional care. If you are in crisis, call or text **988** (US Suicide & Crisis Lifeline), or call **911** in an emergency.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Run the Vitest suite once |
| `npm run check:bundle` | After `npm run build`, scan `.next/static` for leaked secrets or Gemini endpoints |
