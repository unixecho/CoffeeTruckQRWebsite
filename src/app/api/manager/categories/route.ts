import { NextResponse } from "next/server";
import { openWrite, audit } from "@/lib/route";
import {
  dbFailed,
  invalid,
  nextSortOrder,
  parseCategoryCreate,
  uniqueSlug,
} from "@/lib/validate";

/** Create a category. Owner only. */
export async function POST(request: Request) {
  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseCategoryCreate(body);
  if (!parsed.ok) return invalid(parsed.error);

  /* The slug and the sort order are ours, not the client's. A client-chosen
     slug is a client-chosen URL and a client-chosen uniqueness collision; a
     client-chosen sort order lets one category pin itself to the top forever. */
  const slug = await uniqueSlug(db, "categories", parsed.value.name_he);
  const sort_order = await nextSortOrder(db, "categories");

  const { data, error } = await db
    .from("categories")
    .insert({ ...parsed.value, slug, sort_order })
    .select("id")
    .single();

  if (error) return dbFailed("categories.create", error);

  await audit(db, owner, "create", "category", data.id, { name_he: parsed.value.name_he, slug });

  return NextResponse.json({ ok: true, id: data.id, slug });
}
