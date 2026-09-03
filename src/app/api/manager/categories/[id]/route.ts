import { NextResponse } from "next/server";
import { openWrite, openBare, audit } from "@/lib/route";
import { dbFailed, invalid, notFound, parseCategoryPatch } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseCategoryPatch(body);
  if (!parsed.ok) return invalid(parsed.error);

  /* An empty patch is a no-op, not an error — the editor sends whatever
     changed, and "nothing changed" is a legitimate thing for it to conclude.
     PostgREST would reject an empty update, so it is caught here. */
  if (Object.keys(parsed.value).length === 0) {
    return NextResponse.json({ ok: true, id, unchanged: true });
  }

  const { data, error } = await db
    .from("categories")
    .update(parsed.value)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return dbFailed("categories.update", error);
  if (!data) return notFound("category");

  await audit(db, owner, "update", "category", id, parsed.value);

  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openBare(request);
  if (!opened.ok) return opened.response;
  const { db, owner } = opened;

  /* Read the name first: once the row is gone the audit line would have
     nothing but a uuid in it, which is useless three weeks later when someone
     is asking what happened to a category.

     Products reference categories with ON DELETE RESTRICT, so a category with
     anything in it refuses here and surfaces as a 409 "in_use" via dbFailed.
     That is the intended behaviour — deleting a category should not silently
     take a dozen products with it. */
  const { data: existing } = await db
    .from("categories")
    .select("name_he, slug")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return notFound("category");

  const { error } = await db.from("categories").delete().eq("id", id);
  if (error) return dbFailed("categories.delete", error);

  await audit(db, owner, "delete", "category", id, existing);

  return NextResponse.json({ ok: true, id });
}
