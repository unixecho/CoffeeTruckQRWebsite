"use client";

import { ArrowLeft, Lightbulb, Zap } from "lucide-react";
import { LinkButton } from "@/components/ios/LinkButton";
import { ICON_SIZE } from "@/components/ios/Icon";
import { useI18n } from "@/lib/i18n";
import { localize, type ShopSettings } from "@/lib/types";
import { whatsappLink } from "./ContactWidget";

/**
 * The landing view.
 *
 * Should read like the truck's sign lighting up as you walk to it, not like a
 * web page: the brand settles in, then the actions stagger in beneath it. The
 * entrance is the only decoration here — everything else on screen is
 * something to press.
 */
export function LandingView({ settings }: { settings: ShopSettings }) {
  const { t, locale } = useI18n();

  const suggestionHref = whatsappLink(settings.whatsappPhone, t.landing.whatsappSuggestion);
  const announcement = settings.announcement ? localize(settings.announcement, locale) : "";

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 4rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 5rem)",
      }}
    >
      {announcement && (
        <p
          role="status"
          className="animate-rise-in text-footnote px-4 py-3 text-center"
          style={{
            backgroundColor: "var(--fill-quaternary)",
            borderRadius: "var(--radius-card)",
            color: "var(--label-secondary)",
          }}
        >
          {announcement}
        </p>
      )}

      <header className="stagger flex flex-col gap-3">
        <p
          className="text-footnote font-semibold tracking-wide uppercase"
          style={{ ["--i" as string]: 0, color: "var(--ios-orange)" }}
        >
          {t.landing.eyebrow}
        </p>
        <h1 className="text-large-title text-balance" style={{ ["--i" as string]: 1 }}>
          {t.landing.title}
        </h1>
        <p
          className="text-body text-balance"
          style={{ ["--i" as string]: 2, color: "var(--label-secondary)" }}
        >
          {t.landing.body}
        </p>
      </header>

      {settings.open ? (
        <div className="stagger flex flex-col gap-3">
          <div style={{ ["--i" as string]: 3 }}>
            <LinkButton href="/shop" variant="filled" size="lg" fullWidth>
              {t.landing.browse}
              {/* Points along the reading direction, so it aims at the shop in
                  Hebrew and Arabic too rather than back at the text. */}
              <ArrowLeft
                size={ICON_SIZE.md}
                strokeWidth={2.25}
                aria-hidden="true"
                style={{ transform: "scaleX(var(--dir, 1))" }}
              />
            </LinkButton>
          </div>

          {/* A dead payment button is worse than none: it opens a blank page
              and the customer concludes the shop is broken. */}
          {settings.bitPaymentLink && (
            <a
              href={settings.bitPaymentLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ["--i" as string]: 4 }}
              className="press text-subheadline flex min-h-11 items-center justify-center gap-2 px-4 font-medium"
            >
              <Zap size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />
              {t.landing.quickBit}
            </a>
          )}

          {suggestionHref && (
            <a
              href={suggestionHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ["--i" as string]: 5, color: "var(--label-secondary)" }}
              className="press text-subheadline flex min-h-11 items-center justify-center gap-2 px-4"
            >
              <Lightbulb size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />
              {t.landing.suggestions}
            </a>
          )}
        </div>
      ) : (
        <div
          className="animate-rise-in flex flex-col gap-2 p-5 text-center"
          style={{
            backgroundColor: "var(--bg-grouped-secondary)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <h2 className="text-title-3">{t.shop.closedTitle}</h2>
          <p className="text-subheadline" style={{ color: "var(--label-secondary)" }}>
            {localize(settings.closedMessage, locale)}
          </p>
        </div>
      )}
    </main>
  );
}
