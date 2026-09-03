import "server-only";

import { createClient, isSupabaseConfigured } from "./supabase/server";
import SEED from "@/data/seed.json";
import type {
  Category,
  Localized,
  PricingRule,
  PricingScope,
  Product,
  ShopSettings,
  Subclass,
} from "./types";

/* ==========================================================================
   Reading the catalogue

   One module, two sources:

   - **Supabase**, once the project is wired up. Reads run as the visitor
     under RLS, so the storefront sees exactly the visible rows and nothing
     more — the filtering is in the database, not in a `.filter()` here that
     somebody could forget to write on a new query.

   - **`src/data/seed.json`**, when it is not. This is not a mock: it is the
     real catalogue exported from the old static site, and it means the
     storefront still renders — read-only — if the database is unreachable or
     has not been set up yet. The manager detects the same condition and shows
     a "read-only" banner instead of pretending a save worked.

   The fallback exists because the shop is opened at a market stand on a phone
   tether. "The site is down because Supabase is down" is a worse failure than
   "the site is showing this morning's prices".
   ========================================================================== */

export interface Catalogue {
  categories: Category[];
  subclasses: Subclass[];
  products: Product[];
  rules: PricingRule[];
  settings: ShopSettings;
  /** False when serving from `seed.json`. The manager gates editing on this. */
  live: boolean;
}

/* --------------------------------------------------------------------------
   Row shapes, as they come back from PostgREST
   -------------------------------------------------------------------------- */

interface CategoryRow {
  id: string;
  slug: string;
  name_he: string;
  name_en: string | null;
  name_ar: string | null;
  icon: string;
  tint: string;
  sort_order: number;
  visible: boolean;
}

interface SubclassRow {
  id: string;
  category_id: string;
  slug: string;
  name_he: string;
  name_en: string | null;
  name_ar: string | null;
  sort_order: number;
  visible: boolean;
}

interface ProductRow {
  id: string;
  category_id: string;
  subclass_id: string | null;
  slug: string;
  name_he: string;
  name_en: string | null;
  name_ar: string | null;
  description_he: string | null;
  description_en: string | null;
  description_ar: string | null;
  price_agorot: number;
  available: boolean;
  stock: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  product_images: { id: string; path: string; sort_order: number }[] | null;
}

interface RuleRow {
  id: string;
  scope: string;
  scope_id: string;
  min_qty: number;
  price_agorot: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  label_he: string | null;
  label_en: string | null;
  label_ar: string | null;
  created_at: string;
  updated_at: string;
}

/** Collapses the three `name_*` columns into one `Localized`. */
function localized(he: string, en: string | null, ar: string | null): Localized {
  return {
    he,
    ...(en ? { en } : {}),
    ...(ar ? { ar } : {}),
  };
}

function optionalLocalized(
  he: string | null,
  en: string | null,
  ar: string | null
): Localized {
  return localized(he ?? "", en, ar);
}

/* --------------------------------------------------------------------------
   Mappers — the single place a database row becomes a domain object
   -------------------------------------------------------------------------- */

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: localized(row.name_he, row.name_en, row.name_ar),
    icon: row.icon,
    tint: row.tint,
    sortOrder: row.sort_order,
    visible: row.visible,
  };
}

export function toSubclass(row: SubclassRow): Subclass {
  return {
    id: row.id,
    categoryId: row.category_id,
    slug: row.slug,
    name: localized(row.name_he, row.name_en, row.name_ar),
    sortOrder: row.sort_order,
    visible: row.visible,
  };
}

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    categoryId: row.category_id,
    subclassId: row.subclass_id,
    slug: row.slug,
    name: localized(row.name_he, row.name_en, row.name_ar),
    description: optionalLocalized(row.description_he, row.description_en, row.description_ar),
    priceAgorot: row.price_agorot,
    available: row.available,
    stock: row.stock,
    images: (row.product_images ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((image) => ({ id: image.id, path: image.path, sortOrder: image.sort_order })),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toRule(row: RuleRow): PricingRule {
  const label = row.label_he
    ? localized(row.label_he, row.label_en, row.label_ar)
    : null;

  return {
    id: row.id,
    scope: row.scope as PricingScope,
    scopeId: row.scope_id,
    minQty: row.min_qty,
    priceAgorot: row.price_agorot,
    active: row.active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* --------------------------------------------------------------------------
   Settings
   -------------------------------------------------------------------------- */

const DEFAULT_SETTINGS: ShopSettings = {
  open: true,
  closedMessage: {
    he: "סגור כרגע — נתראה בקרוב!",
    en: "Closed right now — see you soon!",
    ar: "مغلق حالياً — نراكم قريباً!",
  },
  bitPaymentLink: "",
  whatsappPhone: "972549109603",
  announcement: null,
};

function toSettings(rows: { key: string; value: unknown }[]): ShopSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const read = <T,>(key: string, fallback: T): T => {
    const value = byKey.get(key);
    return value === undefined || value === null ? fallback : (value as T);
  };

  return {
    open: read("shop_open", DEFAULT_SETTINGS.open),
    closedMessage: read("closed_message", DEFAULT_SETTINGS.closedMessage),
    bitPaymentLink: read("bit_payment_link", DEFAULT_SETTINGS.bitPaymentLink),
    whatsappPhone: read("whatsapp_phone", DEFAULT_SETTINGS.whatsappPhone),
    announcement: read<Localized | null>("announcement", null),
  };
}

/* --------------------------------------------------------------------------
   The seed fallback
   -------------------------------------------------------------------------- */

interface SeedShape {
  categories: Category[];
  subclasses: Subclass[];
  products: Product[];
  rules: PricingRule[];
}

function seedCatalogue(): Catalogue {
  const seed = SEED as unknown as SeedShape;
  return {
    categories: seed.categories,
    subclasses: seed.subclasses,
    products: seed.products,
    rules: seed.rules,
    settings: DEFAULT_SETTINGS,
    live: false,
  };
}

/* --------------------------------------------------------------------------
   The public read
   -------------------------------------------------------------------------- */

/**
 * Everything the storefront needs, in one round trip per table.
 *
 * Deliberately not paginated and not per-category: the whole catalogue is a
 * few dozen rows, and fetching it once lets the pricing engine see every rule
 * at the same moment. Splitting it would mean a cart total computed against a
 * partially-loaded rule set, which is a wrong number rather than a slow one.
 *
 * Any failure — no configuration, network down, a table not migrated yet —
 * falls back to the seed rather than throwing. The `live` flag tells callers
 * which happened, so the manager can refuse to pretend it can save.
 */
export async function readCatalogue(): Promise<Catalogue> {
  if (!isSupabaseConfigured()) return seedCatalogue();

  try {
    const supabase = await createClient();

    const [categories, subclasses, products, rules, settings] = await Promise.all([
      supabase.from("categories").select("*").order("sort_order"),
      supabase.from("subclasses").select("*").order("sort_order"),
      supabase
        .from("products")
        .select("*, product_images(id, path, sort_order)")
        .order("sort_order"),
      supabase.from("pricing_rules").select("*"),
      supabase.from("app_settings").select("key, value"),
    ]);

    const failure =
      categories.error ?? subclasses.error ?? products.error ?? rules.error ?? settings.error;
    if (failure) {
      console.error("[catalogue] read failed, falling back to seed:", failure.message);
      return seedCatalogue();
    }

    return {
      categories: (categories.data as CategoryRow[]).map(toCategory),
      subclasses: (subclasses.data as SubclassRow[]).map(toSubclass),
      products: (products.data as ProductRow[]).map(toProduct),
      rules: (rules.data as RuleRow[]).map(toRule),
      settings: toSettings(settings.data ?? []),
      live: true,
    };
  } catch (error) {
    console.error("[catalogue] read threw, falling back to seed:", error);
    return seedCatalogue();
  }
}

/**
 * The same catalogue, but everything — including hidden categories, unlisted
 * subclasses, unavailable products, and parked deals.
 *
 * A separate function rather than a flag on `readCatalogue`, because the
 * difference is not cosmetic: this one runs as the service role and bypasses
 * RLS entirely. Every caller must already have established that the visitor is
 * an owner (`requireOwner()` / `getOwner()`), and having to reach for a
 * differently-named function makes that obligation visible at the call site
 * instead of hiding it inside a boolean.
 */
export async function readCatalogueAsOwner(): Promise<Catalogue> {
  if (!isSupabaseConfigured()) return seedCatalogue();

  const { createServiceClient } = await import("./supabase/server");

  try {
    const db = createServiceClient();

    const [categories, subclasses, products, rules, settings] = await Promise.all([
      db.from("categories").select("*").order("sort_order"),
      db.from("subclasses").select("*").order("sort_order"),
      db.from("products").select("*, product_images(id, path, sort_order)").order("sort_order"),
      db.from("pricing_rules").select("*").order("min_qty"),
      db.from("app_settings").select("key, value"),
    ]);

    const failure =
      categories.error ?? subclasses.error ?? products.error ?? rules.error ?? settings.error;
    if (failure) {
      console.error("[catalogue] owner read failed:", failure.message);
      return seedCatalogue();
    }

    return {
      categories: (categories.data as CategoryRow[]).map(toCategory),
      subclasses: (subclasses.data as SubclassRow[]).map(toSubclass),
      products: (products.data as ProductRow[]).map(toProduct),
      rules: (rules.data as RuleRow[]).map(toRule),
      settings: toSettings(settings.data ?? []),
      live: true,
    };
  } catch (error) {
    console.error("[catalogue] owner read threw:", error);
    return seedCatalogue();
  }
}

/* --------------------------------------------------------------------------
   Image paths

   `imageUrl` lives in `./images` rather than here: this module is
   `server-only`, and the manager's photo list and the storefront's product
   cards both need it on the client. Re-exported so a server-side caller does
   not have to know that.
   -------------------------------------------------------------------------- */

export { imageUrl } from "./images";
