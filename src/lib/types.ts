/* ==========================================================================
   Domain model

   The catalogue is three levels deep, which is a deliberate change from the
   flat list the static site used:

       category      "Keychains"
         subclass    "Clicker keychains" · "Small" · "Big"
           product   one physical thing, one photo, one base price

   The middle level exists because bundle deals are sold per subclass, not per
   product. "3 keychains for ₪25" at the counter means *any* three small
   keychains, not three of the same one — so the deal has to attach to
   something wider than a product and narrower than a category.
   See `pricing.ts` for how that is actually charged.
   ========================================================================== */

/** The three languages the shop is sold in. Hebrew is primary. */
export const LOCALES = ["he", "en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export const RTL_LOCALES: readonly Locale[] = ["he", "ar"];

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}

/**
 * A string in every language the shop speaks.
 *
 * Hebrew is required; English and Arabic fall back to it. That asymmetry is
 * real and worth encoding in the type: the owner writes Hebrew at the counter
 * and may never get round to the other two, and a product with no English
 * name must still be sellable rather than rendering as a blank row.
 */
export interface Localized {
  he: string;
  en?: string;
  ar?: string;
}

export function localize(value: Localized | null | undefined, locale: Locale): string {
  if (!value) return "";
  return (value[locale] || value.he || value.en || value.ar || "").trim();
}

/* ==========================================================================
   Money

   Stored and computed as **agorot** (integer hundredths of a shekel), never
   as a float. ₪25.50 is 2550. Floating-point money accumulates rounding error
   the moment a bundle price is divided across lines, and a till that is off by
   an agora is a till nobody trusts.
   ========================================================================== */

export type Agorot = number;

/* ==========================================================================
   Catalogue
   ========================================================================== */

export interface Category {
  id: string;
  slug: string;
  name: Localized;
  /** Key into CATEGORY_ICONS — a name, not a component, so it can be stored. */
  icon: string;
  /** Key into CATEGORY_TINTS. */
  tint: string;
  sortOrder: number;
  /** Hidden categories keep their products; they just leave the storefront. */
  visible: boolean;
}

export interface Subclass {
  id: string;
  categoryId: string;
  slug: string;
  name: Localized;
  sortOrder: number;
  visible: boolean;
}

export interface Product {
  id: string;
  categoryId: string;
  /** Null means the product sits directly under its category. */
  subclassId: string | null;
  slug: string;
  name: Localized;
  description: Localized;
  /** Price for one unit, before any bundle applies. */
  priceAgorot: Agorot;
  /**
   * Whether the product is offered at all. Distinct from stock: a keychain
   * design the owner has stopped printing is unavailable, whereas one that
   * merely sold out today has `stock: 0`.
   */
  available: boolean;
  /**
   * Units on the table. `null` means "not tracked" — the common case, since
   * most of the stand is restocked from a box rather than counted.
   */
  stock: number | null;
  images: ProductImage[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  /** Storage object path, or a `/products/...` path for the seeded photos. */
  path: string;
  sortOrder: number;
}

/* ==========================================================================
   Pricing rules
   ========================================================================== */

/**
 * What a bundle applies across.
 *
 * `product`  — N of this exact item.
 * `subclass` — N of any items in the subclass, mixed freely. The counter deal.
 * `category` — N of anything in the category. Rare, but the owner asked for
 *              the option and it costs nothing to support.
 */
export type PricingScope = "product" | "subclass" | "category";

export const PRICING_SCOPES: PricingScope[] = ["product", "subclass", "category"];

/**
 * One rung of a bundle ladder: "any `minQty` of these, together, for
 * `priceAgorot`".
 *
 * Rules do not have to nest or be consistent with each other — `pricing.ts`
 * finds the cheapest combination of whatever exists, so the owner can add
 * "3 for ₪25" today and "5 for ₪35" next week without checking the arithmetic.
 */
export interface PricingRule {
  id: string;
  scope: PricingScope;
  /** The category / subclass / product this ladder hangs off. */
  scopeId: string;
  minQty: number;
  priceAgorot: Agorot;
  /** Off-season deals can be parked without deleting them. */
  active: boolean;
  /** ISO timestamps. Null on either side means "no bound". */
  startsAt: string | null;
  endsAt: string | null;
  /** Optional shout line: "מבצע סוף עונה". Shown on the product card. */
  label: Localized | null;
  createdAt: string;
  updatedAt: string;
}

/* ==========================================================================
   Cart
   ========================================================================== */

/** What the customer has picked, before any pricing is worked out. */
export interface CartLine {
  productId: string;
  quantity: number;
}

/* ==========================================================================
   Access

   The manager is owner-only. Roles are deliberately coarse — this is a
   two-person operation, not a company.
   ========================================================================== */

export type OwnerRole = "owner" | "staff";

export interface Owner {
  authUserId: string;
  email: string;
  role: OwnerRole;
  displayName: string | null;
  createdAt: string;
}

/** `staff` may edit stock and availability; `owner` may do everything. */
export function canEditCatalogue(owner: Pick<Owner, "role"> | null): boolean {
  return owner?.role === "owner";
}

export function canEditStock(owner: Pick<Owner, "role"> | null): boolean {
  return owner?.role === "owner" || owner?.role === "staff";
}

/* ==========================================================================
   Shop settings — business rules the owner changes without a deploy.
   ========================================================================== */

export interface ShopSettings {
  /** Turns the whole storefront into a "closed" screen. */
  open: boolean;
  closedMessage: Localized;
  /** The Bit payment page the pay button opens. */
  bitPaymentLink: string;
  /** International format, digits only: "972549109603". */
  whatsappPhone: string;
  announcement: Localized | null;
}
