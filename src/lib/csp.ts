import { paymentFrameOrigins } from "./payments/config";

/* ==========================================================================
   Content-Security-Policy

   Built per request in `proxy.ts`, because two of its directives depend on
   where the request is going and one depends on a fresh random value.

   ## Scripts: a nonce, not an allowlist

   `script-src 'self'` is close to worthless on a site that serves any
   user-influenced HTML, and an allowlist of hosts is worthless the moment one
   of them serves a JSONP endpoint. So: a per-response nonce plus
   `'strict-dynamic'`. Only scripts carrying this response's nonce run, and
   only the scripts *they* load run after that. `'self'` and `https:` are
   listed for browsers that do not understand `'strict-dynamic'`, which ignore
   the nonce; browsers that do understand it ignore those instead. That is the
   documented way to write one policy for both.

   The two inline scripts in the root layout — the theme and locale no-flash
   reads — take the nonce explicitly. Next adds it to its own bootstrap when it
   finds a nonce in the request's CSP header, which is why `proxy.ts` sets the
   header on the request as well as the response.

   ## Styles: 'unsafe-inline', and why that is accepted here

   This codebase styles almost everything with inline `style={{ ... }}`
   attributes carrying design tokens — that is the design system's own
   convention, several hundred call sites deep. `style-src-attr` has no nonce
   mechanism, so the choice is `'unsafe-inline'` or rewriting the entire UI
   layer. Inline *style* is a far narrower primitive than inline *script*: it
   can leak layout-based signals and it can restyle, but it cannot execute.
   The right way to close it is a Tailwind-only refactor, not a header, and it
   is written down here rather than left as an unexplained weakness.

   ## frame-ancestors and frame-src point in opposite directions

   `frame-ancestors` is who may frame **us** — nobody, except the payment
   return page, which is loaded inside our own checkout by design.
   `frame-src` is what **we** may frame — nothing, unless a payment provider
   is configured, in which case exactly its checkout origin and no other.

   That origin comes from `paymentFrameOrigins()`, the same function the
   server-side URL allowlist uses before any provider URL reaches an
   `<iframe src>`. One source, so the policy and the code cannot disagree.
   ========================================================================== */

/** The one page that is legitimately framed — by us, inside the checkout. */
export const FRAMED_PATH = "/checkout/frame-return";

export function buildCsp({
  nonce,
  pathname,
  isDevelopment,
}: {
  nonce: string;
  pathname: string;
  isDevelopment: boolean;
}): string {
  const supabase = supabaseOrigin();
  const framePayment = paymentFrameOrigins();

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https:",
    /* Turbopack's hot reloader compiles modules with `eval` in development.
       Never in a production build — and this branch is a build-time constant,
       so the production bundle does not contain the string. */
    isDevelopment ? "'unsafe-eval'" : null,
  ].filter(Boolean);

  const connectSrc = [
    "'self'",
    supabase,
    // The dev server's HMR socket.
    isDevelopment ? "ws:" : null,
    isDevelopment ? "wss:" : null,
  ].filter(Boolean);

  const directives: [string, (string | null)[]][] = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    /* Where a form may post. `'self'` is the whole story: nothing on this site
       submits anywhere else, and the payment form lives inside the provider's
       own document where our policy does not reach. */
    ["form-action", ["'self'"]],
    ["object-src", ["'none'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    /* Product photos come from Supabase Storage; `data:` and `blob:` cover the
       image previews the manager builds locally before an upload finishes. */
    ["img-src", ["'self'", "data:", "blob:", supabase]],
    ["font-src", ["'self'"]],
    ["connect-src", connectSrc],
    ["frame-src", framePayment.length > 0 ? framePayment : ["'none'"]],
    [
      "frame-ancestors",
      pathname === FRAMED_PATH ? ["'self'"] : ["'none'"],
    ],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'none'"]],
  ];

  const policy = directives
    .map(([name, values]) => `${name} ${values.filter(Boolean).join(" ")}`)
    .join("; ");

  /* Not in development: the dev server is http, and this directive would make
     every asset request an https one that nothing is listening on. */
  return isDevelopment ? policy : `${policy}; upgrade-insecure-requests`;
}

/**
 * The Supabase origin, for `img-src` and `connect-src`.
 *
 * `NEXT_PUBLIC_` so it is inlined at build time and therefore readable from
 * the proxy runtime. It is not a secret — it is in every page's HTML already.
 */
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * A fresh nonce per response.
 *
 * 16 bytes from the platform CSRNG. `crypto.getRandomValues` and `btoa` are
 * both available on the Edge runtime and in Node, which `Buffer` is not — and
 * this file runs in whichever one the proxy happens to be on.
 */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
