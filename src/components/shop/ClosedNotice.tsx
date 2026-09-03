"use client";

import { Moon } from "lucide-react";
import { LinkButton } from "@/components/ios/LinkButton";
import { useI18n } from "@/lib/i18n";
import { localize, type ShopSettings } from "@/lib/types";

/**
 * What a customer sees when the owner has switched the shop off.
 *
 * A whole screen rather than a banner over a browsable catalogue: if nothing
 * can be bought, showing prices and an add-to-cart button is an invitation to
 * a dead end. The contact widget stays, because "closed" is exactly when
 * someone wants to ask when you are back.
 */
export function ClosedNotice({ settings }: { settings: ShopSettings }) {
  const { t, locale } = useI18n();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <Moon
        size={44}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{ color: "var(--label-quaternary)" }}
      />
      <h1 className="text-title-2">{t.shop.closedTitle}</h1>
      <p className="text-body text-balance" style={{ color: "var(--label-secondary)" }}>
        {localize(settings.closedMessage, locale)}
      </p>
      <LinkButton href="/" variant="tinted" size="md">
        {t.common.back}
      </LinkButton>
    </main>
  );
}
