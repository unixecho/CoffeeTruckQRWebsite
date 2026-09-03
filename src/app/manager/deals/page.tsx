import { DealsView } from "@/components/manager/DealsView";
import { readCatalogueAsOwner } from "@/lib/catalog";

export default async function ManagerDealsPage() {
  const catalogue = await readCatalogueAsOwner();

  return (
    <DealsView
      categories={catalogue.categories}
      subclasses={catalogue.subclasses}
      products={catalogue.products}
      rules={catalogue.rules}
      live={catalogue.live}
    />
  );
}
