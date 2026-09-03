import { NextResponse } from "next/server";

import {
  applyPaymentEvent,
  findOrderByProviderRef,
  recordUnmatchedEvent,
} from "@/lib/orders";
import { providerById } from "@/lib/payments/provider";
import { paymentLog } from "@/lib/payments/log";
import { isPaymentSettled } from "@/lib/payments/status";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { rateLimited, withinRateLimit } from "@/lib/validate";

/* ==========================================================================
   POST /api/payments/webhook/[provider] — the provider calling back

   The one endpoint here that is neither same-origin nor authenticated, and it
   cannot be either: it is called by somebody else's server, from an address
   we do not know in advance, with no cookie and no `Origin`. So none of the
   rails in `publicRoute.ts` apply and the containment is different in kind.

   ## The rule this route is built around

   **A POST to this URL is not evidence of anything.** Anyone can send one.
   What it *is* is a prompt to go and ask the provider what happened, over a
   connection we opened, to a host we configured, with credentials only we
   hold. That server-to-server read is the authority; the callback body is a
   hint about which payment to ask about.

   Two consequences fall out of that, and both are deliberate:

   - The order is resolved **only** by the payment reference we ourselves
     stored when we created the session. The body's own idea of which order it
     concerns is never used to look one up — that would let a stranger
     nominate an order to mark paid.
   - Even a body that arrives with a valid signature is confirmed by reading
     the transaction back before an order settles. A signature proves the
     bytes came from the provider; it does not prove the amount matches what
     we priced, and that check is the one that stops an order being handed
     over against a payment for a different sum.

   ## Status codes, and why they are what they are

   `200` for anything **understood** — including events deliberately ignored
   as duplicates or illegal transitions. Answering an error there makes the
   provider retry a decision we already made, forever.

   `4xx` for a malformed or unrecognised body: a retry will not fix it.

   `404` when no order matches the reference. That *is* retryable and is meant
   to be: the most likely cause is a callback overtaking our own write of the
   reference by a few milliseconds, and a provider retry a minute later
   resolves it.

   `5xx` only for our own transient failure, which is exactly when a retry
   helps.
   ========================================================================== */

/** A callback body is small. Anything larger is not one. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Bounded generously.
 *
 * A provider legitimately retries, and several orders can settle in the same
 * minute at a busy stand. This exists to stop an open endpoint being used as
 * a free write amplifier, not to shape honest traffic — and it deliberately
 * has no per-caller dimension, because the caller is one server whose address
 * we do not control.
 */
const WEBHOOK_MAX = 600;
const WEBHOOK_WINDOW_SECONDS = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: providerId } = await params;

  /* A literal registry lookup, not a constructed provider. The path segment
     is client-controlled, and the only thing it is allowed to do is fail to
     match. */
  const provider = providerById(providerId);
  if (!provider) {
    paymentLog("warn", "webhook.unknownProvider", { provider: providerId });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const db = createServiceClient();

  const allowed = await withinRateLimit(
    db,
    `webhook:${provider.id}`,
    WEBHOOK_MAX,
    WEBHOOK_WINDOW_SECONDS
  );
  if (!allowed) {
    paymentLog("error", "webhook.rateLimited", { provider: provider.id });
    /* 429 rather than a silent drop: a provider that is being throttled
       should back off and retry, and it can only know to do that if told. */
    return rateLimited();
  }

  /* Read as text, once. The signature — where there is one — is over the
     bytes on the wire, and any re-serialisation between what was hashed and
     what arrived is a way for two different payloads to share one signature. */
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const parsed = await provider.parseWebhook(request, rawBody);
  if (!parsed.ok) {
    paymentLog("warn", "webhook.unparseable", { provider: provider.id, reason: parsed.error });
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const event = parsed.value;

  const order = event.providerRef
    ? await findOrderByProviderRef(db, provider.id, event.providerRef.id)
    : null;

  if (!order) {
    await recordUnmatchedEvent(
      db,
      {
        provider: provider.id,
        providerEventId: event.providerEventId,
        kind: "webhook",
        status: event.status,
        paidAgorot: event.paidAgorot,
        signatureValid: event.signatureValid,
        payload: event.payload,
      },
      "no_matching_order"
    );

    paymentLog("warn", "webhook.noMatchingOrder", {
      provider: provider.id,
      ref: event.providerRef?.id,
    });
    // Retryable on purpose — see the header.
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  /* The confirming read. Always performed when the callback claims money
     moved, and also whenever the payload could not authenticate itself.
     The claim is only ever used unconfirmed for a *signed* non-settling
     event — a failure or a cancellation — where believing it early costs a
     customer nothing worse than an early "try again". */
  let status = event.status;
  let paidAgorot = event.paidAgorot;
  let confirmed = false;

  if (isPaymentSettled(event.status) || !event.signatureValid) {
    if (!order.providerRef) {
      paymentLog("error", "webhook.noStoredRef", { orderId: order.id });
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }

    const snapshot = await provider.fetchStatus(order.providerRef);

    if (snapshot.ok) {
      status = snapshot.value.status;
      paidAgorot = snapshot.value.paidAgorot;
      confirmed = true;
    } else if (!event.signatureValid) {
      /* Unsigned and unconfirmable. Nothing is written to the order — an
         unverified claim about money is not a fact — but the attempt is
         logged so the pattern is visible if it repeats. A 5xx asks the
         provider to try again once we can reach it. */
      await recordUnmatchedEvent(
        db,
        {
          provider: provider.id,
          providerEventId: event.providerEventId,
          kind: "webhook",
          status: event.status,
          paidAgorot: event.paidAgorot,
          signatureValid: false,
          payload: event.payload,
        },
        "unconfirmed_and_unsigned"
      );
      paymentLog("error", "webhook.unconfirmed", {
        orderId: order.id,
        provider: provider.id,
        reason: snapshot.error,
      });
      return NextResponse.json({ error: "provider_unavailable" }, { status: 503 });
    }
  }

  const applied = await applyPaymentEvent(order.id, {
    provider: provider.id,
    providerEventId: event.providerEventId,
    kind: "webhook",
    status,
    paidAgorot,
    signatureValid: event.signatureValid || confirmed,
    payload: event.payload,
  });

  if (!applied) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  paymentLog("info", "webhook.handled", {
    orderId: order.id,
    provider: provider.id,
    claimed: event.status,
    resolved: status,
    applied: applied.applied,
    reason: applied.reason,
  });

  /* 200 whether or not anything changed. "Understood, and deliberately
     ignored" is a success from the provider's point of view; anything else
     asks it to redeliver a decision we have already made. */
  return NextResponse.json({ ok: true, applied: applied.applied });
}
