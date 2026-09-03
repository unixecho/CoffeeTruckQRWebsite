import type { Agorot, CartLine, Locale, Localized } from "../types";
import type { CartPricing } from "../pricing";

/* ==========================================================================
   The payment domain

   This file is the vocabulary. It knows nothing about Grow, about Supabase,
   or about React — deliberately, because it is imported by the checkout UI,
   the API routes, the provider adapters and the manager alike, and a type
   that reaches all four must not drag a runtime into any of them.

   ## Two status axes, not one

   An order has **two** independent lifecycles and collapsing them into one
   enum is the mistake that makes every later question unanswerable:

     paymentStatus  — has the money moved?
     orderStatus    — has the customer walked away with the thing?

   They genuinely diverge at a coffee truck. A card order is `paid` before it
   is `collected`. A counter order is `collected` and `paid` in the same
   moment. A refunded order was collected and then paid back. One enum would
   need a state for every pairing and the transition table would be a guess.

   `status.ts` holds the legal transitions for both, as pure functions with
   their own tests, because a wrong transition here is money in the wrong
   place.

   ## Money

   Agorot everywhere, exactly as in `pricing.ts` — integer hundredths of a
   shekel, never a float. The provider is handed shekels only at the very edge
   of its adapter, because that is the unit its API speaks, and the conversion
   lives in one place there.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Status
   -------------------------------------------------------------------------- */

/**
 * Where the money is.
 *
 * `flagged` is the one that is not obvious and the one that matters most: it
 * means a payment arrived whose amount does not match what we priced. That is
 * never silently accepted as `paid` — it is parked for the owner, because the
 * two ways it happens (our bug, or a tampered request) both need a human.
 */
export type PaymentStatus =
  | "unpaid"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded"
  | "flagged";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "unpaid",
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "flagged",
];

/** Where the goods are. */
export type OrderStatus = "placed" | "collected" | "cancelled" | "expired";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "placed",
  "collected",
  "cancelled",
  "expired",
];

/**
 * How the customer said they would pay.
 *
 * `counter` is the business as it actually runs today — Bit, or cash, handed
 * over at the truck. It is not a placeholder for card and must not be removed
 * when Grow arrives: a phone with no signal at a market stand still has to be
 * able to place an order.
 */
export type PaymentMethod = "counter" | "card";

export const PAYMENT_METHODS: readonly PaymentMethod[] = ["counter", "card"];

/* --------------------------------------------------------------------------
   Providers
   -------------------------------------------------------------------------- */

/**
 * `manual` is a real provider, not a mock. It creates no session and moves no
 * money; it exists so that "pay at the counter" travels the same order
 * pipeline as a card payment, which is what makes switching the other one on
 * a configuration change rather than a rewrite.
 */
export type PaymentProviderId = "manual" | "grow";

export const PAYMENT_PROVIDER_IDS: readonly PaymentProviderId[] = ["manual", "grow"];

export function isPaymentProviderId(value: unknown): value is PaymentProviderId {
  return typeof value === "string" && (PAYMENT_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * The provider's own identifier for one payment attempt.
 *
 * Opaque here on purpose. Grow calls this a process id plus a process token;
 * another provider calls it an intent id. The adapter packs whatever it needs
 * into these two fields and nothing outside the adapter reads them apart from
 * echoing them back.
 */
export interface ProviderRef {
  /** The id we send back to the provider to ask "what happened to this?". */
  id: string;
  /** A second factor some providers require alongside the id. */
  token?: string;
}

/* --------------------------------------------------------------------------
   Orders
   -------------------------------------------------------------------------- */

/**
 * One line of an order, **snapshotted**.
 *
 * The name and the unit price are copied in rather than joined out to
 * `products`. An order is a record of what was agreed at a moment; the owner
 * edits prices from her phone between customers, and a receipt that silently
 * re-reads the current price is not a receipt. `productId` is kept for
 * convenience and nulls out if the product is later deleted — the order
 * survives that, which is the whole point.
 */
export interface OrderItem {
  id: string;
  productId: string | null;
  /** As it read on the day. Localized so a receipt renders in any language. */
  name: Localized;
  unitPriceAgorot: Agorot;
  quantity: number;
}

export interface Order {
  id: string;
  /** Short, human, called out at the counter: "#0042". */
  orderNumber: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  provider: PaymentProviderId | null;
  /** Only ever set server-side, from a provider response. */
  providerRef: ProviderRef | null;

  /** Computed server-side by `priceCart`. A total from a browser is a claim. */
  totalAgorot: Agorot;
  /** Same items with no deals applied — the "you saved" line's numerator. */
  baselineAgorot: Agorot;
  savingsAgorot: Agorot;
  /** What the provider says actually moved. Null until something moves. */
  paidAgorot: Agorot | null;
  currency: "ILS";

  items: OrderItem[];
  /** The full pricing breakdown as it stood, so the receipt names the deals. */
  pricing: CartPricing | null;

  /** Both optional: a name is a convenience for calling out, not a login. */
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  locale: Locale;

  /** After this, an unpaid order is swept to `expired`. */
  expiresAt: string;
  paidAt: string | null;
  collectedAt: string | null;
  cancelledAt: string | null;
  /** Set when the identifying columns were cleared. See docs/PAYMENTS.md. */
  anonymizedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the customer's own device is allowed to see.
 *
 * A strict subset of `Order`. The status page fetches this with the order
 * token, and the token is a bearer credential printed into a URL — so the
 * shape it unlocks is written out explicitly rather than being "the order
 * minus whatever we remembered to delete".
 */
export interface PublicOrderView {
  orderNumber: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  totalAgorot: Agorot;
  baselineAgorot: Agorot;
  savingsAgorot: Agorot;
  items: OrderItem[];
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  /** True once the identifying fields have been cleared at the customer's ask. */
  anonymized: boolean;
}

/* --------------------------------------------------------------------------
   Creating an order
   -------------------------------------------------------------------------- */

/**
 * The checkout request, after parsing.
 *
 * Note what is *not* here: no total, no prices, no product names. The client
 * sends picks and contact details; everything money-shaped is computed from
 * the catalogue on the server. This is the same rule the cart already follows
 * in `localStorage`, applied at the wire.
 */
export interface CheckoutRequest {
  lines: CartLine[];
  paymentMethod: PaymentMethod;
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  locale: Locale;
  /**
   * A uuid the browser generates once per checkout attempt and re-sends on
   * every retry. A tethered phone at a market stand drops its connection
   * mid-request routinely; without this, the retry is a second order.
   */
  clientRequestId: string;
}

/* --------------------------------------------------------------------------
   The provider port
   -------------------------------------------------------------------------- */

/** Everything a provider needs to open one payment. Built server-side. */
export interface CreateSessionInput {
  orderId: string;
  orderNumber: number;
  amountAgorot: Agorot;
  currency: "ILS";
  locale: Locale;
  /** Shown on the provider's own page. Never contains customer contact data. */
  description: string;
  customerName: string | null;
  customerPhone: string | null;
  /** Same-origin URLs the provider sends the frame to when it is done. */
  returnUrls: {
    success: string;
    failure: string;
    cancel: string;
  };
  /** Stable across retries of the same attempt, so a retry is not a charge. */
  idempotencyKey: string;
}

/**
 * How the customer completes this payment.
 *
 * `embedded_iframe` is the shape Grow's checkout is designed around and the
 * one this codebase is built for: the card fields render inside the
 * provider's own document, on the provider's own origin, so **no card data
 * ever touches our JavaScript, our server, or our logs**. That is not a
 * convenience, it is the entire reason to use a hosted field set.
 *
 * `at_counter` carries no URL because there is nothing to render — the
 * customer walks four feet and pays a person.
 */
export type PaymentSession =
  | {
      kind: "embedded_iframe";
      /** Validated against the provider's allowed origins before it is rendered. */
      url: string;
      providerRef: ProviderRef;
      /** ISO. The frame is torn down and the attempt retried past this. */
      expiresAt: string | null;
    }
  | {
      kind: "at_counter";
      providerRef: null;
    };

/** What a server-to-server status read comes back with. */
export interface ProviderPaymentSnapshot {
  status: PaymentStatus;
  /** In agorot, converted by the adapter. Null when nothing has moved. */
  paidAgorot: Agorot | null;
  /** The provider's own code, kept for the event log, never shown to a customer. */
  providerStatusCode: string | null;
}

/**
 * A webhook, normalized.
 *
 * `providerEventId` is what makes delivery idempotent — providers retry, and
 * a retried "paid" that is applied twice is a refund conversation. The route
 * writes this to a unique column and ignores the second arrival.
 */
export interface NormalizedWebhookEvent {
  provider: PaymentProviderId;
  providerEventId: string;
  /** Which of our orders this is about. Resolved from the provider's payload. */
  orderId: string | null;
  providerRef: ProviderRef | null;
  status: PaymentStatus;
  paidAgorot: Agorot | null;
  /** Already redacted by the adapter — see `redactPayload` in `log.ts`. */
  payload: unknown;
  /**
   * Whether the payload's own authenticity was established (a signature, an
   * HMAC). **False is not a rejection** — several providers, Grow included,
   * authenticate by making you ask them back rather than by signing. It
   * decides whether `confirmWithProvider` is mandatory, and the route treats
   * an unsigned event as untrusted until that read agrees.
   */
  signatureValid: boolean;
}

/* --------------------------------------------------------------------------
   Results

   The same `{ ok }` discriminated union the rest of the codebase uses. Errors
   are **codes**, never sentences: this UI is trilingual, and a validator that
   returns English prose is a validator that renders Hebrew text to an Arabic
   reader. PLAYBOOK §4.4.
   -------------------------------------------------------------------------- */

export type PaymentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PaymentErrorCode; detail?: string; retryable?: boolean };

/**
 * Every way a payment can fail, as a closed set.
 *
 * The client maps these to translated strings in `i18n.tsx`; an unknown code
 * maps to the generic message, so a code added server-side can never render
 * blank.
 */
export type PaymentErrorCode =
  | "provider_not_configured"
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_timeout"
  | "invalid_response"
  | "amount_mismatch"
  | "order_not_found"
  | "order_expired"
  | "order_already_paid"
  | "illegal_transition"
  | "checkout_disabled"
  | "cart_empty"
  | "cart_unavailable"
  | "rate_limited"
  | "unknown";

/**
 * The port every payment provider implements.
 *
 * Four methods, and the checkout knows only these. Replacing `manual` with
 * `grow` touches `providers/grow.ts` and the environment — not the UI, not
 * the routes, not the order service. That is the whole design goal, and it is
 * worth resisting the temptation to widen this interface for one provider's
 * convenience: every method added here is a method the *next* provider has to
 * fake.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;

  /** How the customer completes payment; decides what the checkout renders. */
  readonly presentation: PaymentSession["kind"];

  /**
   * Whether this provider could actually take a payment right now.
   *
   * Separate from "is it selected". An unconfigured provider must degrade to
   * the counter rather than showing a card button that dead-ends — which is
   * exactly what the storefront already does with an unset Bit link.
   */
  isConfigured(): boolean;

  createSession(input: CreateSessionInput): Promise<PaymentResult<PaymentSession>>;

  /**
   * Ask the provider what really happened.
   *
   * Called after every redirect and after every webhook. A redirect is a
   * browser navigating to a URL an attacker can also navigate to; a webhook
   * is a POST from an address we did not verify. Neither is evidence on its
   * own — this is.
   */
  fetchStatus(ref: ProviderRef): Promise<PaymentResult<ProviderPaymentSnapshot>>;

  /** Turns a raw callback into a normalized event, or refuses it. */
  parseWebhook(
    request: Request,
    rawBody: string
  ): Promise<PaymentResult<NormalizedWebhookEvent>>;
}
