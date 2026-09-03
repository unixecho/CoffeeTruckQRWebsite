import { CartProvider } from "@/components/shop/CartProvider";
import { CartFab } from "@/components/shop/CartFab";
import { CartSheet } from "@/components/shop/CartSheet";
import { ContactWidget } from "@/components/shop/ContactWidget";
import { SettingsMenu } from "@/components/shop/SettingsMenu";
import { StoreView } from "@/components/shop/StoreView";
import { ClosedNotice } from "@/components/shop/ClosedNotice";
import { readCatalogue } from "@/lib/catalog";

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
