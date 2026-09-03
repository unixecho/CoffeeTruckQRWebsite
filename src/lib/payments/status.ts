import type { Agorot } from "../types";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "./types";

/* ==========================================================================
   The order state machine

   Pure, and tested like `pricing.ts` is tested, for the same reason: this is
   the second module in the codebase where being wrong costs real money. A
   transition applied that should not have been is a customer who paid and
   was told they did not, or an order handed over that was never paid for.

   Everything here takes its inputs and returns a decision. Nothing reads a
   clock it was not given, nothing touches a database, nothing logs. The
   callers in `orders.ts` do all three.

   ## Why transitions are refused rather than clamped

   A webhook that says "paid" for an order already `refunded` is not a paid
   order — it is a duplicate delivery, a replay, or a bug. Applying it would
   quietly undo a refund. So an illegal transition is a *result*, not an
   exception and not a no-op: the caller records it in `payment_events` and
   answers the provider 200, because the event was understood and deliberately
   ignored. Answering an error there would make the provider retry forever.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Payment status
   -------------------------------------------------------------------------- */

/**
 * Legal payment transitions.
 *
 * Read a row as "from this, you may go to these". The ones worth explaining:
 *
 * - `failed → pending` and `cancelled → pending` exist because retry is a
 *   first-class path. A declined card at a market stand is normally a second
 *   card, thirty seconds later, on the same order — forcing a new order there
 *   would lose the basket and the queue position.
 * - `expired → *` is empty. An expired order is gone; a payment that arrives
 *   for one is handled by `revivalFor` below, not by a transition, because
 *   reviving an order is a decision about the *order*, not about the money.
 * - `paid → flagged` is reachable: a later read that disagrees about the
 *   amount must be able to raise the flag even after we called it paid.
 * - `flagged → paid` is the owner resolving a mismatch by hand, and it is
 *   the only transition in this table that a human initiates directly.
 */
const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  unpaid: ["pending", "paid", "cancelled", "expired", "flagged"],
  pending: ["paid", "failed", "cancelled", "expired", "flagged"],
  paid: ["refunded", "flagged"],
  failed: ["pending", "paid", "cancelled", "expired"],
  cancelled: ["pending", "expired"],
  expired: [],
  refunded: [],
  flagged: ["paid", "refunded", "cancelled"],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false; // a no-op is not a transition; callers must notice
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** True once nothing further can happen without a human and a refund. */
export function isPaymentTerminal(status: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[status].length === 0;
}

/** True when the money is in — the only condition for handing goods over. */
export function isPaymentSettled(status: PaymentStatus): boolean {
  return status === "paid";
}

/* --------------------------------------------------------------------------
   Order status
   -------------------------------------------------------------------------- */

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: ["collected", "cancelled", "expired"],
  collected: [],
  cancelled: [],
  /* An expired order can come back — see `revivalFor`. Nothing else may. */
  expired: ["placed"],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isOrderTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/**
 * Whether a payment arriving now should pull the order back from `expired`.
 *
 * This is the awkward real case and it is worth handling explicitly rather
 * than discovering it at a counter. An unpaid order is swept to `expired`
 * fifteen minutes after it is placed. A payment can legitimately land after
 * that: the customer's phone lost signal in the queue, the provider retried
 * its callback, the frame sat open while somebody found their card.
 *
 * The money is real either way. Refusing it would leave a customer charged
 * for an order that does not exist, which is far worse than an order that
 * came back to life — so a settled payment revives the order and the owner
 * sees it in the list with everything else.
 */
export function revivalFor(
  orderStatus: OrderStatus,
  incomingPayment: PaymentStatus
): OrderStatus | null {
  if (orderStatus !== "expired") return null;
  return isPaymentSettled(incomingPayment) ? "placed" : null;
}

/* --------------------------------------------------------------------------
   Amount reconciliation
   -------------------------------------------------------------------------- */

export type AmountVerdict = "match" | "short" | "over" | "unknown";

/**
 * Does what the provider says was paid match what we priced?
 *
 * Exact integer comparison. There is no tolerance and there must not be one:
 * both sides are integers in the same unit, so any difference is a real
 * disagreement — our arithmetic, their arithmetic, or a request somebody
 * edited on the way past. A tolerance here would be a hole sized in agorot,
 * and the only reason to add one is to stop a real signal being noisy.
 *
 * `unknown` when the provider told us nothing about the amount, which is
 * itself a reason not to call an order paid on that event alone.
 */
export function reconcileAmount(expected: Agorot, paid: Agorot | null): AmountVerdict {
  if (paid === null || !Number.isFinite(paid)) return "unknown";
  if (paid === expected) return "match";
  return paid < expected ? "short" : "over";
}

/**
 * The status a settled-looking payment should actually be recorded as.
 *
 * An overpayment is as much of a problem as an underpayment — it means the
 * two sides disagree about the price, and handing over goods against a total
 * nobody can reproduce is how a dispute starts. Both are `flagged`.
 */
export function settledStatusFor(expected: Agorot, paid: Agorot | null): PaymentStatus {
  return reconcileAmount(expected, paid) === "match" ? "paid" : "flagged";
}

/* --------------------------------------------------------------------------
   Applying an event
   -------------------------------------------------------------------------- */

export interface TransitionInput {
  order: {
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    paymentMethod: PaymentMethod;
    totalAgorot: Agorot;
  };
  /** What the provider (or the owner) says the payment now is. */
  incoming: PaymentStatus;
  /** What the provider says moved. Null when it did not say. */
  paidAgorot: Agorot | null;
}

export interface TransitionDecision {
  /** False when nothing changes — a duplicate delivery, or a stale event. */
  applied: boolean;
  /** Why, as a code. Recorded on the event row so the log explains itself. */
  reason:
    | "applied"
    | "same_status"
    | "illegal_transition"
    | "terminal"
    | "amount_mismatch_flagged";
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  /** True when the caller must stamp `paid_at`. */
  settled: boolean;
  amount: AmountVerdict;
}

/**
 * The whole decision, in one pure function.
 *
 * Order matters inside it and is not arbitrary:
 *
 *   1. Resolve what the incoming status *really* is, including the amount
 *      check — a "paid" that does not reconcile is a `flagged`, and it must
 *      be resolved to that before the transition table is consulted, or the
 *      table would be asked the wrong question.
 *   2. Refuse if the current status is terminal.
 *   3. Refuse if the transition is not legal.
 *   4. Only then, work out what happens to the order alongside it.
 */
export function decideTransition(input: TransitionInput): TransitionDecision {
  const { order, incoming, paidAgorot } = input;

  const amount = isPaymentSettled(incoming)
    ? reconcileAmount(order.totalAgorot, paidAgorot)
    : "unknown";

  const resolved: PaymentStatus = isPaymentSettled(incoming)
    ? settledStatusFor(order.totalAgorot, paidAgorot)
    : incoming;

  const unchanged: Omit<TransitionDecision, "reason"> = {
    applied: false,
    paymentStatus: order.paymentStatus,
    orderStatus: order.status,
    settled: false,
    amount,
  };

  if (resolved === order.paymentStatus) return { ...unchanged, reason: "same_status" };
  if (isPaymentTerminal(order.paymentStatus)) return { ...unchanged, reason: "terminal" };
  if (!canTransitionPayment(order.paymentStatus, resolved)) {
    return { ...unchanged, reason: "illegal_transition" };
  }

  /* The order side. A cancelled payment does NOT cancel the order on its own:
     the customer may simply have backed out of the card sheet to pay at the
     counter instead, and cancelling their order under them would be a
     surprise. Only the customer's explicit cancel, the owner, or expiry
     closes an order. */
  const revived = revivalFor(order.status, resolved);
  const orderStatus = revived ?? order.status;

  return {
    applied: true,
    reason: resolved === "flagged" && isPaymentSettled(incoming)
      ? "amount_mismatch_flagged"
      : "applied",
    paymentStatus: resolved,
    orderStatus,
    settled: resolved === "paid",
    amount,
  };
}

/* --------------------------------------------------------------------------
   Derived questions the UI asks
   -------------------------------------------------------------------------- */

/**
 * Whether the customer may still try to pay.
 *
 * Deliberately generous on the failure side — `failed` and `cancelled` both
 * allow another go — and hard on expiry, because an expired order has been
 * re-priced out from under itself and the honest move is a fresh cart.
 */
export function canRetryPayment(order: {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}): boolean {
  if (order.status !== "placed") return false;
  return order.paymentStatus === "unpaid"
    || order.paymentStatus === "pending"
    || order.paymentStatus === "failed"
    || order.paymentStatus === "cancelled";
}

/** Whether the customer may still cancel it themselves. */
export function canCustomerCancel(order: {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}): boolean {
  if (order.status !== "placed") return false;
  // Once money has moved, cancelling is a refund conversation with a human.
  return !isPaymentSettled(order.paymentStatus) && order.paymentStatus !== "flagged";
}

/**
 * Whether the owner may hand the goods over.
 *
 * A counter order is collectable while unpaid — that *is* the counter flow,
 * the money changes hands at the same moment. A card order is not: the whole
 * reason to take a card is to know before the bag leaves.
 */
export function canCollect(order: {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
}): boolean {
  if (order.status !== "placed") return false;
  if (order.paymentMethod === "counter") return order.paymentStatus !== "cancelled";
  return isPaymentSettled(order.paymentStatus);
}
