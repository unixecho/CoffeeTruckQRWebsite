import { NextResponse } from "next/server";

import { openWrite, audit } from "@/lib/route";
import { cancelOrderByOwner, collectOrder, findOrderById, toPublicView } from "@/lib/orders";
import { asRecord, invalid, notFound, parseUuid } from "@/lib/validate";

/* ==========================================================================
   PATCH /api/manager/orders/[id]

   Two actions, and only two: hand it over, or call it off. Everything else an
   order can become happens by itself — a payment settles, a window expires,
   a customer cancels — and giving the owner buttons for those would be
   offering to write a status rather than to do a thing.

   `staff` may use this. It is the same class of action as adjusting stock:
   somebody standing at the truck handing a bag over, not somebody changing
   what things cost. Every other manager route stays owner-only.
   ========================================================================== */

const ACTIONS = ["collect", "cancel"] as const;
type Action = (typeof ACTIONS)[number];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const opened = await openWrite<unknown>(request, { role: "staff" });
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const { id } = await params;
  const orderId = parseUuid(id, "id");
  if (!orderId.ok) return invalid(orderId.error);

  const parsed = asRecord(body);
  if (!parsed) return invalid({ field: "body", message: "Expected an object." });

  const action = parsed.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return invalid({ field: "action", message: "Expected collect or cancel." });
  }

  const order = await findOrderById(db, orderId.value);
  if (!order) return notFound("order");

  const updated =
    (action as Action) === "collect"
      ? await collectOrder(db, order)
      : await cancelOrderByOwner(db, order);

  if (!updated) {
    /* The state machine refused. Almost always because somebody else already
       did it — two phones at one truck, or the owner tapping twice — so this
       is a conflict rather than a failure, and the manager re-reads. */
    return NextResponse.json({ error: "illegal_transition" }, { status: 409 });
  }

  await audit(db, owner, "update", "order", order.id, {
    action,
    from: { status: order.status, paymentStatus: order.paymentStatus },
    to: { status: updated.status, paymentStatus: updated.paymentStatus },
  });

  return NextResponse.json({ ok: true, order: toPublicView(updated) });
}
