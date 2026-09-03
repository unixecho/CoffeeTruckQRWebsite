"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ClipboardCopy,
  CreditCard,
  Check,
  ShieldCheck,
  Store,
  Zap,
} from "lucide-react";

import { NavBar } from "@/components/ios/NavBar";
import { Button } from "@/components/ios/Controls";
import { ActionSheet } from "@/components/ios/Sheet";
import { useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { LinkButton } from "@/components/ios/LinkButton";
import { useCart } from "@/components/shop/CartProvider";
import { useI18n } from "@/lib/i18n";
import { formatAgorot } from "@/lib/money";
import { localize } from "@/lib/types";
import type { PublicOrderView } from "@/lib/payments/types";
import { cancelOrder, checkoutErrorMessage, forgetDetails, startPayment } from "./api";
import { PaymentFrame, type FrameOutcome } from "./PaymentFrame";
import { forgetPayingOrder, rememberPayingOrder } from "./session";
import { useOrderStatus } from "./useOrderStatus";

/* ==========================================================================
   The order screen

   One URL, held by whoever placed the order, that answers the only three
   questions they have: what did I order, what do I owe, and what happens now.
   It survives a refresh, a locked phone and a lost signal, which is the whole
   reason the order lives on the server rather than in a component's state.

   ## The screen changes shape, not just its text

   Each state gets the action that belongs to it and no others — a card order
   waiting to be paid shows the payment frame, a counter order shows the
   number to say out loud and the Bit link, a settled one shows a receipt. An
   interface that renders every possible button and disables most of them is
   asking the customer to work out which one is theirs.

   ## Nothing here decides whether a payment happened

   Every status on this screen came from our own server, which asked the
   provider directly. The frame's own "done" message only triggers that read.
   ========================================================================== */

export function OrderView({
  token,
  initialOrder,
  initialCan,
  bitPaymentLink,
  cardAvailable,
}: {
  token: string;
  initialOrder: PublicOrderView;
  initialCan: { retryPayment: boolean; cancel: boolean };
  bitPaymentLink: string;
  cardAvailable: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const { setQuantity } = useCart();

  const { order, can, refreshing, refresh, apply } = useOrderStatus(
    token,
    initialOrder,
    initialCan
  );

  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "pay" | "cancel" | "forget">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<null | "cancel" | "forget">(null);

  const number = String(order.orderNumber).padStart(4, "0");

  /* --- Actions ------------------------------------------------------------ */

  async function pay() {
    setBusy("pay");
    setError(null);
    /* Parked before the frame opens, not after: some providers break out of
       the iframe and redirect the whole tab, and by then this component is
       gone. See `session.ts`. */
    rememberPayingOrder(token);
    const result = await startPayment(token);
    setBusy(null);

    if (!result.ok) {
      setError(checkoutErrorMessage(result.error, t));
      /* The order is untouched and the counter is still there, so this is a
         setback rather than a failure. The retry button stays. */
      return;
    }
    setSessionUrl(result.data.session.url);
  }

  async function onFrameOutcome(outcome: FrameOutcome) {
    setSessionUrl(null);
    forgetPayingOrder();

    /* The message says the customer is done, not that they paid. `confirm`
       makes the server read the transaction back from the provider before
       anything on this screen changes. */
    const next = await refresh(true);

    if (outcome === "failure" && next && next.order.paymentStatus !== "paid") {
      setError(t.checkout.errors.generic);
    }
  }

  async function doCancel() {
    setBusy("cancel");
    setError(null);
    const result = await cancelOrder(token);
    setBusy(null);

    if (!result.ok) {
      setError(checkoutErrorMessage(result.error, t));
      return;
    }
    apply(result.data);
  }

  async function doForget() {
    setBusy("forget");
    setError(null);
    const result = await forgetDetails(token);
    setBusy(null);

    if (!result.ok) {
      setError(checkoutErrorMessage(result.error, t));
      return;
    }
    apply(result.data);
    toast(t.checkout.forgetDone);
  }

  /** Put the same items back in the cart, for an order that did not happen. */
  function orderAgain() {
    for (const item of order.items) {
      if (item.productId) setQuantity(item.productId, item.quantity);
    }
    router.push("/shop");
  }

  async function copySummary() {
    const text = [
      `#${number}`,
      ...order.items.map((item) => `${item.quantity} × ${localize(item.name, locale)}`),
      `${t.cart.total}: ${formatAgorot(order.totalAgorot)}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      toast(t.cart.copied);
    } catch {
      // Refused outside a secure context and in some in-app browsers — which
      // is exactly where a QR code lands people.
      toast(t.cart.copyFailed, "error");
    }
  }

  /* --- Derived ------------------------------------------------------------ */

  const paid = order.paymentStatus === "paid";
  const flagged = order.paymentStatus === "flagged";
  const open = order.status === "placed";
  const awaitingCard = open && order.paymentMethod === "card" && !paid && !flagged;
  const awaitingCounter = open && order.paymentMethod === "counter" && !paid;
  const hasDetails = Boolean(order.customerName || order.customerPhone);

  return (
    <>
      <NavBar title={t.checkout.orderTitle} backTo="/shop" backLabel={t.checkout.backToShop} />

      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)]">
        {/* --- The number, which is the thing the counter actually uses --- */}
        <section
          className="animate-rise-in flex flex-col items-center gap-2 p-6 text-center"
          style={{
            backgroundColor: "var(--bg-grouped-secondary)",
            borderRadius: "var(--radius-card)",
          }}
        >
          <p
            className="text-footnote tracking-wide uppercase"
            style={{ color: "var(--label-secondary)" }}
          >
            {t.checkout.orderNumber}
          </p>
          {/* Digits only, so isolated as one LTR run: a Hebrew line would
              otherwise reorder "#0042" into something that is not the number. */}
          <p className="text-large-title tabular ltr-nums">#{number}</p>

          <StatusPill order={order} />

          <p className="text-title-2 tabular ltr-nums mt-1">
            {formatAgorot(order.totalAgorot)}
          </p>

          {open && <ExpiryNote expiresAt={order.expiresAt} />}
        </section>

        {/* --- What to do now --------------------------------------------- */}
        {paid && (
          <Callout tone="green" icon={Check} title={t.checkout.paidTitle}>
            {t.checkout.paidMessage}
          </Callout>
        )}

        {flagged && (
          <Callout tone="red" icon={AlertTriangle} title={t.checkout.flaggedTitle}>
            {t.checkout.flaggedMessage}
          </Callout>
        )}

        {order.status === "collected" && (
          <Callout tone="green" icon={Check} title={t.checkout.collectedTitle}>
            {t.checkout.collectedMessage}
          </Callout>
        )}

        {order.status === "cancelled" && (
          <Callout tone="gray" icon={Store} title={t.checkout.cancelledTitle}>
            {t.checkout.cancelledMessage}
          </Callout>
        )}

        {order.status === "expired" && (
          <Callout tone="orange" icon={AlertTriangle} title={t.checkout.expiredTitle}>
            {t.checkout.expiredMessage}
          </Callout>
        )}

        {awaitingCounter && (
          <section className="flex flex-col gap-3">
            <Callout tone="blue" icon={Store} title={t.checkout.payAtCounter}>
              {t.checkout.payAtCounterHelper}
            </Callout>

            {bitPaymentLink && (
              <a
                href={bitPaymentLink}
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
            )}

            <p className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
              {t.checkout.showAtCounter}
            </p>
          </section>
        )}

        {awaitingCard && (
          <section className="flex flex-col gap-3">
            {sessionUrl ? (
              <PaymentFrame
                url={sessionUrl}
                onOutcome={onFrameOutcome}
                onStuck={() => {
                  setSessionUrl(null);
                  setError(t.checkout.errors.providerDown);
                }}
              />
            ) : order.paymentStatus === "pending" ? (
              <>
                <Callout tone="blue" icon={CreditCard} title={t.checkout.awaitingTitle}>
                  {t.checkout.awaitingMessage}
                </Callout>
                <Button
                  variant="gray"
                  size="lg"
                  fullWidth
                  onClick={() => refresh(true)}
                  loading={refreshing}
                >
                  {t.checkout.retry}
                </Button>
              </>
            ) : (
              <Button
                size="lg"
                fullWidth
                onClick={pay}
                loading={busy === "pay"}
                disabled={!cardAvailable || !can.retryPayment}
                icon={<CreditCard size={ICON_SIZE.md} strokeWidth={2.25} aria-hidden="true" />}
              >
                {t.checkout.payByCard}
              </Button>
            )}

            {/* The counter never stops being an option, and saying so where
                a card payment just failed is the difference between a sale
                and somebody walking off. */}
            <p className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
              {t.checkout.payAtCounterHelper}
            </p>
          </section>
        )}

        {error && (
          <p role="alert" className="text-footnote px-1" style={{ color: "var(--ios-red)" }}>
            {error}
          </p>
        )}

        {/* --- What was ordered ------------------------------------------- */}
        <section className="flex flex-col gap-2">
          <h2
            className="text-footnote px-1 tracking-wide uppercase"
            style={{ color: "var(--label-secondary)" }}
          >
            {t.checkout.summary}
          </h2>

          <div
            className="flex flex-col gap-2 p-4"
            style={{
              backgroundColor: "var(--bg-grouped-secondary)",
              borderRadius: "var(--radius-card)",
            }}
          >
            {/* The items are a list; the totals below them are not, so they
                sit outside the <ul> rather than being non-list children of
                one. Assistive tech announces "list, N items" either way, and
                only one of the two is true. */}
            <ul className="flex flex-col gap-2">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3">
                <span className="text-subheadline min-w-0 truncate">
                  <span className="tabular ltr-nums">{item.quantity}</span> ×{" "}
                  {localize(item.name, locale)}
                </span>
                <span
                  className="text-subheadline tabular ltr-nums shrink-0"
                  style={{ color: "var(--label-secondary)" }}
                >
                  {formatAgorot(item.unitPriceAgorot * item.quantity)}
                </span>
              </li>
            ))}
            </ul>

            {order.savingsAgorot > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-subheadline" style={{ color: "var(--ios-green)" }}>
                  {t.cart.savings}
                </span>
                <span
                  className="text-subheadline tabular ltr-nums"
                  style={{ color: "var(--ios-green)" }}
                >
                  −{formatAgorot(order.savingsAgorot)}
                </span>
              </div>
            )}

            <div
              className="flex items-baseline justify-between gap-3 pt-1"
              style={{ borderTop: "0.5px solid var(--separator)" }}
            >
              <span className="text-headline">{t.cart.total}</span>
              <span className="text-headline tabular ltr-nums">
                {formatAgorot(order.totalAgorot)}
              </span>
            </div>
          </div>

          {order.note && (
            <p className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
              {order.note}
            </p>
          )}
        </section>

        {/* --- What we hold about you -------------------------------------
            Shown on the same screen as the "remove it" button, deliberately.
            A data-rights flow that is a support process is a data-rights flow
            nobody uses. PLAYBOOK §1.4. ------------------------------------ */}
        <section className="flex flex-col gap-2">
          <h2
            className="text-footnote px-1 tracking-wide uppercase"
            style={{ color: "var(--label-secondary)" }}
          >
            {t.checkout.privacyTitle}
          </h2>

          <div
            className="flex flex-col gap-2 p-4"
            style={{
              backgroundColor: "var(--bg-grouped-secondary)",
              borderRadius: "var(--radius-card)",
            }}
          >
            <p className="text-footnote" style={{ color: "var(--label-secondary)" }}>
              {t.checkout.privacyBody}
            </p>

            {hasDetails ? (
              <>
                <dl className="text-subheadline flex flex-col gap-1">
                  {order.customerName && (
                    <div className="flex justify-between gap-3">
                      <dt style={{ color: "var(--label-secondary)" }}>{t.checkout.name}</dt>
                      <dd className="truncate">{order.customerName}</dd>
                    </div>
                  )}
                  {order.customerPhone && (
                    <div className="flex justify-between gap-3">
                      <dt style={{ color: "var(--label-secondary)" }}>{t.checkout.phone}</dt>
                      <dd className="tabular ltr-nums">{order.customerPhone}</dd>
                    </div>
                  )}
                </dl>

                <Button
                  variant="plain"
                  onClick={() => setConfirming("forget")}
                  loading={busy === "forget"}
                >
                  {t.checkout.forget}
                </Button>
              </>
            ) : (
              <p
                className="text-footnote flex items-center gap-1.5"
                style={{ color: "var(--ios-green)" }}
              >
                <ShieldCheck size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />
                {t.checkout.forgetDone}
              </p>
            )}
          </div>
        </section>

        {/* --- Everything else -------------------------------------------- */}
        <div className="flex flex-col gap-2">
          <Button
            variant="gray"
            fullWidth
            onClick={copySummary}
            icon={<ClipboardCopy size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />}
          >
            {t.checkout.copySummary}
          </Button>

          {!open && order.items.some((item) => item.productId) && (
            <Button variant="tinted" fullWidth onClick={orderAgain}>
              {t.cart.placeOrder}
            </Button>
          )}

          {can.cancel && (
            <Button
              variant="plain"
              fullWidth
              onClick={() => setConfirming("cancel")}
              loading={busy === "cancel"}
            >
              {t.checkout.cancelOrder}
            </Button>
          )}

          <div className="flex justify-center pt-2">
            <LinkButton href="/shop" variant="plain" size="md">
              {t.checkout.backToShop}
            </LinkButton>
          </div>
        </div>
      </div>

      <ActionSheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={
          confirming === "cancel"
            ? t.checkout.cancelConfirmTitle
            : t.checkout.forgetConfirmTitle
        }
        message={
          confirming === "cancel"
            ? t.checkout.cancelConfirmBody
            : t.checkout.forgetConfirmBody
        }
        cancelLabel={confirming === "cancel" ? t.checkout.keepOrder : t.common.cancel}
        actions={[
          {
            label: confirming === "cancel" ? t.checkout.cancelOrder : t.checkout.forget,
            destructive: true,
            onSelect: () => {
              if (confirming === "cancel") void doCancel();
              else void doForget();
            },
          },
        ]}
      />
    </>
  );
}

/* --------------------------------------------------------------------------
   Pieces
   -------------------------------------------------------------------------- */

/**
 * The status, as a word and a shape.
 *
 * Never colour alone: each state carries its own text, and the two that
 * matter most — paid and needs-checking — also carry an icon.
 */
function StatusPill({ order }: { order: PublicOrderView }) {
  const { t } = useI18n();

  const { label, color, Glyph } = (() => {
    if (order.status === "collected") {
      return { label: t.manager.orders.statusCollected, color: "var(--ios-green)", Glyph: Check };
    }
    if (order.status === "cancelled") {
      return { label: t.manager.orders.statusCancelled, color: "var(--label-secondary)", Glyph: null };
    }
    if (order.status === "expired") {
      return { label: t.manager.orders.statusExpired, color: "var(--ios-orange)", Glyph: null };
    }
    if (order.paymentStatus === "paid") {
      return { label: t.manager.orders.paidLabel, color: "var(--ios-green)", Glyph: Check };
    }
    if (order.paymentStatus === "flagged") {
      return { label: t.manager.orders.flaggedLabel, color: "var(--ios-red)", Glyph: AlertTriangle };
    }
    if (order.paymentStatus === "pending") {
      return { label: t.manager.orders.pendingLabel, color: "var(--ios-blue)", Glyph: null };
    }
    return { label: t.manager.orders.unpaidLabel, color: "var(--label-secondary)", Glyph: null };
  })();

  return (
    <span
      className="text-footnote inline-flex items-center gap-1 px-2.5 py-1 font-medium"
      style={{ borderRadius: "999px", backgroundColor: "var(--fill-quaternary)", color }}
    >
      {Glyph && <Glyph size={ICON_SIZE.sm} strokeWidth={2.5} aria-hidden="true" />}
      {label}
    </span>
  );
}

/**
 * How long the order is held for.
 *
 * Computed in an effect rather than during render on purpose: the server and
 * the browser read their clocks at different moments, so rendering a countdown
 * on both sides guarantees a hydration mismatch. Starting empty and filling in
 * after mount is the fix, and it costs one frame nobody sees.
 */
function ExpiryNote({ expiresAt }: { expiresAt: string }) {
  const { t } = useI18n();
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    function tick() {
      const remaining = Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000);
      setMinutes(remaining > 0 ? remaining : 0);
    }
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (minutes === null || minutes <= 0) return null;

  return (
    <p className="text-caption-1" style={{ color: "var(--label-tertiary)" }}>
      {t.checkout.expiresIn(minutes)}
    </p>
  );
}

function Callout({
  tone,
  icon: Glyph,
  title,
  children,
}: {
  tone: "green" | "red" | "orange" | "blue" | "gray";
  icon: typeof Check;
  title: string;
  children: React.ReactNode;
}) {
  const color = {
    green: "var(--ios-green)",
    red: "var(--ios-red)",
    orange: "var(--ios-orange)",
    blue: "var(--ios-blue)",
    gray: "var(--label-secondary)",
  }[tone];

  return (
    <section
      className="animate-rise-in flex gap-3 p-4"
      style={{
        backgroundColor: "var(--bg-grouped-secondary)",
        borderRadius: "var(--radius-card)",
        borderInlineStart: `3px solid ${color}`,
      }}
    >
      <Glyph
        size={ICON_SIZE.lg}
        strokeWidth={2.25}
        aria-hidden="true"
        className="mt-0.5 shrink-0"
        style={{ color }}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-headline">{title}</h2>
        <p className="text-subheadline" style={{ color: "var(--label-secondary)" }}>
          {children}
        </p>
      </div>
    </section>
  );
}
