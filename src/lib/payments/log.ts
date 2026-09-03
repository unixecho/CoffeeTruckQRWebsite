import "server-only";

/* ==========================================================================
   Logging around money

   Two jobs, and the second is the one that matters.

   1. Give every payment log line the same prefix and the same shape, so
      `[payments]` in a Vercel log is one grep away from the whole story of an
      order.

   2. **Never write a secret or a card number into a log.** Provider payloads
      arrive as free-form JSON and land in two places that outlive the
      request — Vercel's log drain and the `payment_events` table — and both
      are read at leisure, weeks later, by whoever has access. A pan or a CVV
      that reaches either is a PCI problem we deliberately do not have: the
      card fields live inside the provider's own iframe, on the provider's own
      origin, and the only way one could reach us is a provider echoing it
      back in a callback. That is exactly the case this file exists for.

   The redactor is allowlist-shaped where it can be and denylist-shaped where
   it cannot. A denylist alone would be a promise nobody can keep — but the
   payloads are third-party and their key names are not ours to fix, so the
   honest answer is: strip the keys known to be dangerous, truncate anything
   that looks like a long digit run, and cap the whole thing.
   ========================================================================== */

/**
 * Key names that must never be stored, matched case-insensitively as
 * substrings.
 *
 * Substring rather than exact match because providers vary the spelling
 * (`cardNumber`, `card_number`, `CardNum`) and a miss here is silent.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  "card",
  "pan",
  "cvv",
  "cvc",
  "securitycode",
  "security_code",
  "expiry",
  "expdate",
  "exp_date",
  "apikey",
  "api_key",
  "secret",
  "password",
  "authorization",
  "token", // process tokens included: they are bearer credentials
  "signature",
  "idnumber", // Israeli ID; providers collect it and we have no use for it
  "id_number",
  "teudat",
];

/** Anything that looks like a 12–19 digit run, wherever it appears. */
const LONG_DIGIT_RUN = /\b\d[\d \-]{10,22}\d\b/g;

const MAX_STRING = 512;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;

function scrubString(value: string): string {
  const capped = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  return capped.replace(LONG_DIGIT_RUN, "[redacted-digits]");
}

function isForbidden(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * A provider payload, safe to persist and safe to log.
 *
 * Returns a **new** structure; the input is never mutated, because the caller
 * still needs the real payload to act on. Cycles are impossible here (the
 * input is always freshly parsed JSON) but depth is bounded anyway — a
 * hostile body can nest as far as it likes and the recursion is ours.
 */
export function redactPayload(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[redacted-depth]";

  if (input === null || input === undefined) return input;
  if (typeof input === "string") return scrubString(input);
  if (typeof input === "number" || typeof input === "boolean") return input;

  if (Array.isArray(input)) {
    const kept = input.slice(0, MAX_ARRAY).map((entry) => redactPayload(entry, depth + 1));
    if (input.length > MAX_ARRAY) kept.push(`[${input.length - MAX_ARRAY} more]`);
    return kept;
  }

  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isForbidden(key) ? "[redacted]" : redactPayload(value, depth + 1);
    }
    return out;
  }

  // Functions, symbols, bigints — nothing legitimate arrives here.
  return "[redacted-type]";
}

/* --------------------------------------------------------------------------
   The log lines themselves
   -------------------------------------------------------------------------- */

type Level = "info" | "warn" | "error";

/**
 * Structured, single-line, and never interpolated from a payload.
 *
 * The fields are ours: an order id, a status, an error code. A provider
 * message is passed through `scrubString` first and truncated, because a log
 * line is a place a value ends up quoted somewhere else later.
 */
export function paymentLog(
  level: Level,
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {}
): void {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === "string" ? scrubString(value) : value}`);

  const line = `[payments] ${event}${parts.length ? ` ${parts.join(" ")}` : ""}`;

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
