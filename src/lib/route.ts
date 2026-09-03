import "server-only";

import type { NextResponse } from "next/server";
import { audit, checkOrigin, readJson, requireOwner, type Guarded } from "./auth";
import { rateLimited, withinRateLimit } from "./validate";
import type { Owner, OwnerRole } from "./types";
import { createServiceClient } from "./supabase/server";

/* ==========================================================================
   The opening of every write route

   Fourteen endpoints each need the same four things done in the same order,
   and the order matters:

     1. checkOrigin   — refuse a present-but-foreign Origin.
     2. requireOwner  — establish who is asking, before reading anything.
     3. rate limit    — bound a runaway client. Keyed per owner, not per IP:
                        these routes are already behind a login, so the thing
                        worth bounding is one account's loop, not the internet.
     4. readJson      — Content-Type and a size ceiling, then parse.

   Doing this inline in each route is how one of them ends up missing step 2.
   The return type is a discriminated union carrying the service-role client,
   so there is no way to reach the database without having passed the guard —
   the client simply does not exist on the other branch.
   ========================================================================== */

export type Opened<T> =
  | { ok: true; owner: Owner; db: ReturnType<typeof createServiceClient>; body: T }
  | { ok: false; response: NextResponse };

interface OpenOptions {
  /** `staff` for stock/availability edits; `owner` for everything else. */
  role?: OwnerRole;
  /** Writes allowed per owner per window. Generous — this is a loop guard. */
  max?: number;
  windowSeconds?: number;
  /** Body size ceiling, checked from content-length before the body is read. */
  maxBytes?: number;
}

/** For routes that carry a JSON body (POST, PATCH). */
export async function openWrite<T>(
  request: Request,
  options: OpenOptions = {}
): Promise<Opened<T>> {
  const guarded = await openBare(request, options);
  if (!guarded.ok) return guarded;

  const parsed = await readJson<T>(request, options.maxBytes);
  if (!parsed.ok) return { ok: false, response: parsed.response };

  return { ok: true, owner: guarded.owner, db: guarded.db, body: parsed.body };
}

/** For routes with no body — DELETE, and the multipart upload. */
export async function openBare(
  request: Request,
  options: OpenOptions = {}
): Promise<Exclude<Opened<never>, { ok: true; body: never }> | { ok: true; owner: Owner; db: ReturnType<typeof createServiceClient> }> {
  const badOrigin = checkOrigin(request);
  if (badOrigin) return { ok: false, response: badOrigin };

  const guarded: Guarded = await requireOwner(options.role ?? "owner");
  if (!guarded.ok) return { ok: false, response: guarded.response };

  const allowed = await withinRateLimit(
    guarded.db,
    `manager:${guarded.owner.authUserId}`,
    options.max ?? 240,
    options.windowSeconds ?? 60
  );
  if (!allowed) return { ok: false, response: rateLimited() };

  return { ok: true, owner: guarded.owner, db: guarded.db };
}

/** Re-exported so a route file imports its whole vocabulary from one place. */
export { audit };
