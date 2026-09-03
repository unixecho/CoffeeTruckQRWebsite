"use client";

import { ShoppingBag } from "lucide-react";
import { ICON_SIZE } from "@/components/ios/Icon";
import { formatAgorot } from "@/lib/money";
import { haptic } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { useCart } from "./CartProvider";

/**
 * The floating cart button.
 *
 * Pinned bottom-LEFT, physically — the opposite corner from the WhatsApp
 * widget, which is pinned bottom-right for the same "a fixed affordance lives
 * where the thumb learned it lives" reason. Two floating buttons on one screen
 * have to be told apart by position as well as by colour, and if both were
 * logical they would swap places with each other on a language change.
 *
 * Hidden entirely when the cart is empty: a cart button showing zero is a
 * control with nothing behind it.
 */
export function CartFab() {
  const { t } = useI18n();
  const { count, pricing, setOpen } = useCart();

  if (count === 0) return null;

  return (
    <button
      type="button"
      aria-label={t.shop.cartAria(count)}
      onClick={() => {
        haptic("light");
        setOpen(true);
      }}
      className="press animate-rise-in fixed z-40 flex min-h-14 items-center gap-3 px-5"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
        left: "calc(env(safe-area-inset-left, 0px) + 1rem)",
        backgroundColor: "var(--ios-blue)",
        color: "#fff",
        borderRadius: "999px",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <span className="relative flex items-center">
        <ShoppingBag size={ICON_SIZE.lg} strokeWidth={2.1} aria-hidden="true" />
        <span
          aria-hidden="true"
          className="text-caption-2 tabular absolute -top-1.5 -end-2 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-bold"
          style={{ backgroundColor: "var(--ios-red)", color: "#fff" }}
        >
          {count}
        </span>
      </span>
      <span className="text-headline tabular ltr-nums">
        {formatAgorot(pricing.totalAgorot)}
      </span>
    </button>
  );
}
