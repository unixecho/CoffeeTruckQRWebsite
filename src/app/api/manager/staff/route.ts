import { NextResponse } from "next/server";
import { openWrite, audit } from "@/lib/route";
import { conflict, dbFailed, invalid, parseStaffCreate } from "@/lib/validate";

/**
 * Invite someone to the manager.
 *
 * The invite is only a *pending* row keyed by email. It becomes access when
 * that person signs in with the matching Google address and
 * `claim_owner_access()` links it to their auth user id — see migration 003.
 * Nothing here can grant access to an account that does not exist yet, and
 * nothing here touches `owners` directly.
 */
export async function POST(request: Request) {
  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseStaffCreate(body);
  if (!parsed.ok) return invalid(parsed.error);

  /* Inviting somebody who already has access is a no-op worth naming: the
     owner is usually trying to *change* a role, and silently writing a
     pending invite that will never be claimed would look like it worked. */
  const { data: existing } = await db
    .from("owners")
    .select("email")
    .eq("email", parsed.value.email)
    .maybeSingle();

  if (existing) {
    return conflict("already_owner", "That person already has access.");
  }

  const { error } = await db.from("owner_invites").upsert(
    {
      email: parsed.value.email,
      role: parsed.value.role,
      invited_by: owner.authUserId,
    },
    { onConflict: "email" }
  );

  if (error) return dbFailed("staff.invite", error);

  await audit(db, owner, "create", "owner_invite", null, parsed.value);

  return NextResponse.json({ ok: true, email: parsed.value.email, role: parsed.value.role });
}
