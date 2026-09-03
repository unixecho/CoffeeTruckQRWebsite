import { isPaymentProviderId, type PaymentProviderId } from "./types";

/* ==========================================================================
   Payment configuration

   Every environment variable the payment side reads, resolved once, here.
   Nothing else in the codebase touches `process.env` for payments — a value
   read in two places is a value that means two things the day one of them is
   renamed.

   **Nothing in this file is client-safe.** No `NEXT_PUBLIC_` variable carries
   a payment secret and none should be added: the storefront learns whether
   card payment is available from the server-rendered page, not from an
   inlined build-time constant. That is deliberate — an inlined provider flag
   is a flag that cannot be turned off without a redeploy, and the kill switch
   in `app_settings` exists precisely so the owner does not need one.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Which provider
   -------------------------------------------------------------------------- */

/**
 * The provider the site is running.
 *
 * Defaults to `manual` — pay at the counter — because that is what the
 * business does today and an unset variable must never silently select a
 * payment processor. Anything unrecognised also lands here rather than
 * throwing at import time: a typo in a Vercel dashboard should degrade the
 * checkout to the counter flow, not take the storefront down.
 */
export function configuredProviderId(): PaymentProviderId {
  const raw = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  return isPaymentProviderId(raw) ? raw : "manual";
}

/* --------------------------------------------------------------------------
   Grow

   ⚠ TODO(grow-credentials): every value below arrives with the merchant
   account. Until then `growConfig()` returns null, `GrowProvider.isConfigured()`
   is false, and the checkout offers the counter flow only — which is not a
   degraded state, it is the current business.

   The variable names mirror what Grow's own dashboard calls these fields, so
   copying them across is transcription rather than translation.
   -------------------------------------------------------------------------- */

export interface GrowConfig {
  /** API root, e.g. the sandbox host during integration, live host after. */
  apiBase: string;
  /** The origin the hosted payment page is served from. See `checkoutOrigin`. */
  checkoutOrigin: string;
  pageCode: string;
  userId: string;
  apiKey: string;
  /**
   * Shared secret for verifying callbacks, **if Grow issues one**.
   *
   * Left optional on purpose. Some Israeli providers authenticate a callback
   * by making you read the transaction back rather than by signing the
   * payload. `GrowProvider` is written for that weaker case and treats an
   * unsigned callback as untrusted until a server-to-server read agrees — so
   * setting this can only tighten things, never loosen them.
   */
  webhookSecret: string | null;
}

/**
 * Every payment variable, read by **static** property access.
 *
 * `process.env[name]` with a computed key would be tidier and is wrong here:
 * bundlers inline `process.env.FOO` at build time and cannot see through a
 * variable, so a dynamic lookup reads `undefined` anywhere the environment is
 * not a live Node process — `proxy.ts` included, which is exactly where the
 * frame origin is needed to build the Content-Security-Policy. Spelling them
 * out is the price of the CSP and the URL allowlist reading one source.
 */
const ENV = {
  apiBase: () => process.env.GROW_API_BASE,
  checkoutOrigin: () => process.env.GROW_CHECKOUT_ORIGIN,
  pageCode: () => process.env.GROW_PAGE_CODE,
  userId: () => process.env.GROW_USER_ID,
  apiKey: () => process.env.GROW_API_KEY,
  webhookSecret: () => process.env.GROW_WEBHOOK_SECRET,
} as const;

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The Grow settings, or null when the merchant account does not exist yet.
 *
 * All-or-nothing. A half-filled configuration is worse than none: it produces
 * a card button that opens a frame that 401s, at a counter, with a customer
 * watching. If any required field is missing, the provider reports itself
 * unconfigured and the checkout never offers card.
 */
export function growConfig(): GrowConfig | null {
  const apiBase = clean(ENV.apiBase());
  const pageCode = clean(ENV.pageCode());
  const userId = clean(ENV.userId());
  const apiKey = clean(ENV.apiKey());

  if (!apiBase || !pageCode || !userId || !apiKey) return null;

  let base: URL;
  try {
    base = new URL(apiBase);
  } catch {
    console.error("[payments] GROW_API_BASE is not a URL; treating Grow as unconfigured.");
    return null;
  }
  if (base.protocol !== "https:") {
    // A payment API over plain http is not a configuration mistake to work
    // around, it is one to refuse.
    console.error("[payments] GROW_API_BASE must be https; treating Grow as unconfigured.");
    return null;
  }

  /* The hosted page can live on a different host from the API. It is a
     separate variable rather than an assumption because it ends up in two
     security-relevant places — the CSP `frame-src` and the allowlist that
     `assertProviderUrl` checks before an iframe is rendered — and guessing
     wrong in either direction is either a blank frame or a hole. */
  const declaredCheckoutOrigin = clean(ENV.checkoutOrigin());
  const checkoutOrigin =
    (declaredCheckoutOrigin ? safeOrigin(declaredCheckoutOrigin) : null) ?? base.origin;

  return {
    apiBase: base.origin + base.pathname.replace(/\/+$/, ""),
    checkoutOrigin,
    pageCode,
    userId,
    apiKey,
    webhookSecret: clean(ENV.webhookSecret()),
  };
}

function safeOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
   Origins the browser is allowed to load a payment frame from

   Read by `proxy.ts` to build `frame-src`, and by `assertProviderUrl` before
   any provider URL reaches an `<iframe src>`. Both read the same list, which
   is the point: a CSP that allows an origin the code will not render, or code
   that renders an origin the CSP blocks, are two different bugs with the same
   cause — two lists.
   -------------------------------------------------------------------------- */

export function paymentFrameOrigins(): string[] {
  const origins = new Set<string>();

  /* Deliberately NOT derived from `growConfig()`. That returns null unless
     every credential is present, and the CSP has to be right on a deployment
     where the checkout host is configured and the API key is not — otherwise
     turning the provider on later would silently ship a policy that blocks
     the frame it just enabled. The origin alone is enough to answer "what may
     be framed", and it is the same string the URL allowlist checks. */
  const declared = clean(ENV.checkoutOrigin());
  const fromDeclared = declared ? safeOrigin(declared) : null;
  if (fromDeclared) origins.add(fromDeclared);

  if (!fromDeclared) {
    const base = clean(ENV.apiBase());
    const fromBase = base ? safeOrigin(base) : null;
    if (fromBase) origins.add(fromBase);
  }

  return [...origins];
}

/* --------------------------------------------------------------------------
   Timing
   -------------------------------------------------------------------------- */

/**
 * How long an unpaid order stays alive.
 *
 * Twenty minutes is the queue at a market stand plus a wide margin, and it is
 * short enough that the price a customer was quoted is still the price in the
 * catalogue. An order that outlives an edit to its own prices is the reason
 * this has a bound at all.
 */
export const ORDER_EXPIRY_MINUTES = readPositiveInt(process.env.CHECKOUT_EXPIRY_MINUTES, 20);

/** How long to wait on the provider before giving the customer an answer. */
export const PROVIDER_TIMEOUT_MS = readPositiveInt(process.env.PAYMENT_PROVIDER_TIMEOUT_MS, 12_000);

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
