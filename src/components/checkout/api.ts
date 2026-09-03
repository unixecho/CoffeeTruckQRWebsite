"use client";

import type { Dict } from "@/lib/i18n";
import type { CartLine, Locale } from "@/lib/types";
import type { PaymentMethod, PublicOrderView } from "@/lib/payments/types";

/* ==========================================================================
   Talking to the checkout API

   The counterpart to `components/manager/api.ts`, and separate for the same
   reason the routes are: the manager's client speaks to endpoints behind a
   login, this one speaks to public endpoints from a phone on a market-stand
   tether. The difference that matters is **retry**.

   ## What is retried, and what is not

   A dropped connection is the single most likely failure here, and it is not
   rare — it happens several times an afternoon. So a read is retried with a
   short backoff, automatically, because a customer should not have to know
   what a tether is.

   **Placing an order is retried too, and that is only safe because of
   `clientRequestId`.** The server treats a repeat of the same id as the same
   order rather than a second one. Without that key this function would be a
   double-order generator; with it, a retry is free. The id is generated once
   per checkout attempt by `useCheckout` and re-sent unchanged.

   A 4xx is never retried. It means the request was wrong, and sending it
   again just makes the same mistake faster.
   ========================================================================== */

export interface CheckoutError {
  /** A code, never a sentence. Mapped to a translated string below. */
  code: string;
  /** Present on `cart_unavailable`: which lines went stale. */
  unavailable?: string[];
  retryable?: boolean;
}

export type CheckoutResult<T> = { ok: true; data: T } | { ok: false; error: CheckoutError };

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function send<T>(
  url: string,
  init: RequestInit,
  { retry }: { retry: boolean }
): Promise<CheckoutResult<T>> {
  let lastError: CheckoutError = { code: "offline", retryable: true };

  for (let attempt = 1; attempt <= (retry ? MAX_ATTEMPTS : 1); attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      lastError = { code: "offline", retryable: true };
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      continue;
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (response.ok) return { ok: true, data: (body ?? {}) as T };

    const parsed = (body ?? {}) as { error?: string; unavailable?: string[]; retryable?: boolean };
    lastError = {
      code: parsed.error ?? "request_failed",
      unavailable: parsed.unavailable,
      retryable: parsed.retryable ?? response.status >= 500,
    };

    /* Only a server-side or upstream failure is worth sending again. A 409
       ("this order is already paid") repeated three times is three ways of
       being told the same true thing. */
    if (!retry || response.status < 500 || attempt === MAX_ATTEMPTS) break;
    await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
  }

  return { ok: false, error: lastError };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/* --------------------------------------------------------------------------
   The calls
   -------------------------------------------------------------------------- */

export interface PlaceOrderBody {
  lines: CartLine[];
  paymentMethod: PaymentMethod;
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  locale: Locale;
  clientRequestId: string;
  /** The honeypot. Always empty when a person filled the form. */
  company: string;
}

export interface PlacedOrder {
  ok: true;
  token: string;
  order: PublicOrderView;
  replayed: boolean;
  nextStep: PaymentMethod;
}

export function placeOrder(body: PlaceOrderBody): Promise<CheckoutResult<PlacedOrder>> {
  return send<PlacedOrder>(
    "/api/checkout",
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
    { retry: true }
  );
}

export interface OrderStatusResponse {
  ok: true;
  order: PublicOrderView;
  can: { retryPayment: boolean; cancel: boolean };
}

/**
 * Read the order back.
 *
 * `confirm` makes the server ask the provider what really happened rather than
 * reporting what it already believes. Used once, after the payment frame says
 * the customer is done — a redirect is a prompt to check, never the evidence.
 */
export function fetchOrder(
  token: string,
  confirm = false
): Promise<CheckoutResult<OrderStatusResponse>> {
  const url = `/api/checkout/${encodeURIComponent(token)}${confirm ? "?confirm=1" : ""}`;
  return send<OrderStatusResponse>(url, { method: "GET" }, { retry: true });
}

export interface PaymentSessionResponse {
  ok: true;
  session: { kind: "embedded_iframe"; url: string };
}

export function startPayment(token: string): Promise<CheckoutResult<PaymentSessionResponse>> {
  return send<PaymentSessionResponse>(
    `/api/checkout/${encodeURIComponent(token)}/pay`,
    { method: "POST" },
    /* Not retried automatically. A create-payment that timed out may or may
       not have created a session at the provider, and firing another is how
       somebody ends up looking at two. The customer gets a retry button
       instead, which is a decision rather than a guess. */
    { retry: false }
  );
}

export function cancelOrder(token: string): Promise<CheckoutResult<OrderStatusResponse>> {
  return send<OrderStatusResponse>(
    `/api/checkout/${encodeURIComponent(token)}/cancel`,
    { method: "POST" },
    { retry: true }
  );
}

/** The customer's own data-rights action: clear the name and phone number. */
export function forgetDetails(token: string): Promise<CheckoutResult<OrderStatusResponse>> {
  return send<OrderStatusResponse>(
    `/api/checkout/${encodeURIComponent(token)}`,
    { method: "DELETE" },
    { retry: true }
  );
}

/* --------------------------------------------------------------------------
   Codes to sentences
   -------------------------------------------------------------------------- */

/**
 * The server answers in codes; the customer reads Hebrew, English or Arabic.
 *
 * An unknown code maps to the generic message rather than being shown raw, so
 * a reason added server-side can never render blank or in the wrong language.
 * PLAYBOOK §4.4.
 */
export function checkoutErrorMessage(error: CheckoutError, t: Dict): string {
  switch (error.code) {
    case "offline":
      return t.checkout.errors.offline;
    case "rate_limited":
      return t.checkout.errors.rateLimited;
    case "cart_unavailable":
      return t.checkout.errors.unavailable;
    case "cart_empty":
      return t.checkout.errors.cartEmpty;
    case "order_expired":
      return t.checkout.errors.expired;
    case "order_already_paid":
      return t.checkout.errors.alreadyPaid;
    case "order_not_found":
      return t.checkout.errors.notFound;
    case "checkout_disabled":
      return t.checkout.errors.disabled;
    case "provider_not_configured":
    case "provider_unavailable":
    case "provider_timeout":
    case "provider_rejected":
    case "invalid_response":
      return t.checkout.errors.providerDown;
    default:
      return t.checkout.errors.generic;
  }
}
