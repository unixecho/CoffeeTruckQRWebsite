import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /* Product photos live in Supabase Storage once the catalogue is online, and
     in `public/products/` before that. Only the project's own storage host is
     allowed — a wildcard here would let any URL in the database render an
     arbitrary remote image through our domain. */
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },

  async headers() {
    /* The payment provider's checkout origin, when one is configured. Read
       here as a static property so it survives build-time inlining, exactly as
       `lib/payments/config.ts` explains — and used only to widen
       `Permissions-Policy`, never to widen what may be framed. `frame-src`
       lives in the Content-Security-Policy built per request in `proxy.ts`. */
    const paymentOrigin = (() => {
      const raw = process.env.GROW_CHECKOUT_ORIGIN ?? process.env.GROW_API_BASE;
      if (!raw) return null;
      try {
        const url = new URL(raw);
        return url.protocol === "https:" ? url.origin : null;
      } catch {
        return null;
      }
    })();

    /* The Payment Request API — Apple Pay, Google Pay — is exercised by the
       provider's own frame, and a `Permissions-Policy` that omits it silently
       removes those buttons from a page that otherwise looks fine. Delegated
       to exactly one origin, and only when one is configured. */
    const permissionsPolicy = [
      "camera=(self)",
      "microphone=()",
      "geolocation=()",
      paymentOrigin ? `payment=(self "${paymentOrigin}")` : "payment=(self)",
    ].join(", ");

    /* The Content-Security-Policy is NOT here. It needs a per-response nonce
       and a per-path `frame-ancestors`, and `next.config.ts` is evaluated once
       at build time — so it lives in `proxy.ts`. What remains here is the set
       of headers that are the same for every response. */
    return [
      {
        /* Everything except the payment return page, which is deliberately
           framed — by us, inside our own checkout. A negative lookahead rather
           than relying on a later rule overriding an earlier one, because
           "which duplicate wins" is not a property worth depending on for a
           header whose failure mode is a blank frame at a counter. */
        source: "/((?!checkout/frame-return).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: permissionsPolicy },
          /* Two years, subdomains included. Vercel serves https only, and the
             QR code on the truck points at an https URL — so there is no
             plain-http entry point this could strand. */
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          /* Severs the window reference a popup would otherwise keep to us,
             which is what closes tabnabbing from anything we open. */
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        /* The one framed page. Same headers, minus the DENY that would stop
           our own checkout from loading it. `frame-ancestors 'self'` in the
           CSP is the modern half of the same rule and is set in `proxy.ts`. */
        source: "/checkout/frame-return",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: permissionsPolicy },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        /* An order URL carries a bearer token. It must never be held by a
           shared cache, and its address must never travel to a third party in
           a referrer — including to the payment provider we are about to
           frame. */
        source: "/checkout/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        /* The manager is owner-only and must never be indexed or cached by a
           shared proxy, even though middleware already gates it. */
        source: "/manager/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
