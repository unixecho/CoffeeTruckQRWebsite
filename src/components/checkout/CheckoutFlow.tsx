"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChevronLeft, CreditCard, ShoppingBag, Store, Trash2 } from "lucide-react";

import { NavBar } from "@/components/ios/NavBar";
import { Button, Stepper, TextField } from "@/components/ios/Controls";
import { EmptyState, useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { LinkButton } from "@/components/ios/LinkButton";
import { useCart } from "@/components/shop/CartProvider";
import { useI18n } from "@/lib/i18n";
import { formatAgorot } from "@/lib/money";
import { imageUrl } from "@/lib/images";
import { localize } from "@/lib/types";
import type { PaymentMethod } from "@/lib/payments/types";
import { checkoutErrorMessage, placeOrder, type PlaceOrderBody } from "./api";
import { ProgressRail } from "./ProgressRail";

/* ==========================================================================
   The checkout

   Three steps — cart, details, payment — and every one of them fits on a
   phone screen with the primary action pinned where a thumb already is.

   ## Why three, and not one long form

   One scrolling page is fewer taps and worse. The person doing this is
   standing at a truck, one-handed, in daylight, with somebody behind them.
   A short screen with one decision on it is answered without reading; a long
   one is scrolled, lost, and abandoned. The steps are also all *skippable* in
   the sense that matters: every field on the details step is optional, so the
   fast path is three taps of Continue.

   ## The idempotency key, and the bug it prevents

   `clientRequestId` makes a retry the same order rather than a second one.
   The subtlety is that it must NOT be stable forever: if the customer goes
   back, changes the cart, and orders again, that is a different order and
   reusing the key would hand them back the first one with the old contents.
   So the key is minted per distinct request *body* — same body, same key,
   any number of retries; different body, new key. See `requestIdFor`.

   ## Nothing money-shaped leaves this component

   The total on screen comes from `priceCart` running locally over the same
   catalogue the server has. The request carries only picks. If the two ever
   disagree, the server's number is the one that counts and the order screen
   shows it — which is the correct outcome, not a bug to paper over.
   ========================================================================== */

type Step = 0 | 1 | 2;

export function CheckoutFlow({
  cardAvailable,
  checkoutEnabled,
}: {
  /** Both the provider being configured AND the owner having switched it on. */
  cardAvailable: boolean;
  checkoutEnabled: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const { lines, pricing, products, setQuantity, clear } = useCart();

  const [step, setStep] = useState<Step>(0);
  /* Which way the last move went, so the panel animates in from the edge it
     came from. `--dir` already flips that for Hebrew and Arabic. */
  const [forward, setForward] = useState(true);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("counter");

  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const request = useRef<{ signature: string; id: string } | null>(null);

  /**
   * A request id that is stable for one order and fresh for a different one.
   *
   * Automatic retries inside `placeOrder` re-send the same body, so they carry
   * the same key and the server folds them into one order. A deliberate
   * second attempt after editing the cart produces a different signature and
   * therefore a different order, which is what the customer meant.
   */
  const requestIdFor = useCallback((signature: string): string => {
    if (request.current?.signature === signature) return request.current.id;
    const id = crypto.randomUUID();
    request.current = { signature, id };
    return id;
  }, []);

  const empty = lines.length === 0;

  const totalUnits = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines]
  );

  function go(next: Step) {
    setForward(next > step);
    setFailure(null);
    setStep(next);
  }

  function validateDetails(): boolean {
    /* Only the phone is checked, and only when it was typed at all. A name
       cannot be wrong and a note cannot be wrong; refusing either would be
       inventing a rule to enforce. The server re-checks this — the browser's
       version exists so the person sees *which* field, not whether. */
    if (phone.trim() !== "" && !/^\d{8,15}$/.test(phone.replace(/[\s+()\-.]/g, ""))) {
      setPhoneError(t.checkout.phoneInvalid);
      return false;
    }
    setPhoneError(undefined);
    return true;
  }

  async function submit() {
    if (empty || busy) return;

    const body: PlaceOrderBody = {
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      paymentMethod: method,
      customerName: name.trim() === "" ? null : name.trim(),
      customerPhone: phone.trim() === "" ? null : phone.trim(),
      note: note.trim() === "" ? null : note.trim(),
      locale,
      company: honeypot,
      clientRequestId: "",
    };
    body.clientRequestId = requestIdFor(JSON.stringify(body));

    setBusy(true);
    setFailure(null);
    const result = await placeOrder(body);
    setBusy(false);

    if (!result.ok) {
      setFailure(checkoutErrorMessage(result.error, t));
      /* A stale line is the one failure the customer can fix here, so the
         cart is repaired for them rather than being described. */
      if (result.error.unavailable) {
        for (const productId of result.error.unavailable) setQuantity(productId, 0);
      }
      return;
    }

    /* The order exists server-side now, so the cart has done its job. Leaving
       it full is how somebody orders the same bag twice while waiting — and
       the order screen offers to put it back if they cancel. */
    clear();
    toast(t.checkout.orderTitle);
    router.replace(`/checkout/${encodeURIComponent(result.data.token)}`);
  }

  if (!checkoutEnabled) {
    return (
      <Shell title={t.checkout.title}>
        <EmptyState
          icon={Store}
          title={t.checkout.disabledTitle}
          message={t.checkout.disabledMessage}
          action={
            <LinkButton href="/shop" variant="tinted" size="md">
              {t.checkout.backToShop}
            </LinkButton>
          }
        />
      </Shell>
    );
  }

  if (empty) {
    return (
      <Shell title={t.checkout.title}>
        <EmptyState
          icon={ShoppingBag}
          title={t.checkout.emptyTitle}
          message={t.checkout.emptyMessage}
          action={
            <LinkButton href="/shop" variant="tinted" size="md">
              {t.checkout.backToShop}
            </LinkButton>
          }
        />
      </Shell>
    );
  }

  const stepLabels = [t.checkout.steps.review, t.checkout.steps.details, t.checkout.steps.payment];

  return (
    <Shell title={t.checkout.title}>
      <div className="mb-6">
        <ProgressRail
          labels={stepLabels}
          current={step}
          stepAria={t.checkout.stepAria}
          navLabel={t.checkout.title}
        />
      </div>

      {/* Keyed on the step so the panel remounts and replays its entrance.
          Push arrives from the leading edge and pop from the trailing one,
          both signed by `--dir`, so forward travel reads as forward in all
          three languages. */}
      <div key={step} className={forward ? "animate-push-in" : "animate-pop-in"}>
        {step === 0 && (
          <section aria-label={t.checkout.steps.review} className="flex flex-col gap-3">
            {/* Two lines per item, unlike the cart sheet's single row.
                Measured at 375px: a thumbnail, a stepper and a delete button
                leave about 66px for the name, which truncates every product in
                this catalogue to four characters. In the sheet that is a
                glance at a running total; here it is the screen where somebody
                confirms what they are buying, and a name they cannot read is
                the one thing this step exists to show them. */}
            <ul className="flex flex-col gap-3">
              {lines.map((line) => {
                const product = products.get(line.productId);
                if (!product) return null;
                const label = localize(product.name, locale);
                const photo = product.images[0];

                return (
                  <li
                    key={line.productId}
                    className="flex items-start gap-3 p-3"
                    style={{
                      backgroundColor: "var(--bg-grouped-secondary)",
                      borderRadius: "var(--radius-card)",
                    }}
                  >
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

                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="text-subheadline font-medium">{label}</span>
                      <span
                        className="text-footnote tabular"
                        style={{ color: "var(--label-secondary)" }}
                      >
                        <span className="ltr-nums">{formatAgorot(product.priceAgorot)}</span> ·{" "}
                        {t.shop.each}
                      </span>

                      <span className="mt-1 flex items-center gap-2">
                        <Stepper
                          value={line.quantity}
                          onChange={(next) => setQuantity(line.productId, next)}
                          min={0}
                          max={product.stock ?? 99}
                          decreaseLabel={t.cart.oneFewer}
                          increaseLabel={t.cart.oneMore}
                        />

                        <span
                          className="text-subheadline tabular ltr-nums flex-1 text-end"
                          style={{ color: "var(--label-secondary)" }}
                        >
                          {formatAgorot(product.priceAgorot * line.quantity)}
                        </span>

                        <button
                          type="button"
                          aria-label={t.cart.removeAria(label)}
                          onClick={() => setQuantity(line.productId, 0)}
                          className="press flex size-11 shrink-0 items-center justify-center rounded-full"
                          style={{ color: "var(--label-tertiary)" }}
                        >
                          <Trash2 size={ICON_SIZE.sm} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <Summary />
          </section>
        )}

        {step === 1 && (
          <section aria-label={t.checkout.steps.details} className="flex flex-col gap-4">
            <p className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
              {t.checkout.detailsIntro}
            </p>

            <TextField
              label={t.checkout.name}
              value={name}
              onChange={setName}
              placeholder={t.checkout.namePlaceholder}
              helper={t.checkout.optional}
            />

            <TextField
              label={t.checkout.phone}
              value={phone}
              onChange={(value) => {
                setPhone(value);
                if (phoneError) setPhoneError(undefined);
              }}
              placeholder={t.checkout.phonePlaceholder}
              inputMode="numeric"
              helper={t.checkout.phoneHelper}
              error={phoneError}
            />

            <TextField
              label={t.checkout.note}
              value={note}
              onChange={setNote}
              placeholder={t.checkout.notePlaceholder}
              helper={t.checkout.optional}
              multiline
            />

            <Honeypot label={t.checkout.honeypotLabel} value={honeypot} onChange={setHoneypot} />
          </section>
        )}

        {step === 2 && (
          <section aria-label={t.checkout.steps.payment} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-3">
              <legend
                className="text-footnote mb-2 px-1 tracking-wide uppercase"
                style={{ color: "var(--label-secondary)" }}
              >
                {t.checkout.method}
              </legend>

              <MethodOption
                value="counter"
                checked={method === "counter"}
                onSelect={setMethod}
                icon={Store}
                title={t.checkout.methodCounter}
                subtitle={t.checkout.methodCounterHelper}
              />

              <MethodOption
                value="card"
                checked={method === "card"}
                onSelect={setMethod}
                icon={CreditCard}
                title={t.checkout.methodCard}
                subtitle={
                  cardAvailable ? t.checkout.methodCardHelper : t.checkout.methodCardUnavailable
                }
                disabled={!cardAvailable}
              />
            </fieldset>

            <Summary />
          </section>
        )}
      </div>

      {failure && (
        <p
          role="alert"
          className="text-footnote mt-4 px-1"
          style={{ color: "var(--ios-red)" }}
        >
          {failure}
        </p>
      )}

      {/* The action bar. Pinned rather than in the flow: on a phone the
          primary action must be reachable without scrolling back down, and
          the total beside it is what people check before they commit. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 backdrop-blur-xl"
        style={{
          backgroundColor: "var(--material-bar)",
          borderTop: "0.5px solid var(--separator)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pt-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => go((step - 1) as Step)}
              className="press flex min-h-11 items-center gap-0.5 rounded-lg pe-3 ps-2"
              style={{ color: "var(--ios-blue)" }}
            >
              <ChevronLeft
                size={ICON_SIZE.md}
                strokeWidth={2.5}
                aria-hidden="true"
                style={{ transform: "scaleX(var(--dir, 1))" }}
              />
              <span className="text-body">{t.checkout.back}</span>
            </button>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-caption-1" style={{ color: "var(--label-secondary)" }}>
              {t.checkout.itemCount(totalUnits)}
            </span>
            <span className="text-headline tabular ltr-nums">
              {formatAgorot(pricing.totalAgorot)}
            </span>
          </div>

          {step < 2 ? (
            <Button
              size="lg"
              onClick={() => {
                if (step === 1 && !validateDetails()) return;
                go((step + 1) as Step);
              }}
            >
              {t.checkout.continue}
            </Button>
          ) : (
            <Button size="lg" onClick={submit} loading={busy}>
              {busy ? t.checkout.placing : t.checkout.placeOrder}
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

/* --------------------------------------------------------------------------
   Pieces
   -------------------------------------------------------------------------- */

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <NavBar title={title} backTo="/shop" backLabel={t.common.back} />
      {/* Room for the pinned action bar, which is fixed and therefore outside
          the flow. Without this the last row sits under it. */}
      <div className="mx-auto max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)]">
        {children}
      </div>
    </>
  );
}

function Summary() {
  const { t } = useI18n();
  const { pricing } = useCart();
  const applied = pricing.groups.flatMap((group) => group.bundles);

  return (
    <div
      className="flex flex-col gap-2 p-4"
      style={{
        backgroundColor: "var(--bg-grouped-secondary)",
        borderRadius: "var(--radius-card)",
      }}
    >
      {pricing.savingsAgorot > 0 && (
        <>
          <Row label={t.cart.subtotal} value={formatAgorot(pricing.baselineAgorot)} muted />
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
        <span className="text-title-2 tabular ltr-nums">{formatAgorot(pricing.totalAgorot)}</span>
      </div>
    </div>
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
  const color = accent
    ? "var(--ios-green)"
    : muted
      ? "var(--label-secondary)"
      : "var(--label-primary)";

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-subheadline" style={{ color }}>
        {label}
      </span>
      <span className="text-subheadline tabular ltr-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function MethodOption({
  value,
  checked,
  onSelect,
  icon: Glyph,
  title,
  subtitle,
  disabled,
}: {
  value: PaymentMethod;
  checked: boolean;
  onSelect: (next: PaymentMethod) => void;
  icon: typeof Store;
  title: string;
  subtitle: string;
  disabled?: boolean;
}) {
  /* A real radio input, visually hidden and driven by the label, rather than a
     div with `role="radio"`. Native grouping, native arrow-key behaviour, and
     the browser's own focus ring — all of which a hand-rolled version has to
     reimplement and usually reimplements incompletely. */
  return (
    <label
      className="press flex min-h-11 cursor-pointer items-center gap-3 p-4"
      style={{
        backgroundColor: "var(--bg-grouped-secondary)",
        borderRadius: "var(--radius-card)",
        border: `1.5px solid ${checked ? "var(--ios-blue)" : "transparent"}`,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="radio"
        name="payment-method"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="sr-only"
      />

      <Glyph
        size={ICON_SIZE.lg}
        strokeWidth={2}
        aria-hidden="true"
        className="shrink-0"
        style={{ color: checked ? "var(--ios-blue)" : "var(--label-secondary)" }}
      />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-medium">{title}</span>
        <span className="text-footnote" style={{ color: "var(--label-secondary)" }}>
          {subtitle}
        </span>
      </span>

      {/* The selection dot. Shape as well as colour, so the chosen option is
          not carried by hue alone. */}
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full"
        style={{
          border: `1.5px solid ${checked ? "var(--ios-blue)" : "var(--label-quaternary)"}`,
        }}
      >
        {checked && (
          <span
            className="size-3 rounded-full"
            style={{ backgroundColor: "var(--ios-blue)" }}
          />
        )}
      </span>
    </label>
  );
}

/**
 * The spam trap.
 *
 * Hidden from sight and from the keyboard, labelled for anything that reaches
 * it anyway, and — deliberately — **not the first or last focusable element**
 * on its step: it sits between two real fields. A focus trap that wraps onto a
 * honeypot lets a keyboard user type into the field whose whole purpose is to
 * make the server discard their order. PLAYBOOK §2.4.
 *
 * `aria-hidden` plus `tabIndex={-1}` keeps it out of both the reading order
 * and the tab order, and `autoComplete="off"` stops a browser filling it in
 * on the customer's behalf — which would silently discard a real order.
 */
function Honeypot({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
      <label htmlFor="checkout-company">{label}</label>
      <input
        id="checkout-company"
        name="company"
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
