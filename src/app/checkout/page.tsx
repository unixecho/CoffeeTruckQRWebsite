import type { Metadata } from "next";

import { CartProvider } from "@/components/shop/CartProvider";
import { SettingsMenu } from "@/components/shop/SettingsMenu";
import { CheckoutFlow } from "@/components/checkout/CheckoutFlow";
import { readCatalogue } from "@/lib/catalog";
import { cardPaymentAvailable } from "@/lib/payments/provider";

export const metadata: Metadata = {
  title: "הזמנה",
  /* Not a page anybody should reach from a search result: it only makes sense
     with a cart behind it, and an indexed checkout is an indexed empty state. */
  robots: { index: false, follow: false },
};

/* Rendered per request, like the rest of the storefront. The catalogue here
   decides what an order may contain and at what price, so a cached copy would
   let somebody order yesterday's price. */
export const dynamic = "force-dynamic";

/**
 * The checkout.
 *
 * Wrapped in its own `CartProvider` rather than sharing one with `/shop`: the
 * cart lives in `localStorage`, so a second provider over the same key is the
 * same cart, and the alternative — hoisting the provider into a layout — would
 * make every page pay for the catalogue read.
 *
 * The two booleans are resolved here, on the server, and not in the browser.
 * `cardPaymentAvailable()` reads server-only configuration, and putting the
 * answer in a `NEXT_PUBLIC_` variable would bake it into the bundle where the
 * owner's kill switch could not reach it.
 */
export default async function CheckoutPage() {
  const catalogue = await readCatalogue();

  const cardAvailable = catalogue.settings.onlinePaymentsEnabled && cardPaymentAvailable();

  return (
    <CartProvider
      products={catalogue.products}
      rules={catalogue.rules}
      settings={catalogue.settings}
    >
      <SettingsMenu />
      <CheckoutFlow
        cardAvailable={cardAvailable}
        checkoutEnabled={catalogue.settings.checkoutEnabled && catalogue.settings.open}
      />
    </CartProvider>
  );
}
