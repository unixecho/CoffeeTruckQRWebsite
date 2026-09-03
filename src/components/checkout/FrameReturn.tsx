"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

import { Spinner } from "@/components/ios/Feedback";
import { useI18n } from "@/lib/i18n";
import { RETURN_TOKEN_KEY } from "./session";

/* ==========================================================================
   The page inside the payment frame

   Two situations, and the second is the one that is easy to forget.

   **1. It loaded inside our own frame**, which is the normal case. It posts
   one message up to the parent — targeted at our own origin explicitly, never
   `"*"` — and the parent goes and asks our server what happened. The message
   carries a status only as a hint about *why* to re-read; the parent never
   treats it as an answer, because a browser arriving at a success URL proves
   only that a browser arrived at a success URL.

   **2. It loaded as the whole tab.** Some providers, and some 3-D Secure
   flows, break out of the frame and redirect the top window instead. Without
   handling that, the customer lands on a blank page having just paid, with no
   way back to their order — the worst possible moment for a dead end.

   The way back is `sessionStorage`: the order screen wrote its token there
   before opening the payment, and this page is the same origin in the same
   tab, so it can read it. That is also why the token is **not** in this URL —
   the provider is handed this address, and anything in it is something a
   third party ends up holding.
   ========================================================================== */

type Outcome = "success" | "failure" | "cancel";

function readOutcome(raw: string | null): Outcome {
  return raw === "success" || raw === "failure" ? raw : "cancel";
}

export function FrameReturn() {
  const { t } = useI18n();
  const params = useSearchParams();
  const status = readOutcome(params.get("status"));

  useEffect(() => {
    const framed = window.parent !== window;

    if (framed) {
      window.parent.postMessage(
        { source: "coffeetruck", type: "payment-return", status },
        window.location.origin
      );
      return;
    }

    /* Top-level. Find the way back to the order the customer was paying for.
       `replace`, not `push`: the provider's redirect chain is already in the
       history and sending them back into it would re-open a finished payment. */
    let token: string | null = null;
    try {
      token = window.sessionStorage.getItem(RETURN_TOKEN_KEY);
    } catch {
      // Private-mode Safari refuses storage access outright.
    }

    window.location.replace(token ? `/checkout/${encodeURIComponent(token)}` : "/shop");
  }, [status]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Spinner label={t.common.loading} />
      <p className="text-subheadline" style={{ color: "var(--label-secondary)" }}>
        {t.checkout.payingTitle}
      </p>
    </div>
  );
}
