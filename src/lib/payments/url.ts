/* ==========================================================================
   Provider URLs, before they reach an <iframe src>

   A payment session URL arrives in an HTTP response from a third party and
   then becomes a live frame inside our page. That makes it the single most
   dangerous string in the checkout: an attacker who can influence it — a
   compromised provider account, a man in the middle without HTTPS, a
   copy-paste of the wrong sandbox host into an env var — gets a document
   rendered inside our origin's chrome, next to our padlock, asking for a
   card number.

   Three checks, and none of them is redundant:

   - **https only.** `javascript:` and `data:` in a frame src both execute.
   - **An explicit origin allowlist**, from `paymentFrameOrigins()`.
   - **The same list is the CSP `frame-src`.** Code and policy read one
     source, so they cannot disagree — a URL this function accepts that the
     CSP then blocks is a blank frame at a counter, and the reverse is a hole.

   Pure and free of `server-only` so the check can also run on the client, but
   the load-bearing call is the server-side one in the checkout route: the
   client is told a URL it is allowed to render, never asked to work it out.
   ========================================================================== */

/**
 * Returns the URL unchanged when it is safe to frame, or null.
 *
 * Null rather than a throw: the caller's correct response is to fail the
 * session and offer the counter, not to 500 at a customer.
 */
export function safeFrameUrl(raw: unknown, allowedOrigins: readonly string[]): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (allowedOrigins.length === 0) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  /* Credentials in a URL (`https://user:pass@host/`) are both a phishing
     primitive and a way to make a host look like something it is not. No
     legitimate payment page uses them. */
  if (url.username !== "" || url.password !== "") return null;

  // Exact origin match. Not `endsWith` — "evil-grow.co.il" ends with a
  // suffix of the real host, and that is the whole trick.
  if (!allowedOrigins.includes(url.origin)) return null;

  return url.toString();
}
