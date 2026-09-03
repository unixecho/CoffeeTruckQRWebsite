import type { Agorot, CartLine, PricingRule, PricingScope, Product } from "./types";

/* ==========================================================================
   Bundle pricing

   The counter sells deals like "1 for ₪10, 3 for ₪25, 5 for ₪35", and those
   deals apply across a whole subclass — any three small keychains, not three
   of the same design. So pricing cannot be done line by line; items have to be
   grouped first, then charged as a group.

   ## Why this is not `Math.floor(qty / 3)`

   The obvious implementation applies the biggest bundle repeatedly and charges
   the remainder at full price. It overcharges. With "2 for ₪18" and
   "3 for ₪25" over a base of ₪10, five items are cheapest as 3+2 = ₪43, but
   biggest-first gives 3 + 1 + 1 = ₪45. The customer would be paying ₪2 for
   our arithmetic.

   So this solves it exactly, with a small dynamic program over the group. The
   groups are tiny (a handful of keychains) and the rule ladders shorter still,
   so exactness is free — there is no reason to approximate.

   ## Which items land in a bundle

   Within a group the items can have *different* base prices — a big keychain
   and a small one can share a subclass deal. Items are therefore sorted most
   expensive first, so bundles swallow the dear items and the cheap ones are
   what is left paying full price. That is the best outcome for the customer,
   and because a bundle price is flat regardless of what fills it, no other
   arrangement can beat it. (Exchange argument: swapping a cheaper item into a
   bundle in place of a dearer one can only raise the remainder.)

   ## The invariant everything else leans on

   `priceCart` never charges more than every-item-at-base-price, and never
   charges for a bundle it did not fully fill. Both are asserted in
   `pricing.test.ts`.
   ========================================================================== */

/** Where a product sits in the hierarchy — enough to resolve its rules. */
export interface PricedProduct {
  id: string;
  categoryId: string;
  subclassId: string | null;
  priceAgorot: Agorot;
}

/** One bundle actually applied, for the receipt and the "you saved" line. */
export interface AppliedBundle {
  ruleId: string;
  scope: PricingScope;
  scopeId: string;
  minQty: number;
  priceAgorot: Agorot;
  /** How many times this rung was used. */
  times: number;
}

export interface PricedGroup {
  scope: PricingScope;
  scopeId: string;
  /** Product ids in this group, with quantities. */
  lines: CartLine[];
  bundles: AppliedBundle[];
  /** Units left over, charged at their own base price. */
  remainderUnits: number;
  subtotalAgorot: Agorot;
  /** What the same items would have cost with no rules at all. */
  baselineAgorot: Agorot;
}

export interface CartPricing {
  groups: PricedGroup[];
  totalAgorot: Agorot;
  baselineAgorot: Agorot;
  /** `baseline - total`. Never negative — see the invariant above. */
  savingsAgorot: Agorot;
}

/* --------------------------------------------------------------------------
   Rule selection
   -------------------------------------------------------------------------- */

/**
 * Whether a rule is live right now.
 *
 * `now` is injected rather than read from the clock so the manager can preview
 * a scheduled deal, and so the tests are not time-dependent.
 */
export function isRuleLive(rule: PricingRule, now: Date = new Date()): boolean {
  if (!rule.active) return false;
  if (rule.minQty < 2) return false; // a "bundle" of one is just the base price
  const t = now.getTime();
  if (rule.startsAt && t < Date.parse(rule.startsAt)) return false;
  if (rule.endsAt && t > Date.parse(rule.endsAt)) return false;
  return true;
}

/**
 * The group a product's pricing belongs to.
 *
 * A product is grouped by the **narrowest scope that has a live rule** —
 * product rules beat subclass deals, which beat category-wide ones. Anything
 * with no rule at all is grouped alone at product scope and simply pays base
 * price, which keeps the rest of the code free of null branches.
 *
 * Narrowest-wins is a real decision, not a default: it means the owner can
 * exclude one expensive keychain from the subclass deal by giving it its own
 * ladder, without restructuring the subclass.
 */
function groupKeyFor(
  product: PricedProduct,
  rulesByScope: Map<string, PricingRule[]>
): { scope: PricingScope; scopeId: string } {
  if (rulesByScope.has(`product:${product.id}`)) {
    return { scope: "product", scopeId: product.id };
  }
  if (product.subclassId && rulesByScope.has(`subclass:${product.subclassId}`)) {
    return { scope: "subclass", scopeId: product.subclassId };
  }
  if (rulesByScope.has(`category:${product.categoryId}`)) {
    return { scope: "category", scopeId: product.categoryId };
  }
  return { scope: "product", scopeId: product.id };
}

/* --------------------------------------------------------------------------
   The solver
   -------------------------------------------------------------------------- */

/**
 * Cheapest way to cover `unitPrices` (sorted descending) given `rules`.
 *
 * `best[i]` is the cheapest cover of items `i..n-1`. Working from the end
 * backwards, each position either pays its own way or starts a bundle that
 * swallows the next `minQty` items. A bundle is only considered when there are
 * enough items left to fill it — charging for a partly filled bundle would be
 * selling someone a deal they did not get.
 */
function solve(
  unitPrices: Agorot[],
  rules: PricingRule[]
): { total: Agorot; bundles: AppliedBundle[]; remainderUnits: number } {
  const n = unitPrices.length;
  const best: Agorot[] = new Array<Agorot>(n + 1).fill(0);
  /** Which rule (if any) `best[i]` chose, so the split can be reconstructed. */
  const choice: (PricingRule | null)[] = new Array<PricingRule | null>(n + 1).fill(null);

  for (let i = n - 1; i >= 0; i--) {
    // Pay for this one item at its own price and carry on.
    let cheapest = unitPrices[i]! + best[i + 1]!;
    let chosen: PricingRule | null = null;

    for (const rule of rules) {
      const end = i + rule.minQty;
      if (end > n) continue; // not enough items left to fill this rung
      const candidate = rule.priceAgorot + best[end]!;
      if (candidate < cheapest) {
        cheapest = candidate;
        chosen = rule;
      }
    }

    best[i] = cheapest;
    choice[i] = chosen;
  }

  // Walk the choices forward to report which bundles were actually used.
  const used = new Map<string, AppliedBundle>();
  let remainderUnits = 0;
  let i = 0;
  while (i < n) {
    const rule = choice[i];
    if (!rule) {
      remainderUnits += 1;
      i += 1;
      continue;
    }
    const existing = used.get(rule.id);
    if (existing) {
      existing.times += 1;
    } else {
      used.set(rule.id, {
        ruleId: rule.id,
        scope: rule.scope,
        scopeId: rule.scopeId,
        minQty: rule.minQty,
        priceAgorot: rule.priceAgorot,
        times: 1,
      });
    }
    i += rule.minQty;
  }

  return {
    total: best[0]!,
    bundles: [...used.values()].sort((a, b) => b.minQty - a.minQty),
    remainderUnits,
  };
}

/* --------------------------------------------------------------------------
   Entry point
   -------------------------------------------------------------------------- */

/**
 * Price a whole cart.
 *
 * This is the single source of truth for what anything costs. The storefront
 * calls it to show a running total, the manager calls it to preview a deal,
 * and the checkout route calls it again **server-side** against freshly read
 * products and rules — a total arriving from a browser is a claim, not an
 * input. (Ported from the 3D Prints rule: money is computed server-side.)
 */
export function priceCart(
  lines: CartLine[],
  products: Map<string, PricedProduct>,
  rules: PricingRule[],
  now: Date = new Date()
): CartPricing {
  const live = rules.filter((rule) => isRuleLive(rule, now));

  const rulesByScope = new Map<string, PricingRule[]>();
  for (const rule of live) {
    const key = `${rule.scope}:${rule.scopeId}`;
    const bucket = rulesByScope.get(key);
    if (bucket) bucket.push(rule);
    else rulesByScope.set(key, [rule]);
  }

  /* Bucket every unit into its pricing group. Units are expanded individually
     because a bundle can span several different products. */
  interface Bucket {
    scope: PricingScope;
    scopeId: string;
    lines: Map<string, number>;
    unitPrices: Agorot[];
  }
  const buckets = new Map<string, Bucket>();

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const product = products.get(line.productId);
    if (!product) continue; // a stale cart entry prices as nothing, not as a crash

    const { scope, scopeId } = groupKeyFor(product, rulesByScope);
    const key = `${scope}:${scopeId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { scope, scopeId, lines: new Map(), unitPrices: [] };
      buckets.set(key, bucket);
    }
    bucket.lines.set(line.productId, (bucket.lines.get(line.productId) ?? 0) + line.quantity);
    for (let i = 0; i < line.quantity; i++) bucket.unitPrices.push(product.priceAgorot);
  }

  const groups: PricedGroup[] = [];
  let totalAgorot = 0;
  let baselineAgorot = 0;

  for (const bucket of buckets.values()) {
    // Dearest first, so bundles absorb the expensive units. See the header.
    const unitPrices = [...bucket.unitPrices].sort((a, b) => b - a);
    const baseline = unitPrices.reduce((sum, price) => sum + price, 0);
    const groupRules = rulesByScope.get(`${bucket.scope}:${bucket.scopeId}`) ?? [];
    const solved = solve(unitPrices, groupRules);

    groups.push({
      scope: bucket.scope,
      scopeId: bucket.scopeId,
      lines: [...bucket.lines].map(([productId, quantity]) => ({ productId, quantity })),
      bundles: solved.bundles,
      remainderUnits: solved.remainderUnits,
      subtotalAgorot: solved.total,
      baselineAgorot: baseline,
    });

    totalAgorot += solved.total;
    baselineAgorot += baseline;
  }

  return {
    groups,
    totalAgorot,
    baselineAgorot,
    savingsAgorot: baselineAgorot - totalAgorot,
  };
}

/* --------------------------------------------------------------------------
   Display helpers
   -------------------------------------------------------------------------- */

/**
 * The ladder shown on a product card: "1 · ₪10 / 3 · ₪25 / 5 · ₪35".
 *
 * Deduplicated by quantity, keeping the cheapest rung, because the owner can
 * legitimately end up with two rules for the same count after editing a deal
 * and showing both would read as a mistake.
 */
export function ladderFor(
  product: PricedProduct,
  rules: PricingRule[],
  now: Date = new Date()
): { qty: number; priceAgorot: Agorot }[] {
  const live = rules.filter((rule) => isRuleLive(rule, now));
  const scoped = live.filter(
    (rule) =>
      (rule.scope === "product" && rule.scopeId === product.id) ||
      (rule.scope === "subclass" && rule.scopeId === product.subclassId) ||
      (rule.scope === "category" && rule.scopeId === product.categoryId)
  );

  // Narrowest scope wins, matching `groupKeyFor`.
  const narrowest = scoped.some((r) => r.scope === "product")
    ? "product"
    : scoped.some((r) => r.scope === "subclass")
      ? "subclass"
      : "category";
  const applicable = scoped.filter((rule) => rule.scope === narrowest);

  const byQty = new Map<number, Agorot>();
  byQty.set(1, product.priceAgorot);
  for (const rule of applicable) {
    const current = byQty.get(rule.minQty);
    if (current === undefined || rule.priceAgorot < current) {
      byQty.set(rule.minQty, rule.priceAgorot);
    }
  }

  return [...byQty]
    .sort(([a], [b]) => a - b)
    .map(([qty, priceAgorot]) => ({ qty, priceAgorot }));
}

/**
 * The ladder for a *group* — a subclass or a category — rather than an item.
 *
 * Distinct from `ladderFor` on purpose, and the distinction is not cosmetic.
 * `ladderFor` answers "what can this one product be had for", which correctly
 * includes a rule scoped to that product alone. A heading above a grid of
 * products is answering a different question: "what deal do all of these
 * share". Using `ladderFor` on a sample product to answer it advertises one
 * item's private deal as though it covered the whole group — a wrong claim to
 * a customer, and exactly the sort that is only noticed at the till.
 *
 * So this considers only rules at the given scope, and returns nothing when
 * there are none. `basePriceAgorot` is used solely to seed the "1 for X" rung
 * and should be the cheapest item in the group.
 */
export function groupLadder(
  scope: Exclude<PricingScope, "product">,
  scopeId: string,
  basePriceAgorot: Agorot,
  rules: PricingRule[],
  now: Date = new Date()
): { qty: number; priceAgorot: Agorot }[] {
  const applicable = rules.filter(
    (rule) => rule.scope === scope && rule.scopeId === scopeId && isRuleLive(rule, now)
  );
  if (applicable.length === 0) return [];

  const byQty = new Map<number, Agorot>();
  byQty.set(1, basePriceAgorot);
  for (const rule of applicable) {
    const current = byQty.get(rule.minQty);
    if (current === undefined || rule.priceAgorot < current) {
      byQty.set(rule.minQty, rule.priceAgorot);
    }
  }

  return [...byQty]
    .sort(([a], [b]) => a - b)
    .map(([qty, priceAgorot]) => ({ qty, priceAgorot }));
}

/** Narrows a full Product to what the solver needs. */
export function toPriced(product: Product): PricedProduct {
  return {
    id: product.id,
    categoryId: product.categoryId,
    subclassId: product.subclassId,
    priceAgorot: product.priceAgorot,
  };
}
