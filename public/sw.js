/* Companion check-in notification service worker (Req 13.4, 13.7). No caching. */

const CALL_URL = "/call?from=checkin";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Only same-origin call-page paths (check-in or reminder call, Req 24.6).
  const url = typeof data.url === "string" && /^\/call(?:\?|$)/.test(data.url) ? data.url : CALL_URL;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        try {
          await client.focus();
        } catch {
          // Focus can fail without user activation; still deliver the message.
        }
        client.postMessage({ type: "open-call", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
