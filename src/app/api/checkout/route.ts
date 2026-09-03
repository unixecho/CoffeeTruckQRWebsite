import { NextResponse } from "next/server";

import { createOrder, toPublicView } from "@/lib/orders";
import { openPublicWrite } from "@/lib/publicRoute";
import { emitCheckoutEvent } from "@/lib/payments/analytics";
import { cardPaymentAvailable } from "@/lib/payments/provider";
import { honeypotFilled, parseCheckoutRequest } from "@/lib/payments/validate";
import { invalid } from "@/lib/validate";
import { readCatalogue } from "@/lib/catalog";

/* ==========================================================================
   POST /api/checkout — place an order

   The **first endpoint in this codebase a stranger can reach with no
   session**, which is why it opens with `openPublicWrite` rather than
   `openWrite`. See `lib/publicRoute.ts` for the rail stack and PLAYBOOK §4
   for why it is a stack rather than a guard.

   ## It creates an order and nothing else

   Starting the payment is a separate request to `/api/checkout/[token]/pay`.
   That split is deliberate: a card session can fail — the provider is down,
   the credentials are wrong, the network dropped — and if creating one were
   part of this request, that failure would take the order down with it and
   the customer would be back at an empty cart. Separated, a failed session is
   a retry button over an order that already exists, and the counter is always
   there underneath.

   ## Nothing money-shaped is read from the body

   `parseCheckoutRequest` accepts picks, a name, a phone and a note. Prices,
   totals and discounts are computed in `createOrder` from the live catalogue.
   A total arriving from a browser is a claim, not an input.
   ========================================================================== */

export async function POST(request: Request) {
  const opened = await openPublicWrite<unknown>(request, { bucket: "checkout" });
  if (!opened.ok) return opened.response;

  /* A filled honeypot gets a cheerful 200 and nothing is written. A bot that
     learns which field gave it away simply stops filling that one in, so the
     refusal must be indistinguishable from success. No real client can reach
     this branch: the field is hidden, and the checkout never writes to it.
     PLAYBOOK §4.1.4. */
  if (honeypotFilled(opened.body)) {
    return NextResponse.json({ ok: true });
  }

  const parsed = parseCheckoutRequest(opened.body);
  if (!parsed.ok) {
    emitCheckoutEvent({ name: "checkout_rejected", reason: "unknown" });
    return invalid(parsed.error);
  }

  /* Card is refused here as well as hidden in the UI. The storefront only
     offers it when the server-rendered page said it was available, but "the
     UI does not offer it" is not a check — this endpoint is reachable with
     curl, and a card order with no provider behind it would sit unpayable. */
  if (parsed.value.paymentMethod === "card") {
    const { settings } = await readCatalogue();
    if (!settings.onlinePaymentsEnabled || !cardPaymentAvailable()) {
      emitCheckoutEvent({ name: "checkout_rejected", reason: "provider_not_configured" });
      return NextResponse.json({ error: "provider_not_configured" }, { status: 409 });
    }
  }

  const created = await createOrder(parsed.value);

  if (!created.ok) {
    emitCheckoutEvent({ name: "checkout_rejected", reason: created.error });

    const status =
      created.error === "checkout_disabled" ? 503
      : created.error === "cart_unavailable" ? 409
      : created.error === "cart_empty" ? 400
      : 500;

    return NextResponse.json(
      {
        error: created.error,
        /* Which lines went stale, so the cart can repair itself rather than
           telling somebody "something changed" and leaving them to guess. */
        ...(created.unavailable ? { unavailable: created.unavailable } : {}),
      },
      { status }
    );
  }

  const { order, token, replayed } = created;

  return NextResponse.json(
    {
      ok: true,
      /* The bearer credential for this order, handed over exactly once per
         request. Only its hash is stored — see `lib/orders.ts`. */
      token,
      order: toPublicView(order),
      /* True when this was a retry of a request whose response was lost. The
         client uses it to avoid double-counting an "order placed" moment. */
      replayed,
      nextStep: order.paymentMethod,
    },
    { status: replayed ? 200 : 201 }
  );
}
