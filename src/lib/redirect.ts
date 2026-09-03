/**
 * Where it is safe to send someone after signing in.
 *
 * The `next` parameter travels from `/login` through Google and back into
 * `/auth/callback`, so it is attacker-controllable end to end: anyone can send
 * the owner a link with any `next` they like. Without this check that link
 * bounces off the real domain — correct padlock, correct hostname — straight
 * onto a page of the attacker's choosing, which is the whole trick behind an
 * open redirect.
 *
 * Only a single-slash absolute path on this site is allowed. The cases that
 * matter and are all rejected here:
 *
 *   "//evil.com"      protocol-relative — a browser reads this as a host
 *   "/\\evil.com"     backslash; some parsers normalise it to "//"
 *   "https://evil"    absolute URL
 *   "javascript:..."  scheme, no host
 *
 * Anything unrecognised falls back to the manager rather than erroring: a
 * malformed `next` is not worth a dead end when the destination it was
 * pointing at is almost always where the person was going anyway.
 */
const FALLBACK = "/manager";

export function safeNext(raw: string | null | undefined): string {
  if (!raw) return FALLBACK;

  // Must be an absolute path on this origin, and exactly one leading slash.
  if (!raw.startsWith("/")) return FALLBACK;
  if (raw.startsWith("//")) return FALLBACK;
  if (raw.startsWith("/\\")) return FALLBACK;

  // A control character or whitespace can be used to smuggle past a naive
  // check further down the stack; there is no legitimate path containing one.
  if (/[\u0000-\u001f\u007f-\u009f\s]/.test(raw)) return FALLBACK;

  return raw;
}
