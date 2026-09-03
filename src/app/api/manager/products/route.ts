import { NextResponse } from "next/server";
import { openWrite, audit } from "@/lib/route";
import {
  dbFailed,
  invalid,
  nextSortOrder,
  notFound,
  parseProductCreate,
  uniqueSlug,
} from "@/lib/validate";

export async function POST(request: Request) {
  const opened = await openWrite<unknown>(request);
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseProductCreate(body);
  if (!parsed.ok) return invalid(parsed.error);

  /* The database enforces that a product's subclass belongs to its own
     category (migration 001, `check_subclass_matches_category`). Checking it
     here too turns what would be a raw 500 from a trigger into a field error
     the editor can point at. */
  const { data: category } = await db
    .from("categories")
    .select("id")
    .eq("id", parsed.value.category_id)
    .maybeSingle();
  if (!category) return notFound("category");

  if (parsed.value.subclass_id) {
    const { data: subclass } = await db
      .from("subclasses")
      .select("id")
      .eq("id", parsed.value.subclass_id)
      .eq("category_id", parsed.value.category_id)
      .maybeSingle();
    if (!subclass) {
      return invalid({
        field: "subclassId",
        message: "That subclass is not in the chosen category.",
      });
    }
  }

  const slug = await uniqueSlug(db, "products", parsed.value.name_he);
  const sort_order = await nextSortOrder(db, "products", {
    column: "category_id",
    value: parsed.value.category_id,
  });

  const { data, error } = await db
    .from("products")
    .insert({ ...parsed.value, slug, sort_order })
    .select("id")
    .single();

  if (error) return dbFailed("products.create", error);

  await audit(db, owner, "create", "product", data.id, {
    name_he: parsed.value.name_he,
    slug,
    price_agorot: parsed.value.price_agorot,
  });

  /* The id comes back because the editor's next move is to upload a photo,
     which needs a product to attach it to. */
  return NextResponse.json({ ok: true, id: data.id, slug });
}
