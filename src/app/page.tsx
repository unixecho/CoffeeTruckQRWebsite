import { LandingView } from "@/components/shop/LandingView";
import { ContactWidget } from "@/components/shop/ContactWidget";
import { SettingsMenu } from "@/components/shop/SettingsMenu";
import { readCatalogue } from "@/lib/catalog";

/* Rendered per request, never prerendered.

   The owner adds a keychain at the truck and shows it to the customer standing
   in front of them; a cached page would show yesterday's catalogue. Traffic
   here is a handful of QR-code scans, so there is nothing to gain by caching
   and a real thing to lose. If that ever changes, the move is ISR with
   on-demand revalidation from the manager's write routes — not a blanket
   `revalidate`, which would reintroduce the same staleness with a timer. */
export const dynamic = "force-dynamic";

/**
 * What a customer sees after scanning the QR code on the truck.
 *
 * A Server Component that reads settings once and hands the pieces to the
 * three client parts. Nothing here needs the catalogue itself — the landing
 * page's whole job is to say what this is and open the shop.
 */
export default async function LandingPage() {
  const { settings } = await readCatalogue();

  return (
    <>
      <SettingsMenu />
      <LandingView settings={settings} />
      <ContactWidget phone={settings.whatsappPhone} />
    </>
  );
}
