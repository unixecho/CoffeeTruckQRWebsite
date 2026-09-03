import { NextResponse } from "next/server";
import { openBare, audit } from "@/lib/route";
import { dbFailed, invalid, notFound, parseEmail } from "@/lib/validate";

type Params = { params: Promise<{ email: string }> };

/**
 * Revoke a pending invite, or remove someone's access entirely.
 *
 * The address arrives URL-encoded in the path — `%40` for the `@` — so it is
 * decoded and then validated exactly like one arriving in a body. A path
 * segment is request input; being in the URL rather than the body changes
 * nothing about how much it can be trusted.
 */
export async function DELETE(request: Request, { params }: Params) {
  const raw = (await params).email;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return invalid({ field: "email", message: "Expected an email address." });
  }

  const parsed = parseEmail(decoded);
  if (!parsed.ok) return invalid(parsed.error);
  const email = parsed.value;

  const opened = await openBare(request);
  if (!opened.ok) return opened.response;
  const { db, owner } = opened;

  /* The owner must not be able to lock themselves out. This is the only
     account guaranteed to be able to grant access back, and a shop with no
     owner needs a database console to fix. */
  if (email === owner.email.toLowerCase()) {
    return NextResponse.json(
      { error: "cannot_remove_self", message: "You cannot remove your own access." },
      { status: 409 }
    );
  }

  const { data: invite } = await db
    .from("owner_invites")
    .select("email, role")
    .eq("email", email)
    .maybeSingle();

  if (invite) {
    const { error } = await db.from("owner_invites").delete().eq("email", email);
    if (error) return dbFailed("staff.revokeInvite", error);

    await audit(db, owner, "delete", "owner_invite", null, invite);
    return NextResponse.json({ ok: true, email, removed: "invite" });
  }

  /* No pending invite — this may be someone who has already signed in, in
     which case removing them means deleting their `owners` row. Their Google
     account still exists and they can still sign in; they simply land on
     /no-access from then on. */
  const { data: existing } = await db
    .from("owners")
    .select("email, role")
    .eq("email", email)
    .maybeSingle();

  if (!existing) return notFound("invite");

  const { error } = await db.from("owners").delete().eq("email", email);
  if (error) return dbFailed("staff.revokeOwner", error);

  await audit(db, owner, "delete", "owner", null, existing);

  return NextResponse.json({ ok: true, email, removed: "owner" });
}
