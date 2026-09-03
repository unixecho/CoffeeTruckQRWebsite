/**
 * Converts the old static site's `data/products.json` into `src/data/seed.json`.
 *
 * Run once during the rebuild; kept in the repo because it documents exactly
 * how the flat catalogue was mapped onto the three-level model, which is the
 * kind of thing nobody remembers six months later.
 *
 *     node scripts/build-seed.mjs
 *
 * The output is the storefront's read-only fallback AND the input to
 * `scripts/seed-supabase.mjs`, which pushes the same rows into the database.
 * One source, so the two can never disagree.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const legacy = JSON.parse(readFileSync(join(root, "legacy/data/products.json"), "utf8"));

/* Fixed ids rather than generated ones: the seed is committed, and a file that
   produces different uuids on every run turns every rebuild into a diff. */
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let counter = 0;
const nextId = () => id(++counter);

const NOW = "2026-09-03T00:00:00.000Z";

/* --------------------------------------------------------------------------
   Categories

   Carried over from the `categories` block in the old `app.js`, including the
   two that had no products (magnets, homeDecor) — the owner had already named
   them, and an empty category is a placeholder, not a mistake.
   -------------------------------------------------------------------------- */

const CATEGORY_DEFS = [
  { key: "keychains", icon: "KeyRound", tint: "orange",
    name: { he: "מחזיקי מפתחות", en: "Keychains", ar: "ميداليات مفاتيح" } },
  { key: "figures", icon: "Sparkles", tint: "purple",
    name: { he: "דמויות ופסלונים", en: "Figures", ar: "مجسمات" } },
  { key: "customPrints", icon: "Wrench", tint: "blue",
    name: { he: "הדפסות בהתאמה אישית", en: "Custom Prints", ar: "طباعة حسب الطلب" } },
  { key: "magnets", icon: "Magnet", tint: "green",
    name: { he: "מגנטים", en: "Magnets", ar: "مغناطيسات" } },
  { key: "homeDecor", icon: "Lamp", tint: "teal",
    name: { he: "דקורציה לבית", en: "Home Decor", ar: "ديكور منزلي" } },
];

const slugOf = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

const categories = CATEGORY_DEFS.map((def, index) => ({
  id: nextId(),
  slug: slugOf(def.key),
  name: def.name,
  icon: def.icon,
  tint: def.tint,
  sortOrder: index,
  visible: true,
}));

const categoryByKey = new Map(
  CATEGORY_DEFS.map((def, index) => [def.key, categories[index]])
);

/* --------------------------------------------------------------------------
   Subclasses

   New in this rebuild. The old catalogue sold every keychain as ONE product
   row with a bundle ladder attached, which meant a customer taking three
   different designs did not get the deal. Splitting keychains into clickers /
   small / big is what lets the ladder hang off something a mix can fill.

   The other categories get no subclasses: nothing there is sold as a mix.
   -------------------------------------------------------------------------- */

const SUBCLASS_DEFS = [
  { category: "keychains", slug: "clickers",
    name: { he: "קליקרים", en: "Clicker keychains", ar: "ميداليات نقّارة" } },
  { category: "keychains", slug: "small",
    name: { he: "קטנים", en: "Small keychains", ar: "ميداليات صغيرة" } },
  { category: "keychains", slug: "big",
    name: { he: "גדולים", en: "Big keychains", ar: "ميداليات كبيرة" } },
];

const subclasses = SUBCLASS_DEFS.map((def, index) => ({
  id: nextId(),
  categoryId: categoryByKey.get(def.category).id,
  slug: def.slug,
  name: def.name,
  sortOrder: index,
  visible: true,
}));

const subclassBySlug = new Map(subclasses.map((s) => [s.slug, s]));

/* --------------------------------------------------------------------------
   Products
   -------------------------------------------------------------------------- */

/** The old JSON stored whole shekels; the new model stores agorot. */
const toAgorot = (shekels) => Math.round(Number(shekels) * 100);

/** Drops empty strings so the fallback chain in `localize()` can do its job. */
const clean = (value) => {
  const out = { he: (value.he ?? "").trim() };
  if (value.en?.trim()) out.en = value.en.trim();
  if (value.ar?.trim()) out.ar = value.ar.trim();
  return out;
};

const products = [];
const rules = [];

legacy.forEach((item, index) => {
  const category = categoryByKey.get(item.categoryKey);
  if (!category) throw new Error(`unknown category key: ${item.categoryKey}`);

  /* The one catch-all keychain row lands in `small` so the seeded ladder has
     something to price. Tomorrow's individual keychains get added beside it
     and immediately share the deal. */
  const subclass = item.categoryKey === "keychains" ? subclassBySlug.get("small") : null;

  const product = {
    id: nextId(),
    categoryId: category.id,
    subclassId: subclass ? subclass.id : null,
    slug: item.id,
    name: clean(item.name),
    description: clean(item.description),
    priceAgorot: toAgorot(item.price),
    available: item.available !== false,
    stock: null,
    images: item.image
      ? [{ id: nextId(), path: `/${item.image.replace(/^assets\//, "products/")}`, sortOrder: 0 }]
      : [],
    sortOrder: index,
    createdAt: NOW,
    updatedAt: NOW,
  };

  products.push(product);

  /* Old `pricingTier` entries become pricing rules.

     Keychain tiers move to SUBCLASS scope — that is the whole point of the
     rebuild, so three different small keychains hit the deal. Everything else
     stays at product scope, because a bundle of two identical dragons is what
     was actually meant. */
  for (const tier of item.pricingTier ?? []) {
    const keychain = item.categoryKey === "keychains";
    rules.push({
      id: nextId(),
      scope: keychain ? "subclass" : "product",
      scopeId: keychain ? subclass.id : product.id,
      minQty: Number(tier.qty),
      priceAgorot: toAgorot(tier.price),
      active: true,
      startsAt: null,
      endsAt: null,
      label: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }
});

/* --------------------------------------------------------------------------
   One correction, made deliberately and flagged in HANDOFF.md.

   The old catalogue advertised "1 for ₪10 / 3 for ₪25 / 5 for ₪35" in all
   three languages, but its `pricingTier` charged ₪40 for five. The two have
   disagreed since the row was written. Taking the advertised number is the
   safer of the two errors — undercharging by ₪5 beats charging a customer
   more than the sign in front of them says.
   -------------------------------------------------------------------------- */

const fiveRung = rules.find((rule) => rule.scope === "subclass" && rule.minQty === 5);
if (fiveRung && fiveRung.priceAgorot === 4000) {
  fiveRung.priceAgorot = 3500;
  console.log("· corrected the 5-keychain rung from ₪40 to the advertised ₪35");
}

/* -------------------------------------------------------------------------- */

const seed = { categories, subclasses, products, rules };

mkdirSync(join(root, "src/data"), { recursive: true });
writeFileSync(join(root, "src/data/seed.json"), `${JSON.stringify(seed, null, 2)}\n`, "utf8");

console.log(
  `wrote src/data/seed.json — ${categories.length} categories, ` +
    `${subclasses.length} subclasses, ${products.length} products, ${rules.length} rules`
);
