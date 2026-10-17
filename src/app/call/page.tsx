"use client";

/**
 * Voice_Call_Interface (Req 5, 14.3, 14.5, 20.3, 20.6, 20.17).
 *
 * Full-viewport dark call screen without the AppShell. The call itself is
 * driven by `useCallController`; this page only renders its state.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { CallAvatar, type AvatarActivity } from "@/components/call/CallAvatar";
import { lightPill, outlinePill, roundControl, topBarLink } from "@/components/call/styles";
import { HelpButton, ProviderBadge, useActiveProfile, useApp, useCanWrite, useSafety, useSettings } from "@/components/app";
import {
  IconChevronLeft,
  IconLifeBuoy,
  IconMessage,
  IconMic,
  IconMicOff,
  IconPhone,
  IconPhoneOff,
  Spinner,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useCallElsewhere } from "@/services/useTabState";
import { useCallController, type CallControllerApi } from "@/services/voice/useCallController";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function spokenDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (m > 0) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  parts.push(`${s} ${s === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

const LIVE_PHASES = new Set(["speaking", "listening", "thinking", "recognitionFailed"]);

function statusText(call: CallControllerApi): string {
  if (call.phase === "recognitionFailed") return "Voice recognition unavailable";
  if (call.muted) return "Muted";
  switch (call.phase) {
    case "speaking":
      return "Speaking…";
    case "listening":
      return "Listening…";
    case "thinking":
      return "Thinking…";
    default:
      return "";
  }
}

function avatarActivity(call: CallControllerApi): AvatarActivity {
  if (call.phase === "speaking") return "speaking";
  if (call.phase === "listening" && !call.muted) return "listening";
  return "still";
}

// ---------------------------------------------------------------------------
// Layout pieces
// ---------------------------------------------------------------------------

function TopBar({ live }: { live: boolean }) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2 sm:px-6">
      <Link href="/" className={topBarLink} aria-label={live ? "Leave call and go home" : "Back to home"}>
        <IconChevronLeft size={18} />
        <span>{live ? "Leave" : "Home"}</span>
      </Link>
      <div className="flex items-center gap-2">
        <ProviderBadge tone="dark" />
        <HelpButton tone="dark" />
      </div>
    </header>
  );
}

function Screen({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-primary-deep text-white selection:bg-white/25">
      <TopBar live={live} />
      {children}
    </div>
  );
}

function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "danger" }) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-md rounded-lg border px-4 py-3 text-left text-sm leading-relaxed",
        tone === "info" ? "border-white/20 bg-white/[0.06] text-white/85" : "border-[#fca5a5]/40 bg-[#B42318]/20 text-white",
      )}
    >
      {children}
    </div>
  );
}

function OfflineNotice() {
  return (
    <Notice>
      <p>
        <span className="font-medium text-white">You&apos;re offline.</span> Speech recognition in some browsers needs a
        network connection. Text chat is still available.{" "}
        <Link href="/chat" className="font-medium text-white underline underline-offset-2 hover:no-underline">
          Open chat
        </Link>
      </p>
    </Notice>
  );
}

/** Centered message screen (unsupported, mic denied, errors, ended). */
function MessageScreen({
  botName,
  title,
  children,
  actions,
  offline,
}: {
  botName: string;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  offline?: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [title]);

  return (
    <Screen>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16 text-center">
        <CallAvatar botName={botName} activity="still" dimmed />
        <div className="max-w-md">
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl leading-tight tracking-[-0.03em] outline-none sm:text-[28px]">
            {title}
          </h1>
          {children && <div className="mt-3 text-[15px] leading-relaxed text-white/75">{children}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
        {offline && <OfflineNotice />}
      </main>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function PreCallScreen({
  call,
  botName,
  fromCheckIn,
  callElsewhere,
  canWrite,
}: {
  call: CallControllerApi;
  botName: string;
  fromCheckIn: boolean;
  callElsewhere: boolean;
  canWrite: boolean;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  const busy = callElsewhere || call.blockedElsewhere;
  const disabled = busy || !canWrite || call.supported === null || call.starting;

  // Coming from a check-in notification: focus the one tap needed to start.
  useEffect(() => {
    if (fromCheckIn && !disabled) startRef.current?.focus();
  }, [fromCheckIn, disabled]);

  const waitingForMic = call.started && call.phase === "requestingMic";

  return (
    <Screen>
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-16 text-center">
        <CallAvatar botName={botName} activity={call.starting ? "listening" : "idle"} />
        <div className="max-w-md">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/60">
            {fromCheckIn ? "Daily check-in" : "Voice call"}
          </p>
          <h1 className="mt-2 text-[32px] leading-tight tracking-[-0.03em] sm:text-[40px]">{botName}</h1>
          <p className="mt-2 text-[15px] text-white/75">
            {fromCheckIn
              ? `It's time for your check-in. Tap below and ${botName} will say hello.`
              : `Have a quick voice chat with ${botName}. Tap below to start.`}
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            ref={startRef}
            type="button"
            onClick={call.start}
            disabled={disabled}
            aria-busy={call.starting || undefined}
            className={cn(lightPill, "h-14 px-8 text-base")}
          >
            {call.starting ? <Spinner size={18} /> : <IconPhone size={20} />}
            {call.starting ? (waitingForMic ? "Waiting for microphone…" : "Connecting…") : `Call ${botName}`}
          </button>
          <p className="text-xs text-white/55" aria-live="polite">
            {waitingForMic
              ? "Allow microphone access in your browser to start the call."
              : "Uses your microphone. Your browser turns speech into text."}
          </p>
        </div>

        {busy && (
          <Notice>
            <p role="status">
              A call is already in progress in another tab. End that call to start one here.
            </p>
          </Notice>
        )}
        {!canWrite && (
          <Notice tone="danger">
            <p role="status">Local storage is unavailable, so a call can&apos;t be saved right now.</p>
          </Notice>
        )}
        {call.offline && <OfflineNotice />}

        <Link href="/chat" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-white/75 underline-offset-2 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <IconMessage size={16} />
          Prefer to type? Open chat
        </Link>
      </main>
    </Screen>
  );
}

function LiveCallScreen({ call, botName }: { call: CallControllerApi; botName: string }) {
  const { showCrisis } = useSafety();
  const status = statusText(call);
  const failed = call.phase === "recognitionFailed";
  const canMute = call.phase === "speaking" || call.phase === "listening" || call.phase === "thinking";

  return (
    <Screen live>
      <main className="flex flex-1 flex-col items-center px-6">
        <h1 className="sr-only">Voice call with {botName}</h1>

        {/* Identity, status, timer */}
        <section className="flex flex-1 flex-col items-center justify-center gap-7 pt-4 text-center">
          <CallAvatar botName={botName} activity={avatarActivity(call)} dimmed={call.muted || failed} />
          <div>
            <p className="text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[32px]">{botName}</p>
            <p className="mt-1.5 flex h-6 items-center justify-center gap-2 text-[15px] text-white/80" aria-live="polite">
              {call.phase === "thinking" && !call.muted && (
                <span aria-hidden="true" className="inline-flex gap-1">
                  <span className="size-1.5 rounded-full bg-white/80 animate-typing-dot" />
                  <span className="size-1.5 rounded-full bg-white/80 animate-typing-dot [animation-delay:150ms]" />
                  <span className="size-1.5 rounded-full bg-white/80 animate-typing-dot [animation-delay:300ms]" />
                </span>
              )}
              {call.muted && <IconMicOff size={16} />}
              <span>{status}</span>
            </p>
            <p
              role="timer"
              aria-label={`Call duration ${spokenDuration(call.elapsedMs)}`}
              className="mt-2 font-mono text-sm tabular-nums tracking-[0.08em] text-white/60"
            >
              {formatClock(call.elapsedMs)}
            </p>
          </div>
        </section>

        {/* Captions and notices */}
        <section className="flex w-full max-w-xl flex-col items-center gap-4 py-6" aria-label="Captions">
          {failed ? (
            <Notice tone="danger">
              <p className="font-medium">Voice recognition is unavailable.</p>
              <p className="mt-1 text-white/80">
                Everything said so far is saved. You can keep talking with {botName} in text chat.
              </p>
              <Link href="/chat" className={cn(lightPill, "mt-3 h-10 px-4 text-sm")}>
                <IconMessage size={16} />
                Open chat
              </Link>
            </Notice>
          ) : null}

          <div aria-live="polite" aria-atomic="true" className="min-h-[4.5rem] w-full text-center">
            {call.caption && (
              <p
                className={cn(
                  "text-lg leading-relaxed tracking-[-0.01em] sm:text-xl",
                  call.captionKind === "fallback" ? "text-white/70 italic" : "text-white",
                )}
              >
                <span className="sr-only">{call.captionKind === "fallback" ? "Notice: " : `${botName} said: `}</span>
                {call.caption}
              </p>
            )}
          </div>

          <p className="min-h-5 max-w-lg text-center text-sm text-white/55" aria-hidden="true">
            {call.interim && !call.muted ? `“${call.interim}”` : ""}
          </p>

          {call.crisis && (
            <button
              type="button"
              onClick={showCrisis}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/[0.06] px-4 py-2 text-sm text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <IconLifeBuoy size={16} />
              Support is available: call or text 988, or 911 in an emergency
            </button>
          )}
          {call.offline && <OfflineNotice />}
        </section>

        {/* Controls */}
        <section
          aria-label="Call controls"
          className="flex items-start justify-center gap-10 pt-2 pb-[max(env(safe-area-inset-bottom),32px)] sm:gap-14"
        >
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={call.toggleMute}
              disabled={!canMute}
              aria-pressed={call.muted}
              aria-label="Mute microphone"
              className={cn(
                roundControl,
                "size-16 border sm:size-[72px]",
                call.muted
                  ? "border-white bg-white text-primary-deep hover:bg-white/90"
                  : "border-white/25 bg-white/10 text-white hover:bg-white/15",
              )}
            >
              {call.muted ? <IconMicOff size={26} /> : <IconMic size={26} />}
            </button>
            <span className="text-xs font-medium text-white/70" aria-hidden="true">
              {call.muted ? "Unmute" : "Mute"}
            </span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => void call.end()}
              aria-label="End call"
              className={cn(
                roundControl,
                "size-16 bg-[#B42318] text-white shadow-[0_6px_20px_rgb(0_0_0/0.25)] hover:bg-[#9b1e14] active:bg-[#861a11] sm:size-[72px]",
              )}
            >
              <IconPhoneOff size={28} />
            </button>
            <span className="text-xs font-medium text-white/70" aria-hidden="true">
              End
            </span>
          </div>
        </section>
      </main>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function CallPageInner() {
  const profile = useActiveProfile();
  const settings = useSettings();
  const { checkStorage } = useApp();
  const { showCrisis } = useSafety();
  const canWrite = useCanWrite();
  const callElsewhere = useCallElsewhere();
  const params = useSearchParams();
  const fromCheckIn = params.get("from") === "checkin";
  const botName = settings.botName;

  const call = useCallController({
    profileId: profile.id,
    displayName: profile.displayName,
    botName,
    tone: settings.tone,
    showCrisis,
    checkStorage,
  });

  const chatLink = (
    <Link href="/chat" className={outlinePill}>
      <IconMessage size={18} />
      Open chat
    </Link>
  );

  if (call.phase === "unsupported") {
    return (
      <MessageScreen
        botName={botName}
        title="Voice calls aren't available in this browser"
        actions={
          <Link href="/chat" className={lightPill}>
            <IconMessage size={18} />
            Open chat
          </Link>
        }
      >
        <p>Voice calls require Chrome or Edge. You can still talk with {botName} in text chat.</p>
      </MessageScreen>
    );
  }

  if (call.phase === "micDenied") {
    return (
      <MessageScreen
        botName={botName}
        title="Microphone access is needed"
        offline={call.offline}
        actions={
          <>
            <button type="button" onClick={call.reset} className={lightPill}>
              <IconMic size={18} />
              Try again
            </button>
            {chatLink}
          </>
        }
      >
        <p>
          Voice calls need your microphone so {botName} can hear you. Allow microphone access for this site in your
          browser&apos;s address bar, then try again. Or switch to text chat.
        </p>
      </MessageScreen>
    );
  }

  if (call.phase === "ended") {
    if (call.error && !call.chatId) {
      return (
        <MessageScreen
          botName={botName}
          title="The call couldn't start"
          actions={
            <>
              <button type="button" onClick={call.reset} className={lightPill}>
                <IconPhone size={18} />
                Try again
              </button>
              {chatLink}
            </>
          }
        >
          <p role="alert">{call.error}</p>
        </MessageScreen>
      );
    }
    return (
      <MessageScreen
        botName={botName}
        title="Call ended"
        actions={
          <>
            <Link href="/" className={lightPill}>
              Back home
            </Link>
            {call.chatId && (
              <Link href={`/chat/${call.chatId}`} className={outlinePill}>
                <IconMessage size={18} />
                View transcript
              </Link>
            )}
            <button
              type="button"
              onClick={call.reset}
              disabled={callElsewhere}
              className={cn(outlinePill, "border-transparent bg-transparent")}
            >
              <IconPhone size={18} />
              Call again
            </button>
          </>
        }
      >
        <p>
          You talked with {botName} for{" "}
          <span className="font-mono tabular-nums text-white" aria-label={spokenDuration(call.elapsedMs)}>
            {formatClock(call.elapsedMs)}
          </span>
          . The conversation is saved in your chats.
        </p>
      </MessageScreen>
    );
  }

  if (call.started && LIVE_PHASES.has(call.phase)) {
    return <LiveCallScreen call={call} botName={botName} />;
  }

  return (
    <PreCallScreen
      call={call}
      botName={botName}
      fromCheckIn={fromCheckIn}
      callElsewhere={callElsewhere}
      canWrite={canWrite}
    />
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-primary-deep" />}>
      <CallPageInner />
    </Suspense>
  );
}
