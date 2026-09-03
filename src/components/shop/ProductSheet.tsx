"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { Sheet } from "@/components/ios/Sheet";
import { Button, Stepper } from "@/components/ios/Controls";
import { useToast } from "@/components/ios/Feedback";
import { formatAgorot, formatLadder } from "@/lib/money";
import { ladderFor } from "@/lib/pricing";
import { imageUrl } from "@/lib/images";
import { localize, type PricingRule, type Product } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useCart } from "./CartProvider";

/** The detail view: the big photo, the description, and the full ladder. */
export function ProductSheet({
  product,
  rules,
  onClose,
}: {
  product: Product;
  rules: PricingRule[];
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { setQuantity, lines } = useCart();
  const toast = useToast();

  const name = localize(product.name, locale);
  const description = localize(product.description, locale);
  const photo = product.images[0];
  const soldOut = !product.available || product.stock === 0;

  /* Starts at one rather than at whatever is already in the cart: the sheet
     asks "how many of these do you want", not "what is your cart". Adding
     sets the line rather than incrementing it, so opening twice and choosing
     two does not silently leave four. */
  const [quantity, setQuantityLocal] = useState(1);
  const alreadyIn = lines.find((line) => line.productId === product.id)?.quantity ?? 0;

  const ladder = ladderFor(
    {
      id: product.id,
      categoryId: product.categoryId,
      subclassId: product.subclassId,
      priceAgorot: product.priceAgorot,
    },
    rules
  );

  return (
    <Sheet
      open
      onClose={onClose}
      dismissLabel={t.common.dismiss}
      title={name}
      footer={
        <div className="flex items-center gap-3">
          <Stepper
            value={quantity}
            onChange={setQuantityLocal}
            min={1}
            max={product.stock ?? 99}
            decreaseLabel={t.cart.oneFewer}
            increaseLabel={t.cart.oneMore}
          />
          <div className="flex-1">
            <Button
              size="lg"
              fullWidth
              disabled={soldOut}
              onClick={() => {
                setQuantity(product.id, alreadyIn + quantity);
                toast(t.shop.addedToCart(name));
                onClose();
              }}
            >
              {soldOut ? t.shop.outOfStock : t.shop.addToCart}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="relative flex aspect-square w-full items-center justify-center overflow-hidden"
          style={{
            backgroundColor: "var(--fill-quaternary)",
            borderRadius: "var(--radius-card)",
          }}
        >
          {photo ? (
            <Image
              src={imageUrl(photo.path)}
              alt={name}
              fill
              sizes="(min-width: 640px) 32rem, 100vw"
              className="object-cover"
            />
          ) : (
            <ImageOff
              size={44}
              strokeWidth={1.5}
              aria-hidden="true"
              style={{ color: "var(--label-quaternary)" }}
            />
          )}
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <span className="text-title-2 tabular ltr-nums">
            {formatAgorot(product.priceAgorot)}
          </span>
          <span className="text-footnote" style={{ color: "var(--label-secondary)" }}>
            {t.shop.each}
          </span>
        </div>

        {ladder.length > 1 && (
          <div
            className="flex flex-col gap-1 p-3"
            style={{
              backgroundColor: "var(--fill-quaternary)",
              borderRadius: "var(--radius-card)",
            }}
          >
            {/* The whole ladder is digits and separators, so it is isolated as
                one unit — otherwise "1 · ₪10 / 3 · ₪25" reorders in Hebrew. */}
            <p className="text-subheadline ltr-nums tabular font-medium">
              {formatLadder(ladder, locale)}
            </p>
            <p className="text-footnote" style={{ color: "var(--label-secondary)" }}>
              {t.shop.mixAndMatch}
            </p>
          </div>
        )}

        {description && (
          <p className="text-body" style={{ color: "var(--label-secondary)" }}>
            {description}
          </p>
        )}

        {product.stock !== null && product.stock > 0 && (
          <p className="text-footnote ltr-nums" style={{ color: "var(--ios-orange)" }}>
            {t.shop.onlyLeft(product.stock)}
          </p>
        )}
      </div>
    </Sheet>
  );
}
