import { asRecord, fail, multiLine, oneLine, parseUuid, type Parsed } from "../parse";
import { LOCALES, type CartLine, type Locale } from "../types";
import { PAYMENT_METHODS, type CheckoutRequest, type PaymentMethod } from "./types";

/* ==========================================================================
   Parsing a checkout request

   This is the codebase's **first and only unauthenticated write endpoint**,
   and that changes the reasoning rather than just the limits. Everything in
   `lib/validate.ts` is written for a request from a signed-in owner; this is
   written for a request from a total stranger with no session, no prior
   contact and no reason to be honest. PLAYBOOK §4.

   It lives in its own file for that reason and not for size. Two threat
   models in one file is how the wrong set of assumptions gets applied to the
   wrong endpoint six months from now.

   ## The rule that does the work

   **This function BUILDS the object; it does not check the caller's.**
   Nothing is spread, nothing is copied by iteration, and a property the
   parser does not name cannot survive — so `status`, `total`, `paid`,
   `orderNumber` or an invented `isPaid` ride along into nothing. That is one
   line of discipline and it removes the whole class. PLAYBOOK §4.1.6.

   ## What is deliberately not accepted

   No prices, no totals, no product names, no order id, no provider fields.
   The client sends picks and contact details; the server prices them from
   the live catalogue. A total arriving from a browser is a claim.

   The sanitisers (`oneLine`, `multiLine`) come from `lib/parse.ts`, shared
   with the manager's parsers rather than reimplemented: they strip bidi
   overrides, which matters more here than anywhere else in the app. A
   customer name carrying U+202E reorders every price rendered beside it on
   the owner's order screen.

   No `server-only` marker, deliberately: nothing here touches a request, a
   cookie or the database, and dropping it is what lets this parser be
   unit-tested directly. The endpoint that calls it is server-side; this file
   is arithmetic over a JSON body.
   ========================================================================== */

const MAX_DISTINCT_LINES = 40;
const MAX_UNITS_PER_LINE = 99;
/** A whole cart's worth. `priceCart` expands units one array entry each. */
const MAX_TOTAL_UNITS = 200;

const NAME_MAX = 60;
const NOTE_MAX = 280;
const PHONE_MIN_DIGITS = 8;
const PHONE_MAX_DIGITS = 15;

/**
 * The honeypot field's name.
 *
 * Plausible enough that a form-filling bot reaches for it, and meaningless to
 * this site — there is no company on a keychain order. A filled honeypot is
 * answered with a cheerful 200 and nothing is written: a bot that learns
 * which field gave it away simply stops filling that one in. PLAYBOOK §4.1.4.
 *
 * The field it corresponds to in the UI must never be the first or last
 * focusable element inside the checkout, or a modal's focus trap will wrap
 * onto it and a keyboard user will type into the field whose entire purpose
 * is to make the server discard their order. PLAYBOOK §2.4.
 */
export const HONEYPOT_FIELD = "company";

export function honeypotFilled(input: unknown): boolean {
  const body = asRecord(input);
  if (!body) return false;
  const value = body[HONEYPOT_FIELD];
  return typeof value === "string" && value.trim() !== "";
}

/* --------------------------------------------------------------------------
   Pieces
   -------------------------------------------------------------------------- */

function parseLines(input: unknown): Parsed<CartLine[]> {
  if (!Array.isArray(input) || input.length === 0) {
    return fail("lines", "Expected at least one item.");
  }
  if (input.length > MAX_DISTINCT_LINES) {
    return fail("lines", `Expected at most ${MAX_DISTINCT_LINES} distinct items.`);
  }

  const lines: CartLine[] = [];
  const seen = new Set<string>();
  let units = 0;

  for (const entry of input) {
    const row = asRecord(entry);
    if (!row) return fail("lines", "Expected an item.");

    const productId = parseUuid(row.productId, "lines");
    if (!productId.ok) return productId;

    /* A repeated product id would be summed by the pricing engine anyway, but
       accepting it here means the order's own line list disagrees with what
       was charged — and the receipt is built from the line list. */
    if (seen.has(productId.value)) return fail("lines", "Duplicate item.");
    seen.add(productId.value);

    const quantity = row.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity)) {
      return fail("lines", "Expected a whole quantity.");
    }
    if (quantity < 1 || quantity > MAX_UNITS_PER_LINE) {
      return fail("lines", `Expected 1–${MAX_UNITS_PER_LINE}.`);
    }

    units += quantity;
    if (units > MAX_TOTAL_UNITS) return fail("lines", "That is too many items.");

    lines.push({ productId: productId.value, quantity });
  }

  return { ok: true, value: lines };
}

function parseMethod(input: unknown): Parsed<PaymentMethod> {
  if (typeof input !== "string" || !(PAYMENT_METHODS as readonly string[]).includes(input)) {
    return fail("paymentMethod", "Expected counter or card.");
  }
  return { ok: true, value: input as PaymentMethod };
}

function parseLocale(input: unknown): Parsed<Locale> {
  // Not an error when absent: the locale decides which language a receipt
  // renders in, and Hebrew — the shop's primary language — is the right
  // default for a request that did not say.
  if (input === undefined || input === null) return { ok: true, value: "he" };
  if (typeof input !== "string" || !(LOCALES as readonly string[]).includes(input)) {
    return fail("locale", "Expected he, en or ar.");
  }
  return { ok: true, value: input as Locale };
}

function parseName(input: unknown): Parsed<string | null> {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") return fail("customerName", "Expected a name.");

  const name = oneLine(input);
  if (name === "") return { ok: true, value: null };
  if (name.length > NAME_MAX) return fail("customerName", `Expected at most ${NAME_MAX} characters.`);

  return { ok: true, value: name };
}

/**
 * A phone number, reduced to digits.
 *
 * Optional, and it stays optional: the only thing it buys is being able to
 * call somebody who wandered off, and requiring it to buy a ₪25 keychain
 * would be collecting personal data to solve a problem shouting the order
 * number already solves.
 *
 * Stored as digits with no separators so two spellings of the same number are
 * one value — and so the retention job that clears it later has one shape to
 * clear.
 */
function parsePhone(input: unknown): Parsed<string | null> {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") return fail("customerPhone", "Expected a phone number.");

  const raw = input.trim();
  if (raw === "") return { ok: true, value: null };

  const digits = raw.replace(/[\s+()\-.]/g, "");
  if (!new RegExp(`^\\d{${PHONE_MIN_DIGITS},${PHONE_MAX_DIGITS}}$`).test(digits)) {
    return fail("customerPhone", "Expected 8–15 digits.");
  }

  return { ok: true, value: digits };
}

function parseNote(input: unknown): Parsed<string | null> {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") return fail("note", "Expected a note.");

  const note = multiLine(input);
  if (note === "") return { ok: true, value: null };
  if (note.length > NOTE_MAX) return fail("note", `Expected at most ${NOTE_MAX} characters.`);

  return { ok: true, value: note };
}

/* --------------------------------------------------------------------------
   The parser
   -------------------------------------------------------------------------- */

export function parseCheckoutRequest(input: unknown): Parsed<CheckoutRequest> {
  const body = asRecord(input);
  if (!body) return fail("body", "Expected an object.");

  const lines = parseLines(body.lines);
  if (!lines.ok) return lines;

  const paymentMethod = parseMethod(body.paymentMethod);
  if (!paymentMethod.ok) return paymentMethod;

  const locale = parseLocale(body.locale);
  if (!locale.ok) return locale;

  const customerName = parseName(body.customerName);
  if (!customerName.ok) return customerName;

  const customerPhone = parsePhone(body.customerPhone);
  if (!customerPhone.ok) return customerPhone;

  const note = parseNote(body.note);
  if (!note.ok) return note;

  /* Required, not optional. It is what makes a retry over a dropped tether
     the same order rather than a second one, and a client that omits it is a
     client that will double-order the first time a market stand's signal
     wobbles — so it is refused rather than generated here. Generating it
     server-side would defeat the purpose entirely: every retry would get a
     fresh one. */
  const clientRequestId = parseUuid(body.clientRequestId, "clientRequestId");
  if (!clientRequestId.ok) return clientRequestId;

  return {
    ok: true,
    value: {
      lines: lines.value,
      paymentMethod: paymentMethod.value,
      customerName: customerName.value,
      customerPhone: customerPhone.value,
      note: note.value,
      locale: locale.value,
      clientRequestId: clientRequestId.value,
    },
  };
}
