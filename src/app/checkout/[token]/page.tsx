import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CartProvider } from "@/components/shop/CartProvider";
import { SettingsMenu } from "@/components/shop/SettingsMenu";
import { OrderView } from "@/components/checkout/OrderView";
import { readCatalogue } from "@/lib/catalog";
import { findOrderByToken, toPublicView } from "@/lib/orders";
import { cardPaymentAvailable } from "@/lib/payments/provider";
import { canCustomerCancel, canRetryPayment } from "@/lib/payments/status";

export const metadata: Metadata = {
  title: "ההזמנה שלך",
  /* An order URL carries a bearer token. It must never be indexed, never be
     cached by a shared proxy, and never be followed by a crawler that happens
     to see it in a referrer. */
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

/**
 * The order screen.
 *
 * The token is read **server-side** and resolved to an order before anything
 * renders, so the first paint is the real order rather than a spinner that
 * turns into one. `findOrderByToken` hashes the token and looks up the hash;
 * the value in this URL never exists in the database.
 *
 * A bad token is a 404, not an error page. There is no useful distinction for
 * the person holding it between "no such order" and "not your order", and
 * offering one would turn this into an oracle for guessing tokens.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [order, catalogue] = await Promise.all([findOrderByToken(token), readCatalogue()]);

  if (!order) notFound();

  const cardAvailable = catalogue.settings.onlinePaymentsEnabled && cardPaymentAvailable();

  return (
    /* The provider is here for two things the order screen genuinely needs:
       the Bit link from settings, and — when an order was cancelled or
       expired — putting its items back in the cart with one tap. */
    <CartProvider
      products={catalogue.products}
      rules={catalogue.rules}
      settings={catalogue.settings}
    >
      <SettingsMenu />
      <OrderView
        token={token}
        initialOrder={toPublicView(order)}
        initialCan={{
          retryPayment: canRetryPayment(order),
          cancel: canCustomerCancel(order),
        }}
        bitPaymentLink={catalogue.settings.bitPaymentLink}
        cardAvailable={cardAvailable}
      />
    </CartProvider>
  );
}
