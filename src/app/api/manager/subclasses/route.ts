import { NextResponse } from "next/server";
import { openWrite, audit } from "@/lib/route";
import {
  dbFailed,
  invalid,
  nextSortOrder,
  notFound,
  parseSubclassCreate,
  uniqueSlug,
} from "@/lib/validate";

export async function POST(request: Request) {
  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseSubclassCreate(body);
  if (!parsed.ok) return invalid(parsed.error);

  /* The category has to exist before the subclass claims a slug inside it —
     otherwise a bad category_id produces a foreign-key 500 rather than a 404
     naming what was actually wrong. */
  const { data: parent } = await db
    .from("categories")
    .select("id")
    .eq("id", parsed.value.category_id)
    .maybeSingle();

  if (!parent) return notFound("category");

  // Subclass slugs are unique within their category, not globally: "small" is
  // a reasonable subclass of both keychains and magnets.
  const slug = await uniqueSlug(db, "subclasses", parsed.value.name_he, {
    column: "category_id",
    value: parsed.value.category_id,
  });
  const sort_order = await nextSortOrder(db, "subclasses", {
    column: "category_id",
    value: parsed.value.category_id,
  });

  const { data, error } = await db
    .from("subclasses")
    .insert({ ...parsed.value, slug, sort_order })
    .select("id")
    .single();

  if (error) return dbFailed("subclasses.create", error);

  await audit(db, owner, "create", "subclass", data.id, {
    name_he: parsed.value.name_he,
    slug,
    category_id: parsed.value.category_id,
  });

  return NextResponse.json({ ok: true, id: data.id, slug });
}
