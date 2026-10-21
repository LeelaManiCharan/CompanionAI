/**
 * Notification_Service (Req 13, 24.6). Browser-only; every function is SSR-safe and
 * feature-detects before touching Notification / ServiceWorker APIs.
 */

export type NotificationPermissionState = NotificationPermission | "unsupported";

export const CALL_URL = "/call?from=checkin";
const SW_URL = "/sw.js";
const MAX_BODY = 120;
const DEFAULT_BODY = "Got a minute to check in?";

/** URL that answers a reminder call (24.6). */
export function reminderCallUrl(reminderId: string): string {
  return `/call?from=reminder&reminder=${encodeURIComponent(reminderId)}`;
}

/** Only same-origin call-page paths are accepted as notification click targets. */
export function safeCallUrl(url: unknown): string {
  return typeof url === "string" && /^\/call(?:\?|$)/.test(url) ? url : CALL_URL;
}

let registration: ServiceWorkerRegistration | null = null;
let registering: Promise<ServiceWorkerRegistration | null> | null = null;
/** True when service worker registration failed or is unavailable (13.9). */
let useFallback = false;

const hasWindow = (): boolean => typeof window !== "undefined";

/** Notification API is available (13.8). */
export function isSupported(): boolean {
  return hasWindow() && "Notification" in window && typeof window.Notification === "function";
}

export function serviceWorkerSupported(): boolean {
  return hasWindow() && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

export function permission(): NotificationPermissionState {
  return isSupported() ? window.Notification.permission : "unsupported";
}

/** Whether notifications are shown from the page instead of the service worker. */
export function isFallback(): boolean {
  return useFallback || !serviceWorkerSupported();
}

/**
 * Requests permission only when the state is "default" (13.1, 13.2). Must be called
 * synchronously from a user gesture (the settings toggle's click handler).
 */
export async function requestPermissionOnce(): Promise<NotificationPermissionState> {
  if (!isSupported()) return "unsupported";
  const current = window.Notification.permission;
  if (current !== "default") return current;
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

/** Registers /sw.js (13.7). On failure sets the page-notification fallback flag (13.9). */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return Promise.resolve(registration);
  if (registering) return registering;
  if (!serviceWorkerSupported()) {
    useFallback = true;
    return Promise.resolve(null);
  }
  registering = navigator.serviceWorker
    .register(SW_URL, { scope: "/" })
    .then((reg) => {
      registration = reg;
      useFallback = false;
      return reg;
    })
    .catch(() => {
      useFallback = true;
      return null;
    })
    .finally(() => {
      registering = null;
    });
  return registering;
}

export interface CheckInNotification {
  profileId: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  botName: string;
  body: string;
}

export interface ReminderNotification {
  reminderId: string;
  botName: string;
  text: string;
}

function normalizeBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return DEFAULT_BODY;
  if (trimmed.length <= MAX_BODY) return trimmed;
  return trimmed.slice(0, MAX_BODY - 1).trimEnd() + "…";
}

function navigateToCall(url: string): void {
  if (!hasWindow()) return;
  try {
    window.focus();
  } catch {
    // ignore
  }
  window.location.assign(url);
}

/** Shows a "{botName} is calling" notification that opens `url` when clicked. */
async function showCall(botNameRaw: string, body: string, tag: string, url: string): Promise<boolean> {
  if (!isSupported() || window.Notification.permission !== "granted") return false;

  const botName = botNameRaw.trim() || "Companion";
  const title = `${botName} is calling`;
  const options: NotificationOptions = { body: normalizeBody(body), tag, data: { url } };

  if (!useFallback) {
    const reg = registration ?? (await registerServiceWorker());
    if (reg) {
      try {
        await reg.showNotification(title, options);
        return true;
      } catch {
        // fall through to page notification
      }
    }
  }

  try {
    const n = new window.Notification(title, options);
    n.onclick = (event) => {
      event.preventDefault();
      n.close();
      navigateToCall(url);
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Shows one check-in notification (13.3). The tag collapses duplicates for the same
 * profile and date. Returns true when a notification was shown.
 */
export function showCheckIn(input: CheckInNotification): Promise<boolean> {
  return showCall(input.botName, input.body, `checkin-${input.profileId}-${input.date}`, CALL_URL);
}

/** Shows a reminder call notification (24.6); clicking opens the reminder call. */
export function showReminder(input: ReminderNotification): Promise<boolean> {
  return showCall(
    input.botName,
    `Reminder: ${input.text}`,
    `reminder-${input.reminderId}`,
    reminderCallUrl(input.reminderId),
  );
}

/**
 * Subscribes to `{type:"open-call", url?}` messages from the service worker.
 * The callback receives a safe `/call…` URL. Returns an unsubscribe fn.
 */
export function onOpenCall(cb: (url: string) => void): () => void {
  if (!serviceWorkerSupported()) return () => {};
  const handler = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { type?: unknown }).type === "open-call"
    ) {
      cb(safeCallUrl((data as { url?: unknown }).url));
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
