import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_NO_FLASH_SCRIPT }} />
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
