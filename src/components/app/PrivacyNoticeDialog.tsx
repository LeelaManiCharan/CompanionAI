"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { modelRouter } from "@/services/modelRouter";

/**
 * Gemini_Privacy_Notice (6.21, 6.22). Registers itself as the Model_Router's
 * notice gate: the router awaits the returned promise before sending the first
 * hosted request for a Profile. Continue resolves `true`; Cancel, Escape, or
 * closing resolves `false`, and the router then sends nothing.
 */
export function PrivacyNoticeDialog() {
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((ok: boolean) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    pending?.resolve(ok);
  }, []);

  useEffect(() => {
    modelRouter.setPrivacyNoticeHandler(() => {
      if (pendingRef.current) return pendingRef.current.promise;
      let resolve!: (ok: boolean) => void;
      const promise = new Promise<boolean>((r) => {
        resolve = r;
      });
      pendingRef.current = { promise, resolve };
      setOpen(true);
      return promise;
    });
    return () => {
      modelRouter.setPrivacyNoticeHandler(null);
      // Never leave the router waiting on an unmounted dialog.
      const pending = pendingRef.current;
      pendingRef.current = null;
      pending?.resolve(false);
    };
  }, []);

  return (
    <Dialog
      open={open}
      onClose={() => settle(false)}
      closeOnBackdrop={false}
      initialFocusRef={continueRef}
      title="Use the hosted Gemini model?"
      description="Shown once per profile, before the first hosted reply."
      actions={
        <>
          <Button variant="secondary" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button ref={continueRef} variant="primary" onClick={() => settle(true)}>
            Continue
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[15px] leading-6 text-text/90">
        <p>
          Ollama isn&apos;t handling this reply, so it will come from Google&apos;s Gemini. To answer, the app sends your
          chat context (recent messages, your profile summary, and relevant memories) to Google through this
          app&apos;s server.
        </p>
        <ul className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-subtle px-4 py-3 text-sm leading-5 text-text/85">
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
            The server only forwards the request. It doesn&apos;t store your messages.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
            Google&apos;s terms apply to anything sent to Gemini.
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-primary" />
            To keep everything on your device, run Ollama locally and pick it in Settings.
          </li>
        </ul>
        <p className="text-sm text-muted">If you cancel, nothing is sent and your message stays as it is.</p>
      </div>
    </Dialog>
  );
}
