"use client";

import { useState } from "react";
import { PackageOpen, SearchX } from "lucide-react";
import { NavBar } from "@/components/ios/NavBar";
import { SearchField } from "@/components/ios/SearchField";
import { EmptyState } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { resolveIcon, resolveTint } from "@/lib/categoryIcons";
import { formatAgorot } from "@/lib/money";
import { groupLadder } from "@/lib/pricing";
import {
  localize,
  type Category,
  type PricingRule,
  type Product,
  type Subclass,
} from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { ProductCard } from "./ProductCard";
import { ProductSheet } from "./ProductSheet";

/* ==========================================================================
   Browsing the shop

   Products are grouped by subclass under a heading that states the deal —
   "Small keychains · any 3 for ₪25". That heading is the whole reason the
   subclass level exists, so it has to be visible while browsing rather than
   discovered at the till.

   The deal text comes from `groupLadder`, which considers only rules at the
   group's own scope. Deriving it from a sample product instead would surface
   that one product's private deal as the whole group's — a claim the pricing
   engine will not honour at the till.
   ========================================================================== */

interface Props {
  categories: Category[];
  subclasses: Subclass[];
  products: Product[];
  rules: PricingRule[];
}

const ALL = "__all__";

export function StoreView({ categories, subclasses, products, rules }: Props) {
  const { t, locale } = useI18n();

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>(ALL);
  const [detail, setDetail] = useState<Product | null>(null);

  const needle = query.trim().toLowerCase();

  /* Everything below is derived during render. There is no filtered list in
     state to fall out of sync with the query. */
  const matching = products.filter((product) => {
    if (activeCategory !== ALL && product.categoryId !== activeCategory) return false;
    if (needle === "") return true;
    const haystack = [
      localize(product.name, locale),
      localize(product.description, locale),
      product.name.he,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });

  /** Category → its subclass groups, plus anything sitting loose in it. */
  const sections = categories
    .map((category) => {
      const inCategory = matching.filter((product) => product.categoryId === category.id);
      if (inCategory.length === 0) return null;

      const groups: {
        key: string;
        title: string;
        items: Product[];
        scope: "subclass" | "category";
        scopeId: string;
      }[] = subclasses
        .filter((subclass) => subclass.categoryId === category.id)
        .map((subclass) => ({
          key: subclass.id,
          title: localize(subclass.name, locale),
          items: inCategory.filter((product) => product.subclassId === subclass.id),
          scope: "subclass" as const,
          scopeId: subclass.id,
        }))
        .filter((group) => group.items.length > 0);

      /* Products sitting directly in the category. Their group deal, if any,
         is the category-wide one — never a neighbour's product-scope rule. */
      const loose = inCategory.filter((product) => product.subclassId === null);
      if (loose.length > 0) {
        groups.push({
          key: `${category.id}-loose`,
          title: "",
          items: loose,
          scope: "category",
          scopeId: category.id,
        });
      }

      return { category, groups };
    })
    .filter((section) => section !== null);

  /**
   * "any 3 for ₪25" for a whole group, or nothing.
   *
   * Only rules at the group's own scope count. A rule scoped to one product
   * inside the group is that product's deal, not the group's, and showing it
   * up here would promise a customer something the pricing engine will not
   * honour — see `groupLadder` in lib/pricing.ts.
   */
  function dealFor(group: {
    items: Product[];
    scope: "subclass" | "category";
    scopeId: string;
  }): string | null {
    const cheapest = Math.min(...group.items.map((product) => product.priceAgorot));
    const ladder = groupLadder(group.scope, group.scopeId, cheapest, rules);

    const best = ladder.at(-1);
    if (!best || best.qty < 2) return null;
    return t.shop.bundleHint(best.qty, formatAgorot(best.priceAgorot));
  }

  return (
    <>
      <NavBar title={t.shop.title} subtitle={t.shop.subtitle} backTo="/" backLabel={t.common.back} />

      <div className="mx-auto max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)]">
        <div className="mb-4">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t.shop.searchPlaceholder}
            label={t.common.search}
          />
        </div>

        {/* Category chips. Horizontally scrollable rather than wrapped, so the
            row height never changes as categories are added. */}
        <div
          role="tablist"
          aria-label={t.manager.categories}
          className="scroll-region -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          <Chip
            label={t.common.all}
            active={activeCategory === ALL}
            onClick={() => setActiveCategory(ALL)}
          />
          {categories.map((category) => {
            const Glyph = resolveIcon(category.icon);
            return (
              <Chip
                key={category.id}
                label={localize(category.name, locale)}
                active={activeCategory === category.id}
                tint={resolveTint(category.tint)}
                icon={<Glyph size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />}
                onClick={() => setActiveCategory(category.id)}
              />
            );
          })}
        </div>

        {products.length === 0 ? (
          <EmptyState icon={PackageOpen} title={t.shop.emptyTitle} message={t.shop.emptyMessage} />
        ) : matching.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={t.shop.noMatchesTitle}
            message={
              needle === "" ? t.shop.emptyMessage : t.shop.noMatchesMessage(query.trim())
            }
          />
        ) : (
          sections.map((section) => (
            <section key={section.category.id} className="mb-8">
              <h2 className="text-title-3 mb-3">{localize(section.category.name, locale)}</h2>

              {section.groups.map((group) => {
                const deal = dealFor(group);
                return (
                  <div key={group.key} className="mb-6">
                    {(group.title || deal) && (
                      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        {group.title && (
                          <h3 className="text-subheadline font-semibold">{group.title}</h3>
                        )}
                        {/* No `.ltr-nums` here. The deal reads "5 ב־₪35" — a
                            translated word between two numbers — and forcing
                            LTR drags the Hebrew along with the digits, so it
                            comes out reading backwards. Left alone, the bidi
                            algorithm renders "₪35" as its own LTR run inside
                            the RTL line, which is what is wanted. `.ltr-nums`
                            is only ever for strings with no letters in them. */}
                        {deal && (
                          <span
                            className="text-footnote tabular font-medium"
                            style={{ color: "var(--ios-orange)" }}
                          >
                            {deal}
                          </span>
                        )}
                        {deal && group.items.length > 1 && (
                          <span
                            className="text-footnote"
                            style={{ color: "var(--label-secondary)" }}
                          >
                            · {t.shop.mixAndMatch}
                          </span>
                        )}
                      </div>
                    )}

                    <ul className="stagger-rise grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {group.items.map((product, index) => (
                        <li key={product.id} style={{ ["--i" as string]: index }}>
                          <ProductCard
                            product={product}
                            rules={rules}
                            onOpen={() => setDetail(product)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>

      {detail && (
        <ProductSheet product={detail} rules={rules} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

function Chip({
  label,
  active,
  onClick,
  icon,
  tint,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  tint?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => {
        haptic("selection");
        onClick();
      }}
      className="press text-subheadline flex min-h-11 shrink-0 items-center gap-1.5 px-3.5 font-medium"
      style={{
        borderRadius: "var(--radius-control)",
        backgroundColor: active ? "var(--ios-blue)" : "var(--fill-tertiary)",
        color: active ? "#fff" : "var(--label-primary)",
      }}
    >
      {icon && <span style={{ color: active ? "#fff" : tint }}>{icon}</span>}
      {label}
    </button>
  );
}
