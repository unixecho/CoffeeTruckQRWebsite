import { NextResponse } from "next/server";

import { cancelOrderByCustomer, findOrderByToken, toPublicView } from "@/lib/orders";
import { openPublicAction } from "@/lib/publicRoute";
import { canCustomerCancel, canRetryPayment } from "@/lib/payments/status";
import type { Order } from "@/lib/payments/types";

/* ==========================================================================
   POST /api/checkout/[token]/cancel

   The customer changing their mind, which at a market stand is a normal thing
   to do and should not require finding a person.

   Refused once money has moved: cancelling a settled payment is a refund, and
   a refund happens at the provider with a human deciding it — not by writing
   a column here. `canCustomerCancel` in `status.ts` is the single place that
   rule lives, so this route and the button that calls it cannot disagree
   about when it applies.
   ========================================================================== */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const opened = await openPublicAction(request, { bucket: "checkout-cancel", perIpMax: 12 });
  if (!opened.ok) return opened.response;

  const order = await findOrderByToken(token);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  if (order.status === "cancelled") {
    // Already cancelled. The caller's intent is satisfied; answering 409 here
    // would only make a flaky connection look like a failure.
    return NextResponse.json(answer(order));
  }

  const cancelled = await cancelOrderByCustomer(order);
  if (!cancelled) {
    return NextResponse.json({ error: "illegal_transition" }, { status: 409 });
  }

  return NextResponse.json(answer(cancelled));
}

/**
 * The same shape `GET /api/checkout/[token]` returns.
 *
 * Including `can` is not decoration: the order screen applies this response
 * directly to the state it renders from, and a response missing `can` would
 * leave the component reading `can.cancel` off `undefined` a moment later.
 * Every endpoint that hands back an order hands back the whole shape.
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
