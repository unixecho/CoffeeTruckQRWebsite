import { NextResponse } from "next/server";

import { anonymizeOrder, applyPaymentEvent, findOrderByToken, toPublicView } from "@/lib/orders";
import { openPublicAction } from "@/lib/publicRoute";
import { providerById } from "@/lib/payments/provider";
import { canCustomerCancel, canRetryPayment } from "@/lib/payments/status";
import type { Order } from "@/lib/payments/types";
import { paymentLog } from "@/lib/payments/log";

/* ==========================================================================
   /api/checkout/[token]

   GET     — what happened to my order?
   DELETE  — forget my name and number.

   The token in the path is a bearer credential: holding it is the whole
   authorisation. That is a deliberate trade and the reason the shape it
   unlocks is a hand-written subset (`toPublicView`) rather than the order
   row — an order carries a name, a phone number, a provider reference and a
   paid amount, and only the first three lines of that list are the
   customer's business.

   Only the token's SHA-256 is stored, so the value travelling in this URL
   never exists in the database. `Referrer-Policy: strict-origin-when-cross-
   origin` (set in `next.config.ts`) keeps it out of third-party referrers.

   ## Why GET can write

   With `?confirm=1`, this asks the provider what really happened and applies
   the answer. That is the load-bearing half of the payment flow: a browser
   arriving at a success page proves only that a browser arrived at a success
   page. The customer's own device coming back is the *prompt* to check; the
   server-to-server read is the *evidence*. Nothing marks an order paid on the
   strength of a redirect.

   `confirm` is a separate, tighter rate-limit bucket because it costs an
   outbound HTTP call, while a plain poll costs one indexed read.
   ========================================================================== */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const url = new URL(request.url);
  const confirm = url.searchParams.get("confirm") === "1";

  const opened = await openPublicAction(request, {
    bucket: confirm ? "checkout-confirm" : "checkout-status",
    perIpMax: confirm ? 20 : 90,
    globalMax: confirm ? 300 : 1200,
  });
  if (!opened.ok) return opened.response;

  const order = await findOrderByToken(token);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  let current = order;

  if (confirm && current.paymentStatus === "pending" && current.provider && current.providerRef) {
    const provider = providerById(current.provider);
    if (provider) {
      const snapshot = await provider.fetchStatus(current.providerRef);

      if (snapshot.ok) {
        const applied = await applyPaymentEvent(current.id, {
          provider: provider.id,
          /* A poll is not a delivery, so there is no provider event id to
             deduplicate on. Keyed by the status it observed, which means
             polling twice on the same outcome writes one log row — and if the
             outcome changes, that is a new row, which is what the log is for. */
          providerEventId: `poll:${current.providerRef.id}:${snapshot.value.status}`,
          kind: "poll",
          status: snapshot.value.status,
          paidAgorot: snapshot.value.paidAgorot,
          signatureValid: true, // a direct read from the provider, over TLS
          payload: { providerStatusCode: snapshot.value.providerStatusCode },
        });
        if (applied) current = applied.order;
      } else {
        /* Not an error to the customer. The order is unchanged and the page
           keeps polling; saying "payment failed" because *we* could not reach
           the provider would be a lie told at a counter. */
        paymentLog("warn", "checkout.confirmFailed", {
          orderId: current.id,
          detail: snapshot.error,
        });
      }
    }
  }

  /* Capabilities rather than raw statuses, so the client renders one decision
     made in one place. The state machine answers them; a UI re-deriving them
     from a status string is a UI that will one day disagree with the server
     about whether a button should exist. */
  return NextResponse.json(answer(current));
}

/* --------------------------------------------------------------------------
   DELETE — the customer's own data-rights action

   The site now stores something about a person for the first time, which is
   what makes a self-service route to remove it necessary rather than nice
   (PLAYBOOK §1.4). It is cheap to build now and expensive to retrofit.

   It anonymises rather than deleting: what was sold and for how much is the
   shop's own business record and is subject to bookkeeping rules the shop
   does not get to opt out of. Who bought it is not, and that is what this
   clears. The status page shows exactly the fields this removes, so "see what
   you hold" and "remove it" are one screen instead of a process.
   -------------------------------------------------------------------------- */

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const opened = await openPublicAction(request, { bucket: "checkout-forget", perIpMax: 10 });
  if (!opened.ok) return opened.response;

  const order = await findOrderByToken(token);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  if (order.anonymizedAt !== null) {
    // Already done. Answering 200 rather than 409 — the caller's intent is
    // satisfied, and telling them otherwise invites a pointless retry.
    return NextResponse.json(answer(order));
  }

  const updated = await anonymizeOrder(order);
  if (!updated) return NextResponse.json({ error: "unknown" }, { status: 500 });

  return NextResponse.json(answer(updated));
}

/**
 * The one response shape every order endpoint returns.
 *
 * `can` travels with the order because the client applies these responses
 * straight into the state it renders from — a reply carrying an order but no
 * capabilities would leave the screen reading `can.cancel` off `undefined` on
 * its next paint.
 */
function answer(order: Order) {
  return {
    ok: true,
    order: toPublicView(order),
    can: {
      retryPayment: canRetryPayment(order),
      cancel: canCustomerCancel(order),
    },
  };
}
