/* ==========================================================================
   Request-parsing primitives

   The small pieces every parser in the codebase is built from — the shape a
   validation result takes, and the two text sanitisers.

   Extracted out of `validate.ts` for two reasons, and the second is the real
   one:

   1. There are now **two** parsing surfaces with different threat models —
      `lib/validate.ts` for a signed-in owner, `lib/payments/validate.ts` for a
      total stranger — and the sanitisers must be identical in both. Copying
      them would be copying a security control, which is how one copy quietly
      stops matching the other.

   2. This module carries no `server-only` marker and no framework import, so
      it can be unit-tested directly. `oneLine` strips bidi overrides; that is
      a rule worth a test rather than a comment, and it was untestable while
      it lived behind `next/server`.

   `validate.ts` re-exports everything here, so no call site changed.
   ========================================================================== */

export interface FieldError {
  /** The client-facing field name, so the manager can focus the input. */
  field: string;
  /** Developer-facing English. The UI renders a translated string keyed off
      the error code, never this. */
  message: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: FieldError };

export function fail(field: string, message: string): { ok: false; error: FieldError } {
  return { ok: false, error: { field, message } };
}

export function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

/** Own properties only — a PATCH distinguishes "absent" from "set to null". */
export function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * A single line of human text.
 *
 * Control characters are collapsed rather than rejected: they arrive from
 * phone keyboards and paste buffers far more often than from an attacker, and
 * silently cleaning them is kinder than refusing a product name. Note that
 * bidi *overrides* (U+202A to U+202E, U+2066 to U+2069) are stripped too — a
 * name carrying one reorders every price and count rendered beside it, which
 * on an order screen means the owner reads the wrong number off their own
 * till.
 */
const BIDI_OVERRIDES = /[\u202a-\u202e\u2066-\u2069]/g;

export function oneLine(raw: string): string {
  return raw
    .replace(BIDI_OVERRIDES, "")
    .replace(/[\x00-\x1f\x7f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A description. Keeps newlines and tabs; drops everything else in C0/C1. */
export function multiLine(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(BIDI_OVERRIDES, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\u009f]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(input: unknown, field: string): Parsed<string> {
  if (typeof input !== "string" || !UUID_RE.test(input.trim())) {
    return fail(field, "Expected an id.");
  }
  return { ok: true, value: input.trim().toLowerCase() };
}
