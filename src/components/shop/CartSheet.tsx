"use client";

import { useState } from "react";
import Image from "next/image";
import { ClipboardCopy, ShoppingBag, Trash2, Zap } from "lucide-react";
import { Sheet } from "@/components/ios/Sheet";
import { Button, Stepper } from "@/components/ios/Controls";
import { EmptyState, useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { LinkButton } from "@/components/ios/LinkButton";
import { formatAgorot } from "@/lib/money";
import { imageUrl } from "@/lib/images";
import { localize } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useCart, useShopSettings } from "./CartProvider";

/* ==========================================================================
   The cart

   The part that matters is the summary. A total that is simply lower than the
   sum of the prices reads as a mistake, so the bundles that were applied are
   named — "3-item deal · 2×" — and the saving is stated outright. A customer
   who can see why the number dropped trusts the number.
   ========================================================================== */

export function CartSheet() {
  const { t, locale } = useI18n();
  const settings = useShopSettings();
  const toast = useToast();
  const { open, setOpen, lines, pricing, products, setQuantity, clear } = useCart();
  const [copying, setCopying] = useState(false);

  if (!open) return null;

  const empty = lines.length === 0;

  /** Plain text, for pasting into Bit alongside the payment. */
  function orderNote(): string {
    const rows = lines.map((line) => {
      const product = products.get(line.productId);
      const name = product ? localize(product.name, locale) : line.productId;
      return `${line.quantity} × ${name}`;
    });
    return [
      t.cart.orderNoteHeading,
      ...rows,
      `${t.cart.total}: ${formatAgorot(pricing.totalAgorot)}`,
    ].join("\n");
  }

  async function copy() {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(orderNote());
      toast(t.cart.copied);
    } catch {
      /* Clipboard access is refused outside a secure context and in some
         in-app browsers — the exact places a QR code lands people. */
      toast(t.cart.copyFailed, "error");
    } finally {
      setCopying(false);
    }
  }

  /** Every bundle applied across the cart, flattened for the summary. */
  const applied = pricing.groups.flatMap((group) => group.bundles);

  return (
    <Sheet
      open
      onClose={() => setOpen(false)}
      dismissLabel={t.common.dismiss}
      title={t.cart.title}
      footer={
        empty ? undefined : (
          <div className="flex flex-col gap-2">
            {settings?.bitPaymentLink ? (
              <a
                href={settings.bitPaymentLink}
                target="_blank"
                rel="noopener noreferrer"
                className="press text-headline flex min-h-[50px] w-full items-center justify-center gap-2 font-medium"
                style={{
                  borderRadius: "var(--radius-card)",
                  backgroundColor: "var(--ios-blue)",
                  color: "#fff",
                }}
              >
                <Zap size={ICON_SIZE.md} strokeWidth={2.25} aria-hidden="true" />
                {t.cart.payWithBit}
              </a>
            ) : (
              <p
                className="text-footnote px-1 text-center"
                style={{ color: "var(--label-secondary)" }}
              >
                {t.cart.bitNotConfigured}
              </p>
            )}

            <Button
              variant="gray"
              size="lg"
              fullWidth
              onClick={copy}
              loading={copying}
              icon={<ClipboardCopy size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />}
            >
              {t.cart.copyOrderNote}
            </Button>

            {settings?.bitPaymentLink && (
              <p
                className="text-caption-1 px-1 text-center"
                style={{ color: "var(--label-tertiary)" }}
              >
                {t.cart.paymentNote}
              </p>
            )}
          </div>
        )
      }
    >
      {empty ? (
        <EmptyState
          icon={ShoppingBag}
          title={t.cart.emptyTitle}
          message={t.cart.emptyMessage}
          action={
            <LinkButton href="/shop" variant="tinted" size="md">
              {t.cart.browse}
            </LinkButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3">
            {lines.map((line) => {
              const product = products.get(line.productId);
              if (!product) return null;
              const name = localize(product.name, locale);
              const photo = product.images[0];

              return (
                <li key={line.productId} className="flex items-center gap-3">
                  <span
                    className="relative size-14 shrink-0 overflow-hidden"
                    style={{
                      borderRadius: "var(--radius-control)",
                      backgroundColor: "var(--fill-quaternary)",
                    }}
                  >
                    {photo && (
                      <Image
                        src={imageUrl(photo.path)}
                        alt=""
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    )}
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-subheadline truncate font-medium">{name}</span>
                    <span
                      className="text-footnote tabular ltr-nums"
                      style={{ color: "var(--label-secondary)" }}
                    >
                      {formatAgorot(product.priceAgorot)} · {t.shop.each}
                    </span>
                  </span>

                  <Stepper
                    value={line.quantity}
                    onChange={(next) => setQuantity(line.productId, next)}
                    min={0}
                    max={product.stock ?? 99}
                    decreaseLabel={t.cart.oneFewer}
                    increaseLabel={t.cart.oneMore}
                  />

                  <button
                    type="button"
                    aria-label={t.cart.removeAria(name)}
                    onClick={() => setQuantity(line.productId, 0)}
                    className="press flex size-11 shrink-0 items-center justify-center rounded-full"
                    style={{ color: "var(--label-tertiary)" }}
                  >
                    <Trash2 size={ICON_SIZE.sm} strokeWidth={2} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>

          <div
            className="flex flex-col gap-2 p-4"
            style={{
              backgroundColor: "var(--bg-grouped-secondary)",
              borderRadius: "var(--radius-card)",
            }}
          >
            {pricing.savingsAgorot > 0 && (
              <>
                <Row
                  label={t.cart.subtotal}
                  value={formatAgorot(pricing.baselineAgorot)}
                  muted
                />
                {/* Named, not priced. A bundle's saving is not attributable to
                    one rung when several combine — the honest number is the
                    single total below, and these say which deals produced it. */}
                {applied.map((bundle) => (
                  <Row
                    key={bundle.ruleId}
                    label={t.cart.bundleApplied(bundle.times, bundle.minQty)}
                    value={formatAgorot(bundle.priceAgorot * bundle.times)}
                    accent
                  />
                ))}
                <Row
                  label={t.cart.savings}
                  value={`−${formatAgorot(pricing.savingsAgorot)}`}
                  accent
                />
              </>
            )}

            <div
              className="flex items-baseline justify-between gap-3 pt-1"
              style={{ borderTop: "0.5px solid var(--separator)" }}
            >
              <span className="text-headline">{t.cart.total}</span>
              <span className="text-title-2 tabular ltr-nums">
                {formatAgorot(pricing.totalAgorot)}
              </span>
            </div>
          </div>

          <Button variant="plain" onClick={clear}>
            {t.cart.clear}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

function Row({
  label,
  value,
  muted,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className="text-subheadline"
        style={{
          color: accent
            ? "var(--ios-green)"
            : muted
              ? "var(--label-secondary)"
              : "var(--label-primary)",
        }}
      >
        {label}
      </span>
      <span
        className="text-subheadline tabular ltr-nums"
        style={{
          color: accent
            ? "var(--ios-green)"
            : muted
              ? "var(--label-secondary)"
              : "var(--label-primary)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
