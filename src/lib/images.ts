/**
 * Turning a stored image path into something an `<img>` can load.
 *
 * Deliberately its own module rather than living in `catalog.ts`: that file is
 * `server-only` because it reads cookies, and both the manager's photo list
 * and the storefront's product cards are client components that need this.
 * Importing it from there pulls `next/headers` into the browser bundle and the
 * build fails — which is the correct outcome, and this is the fix for it.
 *
 * Two path shapes exist and both are legitimate:
 *
 *   `/products/foo.png`   a photo seeded from the old static site, served
 *                         straight out of `public/`
 *   `<uuid>/<uuid>.jpg`   a storage object key, uploaded from the manager
 *
 * `NEXT_PUBLIC_SUPABASE_URL` is inlined at build time, so this works on both
 * sides of the wire with no runtime lookup.
 */
export function imageUrl(path: string): string {
  if (path.startsWith("/") || path.startsWith("http")) return path;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return path;

  return `${base}/storage/v1/object/public/product-photos/${path}`;
}
