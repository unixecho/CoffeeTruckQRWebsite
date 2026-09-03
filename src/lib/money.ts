import type { Agorot, Locale } from "./types";

/* ==========================================================================
   Money

   Everything is agorot — integer hundredths of a shekel. ₪25.50 is 2550.

   Floats are not used anywhere near a price. A bundle price divided across
   lines, or a percentage taken off, accumulates error the moment it happens,
   and a till that is off by an agora is a till nobody trusts. The conversion
   to a human-readable string happens once, here, at the very edge.
   ========================================================================== */

/** ₪ per agora. Named so the arithmetic below reads as intent, not magic. */
const AGOROT_PER_SHEKEL = 100;

/**
 * Format for display: `2550` → `₪25.50`, `2500` → `₪25`.
 *
 * Whole shekels drop the decimals because that is how prices are written on a
 * board at a stand — "₪25.00" reads as a receipt, not a price tag. Anything
 * with agorot keeps both digits.
 *
 * The number is always emitted LTR regardless of the surrounding language:
 * `Intl` with a Hebrew locale would otherwise place the ₪ per Hebrew
 * convention and the bidi algorithm can then reorder a price sitting inside a
 * sentence. A price is a number and must read identically in all three
 * languages. Callers rendering this inside RTL text should still wrap it in
 * `.ltr-nums` when it sits adjacent to other digits.
 */
export function formatAgorot(agorot: Agorot): string {
  const negative = agorot < 0;
  const absolute = Math.abs(Math.round(agorot));
  const shekels = Math.floor(absolute / AGOROT_PER_SHEKEL);
  const remainder = absolute % AGOROT_PER_SHEKEL;

  const body =
    remainder === 0
      ? `₪${shekels}`
      : `₪${shekels}.${String(remainder).padStart(2, "0")}`;

  return negative ? `-${body}` : body;
}

/**
 * Parse what the owner typed into the manager's price field.
 *
 * Accepts `25`, `25.5`, `25.50`, `₪25`, and — because a phone keyboard set to
 * Hebrew offers it and people do use it — a comma decimal separator. Returns
 * `null` for anything it cannot read, so the caller shows a field error rather
 * than silently storing a price of zero.
 */
export function parseShekels(input: string): Agorot | null {
  const cleaned = input.trim().replace(/[₪\s]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;

  // Round rather than truncate: `Number("25.10") * 100` is 2509.9999… in
  // binary floating point, and truncating that loses an agora.
  return Math.round(value * AGOROT_PER_SHEKEL);
}

/** `2550` → `"25.50"`, for pre-filling an edit field. Never carries the ₪. */
export function agorotToInput(agorot: Agorot): string {
  const shekels = Math.floor(agorot / AGOROT_PER_SHEKEL);
  const remainder = agorot % AGOROT_PER_SHEKEL;
  return remainder === 0 ? String(shekels) : `${shekels}.${String(remainder).padStart(2, "0")}`;
}

/**
 * The bundle ladder as one line: `1 · ₪10 / 3 · ₪25 / 5 · ₪35`.
 *
 * Built with a plain `/` separator in every language. The whole string is
 * digits and currency, so it is rendered inside `.ltr-nums` — see the note in
 * `globals.css` about what the bidi algorithm does to `3 / 5` in Hebrew.
 */
export function formatLadder(
  ladder: { qty: number; priceAgorot: Agorot }[],
  _locale: Locale
): string {
  return ladder.map((rung) => `${rung.qty} · ${formatAgorot(rung.priceAgorot)}`).join("  /  ");
}
