"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ClipboardCopy, CreditCard, Inbox, Store } from "lucide-react";

import { NavBar } from "@/components/ios/NavBar";
import { Button, SegmentedControl } from "@/components/ios/Controls";
import { ActionSheet } from "@/components/ios/Sheet";
import { EmptyState, useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { useI18n } from "@/lib/i18n";
import { formatAgorot } from "@/lib/money";
import { localize, type Locale } from "@/lib/types";
import type { Order } from "@/lib/payments/types";
import { errorMessage, patch } from "./api";
import { ReadOnlyBanner } from "./ReadOnlyBanner";

/* ==========================================================================
   Orders

   The screen the owner actually stands in front of, so it is built around one
   question — **what do I hand over next** — and one action per card.

   Two decisions worth stating.

   **Newest first, open by default.** An order that has been dealt with is
   history; the filter starts on "open" and the full list is one tap away.

   **Handing over is one button, not two.** For a counter order it also
   records the payment, because at the counter those are the same moment: the
   owner watches the Bit confirmation and puts the bag down. Splitting them
   would mean two taps, one-handed, with somebody waiting — and the second one
   would get skipped, leaving the till permanently wrong. A card order is
   different and the button refuses until the money is actually in; that rule
   lives in `canCollect` in `lib/payments/status.ts`, and the server enforces
   it whatever this screen renders.
   ========================================================================== */

type Filter = "open" | "all";

export function OrdersView({
  orders,
  live,
  checkoutEnabled,
}: {
  orders: Order[];
  live: boolean;
  checkoutEnabled: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [filter, setFilter] = useState<Filter>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Order | null>(null);

  const shown = useMemo(
    () => (filter === "open" ? orders.filter((order) => order.status === "placed") : orders),
    [orders, filter]
  );

  async function act(order: Order, action: "collect" | "cancel") {
    setBusy(order.id);
    const result = await patch(`/api/manager/orders/${order.id}`, { action });
    setBusy(null);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      /* A 409 means somebody else already moved it — the other phone at the
         truck, or the customer cancelling. Re-reading is the repair. */
      router.refresh();
      return;
    }

    toast(t.manager.saved);
    router.refresh();
  }

  async function copy(order: Order) {
    const text = [
      `#${String(order.orderNumber).padStart(4, "0")}`,
      ...order.items.map((item) => `${item.quantity} × ${localize(item.name, locale)}`),
      `${t.cart.total}: ${formatAgorot(order.totalAgorot)}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      toast(t.manager.orders.copied);
    } catch {
      toast(t.cart.copyFailed, "error");
    }
  }

  return (
    <>
      <NavBar title={t.manager.orders.title} subtitle={t.manager.orders.subtitle} />

      {!live && <ReadOnlyBanner />}

      {live && !checkoutEnabled && (
        <p
          role="status"
          className="text-footnote mb-4 flex items-start gap-2 p-3"
          style={{
            backgroundColor: "var(--bg-grouped-secondary)",
            borderRadius: "var(--radius-card)",
            borderInlineStart: "3px solid var(--ios-orange)",
            color: "var(--label-secondary)",
          }}
        >
          <AlertTriangle
            size={ICON_SIZE.sm}
            strokeWidth={2.25}
            aria-hidden="true"
            className="mt-0.5 shrink-0"
            style={{ color: "var(--ios-orange)" }}
          />
          {t.manager.orders.checkoutOff}
        </p>
      )}

      <div className="mb-6">
        <SegmentedControl<Filter>
          label={t.manager.orders.title}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: t.manager.orders.openOnly },
            { value: "all", label: t.manager.orders.all },
          ]}
        />
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t.manager.orders.none}
          message={t.manager.orders.noneMessage}
        />
      ) : (
        <ul className="stagger flex flex-col gap-3">
          {shown.map((order, index) => (
            <li key={order.id} style={{ ["--i" as string]: index }}>
              <OrderCard
                order={order}
                locale={locale}
                busy={busy === order.id}
                disabled={!live}
                onCollect={() => act(order, "collect")}
                onCancel={() => setConfirming(order)}
                onCopy={() => copy(order)}
              />
            </li>
          ))}
        </ul>
      )}

      <ActionSheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={
          confirming
            ? t.manager.orders.confirmCancelTitle(
                `#${String(confirming.orderNumber).padStart(4, "0")}`
              )
            : undefined
        }
        message={t.manager.orders.confirmCancelBody}
        cancelLabel={t.common.cancel}
        actions={[
          {
            label: t.manager.orders.cancel,
            destructive: true,
            onSelect: () => {
              if (confirming) void act(confirming, "cancel");
            },
          },
        ]}
      />
    </>
  );
}

/* --------------------------------------------------------------------------
   One order
   -------------------------------------------------------------------------- */

/**
 * The time, always in the shop's own timezone.
 *
 * Pinned to Asia/Jerusalem rather than the viewer's locale for a reason that
 * is not about correctness of the clock: a server render and a browser render
 * in different zones produce different strings, and React calls that a
 * hydration failure. Pinning makes both sides agree — and the shop is in one
 * place, so the owner's clock is the only one this ever needs to match.
 */
function shopTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "he" ? "he-IL" : locale === "ar" ? "ar" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
    hour12: false,
  }).format(new Date(iso));
}

function OrderCard({
  order,
  locale,
  busy,
  disabled,
  onCollect,
  onCancel,
  onCopy,
}: {
  order: Order;
  locale: Locale;
  busy: boolean;
  disabled: boolean;
  onCollect: () => void;
  onCancel: () => void;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  const o = t.manager.orders;

  const number = `#${String(order.orderNumber).padStart(4, "0")}`;
  const open = order.status === "placed";
  const paid = order.paymentStatus === "paid";
  const flagged = order.paymentStatus === "flagged";

  /* Mirrors `canCollect` in lib/payments/status.ts. The server is the
     enforcement — this only decides whether to offer the button, so that a
     card order nobody has paid for never gets a tap that will 409. */
  const collectable =
    open &&
    (order.paymentMethod === "counter"
      ? order.paymentStatus !== "cancelled"
      : paid);

  const units = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article
      className="flex flex-col gap-3 p-4"
      style={{
        backgroundColor: "var(--bg-grouped-secondary)",
        borderRadius: "var(--radius-card)",
        borderInlineStart: flagged ? "3px solid var(--ios-red)" : undefined,
      }}
    >
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-2">
            <h2 className="text-title-3 tabular ltr-nums">{number}</h2>
            <span
              className="text-caption-1 tabular ltr-nums"
              style={{ color: "var(--label-tertiary)" }}
            >
              {shopTime(order.createdAt, locale)}
            </span>
          </div>
          <p className="text-footnote" style={{ color: "var(--label-secondary)" }}>
            {order.customerName ?? o.noCustomer}
            {order.customerPhone ? " · " : ""}
            {order.customerPhone && (
              <span className="tabular ltr-nums">{order.customerPhone}</span>
            )}
          </p>
        </div>

        <p className="text-title-3 tabular ltr-nums shrink-0">
          {formatAgorot(order.totalAgorot)}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          icon={order.paymentMethod === "card" ? CreditCard : Store}
          label={order.paymentMethod === "card" ? o.methodCard : o.methodCounter}
          color="var(--label-secondary)"
        />
        {flagged ? (
          <Badge icon={AlertTriangle} label={o.flaggedLabel} color="var(--ios-red)" />
        ) : paid ? (
          <Badge icon={Check} label={o.paidLabel} color="var(--ios-green)" />
        ) : order.paymentStatus === "pending" ? (
          <Badge label={o.pendingLabel} color="var(--ios-blue)" />
        ) : (
          <Badge label={o.unpaidLabel} color="var(--label-secondary)" />
        )}
        {!open && (
          <Badge
            label={
              order.status === "collected"
                ? o.statusCollected
                : order.status === "cancelled"
                  ? o.statusCancelled
                  : o.statusExpired
            }
            color="var(--label-tertiary)"
          />
        )}
        <span className="text-caption-1" style={{ color: "var(--label-tertiary)" }}>
          {o.itemsLine(units)}
        </span>
      </div>

      {flagged && (
        <p className="text-footnote" role="alert" style={{ color: "var(--ios-red)" }}>
          {o.flaggedHelper}
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {order.items.map((item) => (
          <li key={item.id} className="text-subheadline flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              <span className="tabular ltr-nums">{item.quantity}</span> ×{" "}
              {localize(item.name, locale)}
            </span>
            <span
              className="tabular ltr-nums shrink-0 text-footnote"
              style={{ color: "var(--label-tertiary)" }}
            >
              {formatAgorot(item.unitPriceAgorot * item.quantity)}
            </span>
          </li>
        ))}
      </ul>

      {order.note && (
        <p
          className="text-footnote p-2"
          style={{
            backgroundColor: "var(--fill-quaternary)",
            borderRadius: "var(--radius-control)",
            color: "var(--label-secondary)",
          }}
        >
          {order.note}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {collectable && (
          <Button
            size="md"
            onClick={onCollect}
            loading={busy}
            disabled={disabled}
            ariaLabel={o.collectAria(number)}
            icon={<Check size={ICON_SIZE.sm} strokeWidth={2.5} aria-hidden="true" />}
          >
            {o.collect}
          </Button>
        )}

        <Button
          variant="gray"
          size="md"
          onClick={onCopy}
          icon={<ClipboardCopy size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />}
        >
          {o.copy}
        </Button>

        {open && (
          <Button
            variant="plain"
            size="md"
            onClick={onCancel}
            disabled={disabled || busy}
            ariaLabel={o.cancelAria(number)}
          >
            {o.cancel}
          </Button>
        )}
      </div>
    </article>
  );
}

/** A status chip. Icon plus text where it exists, so colour is never alone. */
function Badge({
  icon: Glyph,
  label,
  color,
}: {
  icon?: typeof Check;
  label: string;
  color: string;
}) {
  return (
    <span
      className="text-caption-1 inline-flex items-center gap-1 px-2 py-0.5 font-medium"
      style={{ borderRadius: "999px", backgroundColor: "var(--fill-quaternary)", color }}
    >
      {Glyph && <Glyph size={12} strokeWidth={2.5} aria-hidden="true" />}
      {label}
    </span>
  );
}
