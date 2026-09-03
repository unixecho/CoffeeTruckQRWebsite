import { NextResponse } from "next/server";

import { readCatalogue } from "@/lib/catalog";
import { attachPaymentSession, findOrderByToken, toPublicView } from "@/lib/orders";
import { openPublicAction } from "@/lib/publicRoute";
import { emitCheckoutEvent } from "@/lib/payments/analytics";
import { cardPaymentAvailable, cardProvider } from "@/lib/payments/provider";
import { canRetryPayment } from "@/lib/payments/status";
import { paymentLog } from "@/lib/payments/log";
import { siteUrl } from "@/lib/site";
import { localize } from "@/lib/types";

/* ==========================================================================
   POST /api/checkout/[token]/pay — start (or restart) a card payment

   Separate from placing the order on purpose. A payment session is the part
   that can fail for reasons that have nothing to do with the customer — the
   provider is down, a credential rotated, the tether dropped — and every one
   of those must leave a retry button over an order that still exists rather
   than an empty cart and a queue.

   So this endpoint is **safe to call repeatedly**. Each call asks the
   provider for a fresh session and swaps the order's reference for the new
   one, guarded by a compare-and-swap so two taps cannot leave a live payment
   attempt that no order points at.

   ## What the provider is told

   An amount, an order number, a description, and — only if the customer
   typed them — a name and a phone. No cart contents, no email, no ID number,
   no address. The return URLs carry a status and nothing else: putting the
   order token in one would hand a third party a bearer credential for the
   order, and the page it returns to does not need it (the parent window
   already knows which order it is watching).
   ========================================================================== */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const opened = await openPublicAction(request, { bucket: "checkout-pay", perIpMax: 12 });
  if (!opened.ok) return opened.response;

  const order = await findOrderByToken(token);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  if (order.status === "expired") {
    return NextResponse.json({ error: "order_expired" }, { status: 409 });
  }
  if (order.paymentStatus === "paid") {
    // Not an error worth alarming anyone with: answer with the order and let
    // the client show the receipt it was about to ask for anyway.
    return NextResponse.json({ error: "order_already_paid", order: toPublicView(order) }, { status: 409 });
  }
  if (!canRetryPayment(order)) {
    return NextResponse.json({ error: "illegal_transition" }, { status: 409 });
  }

  const { settings } = await readCatalogue();
  if (!settings.onlinePaymentsEnabled || !cardPaymentAvailable()) {
    return NextResponse.json({ error: "provider_not_configured" }, { status: 409 });
  }

  const provider = cardProvider();

  /* Checked before the provider is called, not after. Nothing in this tree is
     built for another presentation yet, and asking a provider to open a
     session we then cannot render would leave a live payment attempt at their
     end that no screen ever shows — the exact kind of orphan that turns up
     later as a customer saying they paid. */
  if (provider.presentation !== "embedded_iframe") {
    return NextResponse.json({ error: "provider_not_configured" }, { status: 409 });
  }

  const number = String(order.orderNumber).padStart(4, "0");

  const session = await provider.createSession({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountAgorot: order.totalAgorot,
    currency: "ILS",
    locale: order.locale,
    /* Shown on the provider's own page and on the card statement. The order
       number and the shop name — deliberately not the cart contents, which
       would put what somebody bought onto a third party's records and onto a
       shared bank statement. */
    description: `${localize({ he: "הדפסות תלת־ממד", en: "3D Prints", ar: "طباعة ثلاثية الأبعاد" }, order.locale)} #${number}`,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    returnUrls: {
      success: siteUrl("/checkout/frame-return?status=success"),
      failure: siteUrl("/checkout/frame-return?status=failure"),
      cancel: siteUrl("/checkout/frame-return?status=cancel"),
    },
    /* Stable for this order and this attempt count, so a provider that
       honours idempotency keys treats a re-sent create as the same request.
       `updatedAt` moves whenever the order does, which is what makes a
       deliberate retry a new key while a duplicated request is not. */
    idempotencyKey: `${order.id}:${order.updatedAt}`,
  });

  if (!session.ok) {
    emitCheckoutEvent({
      name: "payment_session_failed",
      orderId: order.id,
      provider: provider.id,
      reason: session.error,
    });
    paymentLog("error", "checkout.sessionFailed", {
      orderId: order.id,
      provider: provider.id,
      reason: session.error,
      detail: session.detail,
    });

    /* 502, not 500: the failure is upstream, and the distinction is what the
       client uses to decide between "try again" and "pay at the counter".
       `retryable` comes from the transport layer, which knows whether the
       provider said it did nothing or simply never answered. */
    return NextResponse.json(
      { error: session.error, retryable: session.retryable ?? true },
      { status: 502 }
    );
  }

  if (session.value.kind !== "embedded_iframe") {
    /* Unreachable given the `presentation` check above, and kept because it is
       what narrows the union for the compiler — which means a provider whose
       declared presentation disagrees with what it actually returns fails here
       rather than one line further down with a missing `url`. */
    return NextResponse.json({ error: "provider_not_configured" }, { status: 409 });
  }

  const attached = await attachPaymentSession(
    order.id,
    provider.id,
    session.value.providerRef,
    order.paymentStatus
  );

  if (!attached) {
    /* Another request moved the order between the read and the write — a
       double tap, or a webhook landing mid-flight. The new session is
       abandoned rather than forced over the winner's; the client re-reads the
       status and finds out what actually happened. */
    paymentLog("warn", "checkout.sessionRaced", { orderId: order.id });
    return NextResponse.json({ error: "illegal_transition" }, { status: 409 });
  }

  emitCheckoutEvent({
    name: "payment_session_created",
    orderId: order.id,
    provider: provider.id,
  });

  return NextResponse.json({
    ok: true,
    session: {
      kind: "embedded_iframe",
      /* Already checked against the frame-origin allowlist inside the
         adapter, which reads the same list the CSP `frame-src` is built from.
         The provider's reference is deliberately not returned — it is ours,
         not the customer's. */
      url: session.value.url,
    },
  });
}
