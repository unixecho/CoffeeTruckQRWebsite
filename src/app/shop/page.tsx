import { CartProvider } from "@/components/shop/CartProvider";
import { CartFab } from "@/components/shop/CartFab";
import { CartSheet } from "@/components/shop/CartSheet";
import { ContactWidget } from "@/components/shop/ContactWidget";
import { SettingsMenu } from "@/components/shop/SettingsMenu";
import { StoreView } from "@/components/shop/StoreView";
import { ClosedNotice } from "@/components/shop/ClosedNotice";
import { readCatalogue } from "@/lib/catalog";

/* Rendered per request, never prerendered.

   The owner adds a keychain at the truck and shows it to the customer standing
   in front of them; a cached page would show yesterday's catalogue. Traffic
   here is a handful of QR-code scans, so there is nothing to gain by caching
   and a real thing to lose. If that ever changes, the move is ISR with
   on-demand revalidation from the manager's write routes — not a blanket
   `revalidate`, which would reintroduce the same staleness with a timer. */
export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const catalogue = await readCatalogue();

  if (!catalogue.settings.open) {
    return (
      <>
        <SettingsMenu />
        <ClosedNotice settings={catalogue.settings} />
        <ContactWidget phone={catalogue.settings.whatsappPhone} />
      </>
    );
  }

  return (
    /* The provider wraps the whole shop rather than the cart alone: the store
       grid, the product sheet and the floating button all add to the same
       cart, and threading callbacks down to each of them would be the same
       context with extra steps. */
    <CartProvider
      products={catalogue.products}
      rules={catalogue.rules}
      settings={catalogue.settings}
    >
      <SettingsMenu />
      <StoreView
        categories={catalogue.categories}
        subclasses={catalogue.subclasses}
        products={catalogue.products}
        rules={catalogue.rules}
      />
      <CartFab />
      <CartSheet />
      <ContactWidget phone={catalogue.settings.whatsappPhone} />
    </CartProvider>
  );
}
