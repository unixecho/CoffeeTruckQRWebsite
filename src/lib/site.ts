/* ==========================================================================
   Where this site actually lives

   One answer, in one place. Three separate things need it and had been
   working it out independently, which is how they drift:

     - `checkOrigin()` in `lib/auth.ts`, refusing a foreign `Origin` header.
     - `proxy.ts`, building a Content-Security-Policy.
     - the payment adapters, building the return URLs a provider sends the
       customer's browser back to.

   The third is the one that makes this worth extracting: a return URL is
   handed to a third party and then navigated to by a browser we do not
   control, so it must be a URL we chose in full — never assembled from a
   request header, which is attacker-controlled and is the classic host-header
   injection vector.

   Deliberately not `server-only`: `proxy.ts` imports it, and this module
   reads nothing secret — only the public site URL and Vercel's own
   deployment host.
   ========================================================================== */

function normalize(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // `.origin` throws away any path, query or trailing slash somebody put in
    // the environment variable, which is the usual way this value is wrong.
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/**
 * The canonical origin, e.g. `https://mobile-3dprint-shop.vercel.app`.
 *
 * `NEXT_PUBLIC_SITE_URL` wins because it is the only one an operator sets
 * deliberately. `VERCEL_URL` is the deployment's own generated host and is
 * right for a preview build but wrong for production once a custom domain
 * exists — hence the order.
 *
 * Falls back to localhost rather than throwing: the whole app is built to run
 * with nothing configured (see `readCatalogue`'s seed fallback), and a
 * checkout that cannot even render in development because an environment
 * variable is missing would be a worse failure than a wrong return URL that
 * is obvious the first time anyone looks at it.
 */
export function siteOrigin(): string {
  return (
    normalize(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalize(process.env.VERCEL_URL) ??
    "http://localhost:3000"
  );
}

/**
 * Every origin a same-site request may legitimately come from.
 *
 * Wider than `siteOrigin()` on purpose: a preview deployment serves the same
 * code from a different host, and refusing its own `Origin` header would make
 * every write fail on every preview.
 */
export function allowedOrigins(): string[] {
  const origins = new Set<string>();

  const add = (value: string | null) => {
    if (value) origins.add(value);
  };

  add(normalize(process.env.NEXT_PUBLIC_SITE_URL));
  add(normalize(process.env.VERCEL_PROJECT_PRODUCTION_URL));
  add(normalize(process.env.VERCEL_URL));
  if (process.env.NODE_ENV === "development") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }

  return [...origins];
}

/** Builds an absolute URL on this site. Never takes a host from a request. */
export function siteUrl(path: string): string {
  return new URL(path, `${siteOrigin()}/`).toString();
}
