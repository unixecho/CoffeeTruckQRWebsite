import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { checkOrigin, readJson } from "./auth";
import { createServiceClient, isSupabaseConfigured } from "./supabase/server";
import { rateLimited, withinRateLimit } from "./validate";
import { paymentLog } from "./payments/log";

/* ==========================================================================
   Opening a PUBLIC write endpoint

   The counterpart to `lib/route.ts`, and deliberately a separate file rather
   than an option on it. `openWrite()` is written for a request from a
   signed-in owner; everything here is written for a request from a total
   stranger with no session, no signed token and no prior contact. Two threat
   models sharing one function is how the wrong set of assumptions gets
   applied to the wrong endpoint.

   The design mistake to avoid is reaching for a guard that is not there. We
   cannot authenticate the caller — that is the point of a checkout. So the
   containment is a stack of cheap, independent rails, each worthless alone.
   PLAYBOOK §4.1, in execution order:

     1. **Same-origin.** A *missing* `Origin` is allowed (it means same-origin
        or a non-browser client); a present-but-foreign one is refused.
     2. **`Content-Type: application/json` required.** This is the rail that
        actually closes cross-site form posts, because an HTML form can only
        ever send `text/plain`, urlencoded or multipart. No token, no cookie,
        no state.
     3. **A body ceiling read from `content-length`, before the body is read.**
     4. **Rate limiting, per-IP *and* global.** Per-IP alone does nothing
        against a proxy pool: an unauthenticated write path with no ceiling is
        bounded only by how many addresses somebody can rent.

   ## The trade-off in rail 4, written down deliberately

   While the **global** window is saturated, honest customers are refused too.
   That is acceptable here and it is a real decision, not an inherited one: an
   order can be placed again thirty seconds later, or simply spoken to the
   person behind the counter, which is what happened before this site existed.
   The global ceiling is set roughly a hundred times above any plausible peak
   for one coffee truck, so reaching it means something is actually wrong.

   ## The IP is hashed, not stored

   The limiter needs to tell callers apart; it does not need to know who they
   are. Keys are a truncated SHA-256 rather than the address itself, so the
   `rate_limits` table — which any owner can read — never holds a list of who
   visited. The row ages out in a day either way. PLAYBOOK §4.2.
   ========================================================================== */

/** Per address. Generous: a family sharing a tether is one address. */
const PER_IP_MAX = 12;
const PER_IP_WINDOW_SECONDS = 60;

/** Across everyone. ~100× a busy hour at one truck. See the trade-off above. */
const GLOBAL_MAX = 240;
const GLOBAL_WINDOW_SECONDS = 60;

/** Small: a checkout body is a handful of cart lines and a name. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Namespacing salt for the hashed limiter key.
 *
 * Not a secret and not pretending to be one — the address space is small
 * enough that a determined reader could brute-force a hash back. Its job is
 * to stop the table reading as a plain list of visitors, and to keep the
 * checkout's keys from colliding with any other limiter added later.
 */
const KEY_SALT = "coffeetruck/public";

/**
 * The caller's address, as far as the platform will say.
 *
 * `x-forwarded-for` is a client-settable header everywhere except behind a
 * proxy that overwrites it — which Vercel does, taking the leftmost entry as
 * the real client. Behind anything else this is a hint, not a fact, which is
 * exactly why the global limit exists alongside the per-IP one.
 */
function callerKey(request: Request): string {
  const forwarded =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "";

  const digest = createHash("sha256").update(`${KEY_SALT}:${forwarded}`, "utf8").digest("hex");
  return digest.slice(0, 32);
}

export type PublicOpened<T> =
  | { ok: true; body: T; db: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse };

export interface PublicOpenOptions {
  /** Overrides for endpoints with a different shape of traffic. */
  perIpMax?: number;
  globalMax?: number;
  maxBytes?: number;
  /** Distinguishes one endpoint's limiter buckets from another's. */
  bucket: string;
}

/**
 * Runs the rails and hands back a parsed body plus the service client.
 *
 * The service client is returned rather than created by the caller for the
 * same reason `requireOwner()` does it: pairing the client with the guard
 * means there is no way to reach the database on the refusal branch, because
 * on that branch the client does not exist.
 *
 * Note what is *not* here: no identity. Anything the route wants to attribute
 * has to come from the caller's own session, resolved separately, and has to
 * fail softly — the order is the point, the attribution is a bonus.
 */
export async function openPublicWrite<T>(
  request: Request,
  options: PublicOpenOptions
): Promise<PublicOpened<T>> {
  const badOrigin = checkOrigin(request);
  if (badOrigin) return { ok: false, response: badOrigin };

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "checkout_disabled" }, { status: 503 }),
    };
  }

  const parsed = await readJson<T>(request, options.maxBytes ?? MAX_BODY_BYTES);
  if (!parsed.ok) return { ok: false, response: parsed.response };

  const db = createServiceClient();
  const key = callerKey(request);

  const withinIp = await withinRateLimit(
    db,
    `${options.bucket}:ip:${key}`,
    options.perIpMax ?? PER_IP_MAX,
    PER_IP_WINDOW_SECONDS
  );
  if (!withinIp) {
    paymentLog("warn", "public.rateLimited", { bucket: options.bucket, scope: "ip" });
    return { ok: false, response: rateLimited() };
  }

  const withinGlobal = await withinRateLimit(
    db,
    `${options.bucket}:global`,
    options.globalMax ?? GLOBAL_MAX,
    GLOBAL_WINDOW_SECONDS
  );
  if (!withinGlobal) {
    paymentLog("error", "public.rateLimited", { bucket: options.bucket, scope: "global" });
    return { ok: false, response: rateLimited() };
  }

  return { ok: true, body: parsed.body, db };
}

/**
 * The same rails for a request with no body — a cancel, a status read.
 *
 * The JSON content-type rail is not available here (there is no body to type),
 * so the origin check and the limiter carry it alone. That is acceptable
 * because these endpoints are addressed by an unguessable token: a cross-site
 * form post cannot reach one without already holding the credential, and
 * anything holding the credential is the customer.
 */
export async function openPublicAction(
  request: Request,
  options: PublicOpenOptions
): Promise<{ ok: true; db: ReturnType<typeof createServiceClient> } | { ok: false; response: NextResponse }> {
  const badOrigin = checkOrigin(request);
  if (badOrigin) return { ok: false, response: badOrigin };

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "checkout_disabled" }, { status: 503 }),
    };
  }

  const db = createServiceClient();
  const key = callerKey(request);

  const withinIp = await withinRateLimit(
    db,
    `${options.bucket}:ip:${key}`,
    options.perIpMax ?? PER_IP_MAX * 4,
    PER_IP_WINDOW_SECONDS
  );
  if (!withinIp) return { ok: false, response: rateLimited() };

  const withinGlobal = await withinRateLimit(
    db,
    `${options.bucket}:global`,
    options.globalMax ?? GLOBAL_MAX * 4,
    GLOBAL_WINDOW_SECONDS
  );
  if (!withinGlobal) return { ok: false, response: rateLimited() };

  return { ok: true, db };
}
