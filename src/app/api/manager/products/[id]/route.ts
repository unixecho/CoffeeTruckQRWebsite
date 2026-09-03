import { NextResponse } from "next/server";
import { openWrite, openBare, audit } from "@/lib/route";
import {
  dbFailed,
  invalid,
  notFound,
  parseProductPatch,
  removeStoredObjects,
  STAFF_WRITABLE_PRODUCT_COLUMNS,
} from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;

  /* Opened at `staff` level, then narrowed below. A staff account may mark
     something sold out or adjust a count — that is the whole point of having
     one, since it is the edit that happens mid-service — but may not touch a
     price, a name, or where a product sits. */
  const opened = await openWrite<unknown>(request, { role: "staff" });
  if (!opened.ok) return opened.response;
  const { db, owner, body } = opened;

  const parsed = parseProductPatch(body);
  if (!parsed.ok) return invalid(parsed.error);

  const columns = Object.keys(parsed.value);
  if (columns.length === 0) {
    return NextResponse.json({ ok: true, id, unchanged: true });
  }

  if (owner.role !== "owner") {
    const forbidden = columns.filter((column) => !STAFF_WRITABLE_PRODUCT_COLUMNS.has(column));
    if (forbidden.length > 0) {
      return NextResponse.json(
        { error: "forbidden", fields: forbidden },
        { status: 403 }
      );
    }
  }

  /* Moving a product between categories can strand its subclass. Resolve the
     pair as it will be AFTER the patch, not as either half was before —
     patching only `categoryId` and leaving an old `subclass_id` in place is
     exactly how a mismatched row gets made. */
  if (parsed.value.category_id !== undefined || parsed.value.subclass_id !== undefined) {
    const { data: current } = await db
      .from("products")
      .select("category_id, subclass_id")
      .eq("id", id)
      .maybeSingle();

    if (!current) return notFound("product");

    const nextCategory = parsed.value.category_id ?? current.category_id;
    const nextSubclass =
      parsed.value.subclass_id !== undefined ? parsed.value.subclass_id : current.subclass_id;

    if (nextSubclass) {
      const { data: subclass } = await db
        .from("subclasses")
        .select("id")
        .eq("id", nextSubclass)
        .eq("category_id", nextCategory)
        .maybeSingle();

      if (!subclass) {
        /* The subclass does not belong to the new category. Detaching is the
           kinder resolution than refusing: the owner moved the product on
           purpose, and a product sitting directly in a category is a valid
           state. The response says so, so the editor can tell them. */
        parsed.value.subclass_id = null;
      }
    }
  }

  const { data, error } = await db
    .from("products")
    .update(parsed.value)
    .eq("id", id)
    .select("id, subclass_id")
    .maybeSingle();

  if (error) return dbFailed("products.update", error);
  if (!data) return notFound("product");

  await audit(db, owner, "update", "product", id, parsed.value);

  return NextResponse.json({ ok: true, id, subclassId: data.subclass_id });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openBare(request);
  if (!opened.ok) return opened.response;
  const { db, owner } = opened;

  const { data: existing } = await db
    .from("products")
    .select("name_he, slug, price_agorot")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return notFound("product");

  /* Collect the photo paths before the rows cascade away, or the objects are
     orphaned in the bucket with nothing left pointing at them. Only uploaded
     objects are removed — a `/products/...` path is a file in `public/` that
     ships with the repo and is not ours to delete. */
  const { data: images } = await db
    .from("product_images")
    .select("path")
    .eq("product_id", id);

  const uploaded = (images ?? [])
    .map((image) => image.path as string)
    .filter((path) => !path.startsWith("/"));

  const { error } = await db.from("products").delete().eq("id", id);
  if (error) return dbFailed("products.delete", error);

  // After the row is gone: a failed cleanup leaves a stray file, which is a
  // far smaller problem than a failed delete leaving a product on the shelf.
  await removeStoredObjects(db, uploaded);

  await audit(db, owner, "delete", "product", id, existing);

  return NextResponse.json({ ok: true, id });
}
