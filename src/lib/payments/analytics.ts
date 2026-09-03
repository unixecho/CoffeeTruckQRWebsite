import "server-only";

import { paymentLog } from "./log";
import type { PaymentErrorCode, PaymentMethod, PaymentProviderId } from "./types";

/* ==========================================================================
   Checkout analytics

   A typed set of events with one sink behind it, so that "how many people
   abandon at the payment step" is answerable later without instrumenting the
   checkout again from scratch.

   ## Read this before adding a third-party tool here

   **Nothing in this file runs in the browser, and nothing in it sets a
   cookie.** That is not an oversight — it is the reason the site currently
   needs no consent banner. Israel's Amendment 13 requires an opt-in banner
   for any non-essential cookie or tracking script, blocked *before* it loads,
   with reject given equal prominence and consent logged (PLAYBOOK §3). The
   moment a Google Analytics tag, a Meta pixel, or any third-party embed that
   sets its own storage is added — here or anywhere — that banner becomes a
   legal requirement, not a nice-to-have.

   So the sink is server-side by design. Events are emitted from API routes
   where the request already exists, carry no identifier for the person, and
   go to the platform log. If aggregate numbers are wanted later, the cheap
   and consent-free option is a counters table in Postgres written from these
   same calls — not a script tag.

   ## What is deliberately not in an event

   No name, no phone number, no order token, no cart contents. An event
   carries an order id, a step, a provider and an error code; that is enough
   to answer "where do people stop" and not enough to reconstruct who bought
   what. `redactPayload` is not needed here because nothing sensitive is
   accepted in the first place, which is the better version of the same rule.
   ========================================================================== */

export type CheckoutEvent =
  | { name: "checkout_started"; orderId: string; method: PaymentMethod; itemCount: number }
  | { name: "checkout_rejected"; reason: PaymentErrorCode }
  | { name: "payment_session_created"; orderId: string; provider: PaymentProviderId }
  | { name: "payment_session_failed"; orderId: string; provider: PaymentProviderId; reason: PaymentErrorCode }
  | { name: "payment_settled"; orderId: string; provider: PaymentProviderId; totalAgorot: number }
  | { name: "payment_flagged"; orderId: string; provider: PaymentProviderId; expectedAgorot: number; paidAgorot: number | null }
  | { name: "payment_failed"; orderId: string; provider: PaymentProviderId }
  | { name: "order_cancelled"; orderId: string; by: "customer" | "owner" | "system" }
  | { name: "order_collected"; orderId: string; method: PaymentMethod };

/**
 * Emit one event.
 *
 * Never throws and never awaits anything slow. An analytics call that can
 * fail a checkout is worse than no analytics at all — this is the one place
 * in the payment path where "swallow the error" is the correct behaviour, and
 * it is worth saying so out loud because it reads like a mistake otherwise.
 */
export function emitCheckoutEvent(event: CheckoutEvent): void {
  try {
    const { name, ...fields } = event;
    paymentLog("info", `event.${name}`, fields as Record<string, string | number | null>);
  } catch {
    /* Intentionally silent. See above. */
  }
}
