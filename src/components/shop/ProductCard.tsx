"use client";

import Image from "next/image";
import { ImageOff, Plus } from "lucide-react";
import { ICON_SIZE } from "@/components/ios/Icon";
import { useToast } from "@/components/ios/Feedback";
import { formatAgorot } from "@/lib/money";
import { ladderFor } from "@/lib/pricing";
import { imageUrl } from "@/lib/images";
import { localize, type PricingRule, type Product } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { useCart } from "./CartProvider";

/**
 * One product, in the grid.
 *
 * Two separate targets rather than one: the card opens the detail sheet, and
 * a distinct add button drops it straight in the cart. At a counter the common
 * action is "one of those" without reading anything, and making that require a
 * sheet first would be an extra tap on every sale.
 */
export function ProductCard({
  product,
  rules,
  onOpen,
}: {
  product: Product;
  rules: PricingRule[];
  onOpen: () => void;
}) {
  const { t, locale } = useI18n();
  const { add } = useCart();
  const toast = useToast();

  const name = localize(product.name, locale);
  const photo = product.images[0];
  const soldOut = !product.available || product.stock === 0;

  const ladder = ladderFor(
    {
      id: product.id,
      categoryId: product.categoryId,
      subclassId: product.subclassId,
      priceAgorot: product.priceAgorot,
    },
    rules
  );
  const bundle = ladder.length > 1 ? ladder.at(-1) : undefined;

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--bg-grouped-secondary)",
        borderRadius: "var(--radius-card)",
        opacity: soldOut ? 0.55 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => {
          haptic("selection");
          onOpen();
        }}
        className="press-row flex flex-1 flex-col text-start"
      >
        <span
          className="relative flex aspect-square w-full items-center justify-center"
          style={{ backgroundColor: "var(--fill-quaternary)" }}
        >
          {photo ? (
            <Image
              src={imageUrl(photo.path)}
              alt={name}
              fill
              sizes="(min-width: 640px) 33vw, 50vw"
              className="object-cover"
            />
          ) : (
            <ImageOff
              size={28}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: "var(--label-quaternary)" }}
            />
          )}

          {soldOut && (
            <span
              className="text-caption-1 absolute top-2 start-2 px-2 py-0.5 font-semibold"
              style={{
                backgroundColor: "var(--material-sheet)",
                backdropFilter: "blur(12px)",
                borderRadius: "var(--radius-control)",
              }}
            >
              {t.shop.outOfStock}
            </span>
          )}
        </span>

        <span className="flex flex-1 flex-col gap-0.5 px-3 pt-2.5 pb-1">
          <span className="text-subheadline line-clamp-2 font-medium">{name}</span>
          <span className="text-body tabular ltr-nums font-semibold">
            {formatAgorot(product.priceAgorot)}
          </span>
          {/* No `.ltr-nums`: this is translated text around a number, not a
              bare number. See the note in StoreView. */}
          {bundle && (
            <span className="text-caption-1 tabular" style={{ color: "var(--ios-orange)" }}>
              {t.shop.bundleHint(bundle.qty, formatAgorot(bundle.priceAgorot))}
            </span>
          )}
        </span>
      </button>

      <div className="px-3 pb-2">
        <button
          type="button"
          disabled={soldOut}
          aria-label={`${t.shop.addToCart}: ${name}`}
          onClick={() => {
            haptic("success");
            add(product.id);
            toast(t.shop.addedToCart(name));
          }}
          className="press text-subheadline flex min-h-11 w-full items-center justify-center gap-1 font-medium"
          style={{
            borderRadius: "var(--radius-control)",
            backgroundColor: "var(--fill-tertiary)",
            color: soldOut ? "var(--label-tertiary)" : "var(--ios-blue)",
          }}
        >
          <Plus size={ICON_SIZE.sm} strokeWidth={2.5} aria-hidden="true" />
          {t.shop.addToCart}
        </button>
      </div>
    </div>
  );
}
