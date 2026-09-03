import { CatalogueView } from "@/components/manager/CatalogueView";
import { readCatalogueAsOwner } from "@/lib/catalog";

/**
 * The catalogue screen.
 *
 * `readCatalogueAsOwner`, not `readCatalogue`: the manager has to see hidden
 * categories and unavailable products, and the public read runs under RLS
 * which correctly filters exactly those out.
 */
export default async function ManagerCataloguePage() {
  const catalogue = await readCatalogueAsOwner();

  return (
    <CatalogueView
      categories={catalogue.categories}
      subclasses={catalogue.subclasses}
      products={catalogue.products}
      rules={catalogue.rules}
      live={catalogue.live}
    />
  );
}
