"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Tag } from "lucide-react";
import { NavBar } from "@/components/ios/NavBar";
import { ListGroup, ListRow } from "@/components/ios/List";
import { Button, Switch } from "@/components/ios/Controls";
import { EmptyState, useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { formatAgorot } from "@/lib/money";
import { useI18n } from "@/lib/i18n";
import {
  localize,
  type Category,
  type PricingRule,
  type PricingScope,
  type Product,
  type Subclass,
} from "@/lib/types";
import { errorMessage, patch } from "./api";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { DealEditor } from "./DealEditor";

/* ==========================================================================
   The deals screen

   A deal attaches to a SCOPE — one product, a subclass, or a whole category —
   and everything inside that scope counts toward it, mixed freely. Getting
   that idea across is most of this screen's job, so every row names the real
   thing it applies to rather than showing a uuid, and the mix-and-match rule
   is stated as a group footer where somebody reading a deal will actually see
   it.
   ========================================================================== */

interface Props {
  categories: Category[];
  subclasses: Subclass[];
  products: Product[];
  rules: PricingRule[];
  live: boolean;
}

export function DealsView({ categories, subclasses, products, rules, live }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const [editing, setEditing] = useState<PricingRule | "new" | null>(null);

  /** uuid → the name a human recognises, across all three scopes. */
  const nameOf = (scope: PricingScope, id: string): string => {
    const row =
      scope === "category"
        ? categories.find((c) => c.id === id)
        : scope === "subclass"
          ? subclasses.find((s) => s.id === id)
          : products.find((p) => p.id === id);
    return row ? localize(row.name, locale) : "—";
  };

  const scopeLabel = (scope: PricingScope) =>
    scope === "product"
      ? t.manager.deals.scopeProduct
      : scope === "subclass"
        ? t.manager.deals.scopeSubclass
        : t.manager.deals.scopeCategory;

  async function toggleActive(rule: PricingRule, active: boolean) {
    const result = await patch(`/api/manager/rules/${rule.id}`, { active });
    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    router.refresh();
  }

  /* Grouped by scope so the narrowest — which is also the one that wins — is
     read first. `groupKeyFor` in pricing.ts resolves in this same order. */
  const order: PricingScope[] = ["product", "subclass", "category"];
  const grouped = order
    .map((scope) => ({ scope, rules: rules.filter((rule) => rule.scope === scope) }))
    .filter((group) => group.rules.length > 0);

  return (
    <>
      <NavBar
        title={t.manager.deals.title}
        subtitle={t.manager.itemCount(rules.length)}
        trailing={
          <Button
            size="sm"
            variant="plain"
            disabled={!live}
            onClick={() => setEditing("new")}
            icon={<Plus size={ICON_SIZE.md} strokeWidth={2.5} aria-hidden="true" />}
          >
            {t.manager.deals.newDeal}
          </Button>
        }
      />

      {!live && <ReadOnlyBanner />}

      {rules.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={t.manager.deals.none}
          message={t.manager.deals.subtitle}
          action={
            <Button disabled={!live} onClick={() => setEditing("new")}>
              {t.manager.deals.newDeal}
            </Button>
          }
        />
      ) : (
        grouped.map((group) => (
          <ListGroup
            key={group.scope}
            header={scopeLabel(group.scope)}
            /* The mix-and-match explanation sits under the deals it explains,
               not as a wall of text above them. */
            footer={group.scope !== "product" ? t.manager.deals.subtitle : undefined}
          >
            {group.rules.map((rule) => {
              const perUnit = Math.round(rule.priceAgorot / rule.minQty);
              return (
                <ListRow
                  key={rule.id}
                  title={nameOf(rule.scope, rule.scopeId)}
                  subtitle={
                    <>
                      {/* Digits and a separator inside RTL text: without the
                          isolation the bidi algorithm renders "3 · ₪25" as
                          "₪25 · 3", which is a different claim. */}
                      <span className="ltr-nums tabular">
                        {rule.minQty} · {formatAgorot(rule.priceAgorot)}
                      </span>
                      {"  "}
                      {/* "₪8 ליחידה" — translated, so not forced LTR. */}
                      <span className="tabular">
                        ({t.manager.deals.perUnit(formatAgorot(perUnit))})
                      </span>
                    </>
                  }
                  onClick={() => setEditing(rule)}
                  trailing={
                    <Switch
                      checked={rule.active}
                      disabled={!live}
                      onChange={(next) => toggleActive(rule, next)}
                      label={`${t.manager.deals.active}: ${nameOf(rule.scope, rule.scopeId)}`}
                    />
                  }
                />
              );
            })}
          </ListGroup>
        ))
      )}

      {editing && (
        <DealEditor
          rule={editing === "new" ? null : editing}
          categories={categories}
          subclasses={subclasses}
          products={products}
          rules={rules}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
