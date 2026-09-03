import { OrdersView } from "@/components/manager/OrdersView";
import { listOrders, sweepExpiredOrders } from "@/lib/orders";
import { readCatalogue } from "@/lib/catalog";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Order } from "@/lib/payments/types";

/**
 * The orders screen.
 *
 * The manager layout has already established that the caller is an owner, and
 * these reads use the service role — the same arrangement `readCatalogueAsOwner`
 * uses, for the same reason: no client role holds any grant on `orders`, not
 * even SELECT, because the table carries names and phone numbers.
 *
 * The expiry sweep runs here rather than only in the nightly job. Nightly is
 * far too coarse for a fifteen-minute window, and an hour-old unpaid order
 * showing as "open" at a counter is worse than one extra statement per page
 * view — it is somebody's bag being made up for a customer who left.
 */
export default async function ManagerOrdersPage() {
  const catalogue = await readCatalogue();

  let orders: Order[] = [];
  if (isSupabaseConfigured()) {
    const db = createServiceClient();
    await sweepExpiredOrders(db);
    orders = await listOrders(db, { limit: 100 });
  }

  return (
    <OrdersView
      orders={orders}
      live={catalogue.live}
      checkoutEnabled={catalogue.settings.checkoutEnabled}
    />
  );
}
