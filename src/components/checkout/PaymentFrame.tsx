"use client";

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { Spinner } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { useI18n } from "@/lib/i18n";

/* ==========================================================================
   The hosted payment frame

   The provider's own page, rendered inside our layout. The card fields live
   in *their* document on *their* origin, so nothing typed into them is
   reachable from our JavaScript, never reaches our server, and cannot appear
   in our logs. That is the entire reason to use hosted fields rather than
   posting a form ourselves, and every decision below follows from protecting
   it.

   ## The message from inside

   When the provider finishes it navigates the frame to our own
   `/checkout/frame-return` page, which posts a message up to this window.
   Two rules govern that:

   1. **Only our own origin is believed.** The listener drops anything else
      without looking at it. The provider's page is not expected to talk to
      us, and a message from a third origin has no legitimate meaning.
   2. **The message decides nothing.** It is a prompt to go and ask our own
      server, which asks the provider over a connection we opened. A browser
      arriving at a success URL proves only that a browser arrived at a
      success URL — anybody can navigate to one.

   ## The sandbox

   Each token is there for a reason, and the set is as small as a hosted
   payment page can work with:

     allow-scripts                       the page is an application
     allow-forms                         it submits the card
     allow-same-origin                   its own storage and cookies. This does
                                         NOT grant access to *our* origin — the
                                         frame's origin is the provider's.
     allow-popups                        3-D Secure often opens a bank window
     allow-popups-to-escape-sandbox      that window must not inherit this
                                         sandbox, or the bank's page breaks
     allow-top-navigation-by-user-activation
                                         it may take over the tab only if the
                                         customer actually tapped something —
                                         which is what stops a silent redirect
                                         out from under them

   Deliberately absent: `allow-modals`, `allow-downloads`, and plain
   `allow-top-navigation`.
   ========================================================================== */

/** How long to wait for the provider's page before offering a way out. */
const LOAD_TIMEOUT_MS = 15_000;

export type FrameOutcome = "success" | "failure" | "cancel";

interface ReturnMessage {
  source: "coffeetruck";
  type: "payment-return";
  status: FrameOutcome;
}

function isReturnMessage(data: unknown): data is ReturnMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Partial<ReturnMessage>;
  return (
    message.source === "coffeetruck" &&
    message.type === "payment-return" &&
    (message.status === "success" || message.status === "failure" || message.status === "cancel")
  );
}

export function PaymentFrame({
  url,
  onOutcome,
  onStuck,
}: {
  url: string;
  onOutcome: (outcome: FrameOutcome) => void;
  /** The page did not load in time. The caller offers a retry and the counter. */
  onStuck: () => void;
}) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const outcomeRef = useRef(onOutcome);
  const stuckRef = useRef(onStuck);

  /* The callbacks are held in refs so the listener effect below depends only
     on the URL. Without this, every parent re-render — and the status poll
     ticks every three seconds — would tear the listener down and rebuild it,
     and a message arriving in that gap would be lost. That is the one message
     that matters.

     Synced in an effect rather than assigned during render: a ref written
     while rendering is a ref whose value depends on how many times React
     chose to render, which is not something a component may know. */
  useEffect(() => {
    outcomeRef.current = onOutcome;
    stuckRef.current = onStuck;
  });

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Rule 1: only our own origin. See the header.
      if (event.origin !== window.location.origin) return;
      if (!isReturnMessage(event.data)) return;
      outcomeRef.current(event.data.status);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [url]);

  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(() => stuckRef.current(), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loaded, url]);

  /* Derived from the URL the server already validated against the frame-origin
     allowlist, so this cannot widen what is permitted — it only narrows the
     Payment Request API to the one origin actually being framed. */
  const providerOrigin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return "";
    }
  })();

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative w-full overflow-hidden"
        style={{
          borderRadius: "var(--radius-card)",
          backgroundColor: "var(--bg-grouped-secondary)",
          /* Tall enough for a card form plus a 3-D Secure step without the
             frame scrolling inside a scrolling page, which is the single most
             unpleasant thing a phone checkout can do. */
          minHeight: 520,
        }}
      >
        {!loaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Spinner label={t.common.loading} />
            <p className="text-footnote" style={{ color: "var(--label-secondary)" }}>
              {t.checkout.payingTitle}
            </p>
          </div>
        )}

        <iframe
          src={url}
          title={t.checkout.paymentWindow}
          onLoad={() => setLoaded(true)}
          className="h-[520px] w-full"
          style={{ border: "none", opacity: loaded ? 1 : 0, transition: "opacity 0.3s var(--ease-ios)" }}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
          allow={providerOrigin ? `payment ${providerOrigin}` : "payment"}
          /* No referrer to a payment page. The order token lives in our URL,
             and a `Referer` header carrying it to a third party would hand
             them a bearer credential for the order. */
          referrerPolicy="no-referrer"
        />
      </div>

      <p
        className="text-caption-1 flex items-center justify-center gap-1.5"
        style={{ color: "var(--label-secondary)" }}
      >
        <Lock size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />
        {t.checkout.methodCardHelper}
      </p>
    </div>
  );
}
