import "server-only";

import { NextResponse } from "next/server";
import { createClient, createServiceClient, isSupabaseConfigured } from "./supabase/server";
import { allowedOrigins } from "./site";
import type { Owner, OwnerRole } from "./types";

/* ==========================================================================
   Who is asking

   Google sign-in is open to any Google account, so being authenticated says
   nothing about being authorized. Authorization is a row in `owners`, and
   these helpers are the only way the rest of the app asks about it.

   Two layers deliberately duplicate this check:

   - **Middleware** gates `/manager/*` so an unauthorized person never renders
     the screen at all.
   - **Every write route** calls `requireOwner()` again.

   The second is not redundant. Middleware runs on navigation; an API route can
   be called directly with curl and never passes through a page render. A gate
   that only exists in middleware is a gate on the front door of a building
   with open windows.
   ========================================================================== */

export interface AuthResult {
  owner: Owner | null;
  /** Signed into Google, but with no owners row. Lands on /no-access. */
  authenticatedButUnauthorized: boolean;
}

interface OwnerRow {
  auth_user_id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
}

function toOwner(row: OwnerRow): Owner {
  return {
    authUserId: row.auth_user_id,
    email: row.email,
    role: row.role as OwnerRole,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

/**
 * Resolve the caller.
 *
 * On a miss, `claim_owner_access()` is called once: the owner may have been
 * invited by email before they ever signed in, and the bootstrap address has
 * no row until its first visit. That RPC takes no parameters and reads the
 * caller's identity from the JWT, so there is nothing to forge — see
 * migration 003.
 */
export async function getOwner(): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return { owner: null, authenticatedButUnauthorized: false };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { owner: null, authenticatedButUnauthorized: false };

  const { data: row } = await supabase
    .from("owners")
    .select("auth_user_id, email, role, display_name, created_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (row) return { owner: toOwner(row as OwnerRow), authenticatedButUnauthorized: false };

  // No row yet — this may be the bootstrap address or a pending invite.
  const { data: claimed } = await supabase.rpc("claim_owner_access");
  if (!claimed) return { owner: null, authenticatedButUnauthorized: true };

  const { data: fresh } = await supabase
    .from("owners")
    .select("auth_user_id, email, role, display_name, created_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return fresh
    ? { owner: toOwner(fresh as OwnerRow), authenticatedButUnauthorized: false }
    : { owner: null, authenticatedButUnauthorized: true };
}

/* --------------------------------------------------------------------------
   Route guards
   -------------------------------------------------------------------------- */

/**
 * The guard every write route opens with.
 *
 * Returns either a service-role client — already established as safe to use,
 * because the caller has been checked — or a response to return immediately.
 * Pairing them in one value is what stops the "checked the owner, then forgot
 * to stop" bug: there is no way to get the client without also getting the
 * refusal, and no way to proceed without the client.
 */
export type Guarded =
  | { ok: true; owner: Owner; db: ReturnType<typeof createServiceClient> }
  | { ok: false; response: NextResponse };

export async function requireOwner(minimum: OwnerRole = "owner"): Promise<Guarded> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "not_configured", message: "The database is not configured." },
        { status: 503 }
      ),
    };
  }

  const { owner } = await getOwner();

  if (!owner) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  // `staff` may touch stock and availability; everything else is owner-only.
  if (minimum === "owner" && owner.role !== "owner") {
    return {
      ok: false,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, owner, db: createServiceClient() };
}

/* --------------------------------------------------------------------------
   Request hygiene for write endpoints

   These are behind a login, so they are not the unauthenticated-write case in
   PLAYBOOK.md §4 — but the two cheap rails still apply, and the JSON one is
   what actually closes cross-site form posts: an HTML form can only ever send
   text/plain, urlencoded, or multipart.
   -------------------------------------------------------------------------- */

/**
 * Rejects a cross-origin write.
 *
 * A *missing* `Origin` means same-origin or a non-browser client, so it is
 * allowed — every modern browser sends the header on a cross-origin request.
 */
export function checkOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;

  // `allowedOrigins()` in lib/site.ts is the one definition of "this site",
  // shared with the CSP in proxy.ts and with the payment return URLs. Three
  // places working it out independently is how they drift apart.
  if (allowedOrigins().includes(origin)) return null;

  return NextResponse.json({ error: "bad_origin" }, { status: 403 });
}

/** Reads a JSON body, refusing anything that is not actually JSON or is huge. */
export async function readJson<T>(
  request: Request,
  maxBytes = 64 * 1024
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "expected_json" }, { status: 415 }),
    };
  }

  // Checked before the body is read, not after.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return {
      ok: false,
      response: NextResponse.json({ error: "too_large" }, { status: 413 }),
    };
  }

  try {
    return { ok: true, body: (await request.json()) as T };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "malformed_json" }, { status: 400 }),
    };
  }
}

/* --------------------------------------------------------------------------
   Audit
   -------------------------------------------------------------------------- */

/**
 * Records a catalogue change.
 *
 * Best-effort on purpose: a failed audit insert must not fail the write the
 * owner just made. The point is answering "why is this ₪10 now" three weeks
 * later, and losing one line to a transient error is a smaller problem than
 * refusing a price change at the counter.
 */
export async function audit(
  db: ReturnType<typeof createServiceClient>,
  owner: Owner,
  action: "create" | "update" | "delete",
  entity: string,
  entityId: string | null,
  changes?: unknown
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    actor_id: owner.authUserId,
    actor_email: owner.email,
    action,
    entity,
    entity_id: entityId,
    changes: changes ?? null,
  });

  if (error) console.error("[audit] could not record:", error.message);
}
