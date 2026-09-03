import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isIconName, isTintName } from "./categoryIcons";
import { PRICING_SCOPES, type OwnerRole, type PricingScope } from "./types";

/* ==========================================================================
   Turning a request body into something safe to write

   Every write endpoint narrows its body here, field by field, before anything
   reaches the database. Nothing is ever spread: `{ ...body }` into an insert
   is how a client ends up choosing its own `id`, `slug`, `sort_order` — or, on
   `owners`, its own `role` — and the bug is invisible in review because it is
   the code that *isn't* there.

   The shape is one parser per entity, returning either a **column-shaped**
   object ready for PostgREST or a single field error the route turns into a
   400. Unknown keys are rejected by the simplest mechanism available: they are
   never read.

   Column names, not domain names, come out of these parsers. The translation
   from `{ name: { he } }` to `name_he` is exactly the step where a client-
   controlled key would otherwise sneak through, so it happens here once rather
   than being re-derived in fourteen route handlers.

   Alongside the parsers this module holds the other small pieces of the write
   surface that must be identical everywhere — slug generation, sort ordering,
   the image sniffer, and the response shapes. They live together because the
   thing they have in common is that a route must never improvise its own.
   ========================================================================== */

type Db = SupabaseClient;

/* --------------------------------------------------------------------------
   Limits

   These mirror the CHECK constraints in migration 001. The database is the
   real enforcement; repeating the numbers here buys a 400 with a field name
   instead of a 500 from a constraint violation, which is the difference
   between the manager highlighting a field and the manager saying "something
   went wrong".
   -------------------------------------------------------------------------- */

const CATEGORY_NAME_MAX = 80;
const PRODUCT_NAME_MAX = 120;
const DESCRIPTION_MAX = 2000;
const LABEL_MAX = 80;
const MAX_AGOROT = 1_000_000;
const MIN_BUNDLE_QTY = 2;
const MAX_BUNDLE_QTY = 999;
const MAX_STOCK = 1_000_000;
const EMAIL_MAX = 254;
const URL_MAX = 500;
const PHONE_MAX = 15;
const SLUG_BASE_MAX = 48;
const MAX_REORDER_IDS = 200;

/* --------------------------------------------------------------------------
   Result type
   -------------------------------------------------------------------------- */

export interface FieldError {
  /** The client-facing field name, so the manager can focus the input. */
  field: string;
  /** Developer-facing English. The manager renders a translated string keyed
      off the error code, never this. */
  message: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: FieldError };

function fail(field: string, message: string): { ok: false; error: FieldError } {
  return { ok: false, error: { field, message } };
}

/* --------------------------------------------------------------------------
   Primitive readers
   -------------------------------------------------------------------------- */

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

/** Own properties only — a PATCH distinguishes "absent" from "set to null". */
function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * A single line of human text.
 *
 * Control characters are collapsed rather than rejected: they arrive from
 * phone keyboards and paste buffers far more often than from an attacker, and
 * silently cleaning them is kinder than refusing a product name. Note that
 * bidi *overrides* (U+202A-U+202E, U+2066-U+2069) are stripped too — a name
 * carrying one reorders every price and count rendered beside it.
 */
const BIDI_OVERRIDES = /[\u202a-\u202e\u2066-\u2069]/g;

function oneLine(raw: string): string {
  return raw
    .replace(BIDI_OVERRIDES, "")
    .replace(/[\x00-\x1f\x7f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A description. Keeps newlines and tabs; drops everything else in C0/C1. */
function multiLine(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(BIDI_OVERRIDES, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\u009f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function parseBoolean(input: unknown, field: string, fallback: boolean): Parsed<boolean> {
  if (input === undefined) return { ok: true, value: fallback };
  // Deliberately not truthiness: `"false"` is truthy, and a client sending a
  // string here is a client with a bug worth surfacing.
  if (typeof input !== "boolean") return fail(field, "Expected true or false.");
  return { ok: true, value: input };
}

function parseInteger(
  input: unknown,
  field: string,
  min: number,
  max: number
): Parsed<number> {
  if (typeof input !== "number" || !Number.isInteger(input)) {
    return fail(field, "Expected a whole number.");
  }
  if (input < min || input > max) return fail(field, `Expected ${min}–${max}.`);
  return { ok: true, value: input };
}

/**
 * A price, in agorot.
 *
 * Strings are refused outright. `parseShekels()` exists for the one place a
 * human types a price — the manager's own input — and by the time a value
 * reaches an API route it is an integer or it is a mistake. Accepting
 * `"25.50"` here would put a float in the path of a till.
 */
function parseAgorot(input: unknown, field: string): Parsed<number> {
  return parseInteger(input, field, 0, MAX_AGOROT);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(input: unknown, field: string): Parsed<string> {
  if (typeof input !== "string" || !UUID_RE.test(input.trim())) {
    return fail(field, "Expected an id.");
  }
  return { ok: true, value: input.trim().toLowerCase() };
}

/** An ISO timestamp, or null for "no bound". */
function parseTimestamp(input: unknown, field: string): Parsed<string | null> {
  if (input === null || input === undefined || input === "") return { ok: true, value: null };
  if (typeof input !== "string" || input.length > 40) return fail(field, "Expected a date.");

  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) return fail(field, "Expected a date.");

  // Normalised, so two clients sending different valid spellings of the same
  // instant produce the same row.
  return { ok: true, value: new Date(parsed).toISOString() };
}

/* --------------------------------------------------------------------------
   Localized text
   -------------------------------------------------------------------------- */

export interface LocalizedColumns {
  he: string;
  en: string | null;
  ar: string | null;
}

export interface OptionalLocalizedColumns {
  he: string | null;
  en: string | null;
  ar: string | null;
}

function readTranslation(
  body: Record<string, unknown>,
  key: "en" | "ar",
  field: string,
  max: number,
  clean: (raw: string) => string
): Parsed<string | null> {
  const raw = body[key];
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return fail(`${field}.${key}`, "Expected text.");

  const value = clean(raw);
  if (value.length > max) return fail(`${field}.${key}`, `Longer than ${max} characters.`);
  // An empty translation is an absent translation, not an empty string that
  // would beat the Hebrew fallback in `localize()`.
  return { ok: true, value: value === "" ? null : value };
}

/** Hebrew required, the other two optional. The asymmetry is in `Localized`. */
function parseRequiredLocalized(
  input: unknown,
  field: string,
  max: number,
  mode: "line" | "block"
): Parsed<LocalizedColumns> {
  const body = asRecord(input);
  if (!body) return fail(field, "Expected a localized object.");

  const clean = mode === "line" ? oneLine : multiLine;

  if (typeof body.he !== "string") return fail(`${field}.he`, "Hebrew is required.");
  const he = clean(body.he);
  if (he === "") return fail(`${field}.he`, "Hebrew is required.");
  if (he.length > max) return fail(`${field}.he`, `Longer than ${max} characters.`);

  const en = readTranslation(body, "en", field, max, clean);
  if (!en.ok) return en;
  const ar = readTranslation(body, "ar", field, max, clean);
  if (!ar.ok) return ar;

  return { ok: true, value: { he, en: en.value, ar: ar.value } };
}

/** Every language optional — a product may ship with no description at all. */
function parseOptionalLocalized(
  input: unknown,
  field: string,
  max: number,
  mode: "line" | "block"
): Parsed<OptionalLocalizedColumns> {
  if (input === null || input === undefined) {
    return { ok: true, value: { he: null, en: null, ar: null } };
  }

  const body = asRecord(input);
  if (!body) return fail(field, "Expected a localized object.");

  const clean = mode === "line" ? oneLine : multiLine;

  let he: string | null = null;
  if (body.he !== undefined && body.he !== null) {
    if (typeof body.he !== "string") return fail(`${field}.he`, "Expected text.");
    he = clean(body.he);
    if (he.length > max) return fail(`${field}.he`, `Longer than ${max} characters.`);
    if (he === "") he = null;
  }

  const en = readTranslation(body, "en", field, max, clean);
  if (!en.ok) return en;
  const ar = readTranslation(body, "ar", field, max, clean);
  if (!ar.ok) return ar;

  return { ok: true, value: { he, en: en.value, ar: ar.value } };
}

/* --------------------------------------------------------------------------
   Categories
   -------------------------------------------------------------------------- */

export interface CategoryInsert {
  name_he: string;
  name_en: string | null;
  name_ar: string | null;
  icon: string;
  tint: string;
  visible: boolean;
}

export type CategoryUpdate = Partial<CategoryInsert>;

function parseIcon(input: unknown): Parsed<string> {
  if (input === undefined || input === null) return { ok: true, value: "Package" };
  // Closed set, not free text: the name is looked up in CATEGORY_ICONS and an
  // unknown one would silently render as the fallback box forever.
  if (typeof input !== "string" || !isIconName(input)) return fail("icon", "Unknown icon.");
  return { ok: true, value: input };
}

function parseTint(input: unknown): Parsed<string> {
  if (input === undefined || input === null) return { ok: true, value: "gray" };
  if (typeof input !== "string" || !isTintName(input)) return fail("tint", "Unknown tint.");
  return { ok: true, value: input };
}

export function parseCategoryCreate(input: unknown): Parsed<CategoryInsert> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const name = parseRequiredLocalized(body.name, "name", CATEGORY_NAME_MAX, "line");
  if (!name.ok) return name;

  const icon = parseIcon(body.icon);
  if (!icon.ok) return icon;

  const tint = parseTint(body.tint);
  if (!tint.ok) return tint;

  const visible = parseBoolean(body.visible, "visible", true);
  if (!visible.ok) return visible;

  return {
    ok: true,
    value: {
      name_he: name.value.he,
      name_en: name.value.en,
      name_ar: name.value.ar,
      icon: icon.value,
      tint: tint.value,
      visible: visible.value,
    },
  };
}

export function parseCategoryPatch(input: unknown): Parsed<CategoryUpdate> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const update: CategoryUpdate = {};

  if (has(body, "name")) {
    const name = parseRequiredLocalized(body.name, "name", CATEGORY_NAME_MAX, "line");
    if (!name.ok) return name;
    update.name_he = name.value.he;
    update.name_en = name.value.en;
    update.name_ar = name.value.ar;
  }

  if (has(body, "icon")) {
    const icon = parseIcon(body.icon);
    if (!icon.ok) return icon;
    update.icon = icon.value;
  }

  if (has(body, "tint")) {
    const tint = parseTint(body.tint);
    if (!tint.ok) return tint;
    update.tint = tint.value;
  }

  if (has(body, "visible")) {
    const visible = parseBoolean(body.visible, "visible", true);
    if (!visible.ok) return visible;
    update.visible = visible.value;
  }

  if (Object.keys(update).length === 0) return fail("body", "Nothing to update.");
  return { ok: true, value: update };
}

/* --------------------------------------------------------------------------
   Subclasses
   -------------------------------------------------------------------------- */

export interface SubclassInsert {
  category_id: string;
  name_he: string;
  name_en: string | null;
  name_ar: string | null;
  visible: boolean;
}

export type SubclassUpdate = Partial<Omit<SubclassInsert, "category_id">>;

export function parseSubclassCreate(input: unknown): Parsed<SubclassInsert> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const categoryId = parseUuid(body.categoryId, "categoryId");
  if (!categoryId.ok) return categoryId;

  const name = parseRequiredLocalized(body.name, "name", CATEGORY_NAME_MAX, "line");
  if (!name.ok) return name;

  const visible = parseBoolean(body.visible, "visible", true);
  if (!visible.ok) return visible;

  return {
    ok: true,
    value: {
      category_id: categoryId.value,
      name_he: name.value.he,
      name_en: name.value.en,
      name_ar: name.value.ar,
      visible: visible.value,
    },
  };
}

/**
 * A subclass cannot be moved between categories.
 *
 * Its slug is unique per category and its bundle deals hang off it by id, so a
 * move would silently carry "3 small keychains for ₪25" over to magnets. The
 * owner reorganises by creating the subclass in the right place and moving the
 * products, which is the same number of taps and cannot go wrong.
 */
export function parseSubclassPatch(input: unknown): Parsed<SubclassUpdate> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const update: SubclassUpdate = {};

  if (has(body, "name")) {
    const name = parseRequiredLocalized(body.name, "name", CATEGORY_NAME_MAX, "line");
    if (!name.ok) return name;
    update.name_he = name.value.he;
    update.name_en = name.value.en;
    update.name_ar = name.value.ar;
  }

  if (has(body, "visible")) {
    const visible = parseBoolean(body.visible, "visible", true);
    if (!visible.ok) return visible;
    update.visible = visible.value;
  }

  if (Object.keys(update).length === 0) return fail("body", "Nothing to update.");
  return { ok: true, value: update };
}

/* --------------------------------------------------------------------------
   Products
   -------------------------------------------------------------------------- */

export interface ProductInsert {
  category_id: string;
  subclass_id: string | null;
  name_he: string;
  name_en: string | null;
  name_ar: string | null;
  description_he: string | null;
  description_en: string | null;
  description_ar: string | null;
  price_agorot: number;
  available: boolean;
  stock: number | null;
}

export type ProductUpdate = Partial<ProductInsert>;

/** Which columns a `staff` account may touch. See `canEditStock` in types.ts. */
export const STAFF_WRITABLE_PRODUCT_COLUMNS: ReadonlySet<string> = new Set([
  "available",
  "stock",
]);

function parseStock(input: unknown): Parsed<number | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  return parseInteger(input, "stock", 0, MAX_STOCK);
}

export function parseProductCreate(input: unknown): Parsed<ProductInsert> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const categoryId = parseUuid(body.categoryId, "categoryId");
  if (!categoryId.ok) return categoryId;

  let subclassId: string | null = null;
  if (body.subclassId !== null && body.subclassId !== undefined) {
    const parsed = parseUuid(body.subclassId, "subclassId");
    if (!parsed.ok) return parsed;
    subclassId = parsed.value;
  }

  const name = parseRequiredLocalized(body.name, "name", PRODUCT_NAME_MAX, "line");
  if (!name.ok) return name;

  const description = parseOptionalLocalized(
    body.description,
    "description",
    DESCRIPTION_MAX,
    "block"
  );
  if (!description.ok) return description;

  const price = parseAgorot(body.priceAgorot, "priceAgorot");
  if (!price.ok) return price;

  const available = parseBoolean(body.available, "available", true);
  if (!available.ok) return available;

  const stock = parseStock(body.stock);
  if (!stock.ok) return stock;

  return {
    ok: true,
    value: {
      category_id: categoryId.value,
      subclass_id: subclassId,
      name_he: name.value.he,
      name_en: name.value.en,
      name_ar: name.value.ar,
      description_he: description.value.he,
      description_en: description.value.en,
      description_ar: description.value.ar,
      price_agorot: price.value,
      available: available.value,
      stock: stock.value,
    },
  };
}

export function parseProductPatch(input: unknown): Parsed<ProductUpdate> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const update: ProductUpdate = {};

  if (has(body, "categoryId")) {
    const categoryId = parseUuid(body.categoryId, "categoryId");
    if (!categoryId.ok) return categoryId;
    update.category_id = categoryId.value;
  }

  if (has(body, "subclassId")) {
    if (body.subclassId === null) {
      update.subclass_id = null;
    } else {
      const subclassId = parseUuid(body.subclassId, "subclassId");
      if (!subclassId.ok) return subclassId;
      update.subclass_id = subclassId.value;
    }
  }

  if (has(body, "name")) {
    const name = parseRequiredLocalized(body.name, "name", PRODUCT_NAME_MAX, "line");
    if (!name.ok) return name;
    update.name_he = name.value.he;
    update.name_en = name.value.en;
    update.name_ar = name.value.ar;
  }

  if (has(body, "description")) {
    const description = parseOptionalLocalized(
      body.description,
      "description",
      DESCRIPTION_MAX,
      "block"
    );
    if (!description.ok) return description;
    update.description_he = description.value.he;
    update.description_en = description.value.en;
    update.description_ar = description.value.ar;
  }

  if (has(body, "priceAgorot")) {
    const price = parseAgorot(body.priceAgorot, "priceAgorot");
    if (!price.ok) return price;
    update.price_agorot = price.value;
  }

  if (has(body, "available")) {
    const available = parseBoolean(body.available, "available", true);
    if (!available.ok) return available;
    update.available = available.value;
  }

  if (has(body, "stock")) {
    const stock = parseStock(body.stock);
    if (!stock.ok) return stock;
    update.stock = stock.value;
  }

  if (Object.keys(update).length === 0) return fail("body", "Nothing to update.");
  return { ok: true, value: update };
}

/* --------------------------------------------------------------------------
   Pricing rules
   -------------------------------------------------------------------------- */

export interface RuleInsert {
  scope: PricingScope;
  scope_id: string;
  min_qty: number;
  price_agorot: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  label_he: string | null;
  label_en: string | null;
  label_ar: string | null;
}

export type RuleUpdate = Partial<RuleInsert>;

/** The table each scope points at. A literal map, never an interpolation. */
export const SCOPE_TABLES: Record<PricingScope, "products" | "subclasses" | "categories"> = {
  product: "products",
  subclass: "subclasses",
  category: "categories",
};

function parseScope(input: unknown): Parsed<PricingScope> {
  if (typeof input !== "string" || !PRICING_SCOPES.includes(input as PricingScope)) {
    return fail("scope", "Expected product, subclass or category.");
  }
  return { ok: true, value: input as PricingScope };
}

/**
 * A bundle of one is just the base price.
 *
 * The database enforces this too. Checking here as well turns a 500 from a
 * constraint violation into a 400 naming the field, which is the difference
 * between the manager highlighting the quantity box and the manager shrugging.
 */
function parseMinQty(input: unknown): Parsed<number> {
  const parsed = parseInteger(input, "minQty", MIN_BUNDLE_QTY, MAX_BUNDLE_QTY);
  if (!parsed.ok) return fail("minQty", `Expected ${MIN_BUNDLE_QTY}–${MAX_BUNDLE_QTY}.`);
  return parsed;
}

function parseLabel(input: unknown): Parsed<OptionalLocalizedColumns> {
  if (input === null || input === undefined) {
    return { ok: true, value: { he: null, en: null, ar: null } };
  }
  const parsed = parseRequiredLocalized(input, "label", LABEL_MAX, "line");
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

function checkWindow(startsAt: string | null, endsAt: string | null): FieldError | null {
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    return { field: "endsAt", message: "The deal must end after it starts." };
  }
  return null;
}

export function parseRuleCreate(input: unknown): Parsed<RuleInsert> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const scope = parseScope(body.scope);
  if (!scope.ok) return scope;

  const scopeId = parseUuid(body.scopeId, "scopeId");
  if (!scopeId.ok) return scopeId;

  const minQty = parseMinQty(body.minQty);
  if (!minQty.ok) return minQty;

  const price = parseAgorot(body.priceAgorot, "priceAgorot");
  if (!price.ok) return price;

  const active = parseBoolean(body.active, "active", true);
  if (!active.ok) return active;

  const startsAt = parseTimestamp(body.startsAt, "startsAt");
  if (!startsAt.ok) return startsAt;

  const endsAt = parseTimestamp(body.endsAt, "endsAt");
  if (!endsAt.ok) return endsAt;

  const window = checkWindow(startsAt.value, endsAt.value);
  if (window) return { ok: false, error: window };

  const label = parseLabel(body.label);
  if (!label.ok) return label;

  return {
    ok: true,
    value: {
      scope: scope.value,
      scope_id: scopeId.value,
      min_qty: minQty.value,
      price_agorot: price.value,
      active: active.value,
      starts_at: startsAt.value,
      ends_at: endsAt.value,
      label_he: label.value.he,
      label_en: label.value.en,
      label_ar: label.value.ar,
    },
  };
}

/**
 * A rule's `scope` and `scopeId` are not patchable.
 *
 * Repointing a live deal at a different subclass is indistinguishable from
 * creating one, and doing it in place loses the audit trail of what the old
 * deal was. Everything about *how much* it charges is editable.
 */
export function parseRulePatch(input: unknown): Parsed<RuleUpdate> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const update: RuleUpdate = {};

  if (has(body, "minQty")) {
    const minQty = parseMinQty(body.minQty);
    if (!minQty.ok) return minQty;
    update.min_qty = minQty.value;
  }

  if (has(body, "priceAgorot")) {
    const price = parseAgorot(body.priceAgorot, "priceAgorot");
    if (!price.ok) return price;
    update.price_agorot = price.value;
  }

  if (has(body, "active")) {
    const active = parseBoolean(body.active, "active", true);
    if (!active.ok) return active;
    update.active = active.value;
  }

  if (has(body, "startsAt")) {
    const startsAt = parseTimestamp(body.startsAt, "startsAt");
    if (!startsAt.ok) return startsAt;
    update.starts_at = startsAt.value;
  }

  if (has(body, "endsAt")) {
    const endsAt = parseTimestamp(body.endsAt, "endsAt");
    if (!endsAt.ok) return endsAt;
    update.ends_at = endsAt.value;
  }

  if (has(body, "label")) {
    const label = parseLabel(body.label);
    if (!label.ok) return label;
    update.label_he = label.value.he;
    update.label_en = label.value.en;
    update.label_ar = label.value.ar;
  }

  if (Object.keys(update).length === 0) return fail("body", "Nothing to update.");
  return { ok: true, value: update };
}

/** Both ends of the window after a patch is merged onto the stored row. */
export function checkRuleWindow(
  startsAt: string | null,
  endsAt: string | null
): FieldError | null {
  return checkWindow(startsAt, endsAt);
}

/* --------------------------------------------------------------------------
   Shop settings

   An allowlist, keyed by the request field, carrying the `app_settings.key`
   it writes and the parser that guards it. A setting absent from this table
   cannot be written no matter what the body says — which is the point, since
   `app_settings` is a free-form key/value table and an unguarded write would
   let a client invent keys.
   -------------------------------------------------------------------------- */

export interface SettingWrite {
  key: string;
  value: unknown;
}

/**
 * The Bit link is opened with `window.open` from the cart, so it is one of the
 * few stored strings that becomes a navigation target. `https:` only — a
 * `javascript:` URL stored here would run in the customer's browser, and the
 * check has to be on the way *in* because by render time it is just a string.
 */
function parseBitLink(input: unknown): Parsed<string> {
  if (input === null || input === undefined) return { ok: true, value: "" };
  if (typeof input !== "string") return fail("bitPaymentLink", "Expected a link.");

  const value = input.trim();
  if (value === "") return { ok: true, value: "" };
  if (value.length > URL_MAX) return fail("bitPaymentLink", "That link is too long.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("bitPaymentLink", "Expected a full https:// link.");
  }
  if (url.protocol !== "https:") return fail("bitPaymentLink", "Expected an https:// link.");

  return { ok: true, value: url.toString() };
}

/** Digits only, international format: "972549109603". Built into a wa.me URL. */
function parseWhatsappPhone(input: unknown): Parsed<string> {
  if (typeof input !== "string") return fail("whatsappPhone", "Expected a phone number.");
  const digits = input.replace(/[\s+()-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    return fail("whatsappPhone", `Expected 8–${PHONE_MAX} digits, international format.`);
  }
  return { ok: true, value: digits };
}

export function parseSettingsPatch(input: unknown): Parsed<SettingWrite[]> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const writes: SettingWrite[] = [];

  if (has(body, "open")) {
    const open = parseBoolean(body.open, "open", true);
    if (!open.ok) return open;
    writes.push({ key: "shop_open", value: open.value });
  }

  if (has(body, "closedMessage")) {
    const message = parseRequiredLocalized(
      body.closedMessage,
      "closedMessage",
      DESCRIPTION_MAX,
      "block"
    );
    if (!message.ok) return message;
    writes.push({
      key: "closed_message",
      value: {
        he: message.value.he,
        ...(message.value.en ? { en: message.value.en } : {}),
        ...(message.value.ar ? { ar: message.value.ar } : {}),
      },
    });
  }

  if (has(body, "bitPaymentLink")) {
    const link = parseBitLink(body.bitPaymentLink);
    if (!link.ok) return link;
    writes.push({ key: "bit_payment_link", value: link.value });
  }

  if (has(body, "whatsappPhone")) {
    const phone = parseWhatsappPhone(body.whatsappPhone);
    if (!phone.ok) return phone;
    writes.push({ key: "whatsapp_phone", value: phone.value });
  }

  if (has(body, "announcement")) {
    if (body.announcement === null) {
      writes.push({ key: "announcement", value: null });
    } else {
      const announcement = parseRequiredLocalized(
        body.announcement,
        "announcement",
        LABEL_MAX * 4,
        "line"
      );
      if (!announcement.ok) return announcement;
      writes.push({
        key: "announcement",
        value: {
          he: announcement.value.he,
          ...(announcement.value.en ? { en: announcement.value.en } : {}),
          ...(announcement.value.ar ? { ar: announcement.value.ar } : {}),
        },
      });
    }
  }

  if (writes.length === 0) return fail("body", "No writable settings.");
  return { ok: true, value: writes };
}

/* --------------------------------------------------------------------------
   Staff
   -------------------------------------------------------------------------- */

export interface StaffInvite {
  email: string;
  role: OwnerRole;
}

/**
 * Deliberately stricter than RFC 5322.
 *
 * Every address here is a Google account someone will sign in with, and the
 * value is compared against `auth.jwt() ->> 'email'` — so the useful question
 * is not "could this exist" but "could this be the address in a Google token",
 * and that set has no quoted local parts or bracketed literals in it.
 */
const EMAIL_RE = /^[a-z0-9!#$&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$&'*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function parseEmail(input: unknown, field = "email"): Parsed<string> {
  if (typeof input !== "string") return fail(field, "Expected an email address.");

  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > EMAIL_MAX) {
    return fail(field, "Expected an email address.");
  }
  if (!EMAIL_RE.test(email)) return fail(field, "Expected an email address.");

  return { ok: true, value: email };
}

export function parseStaffCreate(input: unknown): Parsed<StaffInvite> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const email = parseEmail(body.email);
  if (!email.ok) return email;

  const role = body.role === undefined ? "staff" : body.role;
  if (role !== "owner" && role !== "staff") return fail("role", "Expected owner or staff.");

  return { ok: true, value: { email: email.value, role } };
}

/* --------------------------------------------------------------------------
   Reordering
   -------------------------------------------------------------------------- */

/**
 * The only three tables a reorder may touch, as a literal map.
 *
 * The client sends `"categories"`, and what reaches PostgREST is the value
 * side of this object — never the string it sent. There is no code path where
 * a request-supplied name becomes a table name.
 */
export const REORDER_TABLES = {
  categories: "categories",
  subclasses: "subclasses",
  products: "products",
} as const;

export type ReorderEntity = keyof typeof REORDER_TABLES;

export interface ReorderRequest {
  entity: ReorderEntity;
  ids: string[];
}

export function parseReorder(input: unknown): Parsed<ReorderRequest> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  if (typeof body.entity !== "string" || !(body.entity in REORDER_TABLES)) {
    return fail("entity", "Expected categories, subclasses or products.");
  }
  const entity = body.entity as ReorderEntity;

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return fail("ids", "Expected a list of ids.");
  }
  if (body.ids.length > MAX_REORDER_IDS) {
    return fail("ids", `Expected at most ${MAX_REORDER_IDS} ids.`);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of body.ids) {
    const id = parseUuid(raw, "ids");
    if (!id.ok) return id;
    // A repeated id would give two rows the same position and quietly lose
    // one of them from the order the owner just dragged.
    if (seen.has(id.value)) return fail("ids", "Duplicate id.");
    seen.add(id.value);
    ids.push(id.value);
  }

  return { ok: true, value: { entity, ids } };
}

/* --------------------------------------------------------------------------
   Uploaded images

   A declared `Content-Type` is request input. It decides nothing here: the
   leading bytes do, and the declared type only has to agree with them.
   -------------------------------------------------------------------------- */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const PRODUCT_PHOTO_BUCKET = "product-photos";

export interface SniffedImage {
  /** The real type, from the bytes. Used for the stored `Content-Type`. */
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  /** The extension the generated object key gets. */
  extension: "jpg" | "png" | "webp" | "avif";
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) return "";
    out += String.fromCharCode(byte);
  }
  return out;
}

function readU32(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) return 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * AVIF is an ISOBMFF file: `[size][ftyp][major brand][minor version][compatible
 * brands...]`. The major brand is often `mif1` on files a phone produces, with
 * `avif` further down the compatible list, so both are checked.
 */
function isAvif(bytes: Uint8Array): boolean {
  if (ascii(bytes, 4, 8) !== "ftyp") return false;

  const major = ascii(bytes, 8, 12);
  if (major === "avif" || major === "avis") return true;

  const boxEnd = Math.min(readU32(bytes, 0), bytes.length, 512);
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
    const brand = ascii(bytes, offset, offset + 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { contentType: "image/png", extension: "png" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  if (isAvif(bytes)) {
    return { contentType: "image/avif", extension: "avif" };
  }
  return null;
}

/**
 * Removes objects from the photo bucket, best effort.
 *
 * A row deleted with its object left behind costs a few kilobytes; a row
 * deleted only if the object delete succeeds leaves the owner unable to remove
 * a photo because of a storage hiccup. The cheap failure is the right one.
 */
export async function removeStoredObjects(db: Db, paths: string[]): Promise<void> {
  // `/products/...` paths are files in `public/`, seeded from the old static
  // site. They are not in the bucket and must not be handed to it.
  const keys = paths.filter((path) => !path.startsWith("/") && !path.startsWith("http"));
  if (keys.length === 0) return;

  const { error } = await db.storage.from(PRODUCT_PHOTO_BUCKET).remove(keys);
  if (error) console.error("[storage] object(s) left orphaned:", error.message);
}

/* --------------------------------------------------------------------------
   Slugs

   Generated here, never accepted from a client. A client-chosen slug is a
   client-chosen URL, and the collision handling below is the sort of thing
   that gets skipped when it is somebody else's field.
   -------------------------------------------------------------------------- */

const SLUG_TABLES = {
  categories: "categories",
  subclasses: "subclasses",
  products: "products",
} as const;

export type SlugTable = keyof typeof SLUG_TABLES;

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6);
}

/**
 * `"Clicker Keychains"` → `"clicker-keychains"`.
 *
 * Returns an empty string for a name with no Latin letters in it at all —
 * which is the *normal* case here, since the owner writes Hebrew. Callers must
 * treat the empty result as "generate one", not as a slug.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    // Strip combining marks so "café" becomes "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_BASE_MAX)
    .replace(/^-+|-+$/g, "");
}

/**
 * A slug that is free, in the scope it has to be free in.
 *
 * Categories and products are unique globally; subclasses only within their
 * category, because "small" is a reasonable subclass of both keychains and
 * magnets. The `-2`, `-3` walk is bounded — past that a random suffix ends it,
 * since at twenty collisions the owner has a naming problem rather than a
 * slug problem.
 */
export async function uniqueSlug(
  db: Db,
  table: SlugTable,
  nameHe: string,
  scope?: { column: "category_id"; value: string }
): Promise<string> {
  const base = slugify(nameHe) || `item-${randomSuffix()}`;

  let query = db.from(SLUG_TABLES[table]).select("slug").like("slug", `${base}%`);
  if (scope) query = query.eq(scope.column, scope.value);

  const { data, error } = await query;
  // A failed lookup must not block the write: a suffixed slug cannot collide,
  // so fall through to one rather than refusing to create the row.
  if (error) return `${base}-${randomSuffix()}`;

  const taken = new Set((data ?? []).map((row) => (row as { slug: string }).slug));
  if (!taken.has(base)) return base;

  for (let n = 2; n <= 20; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${base}-${randomSuffix()}`;
}

/* --------------------------------------------------------------------------
   Ordering
   -------------------------------------------------------------------------- */

const ORDERABLE_TABLES = {
  categories: "categories",
  subclasses: "subclasses",
  products: "products",
  product_images: "product_images",
} as const;

export type OrderableTable = keyof typeof ORDERABLE_TABLES;

/** Appends: the new row lands after everything already in its scope. */
export async function nextSortOrder(
  db: Db,
  table: OrderableTable,
  scope?: { column: "category_id" | "product_id"; value: string }
): Promise<number> {
  let query = db
    .from(ORDERABLE_TABLES[table])
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);

  if (scope) query = query.eq(scope.column, scope.value);

  const { data, error } = await query;
  if (error || !data || data.length === 0) return 0;

  const highest = (data[0] as { sort_order: number } | undefined)?.sort_order ?? -1;
  return highest + 1;
}

/* --------------------------------------------------------------------------
   Responses

   Every route answers in one of these shapes. A Postgres message never
   reaches the client: it names tables, columns and constraints, and the person
   who most wants to read one is not the owner.
   -------------------------------------------------------------------------- */

export function invalid(error: FieldError): NextResponse {
  return NextResponse.json(
    { error: "invalid_field", field: error.field, message: error.message },
    { status: 400 }
  );
}

export function notFound(entity: string): NextResponse {
  return NextResponse.json({ error: "not_found", entity }, { status: 404 });
}

export function conflict(code: string, message: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status: 409 });
}

export function rateLimited(): NextResponse {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}

interface DbError {
  code?: string | null;
  message: string;
  details?: string | null;
}

/**
 * Logs the real failure, answers with a shape the manager can act on.
 *
 * The three mapped codes are the ones that mean "the request was wrong", not
 * "the server broke", and they are worth distinguishing: a duplicate deal rung
 * and a category that still has products in it both need a message, not a
 * retry.
 */
export function dbFailed(scope: string, error: DbError): NextResponse {
  console.error(`[${scope}] ${error.code ?? "?"}: ${error.message}`, error.details ?? "");

  switch (error.code) {
    case "23505":
      return conflict("duplicate", "That already exists.");
    case "23503":
      return conflict("in_use", "Something still refers to this.");
    case "23514":
    case "23502":
      return NextResponse.json({ error: "invalid_field", field: "body" }, { status: 400 });
    default:
      return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }
}

/* --------------------------------------------------------------------------
   Rate limiting
   -------------------------------------------------------------------------- */

/**
 * Postgres-backed, so the limit is real across Vercel instances.
 *
 * Fails **open**: if the limiter itself errors, the write proceeds and the
 * problem is logged. These endpoints are already behind an owner check, so the
 * limiter is there to bound a runaway client, not to hold a door shut — and a
 * broken limiter must not stop the owner pricing a keychain at the counter.
 */
export async function withinRateLimit(
  db: Db,
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  const { data, error } = await db.rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("[rate-limit] check failed, allowing:", error.message);
    return true;
  }

  return data !== false;
}
