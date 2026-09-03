import { NextResponse } from "next/server";
import { openBare, audit } from "@/lib/route";
import { dbFailed, notFound, removeStoredObjects } from "@/lib/validate";

type Params = { params: Promise<{ id: string }> };

/** Remove one product photo, row and object together. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  const opened = await openBare(request);
  if (!opened.ok) return opened.response;
  const { db, owner } = opened;

  const { data: existing } = await db
    .from("product_images")
    .select("path, product_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return notFound("product_image");

  const { error } = await db.from("product_images").delete().eq("id", id);
  if (error) return dbFailed("images.delete", error);

  /* Row first, then object. If the object delete fails the photo is already
     gone from the app and a few kilobytes are stranded; the other order can
     leave a row pointing at nothing, which renders as a broken image on the
     storefront. `removeStoredObjects` skips `/products/...` paths — those are
     files committed in `public/` and are not ours to delete. */
  await removeStoredObjects(db, [existing.path as string]);

  await audit(db, owner, "delete", "product_image", id, existing);

  return NextResponse.json({ ok: true, id });
}
