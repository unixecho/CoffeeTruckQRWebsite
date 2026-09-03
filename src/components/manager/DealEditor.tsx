"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Sheet } from "@/components/ios/Sheet";
import { Button, Disclosure, SegmentedControl, Switch, TextField } from "@/components/ios/Controls";
import { useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { agorotToInput, formatAgorot, parseShekels } from "@/lib/money";
import { ladderFor, priceCart, type PricedProduct } from "@/lib/pricing";
import {
  localize,
  type Category,
  type PricingRule,
  type PricingScope,
  type Product,
  type Subclass,
} from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { del, errorMessage, patch, post } from "./api";
import { Picker } from "./Picker";

/* ==========================================================================
   Setting up a deal

   The important part of this screen is not the form, it is the preview under
   it. A bundle ladder is easy to get subtly wrong — a rung that is dearer per
   unit than the one below it, a "5 for ₪40" that nobody will ever take because
   3+2 is cheaper — and none of that is visible from the numbers alone.

   So as the owner types, the draft rule is fed through the real pricing engine
   and the resulting totals for one to six items are shown. That is the same
   code that will charge the customer, not an approximation of it, which is
   what makes the preview worth trusting.
   ========================================================================== */

interface Props {
  rule: PricingRule | null;
  categories: Category[];
  subclasses: Subclass[];
  products: Product[];
  rules: PricingRule[];
  onClose: () => void;
}

const PREVIEW_UPTO = 6;

export function DealEditor({ rule, categories, subclasses, products, rules, onClose }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [scope, setScope] = useState<PricingScope>(rule?.scope ?? "subclass");
  const [scopeId, setScopeId] = useState<string>(rule?.scopeId ?? "");
  const [minQty, setMinQty] = useState(rule ? String(rule.minQty) : "3");
  const [price, setPrice] = useState(rule ? agorotToInput(rule.priceAgorot) : "");
  const [active, setActive] = useState(rule?.active ?? true);
  const [labelHe, setLabelHe] = useState(rule?.label?.he ?? "");
  const [startsAt, setStartsAt] = useState(rule?.startsAt?.slice(0, 10) ?? "");
  const [endsAt, setEndsAt] = useState(rule?.endsAt?.slice(0, 10) ?? "");
  const [errors, setErrors] = useState<{ minQty?: string; price?: string; scopeId?: string }>({});
  const [saving, setSaving] = useState(false);

  /* The scope target list changes with the scope. Everything below derives
     from these during render — nothing is synchronised in an effect. */
  const targets =
    scope === "category"
      ? categories.map((c) => ({ value: c.id, label: localize(c.name, locale) }))
      : scope === "subclass"
        ? subclasses.map((s) => ({
            value: s.id,
            label: `${localize(s.name, locale)} · ${
              localize(categories.find((c) => c.id === s.categoryId)?.name ?? { he: "" }, locale)
            }`,
          }))
        : products.map((p) => ({ value: p.id, label: localize(p.name, locale) }));

  const effectiveScopeId = targets.some((option) => option.value === scopeId)
    ? scopeId
    : (targets[0]?.value ?? "");

  const qty = Number.parseInt(minQty, 10);
  const priceAgorot = parseShekels(price);

  /* --------------------------------------------------------------------
     The preview
     -------------------------------------------------------------------- */

  /** A representative product inside the chosen scope, to price against. */
  const sample: Product | undefined =
    scope === "product"
      ? products.find((p) => p.id === effectiveScopeId)
      : scope === "subclass"
        ? products.find((p) => p.subclassId === effectiveScopeId)
        : products.find((p) => p.categoryId === effectiveScopeId);

  /** Every live rule, with the draft substituted in for the one being edited. */
  const draftRules: PricingRule[] = (() => {
    if (!Number.isFinite(qty) || qty < 2 || priceAgorot === null || !effectiveScopeId) {
      return rules.filter((r) => r.id !== rule?.id);
    }
    const draft: PricingRule = {
      id: rule?.id ?? "__draft__",
      scope,
      scopeId: effectiveScopeId,
      minQty: qty,
      priceAgorot,
      active,
      startsAt: null,
      endsAt: null,
      label: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
    return [...rules.filter((r) => r.id !== rule?.id), draft];
  })();

  const priced: PricedProduct | null = sample
    ? {
        id: sample.id,
        categoryId: sample.categoryId,
        subclassId: sample.subclassId,
        priceAgorot: sample.priceAgorot,
      }
    : null;

  const ladder = priced ? ladderFor(priced, draftRules) : [];

  const totals = priced
    ? Array.from({ length: PREVIEW_UPTO }, (_, index) => {
        const count = index + 1;
        const result = priceCart(
          [{ productId: priced.id, quantity: count }],
          new Map([[priced.id, priced]]),
          draftRules
        );
        return { count, totalAgorot: result.totalAgorot };
      })
    : [];

  /* A rung dearer than paying singly is almost always a slipped decimal — but
     "almost always" is not "always", so this warns rather than blocks. */
  const dearer =
    priced && priceAgorot !== null && Number.isFinite(qty) && qty >= 2
      ? priceAgorot > priced.priceAgorot * qty
      : false;

  /* --------------------------------------------------------------------
     Saving
     -------------------------------------------------------------------- */

  async function save() {
    const next: typeof errors = {};

    if (!Number.isFinite(qty) || qty < 2) next.minQty = t.manager.validation.qtyInvalid;
    if (priceAgorot === null) next.price = t.manager.validation.priceInvalid;
    if (!effectiveScopeId) next.scopeId = t.manager.validation.categoryRequired;

    // A second live rung for the same count on the same thing would be shown
    // twice and charged at the cheaper one. The database rejects it too.
    const clash = rules.some(
      (r) =>
        r.id !== rule?.id &&
        r.scope === scope &&
        r.scopeId === effectiveScopeId &&
        r.minQty === qty
    );
    if (clash) next.minQty = t.manager.validation.duplicateQty;

    setErrors(next);
    if (Object.keys(next).length > 0 || priceAgorot === null) return;

    setSaving(true);

    const body = {
      scope,
      scopeId: effectiveScopeId,
      minQty: qty,
      priceAgorot,
      active,
      startsAt: startsAt ? new Date(`${startsAt}T00:00:00Z`).toISOString() : null,
      endsAt: endsAt ? new Date(`${endsAt}T23:59:59Z`).toISOString() : null,
      label: labelHe.trim() === "" ? null : { he: labelHe.trim() },
    };

    const result = rule
      ? await patch(`/api/manager/rules/${rule.id}`, body)
      : await post("/api/manager/rules", body);

    setSaving(false);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }

    toast(t.manager.saved);
    router.refresh();
    onClose();
  }

  async function remove() {
    if (!rule) return;
    setSaving(true);
    const result = await del(`/api/manager/rules/${rule.id}`);
    setSaving(false);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    toast(t.manager.saved);
    router.refresh();
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      dismissLabel={t.common.dismiss}
      title={rule ? t.manager.deals.editDeal : t.manager.deals.newDeal}
      footer={
        <div className="flex gap-2">
          <div className="flex-[2]">
            <Button size="lg" fullWidth onClick={save} loading={saving}>
              {saving ? t.common.saving : t.common.save}
            </Button>
          </div>
          <div className="flex-1">
            <Button size="lg" fullWidth variant="gray" onClick={onClose}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
            {t.manager.deals.scope}
          </span>
          <SegmentedControl<PricingScope>
            label={t.manager.deals.scope}
            value={scope}
            onChange={(next) => {
              setScope(next);
              setScopeId("");
            }}
            options={[
              { value: "product", label: t.manager.deals.scopeProduct },
              { value: "subclass", label: t.manager.deals.scopeSubclass },
              { value: "category", label: t.manager.deals.scopeCategory },
            ]}
          />
          <p className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
            {t.manager.deals.scopeHint}
          </p>
        </div>

        <Picker
          label={t.manager.deals.appliesTo}
          value={effectiveScopeId}
          options={targets}
          onChange={setScopeId}
          error={errors.scopeId}
        />

        <TextField
          label={t.manager.deals.minQty}
          value={minQty}
          onChange={(value) => setMinQty(value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          error={errors.minQty}
        />

        <TextField
          label={t.manager.deals.bundlePrice}
          value={price}
          onChange={setPrice}
          prefix="₪"
          inputMode="decimal"
          error={errors.price}
        />

        {dearer && (
          <p
            role="alert"
            className="text-footnote flex items-start gap-2 px-1"
            style={{ color: "var(--ios-orange)" }}
          >
            <AlertTriangle
              size={ICON_SIZE.sm}
              strokeWidth={2.25}
              aria-hidden="true"
              className="mt-0.5 shrink-0"
            />
            {t.manager.validation.bundleDearer}
          </p>
        )}

        <div className="flex min-h-11 items-center justify-between gap-4">
          <span className="text-body">{t.manager.deals.active}</span>
          <Switch checked={active} onChange={setActive} label={t.manager.deals.active} />
        </div>

        {/* ---------------- the preview ---------------- */}
        {priced && (
          <div
            className="animate-rise-in flex flex-col gap-3 p-4"
            style={{
              backgroundColor: "var(--bg-grouped-secondary)",
              borderRadius: "var(--radius-card)",
            }}
          >
            <p className="text-footnote font-semibold" style={{ color: "var(--label-secondary)" }}>
              {t.manager.deals.ladderPreview}
            </p>

            <p className="ltr-nums tabular text-headline">
              {ladder.map((rung) => `${rung.qty} · ${formatAgorot(rung.priceAgorot)}`).join("   /   ")}
            </p>

            {/* Re-keyed on the draft so the numbers re-animate when they
                change — the movement is what draws the eye to a total that
                just went the wrong way. */}
            <ul
              key={`${qty}-${priceAgorot}-${effectiveScopeId}`}
              className="stagger-rise flex flex-col gap-1"
            >
              {totals.map((row, index) => (
                <li
                  key={row.count}
                  className="text-subheadline flex items-center justify-between"
                  style={{ ["--i" as string]: index }}
                >
                  <span style={{ color: "var(--label-secondary)" }} className="ltr-nums tabular">
                    ×{row.count}
                  </span>
                  <span className="ltr-nums tabular font-medium">
                    {formatAgorot(row.totalAgorot)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Disclosure label={`${t.manager.deals.labelHe} · ${t.manager.deals.startsAt}`}>
          <TextField
            label={t.manager.deals.labelHe}
            value={labelHe}
            onChange={setLabelHe}
          />
          <TextField
            label={t.manager.deals.startsAt}
            value={startsAt}
            onChange={setStartsAt}
            placeholder="2026-09-01"
          />
          <TextField
            label={t.manager.deals.endsAt}
            value={endsAt}
            onChange={setEndsAt}
            placeholder="2026-09-30"
          />
        </Disclosure>

        {rule && (
          <Button variant="destructive" fullWidth onClick={remove} loading={saving}>
            {t.common.delete}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
