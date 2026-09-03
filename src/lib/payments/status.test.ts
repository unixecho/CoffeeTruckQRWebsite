import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  canCollect,
  canCustomerCancel,
  canRetryPayment,
  canTransitionOrder,
  canTransitionPayment,
  decideTransition,
  isPaymentTerminal,
  reconcileAmount,
  revivalFor,
  settledStatusFor,
} from "./status.ts";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "./types.ts";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "./types.ts";

/* ==========================================================================
   Order state machine tests

   The second pure, money-shaped module in the codebase, and pinned for the
   same reason `pricing.ts` is: being wrong here is a customer who paid and
   was told they had not, or a bag handed over that nobody paid for.

   The cases below are not a sample of the transition table — the table is
   small enough to assert exhaustively, and the exhaustive sweeps at the
   bottom are what catch a row added later without a decision behind it.
   ========================================================================== */

const ORDER_TOTAL = 4300; // ₪43 — the 3+2 keychain cart from pricing.test.ts

function order(
  paymentStatus: PaymentStatus,
  status: OrderStatus = "placed",
  paymentMethod: PaymentMethod = "card"
) {
  return { status, paymentStatus, paymentMethod, totalAgorot: ORDER_TOTAL };
}

/* --------------------------------------------------------------------------
   The happy path, both methods
   -------------------------------------------------------------------------- */

test("a card order settles when the paid amount matches", () => {
  const decision = decideTransition({
    order: order("pending"),
    incoming: "paid",
    paidAgorot: ORDER_TOTAL,
  });

  assert.equal(decision.applied, true);
  assert.equal(decision.paymentStatus, "paid");
  assert.equal(decision.settled, true);
  assert.equal(decision.amount, "match");
});

test("a counter order can be attested paid straight from unpaid", () => {
  const decision = decideTransition({
    order: order("unpaid", "placed", "counter"),
    incoming: "paid",
    paidAgorot: ORDER_TOTAL,
  });

  assert.equal(decision.applied, true);
  assert.equal(decision.paymentStatus, "paid");
});

/* --------------------------------------------------------------------------
   The amount check — the rail that stops a wrong charge being accepted
   -------------------------------------------------------------------------- */

test("an underpayment is flagged, never paid", () => {
  const decision = decideTransition({
    order: order("pending"),
    incoming: "paid",
    paidAgorot: ORDER_TOTAL - 1,
  });

  assert.equal(decision.paymentStatus, "flagged");
  assert.equal(decision.settled, false);
  assert.equal(decision.amount, "short");
  assert.equal(decision.reason, "amount_mismatch_flagged");
});

test("an OVERpayment is flagged too", () => {
  // Both directions mean the two sides disagree about the price, and handing
  // goods over against a total nobody can reproduce is how a dispute starts.
  const decision = decideTransition({
    order: order("pending"),
    incoming: "paid",
    paidAgorot: ORDER_TOTAL + 100,
  });

  assert.equal(decision.paymentStatus, "flagged");
  assert.equal(decision.amount, "over");
});

test("a settlement with no stated amount is flagged, not trusted", () => {
  const decision = decideTransition({
    order: order("pending"),
    incoming: "paid",
    paidAgorot: null,
  });

  assert.equal(decision.paymentStatus, "flagged");
  assert.equal(decision.amount, "unknown");
});

test("there is no tolerance, in either direction, at one agora", () => {
  assert.equal(reconcileAmount(2550, 2550), "match");
  assert.equal(reconcileAmount(2550, 2549), "short");
  assert.equal(reconcileAmount(2550, 2551), "over");
  assert.equal(settledStatusFor(2550, 2549), "flagged");
  assert.equal(settledStatusFor(2550, 2550), "paid");
});

/* --------------------------------------------------------------------------
   Idempotency — the property the webhook route rests on
   -------------------------------------------------------------------------- */

test("re-delivering the same outcome changes nothing", () => {
  const decision = decideTransition({
    order: order("paid"),
    incoming: "paid",
    paidAgorot: ORDER_TOTAL,
  });

  assert.equal(decision.applied, false);
  assert.equal(decision.reason, "same_status");
  assert.equal(decision.paymentStatus, "paid");
});

test("a replayed 'paid' cannot undo a refund", () => {
  const decision = decideTransition({
    order: order("refunded"),
    incoming: "paid",
    paidAgorot: ORDER_TOTAL,
  });

  assert.equal(decision.applied, false);
  assert.equal(decision.reason, "terminal");
  assert.equal(decision.paymentStatus, "refunded");
});

test("a late 'failed' cannot unpay a paid order", () => {
  const decision = decideTransition({
    order: order("paid"),
    incoming: "failed",
    paidAgorot: null,
  });

  assert.equal(decision.applied, false);
  assert.equal(decision.reason, "illegal_transition");
});

/* --------------------------------------------------------------------------
   Retry
   -------------------------------------------------------------------------- */

test("a declined card can be tried again", () => {
  assert.equal(canTransitionPayment("failed", "pending"), true);
  assert.equal(canRetryPayment(order("failed")), true);
  assert.equal(canRetryPayment(order("cancelled")), true);
});

test("an expired order cannot be retried — the price may have moved", () => {
  assert.equal(canRetryPayment(order("expired", "expired")), false);
  assert.equal(isPaymentTerminal("expired"), true);
});

/* --------------------------------------------------------------------------
   The late payment on an expired order
   -------------------------------------------------------------------------- */

test("a settled payment revives an expired order", () => {
  // The money is real whether or not our timer ran out. Refusing it would
  // leave somebody charged for an order that does not exist.
  assert.equal(revivalFor("expired", "paid"), "placed");

  const decision = decideTransition({
    order: order("pending", "expired"),
    incoming: "paid",
    paidAgorot: ORDER_TOTAL,
  });

  assert.equal(decision.applied, true);
  assert.equal(decision.orderStatus, "placed");
  assert.equal(decision.paymentStatus, "paid");
});

test("an unsettled event does not revive an expired order", () => {
  assert.equal(revivalFor("expired", "failed"), null);
  assert.equal(revivalFor("expired", "cancelled"), null);
  assert.equal(revivalFor("placed", "paid"), null);
});

/* --------------------------------------------------------------------------
   A cancelled payment is not a cancelled order
   -------------------------------------------------------------------------- */

test("backing out of the card sheet leaves the order open", () => {
  // The customer may simply have decided to pay at the counter instead;
  // closing their order under them would be a surprise at the front of a queue.
  const decision = decideTransition({
    order: order("pending"),
    incoming: "cancelled",
    paidAgorot: null,
  });

  assert.equal(decision.applied, true);
  assert.equal(decision.paymentStatus, "cancelled");
  assert.equal(decision.orderStatus, "placed");
});

/* --------------------------------------------------------------------------
   Handing the goods over
   -------------------------------------------------------------------------- */

test("a counter order may be collected while unpaid — that IS the flow", () => {
  assert.equal(canCollect(order("unpaid", "placed", "counter")), true);
});

test("a card order may not be collected until the money is in", () => {
  assert.equal(canCollect(order("unpaid", "placed", "card")), false);
  assert.equal(canCollect(order("pending", "placed", "card")), false);
  assert.equal(canCollect(order("failed", "placed", "card")), false);
  assert.equal(canCollect(order("flagged", "placed", "card")), false);
  assert.equal(canCollect(order("paid", "placed", "card")), true);
});

test("nothing is collectable twice", () => {
  assert.equal(canCollect(order("paid", "collected")), false);
  assert.equal(canCollect(order("paid", "cancelled")), false);
  assert.equal(canCollect(order("expired", "expired")), false);
});

test("a customer cannot cancel once money has moved", () => {
  assert.equal(canCustomerCancel(order("unpaid")), true);
  assert.equal(canCustomerCancel(order("pending")), true);
  assert.equal(canCustomerCancel(order("failed")), true);
  assert.equal(canCustomerCancel(order("paid")), false);
  assert.equal(canCustomerCancel(order("flagged")), false);
});

/* --------------------------------------------------------------------------
   Exhaustive sweeps

   These are what catch a status added later with no decision behind it: a new
   member of the union either appears in the transition table or fails here,
   rather than silently defaulting to "anything goes".
   -------------------------------------------------------------------------- */

test("every payment status is in the transition table and self-transitions are refused", () => {
  for (const from of PAYMENT_STATUSES) {
    assert.equal(
      canTransitionPayment(from, from),
      false,
      `${from} -> ${from} must not be a transition`
    );
    for (const to of PAYMENT_STATUSES) {
      // Must not throw: a missing row would be a TypeError here.
      assert.equal(typeof canTransitionPayment(from, to), "boolean");
    }
  }
});

test("every order status is in the transition table", () => {
  for (const from of ORDER_STATUSES) {
    assert.equal(canTransitionOrder(from, from), false);
    for (const to of ORDER_STATUSES) {
      assert.equal(typeof canTransitionOrder(from, to), "boolean");
    }
  }
});

test("no event can ever settle an order for the wrong amount", () => {
  // The invariant the whole file exists for, swept over every starting state
  // and every plausible amount. `settled` is what stamps `paid_at` and what
  // the manager reads before handing a bag over.
  const amounts = [null, 0, 1, ORDER_TOTAL - 1, ORDER_TOTAL, ORDER_TOTAL + 1, 10 ** 7];

  for (const from of PAYMENT_STATUSES) {
    for (const status of ORDER_STATUSES) {
      for (const incoming of PAYMENT_STATUSES) {
        for (const paid of amounts) {
          const decision = decideTransition({
            order: order(from, status),
            incoming,
            paidAgorot: paid,
          });

          if (decision.settled) {
            assert.equal(
              paid,
              ORDER_TOTAL,
              `settled from ${from}/${status} on ${incoming} with ${paid}`
            );
            assert.equal(decision.paymentStatus, "paid");
          }

          // An unapplied decision must never move anything.
          if (!decision.applied) {
            assert.equal(decision.paymentStatus, from);
            assert.equal(decision.orderStatus, status);
          }
        }
      }
    }
  }
});
