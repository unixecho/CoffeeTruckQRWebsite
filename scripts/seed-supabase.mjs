#!/usr/bin/env node
/**
 * Pushes `src/data/seed.json` into a live Supabase project.
 *
 *     node scripts/seed-supabase.mjs            # create what is missing
 *     node scripts/seed-supabase.mjs --dry-run  # say what it would do, write nothing
 *     node scripts/seed-supabase.mjs --force    # proceed even over the owner's own rows
 *
 * `scripts/build-seed.mjs` produces the file this consumes; read its comments
 * for how the old flat catalogue was mapped onto category → subclass → product.
 * The two scripts share one source so the storefront's offline fallback and the
 * database can never disagree about what the shop sells.
 *
 * Two properties matter more than anything else here:
 *
 *   1. Running it twice changes nothing the second time. Every row is matched
 *      on a natural key the schema already declares unique — categories.slug,
 *      (subclasses.category_id, slug), products.slug, and
 *      (pricing_rules.scope, scope_id, min_qty). The seed's uuids are fixed
 *      (build-seed.mjs generates them deterministically) and are usable as
 *      primary keys, so a fresh insert lands on both the natural key AND the
 *      same id it had last time; a re-run matches the identical row on either.
 *
 *   2. It never deletes and never silently overwrites the owner's work. This
 *      script only inserts rows that are missing and updates seeded rows that
 *      have drifted. If the database contains products the seed has never
 *      heard of, that is a week of real edits, and the script stops and asks
 *      for --force rather than assuming.
 *
 * It also lifts the seeded photos out of `public/products/` and into the
 * `product-photos` bucket, repointing product_images at the storage keys, so
 * the catalogue survives `public/` being cleaned out later.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const BUCKET = "product-photos";

/* Seeded photos live under their own prefix. The manager's upload route names
   the objects it creates itself, and keeping the two apart means a re-run can
   tell "this is the photo I put here" from "the owner replaced it". */
const PHOTO_PREFIX = "seed";

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/* ==========================================================================
   Output

   Warnings are collected rather than printed as they happen: the report at the
   end is the thing somebody actually reads, and a warning buried forty lines
   above the summary is a warning nobody saw.
   ========================================================================== */

const warnings = [];
const say = (...parts) => console.log(...parts);
const warn = (message) => warnings.push(message);

function fail(message, hint) {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

/** Local, because this is plain Node and cannot import the TypeScript money.ts. */
const shekels = (agorot) =>
  `₪${(agorot / 100).toFixed(agorot % 100 === 0 ? 0 : 2)}`;

/* ==========================================================================
   Arguments
   ========================================================================== */

const KNOWN_FLAGS = ["--force", "--dry-run", "--skip-photos", "--help", "-h"];
const args = process.argv.slice(2);
const unknownArgs = args.filter((arg) => !KNOWN_FLAGS.includes(arg));

if (unknownArgs.length > 0) {
  fail(
    `unrecognised argument${unknownArgs.length > 1 ? "s" : ""}: ${unknownArgs.join(", ")}`,
    "run with --help for the list."
  );
}

if (args.includes("--help") || args.includes("-h")) {
  say(`
seed-supabase — push src/data/seed.json into a live Supabase project

  node scripts/seed-supabase.mjs [--dry-run] [--force] [--skip-photos]

  --dry-run      read everything, write nothing, print the plan
  --force        continue even when the database holds products the seed does
                 not know about (i.e. the owner has been editing)
  --skip-photos  leave storage alone; catalogue rows only

Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
environment, or from .env.local. See .env.example.

Safe to run repeatedly: nothing is ever deleted, and every row is matched on
its natural key, so a second run reports "unchanged" rather than duplicating.
`);
  process.exit(0);
}

const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const skipPhotos = args.includes("--skip-photos");

/* ==========================================================================
   Environment

   Parsed here rather than with dotenv: this script exists so the project can be
   seeded on a laptop that has just cloned the repo, and adding a dependency to
   read four lines of KEY=value would be a poor trade.
   ========================================================================== */

/**
 * Loads `.env.local` into process.env without overwriting anything already
 * set — a real environment variable is more specific than a file, and CI sets
 * the real thing.
 */
function loadEnvFile(file) {
  if (!existsSync(file)) return false;

  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;

    let value = raw.trim();
    const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
    if (quoted) {
      value = quoted[2];
      /* Only double quotes carry escapes, same as every other .env reader. */
      if (quoted[1] === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      /* A `#` only starts a comment when whitespace precedes it. Supabase keys
         are base64url and cannot contain one, but a password in the same file
         very well might. */
      value = value.replace(/\s+#.*$/, "");
    }

    process.env[key] = value;
  }

  return true;
}

const envFileLoaded = loadEnvFile(join(root, ".env.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  const missing = [
    !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);

  fail(
    `missing ${missing.join(" and ")}.`,
    `Copy .env.example to .env.local and fill in the project's API settings.` +
      (envFileLoaded ? " (.env.local was read, but does not define it.)" : "")
  );
}

if (!/^https?:\/\//.test(supabaseUrl)) {
  fail(
    `NEXT_PUBLIC_SUPABASE_URL does not look like a URL: ${supabaseUrl}`,
    "It should be https://YOUR-PROJECT-REF.supabase.co — see .env.example."
  );
}

/* The service role bypasses RLS entirely, which is the whole reason this runs
   from a terminal and never from the app. */
const db = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ==========================================================================
   The seed, and a check that it is sane

   The seed is generated, so this validation is not defending against a hostile
   file — it is defending against a hand-edit, which is the realistic way this
   file changes. Every rule below mirrors a CHECK constraint in migration 001;
   catching them here produces "products[3].slug is not a slug" instead of a
   Postgres error forty rows into a batch insert.
   ========================================================================== */

const seedPath = join(root, "src/data/seed.json");
if (!existsSync(seedPath)) {
  fail("src/data/seed.json is missing.", "Run: node scripts/build-seed.mjs");
}

let seed;
try {
  seed = JSON.parse(readFileSync(seedPath, "utf8"));
} catch (error) {
  fail(`src/data/seed.json is not valid JSON: ${error.message}`);
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateSeed(data) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };

  for (const key of ["categories", "subclasses", "products", "rules"]) {
    if (!Array.isArray(data[key])) {
      problems.push(`${key} is missing or not an array`);
    }
  }
  if (problems.length > 0) return problems;

  const seen = (list, label, keyOf) => {
    const used = new Set();
    list.forEach((row, index) => {
      const key = keyOf(row);
      check(!used.has(key), `${label}[${index}] duplicates the key "${key}"`);
      used.add(key);
    });
  };

  const categoryIds = new Set(data.categories.map((row) => row.id));
  const subclassIds = new Set(data.subclasses.map((row) => row.id));
  const productIds = new Set(data.products.map((row) => row.id));

  data.categories.forEach((row, i) => {
    check(UUID.test(row.id), `categories[${i}].id is not a uuid`);
    check(SLUG.test(row.slug ?? ""), `categories[${i}].slug "${row.slug}" is not a slug`);
    check(Boolean(row.name?.he?.trim()), `categories[${i}] has no Hebrew name`);
    check((row.name?.he ?? "").length <= 80, `categories[${i}] Hebrew name is over 80 chars`);
    check(typeof row.icon === "string" && row.icon.length > 0, `categories[${i}].icon is empty`);
    check(typeof row.tint === "string" && row.tint.length > 0, `categories[${i}].tint is empty`);
  });
  seen(data.categories, "categories", (row) => row.slug);

  data.subclasses.forEach((row, i) => {
    check(UUID.test(row.id), `subclasses[${i}].id is not a uuid`);
    check(SLUG.test(row.slug ?? ""), `subclasses[${i}].slug "${row.slug}" is not a slug`);
    check(Boolean(row.name?.he?.trim()), `subclasses[${i}] has no Hebrew name`);
    check(
      categoryIds.has(row.categoryId),
      `subclasses[${i}] ("${row.slug}") points at an unknown category`
    );
  });
  seen(data.subclasses, "subclasses", (row) => `${row.categoryId}/${row.slug}`);

  const subclassParent = new Map(data.subclasses.map((row) => [row.id, row.categoryId]));

  data.products.forEach((row, i) => {
    check(UUID.test(row.id), `products[${i}].id is not a uuid`);
    check(SLUG.test(row.slug ?? ""), `products[${i}].slug "${row.slug}" is not a slug`);
    check(Boolean(row.name?.he?.trim()), `products[${i}] has no Hebrew name`);
    check((row.name?.he ?? "").length <= 120, `products[${i}] Hebrew name is over 120 chars`);
    check(
      Number.isInteger(row.priceAgorot) && row.priceAgorot >= 0 && row.priceAgorot <= 1000000,
      `products[${i}] ("${row.slug}") has a price outside 0–₪10,000, or one that is not an integer`
    );
    check(
      row.stock === null || (Number.isInteger(row.stock) && row.stock >= 0),
      `products[${i}] ("${row.slug}") has a negative or fractional stock`
    );
    check(
      categoryIds.has(row.categoryId),
      `products[${i}] ("${row.slug}") points at an unknown category`
    );
    if (row.subclassId) {
      check(
        subclassIds.has(row.subclassId),
        `products[${i}] ("${row.slug}") points at an unknown subclass`
      );
      /* The database enforces this with a trigger; failing here names the
         product instead of printing a pair of uuids. */
      check(
        subclassParent.get(row.subclassId) === row.categoryId,
        `products[${i}] ("${row.slug}") is in a subclass that belongs to a different category`
      );
    }
    (row.images ?? []).forEach((image, j) => {
      check(UUID.test(image.id), `products[${i}].images[${j}].id is not a uuid`);
      check(
        typeof image.path === "string" && image.path.length > 0 && image.path.length <= 500,
        `products[${i}].images[${j}].path is empty or too long`
      );
    });
  });
  seen(data.products, "products", (row) => row.slug);

  data.rules.forEach((row, i) => {
    check(UUID.test(row.id), `rules[${i}].id is not a uuid`);
    check(
      ["product", "subclass", "category"].includes(row.scope),
      `rules[${i}].scope "${row.scope}" is not product/subclass/category`
    );
    check(
      Number.isInteger(row.minQty) && row.minQty >= 2 && row.minQty <= 999,
      `rules[${i}] has minQty ${row.minQty}; a bundle is 2–999`
    );
    check(
      Number.isInteger(row.priceAgorot) && row.priceAgorot >= 0 && row.priceAgorot <= 1000000,
      `rules[${i}] has a price outside 0–₪10,000, or one that is not an integer`
    );
    const pool =
      row.scope === "product" ? productIds : row.scope === "subclass" ? subclassIds : categoryIds;
    check(pool.has(row.scopeId), `rules[${i}] prices a ${row.scope} that is not in the seed`);
  });
  seen(data.rules, "rules", (row) => `${row.scope}/${row.scopeId}/${row.minQty}`);

  return problems;
}

const problems = validateSeed(seed);
if (problems.length > 0) {
  console.error(`\n✖ src/data/seed.json has ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error("\nFix the source and re-run: node scripts/build-seed.mjs\n");
  process.exit(1);
}

/* ==========================================================================
   Reading what is already there

   Every table is read in full before anything is written. These are a few
   dozen rows, and having the whole picture is what lets the script tell a
   fresh install from a re-run from "the owner has been busy".
   ========================================================================== */

async function fetchAll(table) {
  const { data, error } = await db.from(table).select("*");
  if (error) {
    fail(
      `could not read ${table}: ${error.message}`,
      /does not exist|schema cache/i.test(error.message)
        ? "The schema is not migrated yet. Run: npm run db:push"
        : "Check that SUPABASE_SERVICE_ROLE_KEY belongs to this project."
    );
  }
  return data ?? [];
}

say(`\nseeding ${new URL(supabaseUrl).host}${dryRun ? "  (dry run — nothing will be written)" : ""}`);

const [current, currentSubclasses, currentProducts, currentImages, currentRules] =
  await Promise.all([
    fetchAll("categories"),
    fetchAll("subclasses"),
    fetchAll("products"),
    fetchAll("product_images"),
    fetchAll("pricing_rules"),
  ]);

/* ==========================================================================
   The guard

   The realistic accident is somebody re-running this a week after launch to
   "reset the demo data", on a database that by then holds the owner's real
   catalogue. Nothing here deletes, so their rows would survive — but their
   *edits to seeded rows* would be silently reverted, and that is bad enough to
   stop for.
   ========================================================================== */

const seedProductSlugs = new Set(seed.products.map((row) => row.slug));
const strangers = currentProducts.filter((row) => !seedProductSlugs.has(row.slug));

if (strangers.length > 0) {
  say(
    `\n⚠ this database holds ${strangers.length} product(s) the seed has never heard of:\n`
  );
  for (const row of strangers.slice(0, 20)) {
    const added = String(row.created_at ?? "").slice(0, 10);
    say(`  · ${row.slug} — ${row.name_he} — ${shekels(row.price_agorot)}${added ? `  (added ${added})` : ""}`);
  }
  if (strangers.length > 20) say(`  · …and ${strangers.length - 20} more`);

  say(
    "\n  That is the owner's own work. Seeding will not delete it, but it WILL\n" +
      "  overwrite any edits made to the seeded rows themselves — prices, names,\n" +
      "  availability, bundle rungs.\n"
  );

  if (!force) {
    fail(
      "stopping, because this looks like a live catalogue rather than an empty project.",
      "Re-run with --force if you are certain, or --dry-run to see exactly what would change."
    );
  }

  say("  --force given; continuing.\n");
}

/* ==========================================================================
   Writing

   One pass per table, parents first, because products reference categories and
   pricing rules are checked against their scope by a trigger.

   Matching is done on the natural key rather than the primary key, and ids are
   then *resolved* through a map: if the owner already created a category with
   the slug "keychains" under a uuid of their own, the seed's subclasses and
   products must attach to that row, not conjure a second one. Rewriting their
   primary key instead would be rejected by the foreign keys anyway.
   ========================================================================== */

/** Normalises for comparison so `undefined` and `null` are one thing. */
const differs = (existing, payload) =>
  Object.keys(payload).some((key) => (existing[key] ?? null) !== (payload[key] ?? null));

/** `{he, en?, ar?}` → three nullable columns, empty strings folded to null. */
function localizedColumns(prefix, value) {
  const pick = (locale) => {
    const text = value?.[locale];
    return typeof text === "string" && text.trim() ? text.trim() : null;
  };
  return {
    [`${prefix}_he`]: pick("he"),
    [`${prefix}_en`]: pick("en"),
    [`${prefix}_ar`]: pick("ar"),
  };
}

const tally = {};

/**
 * Inserts what is missing, updates what has drifted, leaves the rest alone.
 * Returns a map from seed id to the id the row actually has in the database.
 */
async function sync({ table, seedRows, existingRows, keyOf, payloadOf }) {
  const byKey = new Map(existingRows.map((row) => [keyOf(row), row]));
  const resolved = new Map();

  const inserts = [];
  const updates = [];
  let unchanged = 0;

  for (const seedRow of seedRows) {
    const payload = payloadOf(seedRow);
    if (!payload) continue; // the caller could not resolve a parent; already warned

    const existing = byKey.get(keyOf(payload));

    if (!existing) {
      inserts.push({ id: seedRow.id, ...payload });
      resolved.set(seedRow.id, seedRow.id);
      continue;
    }

    resolved.set(seedRow.id, existing.id);
    if (differs(existing, payload)) updates.push({ id: existing.id, payload });
    else unchanged += 1;
  }

  if (!dryRun && inserts.length > 0) {
    const { error } = await db.from(table).insert(inserts);
    if (error) fail(`inserting into ${table} failed: ${error.message}`);
  }

  if (!dryRun) {
    /* One statement per update rather than an upsert: there are a handful of
       them, and a failure names the row that caused it. */
    for (const { id, payload } of updates) {
      const { error } = await db.from(table).update(payload).eq("id", id);
      if (error) fail(`updating ${table} ${id} failed: ${error.message}`);
    }
  }

  tally[table] = { created: inserts.length, updated: updates.length, unchanged };
  return resolved;
}

/* -- categories ----------------------------------------------------------- */

const categoryIds = await sync({
  table: "categories",
  seedRows: seed.categories,
  existingRows: current,
  keyOf: (row) => row.slug,
  payloadOf: (row) => ({
    slug: row.slug,
    ...localizedColumns("name", row.name),
    icon: row.icon,
    tint: row.tint,
    sort_order: row.sortOrder,
    visible: row.visible,
  }),
});

/* -- subclasses ----------------------------------------------------------- */

const subclassIds = await sync({
  table: "subclasses",
  seedRows: seed.subclasses,
  existingRows: currentSubclasses,
  keyOf: (row) => `${row.category_id}\u0000${row.slug}`,
  payloadOf: (row) => ({
    category_id: categoryIds.get(row.categoryId),
    slug: row.slug,
    ...localizedColumns("name", row.name),
    sort_order: row.sortOrder,
    visible: row.visible,
  }),
});

/* -- products ------------------------------------------------------------- */

const productIds = await sync({
  table: "products",
  seedRows: seed.products,
  existingRows: currentProducts,
  keyOf: (row) => row.slug,
  payloadOf: (row) => ({
    category_id: categoryIds.get(row.categoryId),
    subclass_id: row.subclassId ? subclassIds.get(row.subclassId) : null,
    slug: row.slug,
    ...localizedColumns("name", row.name),
    ...localizedColumns("description", row.description),
    price_agorot: row.priceAgorot,
    available: row.available,
    stock: row.stock ?? null,
    sort_order: row.sortOrder,
  }),
});

/* ==========================================================================
   Photos

   The seed points at `/products/foo.png`, which the storefront serves straight
   out of `public/`. That works, but it ties the catalogue to the repository:
   the day somebody prunes `public/` — or the manager starts replacing these
   photos with ones taken at the stand — the rows go stale. So each seeded
   photo is copied into the bucket once and the row is repointed at the storage
   key, which `imageUrl()` in src/lib/catalog.ts already knows how to render.

   A photo that is already in the bucket is left alone. Re-uploading identical
   bytes would only change the object's timestamp and bust every cache.
   ========================================================================== */

const photos = { uploaded: 0, present: 0, missing: 0 };

/** Object keys already in the bucket, or null when the bucket is unreachable. */
async function readBucket() {
  const { data, error } = await db.storage.from(BUCKET).list(PHOTO_PREFIX, { limit: 1000 });

  if (error) {
    warn(
      /not found|does not exist/i.test(error.message)
        ? `the "${BUCKET}" bucket does not exist — run \`npm run db:push\` so ` +
          `supabase/migrations/004_storage.sql creates it, then re-run this script. ` +
          `Photos stay on their /products/ paths until then.`
        : `could not list the "${BUCKET}" bucket: ${error.message}. Photos left as they are.`
    );
    return null;
  }

  return new Set((data ?? []).map((object) => `${PHOTO_PREFIX}/${object.name}`));
}

const bucketContents = skipPhotos ? null : await readBucket();

/**
 * Works out where a seeded photo should live, uploading it if it is not in the
 * bucket yet. Falls back to the original `public/` path — which still renders —
 * whenever storage is unavailable or the file is not on disk.
 */
async function resolvePhotoPath(image) {
  if (bucketContents === null) return image.path;

  const filename = basename(image.path);
  const key = `${PHOTO_PREFIX}/${filename}`;

  if (bucketContents.has(key)) {
    photos.present += 1;
    return key;
  }

  const localFile = join(root, "public/products", filename);
  if (!existsSync(localFile)) {
    photos.missing += 1;
    warn(`public/products/${filename} is not on disk — the row keeps its ${image.path} path.`);
    return image.path;
  }

  const contentType = CONTENT_TYPES[extname(filename).toLowerCase()];
  if (!contentType) {
    photos.missing += 1;
    warn(`${filename} is not a jpeg/png/webp/avif — the bucket would reject it; row left alone.`);
    return image.path;
  }

  if (dryRun) {
    photos.uploaded += 1;
    return key;
  }

  const { error } = await db.storage.from(BUCKET).upload(localFile && key, readFileSync(localFile), {
    contentType,
    /* A year. Safe because these object keys never receive different bytes:
       a replacement photo comes through the manager, which names its own
       object. */
    cacheControl: "31536000",
    upsert: false,
  });

  if (error) {
    photos.missing += 1;
    warn(`uploading ${filename} failed: ${error.message}. The row keeps its ${image.path} path.`);
    return image.path;
  }

  photos.uploaded += 1;
  bucketContents.add(key);
  return key;
}

/* Image rows are matched on the seed's fixed image id rather than on a natural
   key, and that is deliberate: a product can have several photos, and only the
   one this script put there may be repointed. Anything the owner uploaded is
   invisible to this loop. */
const imagesByIdOrPath = new Map();
for (const row of currentImages) {
  imagesByIdOrPath.set(row.id, row);
  imagesByIdOrPath.set(`${row.product_id}\u0000${row.path}`, row);
}

const imageInserts = [];
const imageUpdates = [];
let imagesUnchanged = 0;

for (const product of seed.products) {
  const productId = productIds.get(product.id);
  if (!productId) continue;

  for (const image of product.images ?? []) {
    const path = await resolvePhotoPath(image);

    const existing =
      imagesByIdOrPath.get(image.id) ??
      imagesByIdOrPath.get(`${productId}\u0000${path}`) ??
      imagesByIdOrPath.get(`${productId}\u0000${image.path}`);

    const payload = { product_id: productId, path, sort_order: image.sortOrder };

    if (!existing) imageInserts.push({ id: image.id, ...payload });
    else if (differs(existing, payload)) imageUpdates.push({ id: existing.id, payload });
    else imagesUnchanged += 1;
  }
}

if (!dryRun && imageInserts.length > 0) {
  const { error } = await db.from("product_images").insert(imageInserts);
  if (error) fail(`inserting product_images failed: ${error.message}`);
}

if (!dryRun) {
  for (const { id, payload } of imageUpdates) {
    const { error } = await db.from("product_images").update(payload).eq("id", id);
    if (error) fail(`updating product_images ${id} failed: ${error.message}`);
  }
}

tally.product_images = {
  created: imageInserts.length,
  updated: imageUpdates.length,
  unchanged: imagesUnchanged,
};

/* ==========================================================================
   Pricing rules

   Last, because a trigger checks that the product / subclass / category a rule
   prices actually exists.
   ========================================================================== */

const scopeMaps = { product: productIds, subclass: subclassIds, category: categoryIds };

await sync({
  table: "pricing_rules",
  seedRows: seed.rules,
  existingRows: currentRules,
  keyOf: (row) => `${row.scope}\u0000${row.scope_id}\u0000${row.min_qty}`,
  payloadOf: (row) => {
    const scopeId = scopeMaps[row.scope].get(row.scopeId);
    if (!scopeId) {
      warn(`a ${row.minQty}-for-${shekels(row.priceAgorot)} rule was skipped: its ${row.scope} is not in the database.`);
      return null;
    }

    return {
      scope: row.scope,
      scope_id: scopeId,
      min_qty: row.minQty,
      price_agorot: row.priceAgorot,
      active: row.active,
      starts_at: row.startsAt ?? null,
      ends_at: row.endsAt ?? null,
      ...localizedColumns("label", row.label),
    };
  },
});

/* `app_settings` is deliberately not touched. Migration 001 inserts the five
   keys with `on conflict do nothing`, and by the time anyone runs this script
   the owner may well have set a real Bit link — which is exactly the kind of
   thing a seed script has no business resetting. */

/* ==========================================================================
   The report
   ========================================================================== */

const LABELS = {
  categories: "categories",
  subclasses: "subclasses",
  products: "products",
  product_images: "photos (rows)",
  pricing_rules: "bundle rules",
};

say(dryRun ? "\nwould write:" : "\nwrote:");

for (const [table, label] of Object.entries(LABELS)) {
  const counts = tally[table] ?? { created: 0, updated: 0, unchanged: 0 };
  say(
    `  ${label.padEnd(14)} ${String(counts.created).padStart(3)} created · ` +
      `${String(counts.updated).padStart(3)} updated · ` +
      `${String(counts.unchanged).padStart(3)} unchanged`
  );
}

if (skipPhotos) {
  say(`  ${"photo files".padEnd(14)} skipped (--skip-photos)`);
} else {
  say(
    `  ${"photo files".padEnd(14)} ${String(photos.uploaded).padStart(3)} ${dryRun ? "to upload" : "uploaded"} · ` +
      `${String(photos.present).padStart(3)} already in the bucket` +
      (photos.missing > 0 ? ` · ${photos.missing} unavailable` : "")
  );
}

if (warnings.length > 0) {
  say(`\n⚠ ${warnings.length} warning(s):`);
  for (const message of warnings) say(`  · ${message}`);
}

const touched = Object.values(tally).some((c) => c.created > 0 || c.updated > 0);

say(
  dryRun
    ? "\ndry run — nothing was written. Drop --dry-run to apply.\n"
    : touched
      ? "\ndone. The storefront reads live rows now; `live: true` in readCatalogue().\n"
      : "\ndone — everything was already in place. Nothing changed.\n"
);

/* A non-zero exit on warnings so CI, or a person who scrolled past, still
   notices that some photos did not make it into the bucket. */
process.exit(warnings.length > 0 ? 1 : 0);
