import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { LocaleProvider, LOCALE_NO_FLASH_SCRIPT } from "@/lib/i18n";
import { ThemeProvider, THEME_NO_FLASH_SCRIPT } from "@/lib/theme";
import { ToastProvider } from "@/components/ios/Feedback";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "הדפסות תלת־ממד · עגלת הקפה",
    template: "%s · הדפסות תלת־ממד",
  },
  description:
    "חנות קטנה למוצרים מודפסים בתלת־ממד ליד עגלת הקפה. בוחרים, רואים מחיר, ומשלמים בביט בדלפק.",
  applicationName: "הדפסות תלת־ממד",
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    title: "הדפסות תלת־ממד · עגלת הקפה",
    description: "מוצרים מודפסים בתלת־ממד — בוחרים בטלפון, משלמים בדלפק.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
  ],
  width: "device-width",
  initialScale: 1,
  /* Never disable zoom. `maximumScale: 1` is a documented accessibility
     failure and one of the easiest to ship without noticing. */
  maximumScale: 5,
  viewportFit: "cover",
};

/**
 * The nonce for this response's inline scripts.
 *
 * Minted in `proxy.ts` and passed down on a request header. Reading it here
 * makes every page dynamic, which is the real cost of a nonce-based CSP and is
 * accepted deliberately: the storefront and the manager are already rendered
 * per request, and the two pages that were not — the sign-in screens — have no
 * data to cache.
 *
 * An empty nonce (nothing set the header, e.g. a path the proxy does not
 * match) renders the scripts without one. They are then blocked by the policy
 * rather than running unprotected, which is the correct direction to fail: a
 * page that flashes the wrong theme is a nuisance, a page that runs unsigned
 * inline script is not.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    /*
      `lang` and `dir` are the Hebrew defaults, then corrected before paint by
      the script below. `suppressHydrationWarning` covers exactly that: the
      attributes legitimately differ between the server's render and the
      client's first read of localStorage, and there is no server-side way to
      know a visitor's stored choice.
    */
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        {/* The two subsets almost every visitor needs. Arabic and Latin-ext
            load on demand via their unicode-range. */}
        <link
          rel="preload"
          href="/fonts/rubik-hebrew.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/rubik-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Both run synchronously, before React hydrates. Without them the
            first paint is always Hebrew-dark and an English visitor who
            prefers light watches the whole layout flip after hydration. */}
        {/*
          `suppressHydrationWarning` is load-bearing here, and not for the
          usual reason.

          Browsers deliberately hide a script's nonce from the DOM once the
          page has loaded — `getAttribute("nonce")` comes back empty — so that
          a CSS-selector injection cannot read the value out and reuse it.
          React's client render therefore sees `nonce=""` where the server
          wrote a real one, and reports a mismatch it will not "patch up". The
          server's attribute is the one that stays, which is exactly right;
          the warning is the browser's anti-exfiltration behaviour being
          mistaken for our bug.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }}
        />
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_NO_FLASH_SCRIPT }}
        />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider>
            <ToastProvider>{children}</ToastProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
