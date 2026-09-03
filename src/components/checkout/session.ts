"use client";

/**
 * Where the order token is parked for the duration of a payment.
 *
 * `sessionStorage`, not `localStorage`, and the distinction is the point: this
 * is a per-tab breadcrumb that exists only so a payment flow which breaks out
 * of its iframe can find its way back. It dies with the tab, which is exactly
 * how long it is useful for.
 *
 * The cart uses `localStorage` because losing a basket when a phone sleeps is
 * the worst bug this site can have. An order token is the opposite: it is a
 * bearer credential, and the shorter it lingers on a device that may be handed
 * to the next person in the queue, the better.
 */
export const RETURN_TOKEN_KEY = "coffeetruck-paying-order";

/** Best effort. Private-mode Safari throws on any storage access. */
export function rememberPayingOrder(token: string): void {
  try {
    window.sessionStorage.setItem(RETURN_TOKEN_KEY, token);
  } catch {
    /* The frame path still works; only the broke-out-of-the-frame fallback is
       lost, and that is a rarer failure than refusing to start a payment. */
  }
}

export function forgetPayingOrder(): void {
  try {
    window.sessionStorage.removeItem(RETURN_TOKEN_KEY);
  } catch {
    /* Nothing to clean up if it could never be written. */
  }
}
