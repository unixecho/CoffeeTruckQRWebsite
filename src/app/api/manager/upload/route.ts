import { NextResponse } from "next/server";
import { openBare, audit } from "@/lib/route";
import { checkOrigin } from "@/lib/auth";
import {
  dbFailed,
  invalid,
  MAX_UPLOAD_BYTES,
  nextSortOrder,
  notFound,
  PRODUCT_PHOTO_BUCKET,
  sniffImage,
} from "@/lib/validate";

/**
 * A product photo, taken on a phone at the stand.
 *
 * This is the only endpoint that accepts bytes rather than JSON, and it is the
 * one with the sharpest edges. Three things are non-negotiable:
 *
 * 1. **The object key is generated here.** Never any part of the client's
 *    filename — that is the classic path-traversal vector, and a phone will
 *    happily send whatever the camera app named the file.
 * 2. **The type comes from the bytes, not the header.** A declared
 *    `Content-Type` is request input. An HTML file announced as `image/png`
 *    and served from a public bucket is stored XSS on our own origin.
 * 3. **The size is checked before the body is buffered.** `File.size` is known
 *    from the multipart headers, so an oversized upload is refused without
 *    ever holding it in memory.
 */
export async function POST(request: Request) {
  /* `openBare` rather than `openWrite`: the body is multipart, not JSON, so
     the JSON content-type rail does not apply and origin is checked directly.
     The upload limit is lower than the general one because each call moves
     megabytes. */
  const badOrigin = checkOrigin(request);
  if (badOrigin) return badOrigin;

  const opened = await openBare(request, { max: 60, windowSeconds: 60 });
  if (!opened.ok) return opened.response;
  const { db, owner } = opened;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "malformed_body" }, { status: 400 });
  }

  const productId = form.get("productId");
  if (typeof productId !== "string" || !UUID.test(productId)) {
    return invalid({ field: "productId", message: "Expected a product id." });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return invalid({ field: "file", message: "Expected a file." });
  }

  // Before any buffering.
  if (file.size === 0) {
    return invalid({ field: "file", message: "The file is empty." });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const { data: product } = await db
    .from("products")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (!product) return notFound("product");

  const bytes = new Uint8Array(await file.arrayBuffer());

  /* The bytes decide. `file.type` is not consulted at all — not even as a
     first-pass filter — because a check that agrees with the header when the
     header is honest and disagrees when it lies is just the byte check with
     extra steps. */
  const sniffed = sniffImage(bytes);
  if (!sniffed) {
    return invalid({ field: "file", message: "That is not a JPEG, PNG, WebP or AVIF." });
  }

  const key = `${productId}/${crypto.randomUUID()}.${sniffed.extension}`;

  const { error: uploadError } = await db.storage
    .from(PRODUCT_PHOTO_BUCKET)
    .upload(key, bytes, {
      contentType: sniffed.contentType,
      // Long, because the key is a fresh uuid every time — an object at this
      // key can never be a different image later.
      cacheControl: "31536000",
      upsert: false,
    });

  if (uploadError) {
    console.error("[upload] storage rejected:", uploadError.message);
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  const sort_order = await nextSortOrder(db, "product_images", {
    column: "product_id",
    value: productId,
  });

  const { data: row, error } = await db
    .from("product_images")
    .insert({ product_id: productId, path: key, sort_order })
    .select("id")
    .single();

  if (error) {
    // The row is what makes the object reachable. Without it the upload is
    // invisible to the app, so take the object back out rather than leaving
    // a file nothing references.
    await db.storage.from(PRODUCT_PHOTO_BUCKET).remove([key]);
    return dbFailed("upload.insert", error);
  }

  await audit(db, owner, "create", "product_image", row.id, { product_id: productId, path: key });

  return NextResponse.json({ ok: true, path: key, imageId: row.id });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
