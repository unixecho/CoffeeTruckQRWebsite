import { NextResponse } from "next/server";
import { openWrite, openBare, audit } from "@/lib/route";
import { dbFailed, invalid, notFound, parseSubclassPatch } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  /* `parseSubclassPatch` cannot change `category_id` — moving a subclass
     between categories would orphan every product in it from its own
     category's rules, and there is no screen that asks for it. */
  const parsed = parseSubclassPatch(body);
  if (!parsed.ok) return invalid(parsed.error);

  if (Object.keys(parsed.value).length === 0) {
    return NextResponse.json({ ok: true, id, unchanged: true });
  }

  const { data, error } = await db
    .from("subclasses")
    .update(parsed.value)
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) return dbFailed("subclasses.update", error);
  if (!data) return notFound("subclass");

  await audit(db, owner, "update", "subclass", id, parsed.value);

  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openBare(request);
  if (!opened.ok) return opened.response;
  const { db, owner } = opened;

  const { data: existing } = await db
    .from("subclasses")
    .select("name_he, slug, category_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return notFound("subclass");

  /* Products reference subclasses with ON DELETE SET NULL, so deleting one
     does not delete its products — they fall back to sitting directly in the
     category. That is the right behaviour for a reorganisation, but it also
     means the products silently leave whatever subclass deal they were in, so
     the count goes into the audit line: "12 products left this subclass" is
     the fact somebody will want later. Migration 001 sweeps the subclass's own
     pricing rules on delete. */
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("subclass_id", id);

  const { error } = await db.from("subclasses").delete().eq("id", id);
  if (error) return dbFailed("subclasses.delete", error);

  await audit(db, owner, "delete", "subclass", id, {
    ...existing,
    products_detached: count ?? 0,
  });

  return NextResponse.json({ ok: true, id, productsDetached: count ?? 0 });
}
