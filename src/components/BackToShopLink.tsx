"use client";

import { LinkButton } from "@/components/ios/LinkButton";
import { useI18n } from "@/lib/i18n";

/** "Browse the shop", as a real anchor. Used on the two auth screens. */
export function BackToShopLink() {
  const { t } = useI18n();
  return (
    <LinkButton href="/" variant="plain" size="md">
      {t.landing.browse}
    </LinkButton>
  );
}
