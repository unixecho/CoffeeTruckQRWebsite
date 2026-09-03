import { LandingView } from "@/components/shop/LandingView";
import { ContactWidget } from "@/components/shop/ContactWidget";
import { SettingsMenu } from "@/components/shop/SettingsMenu";
import { readCatalogue } from "@/lib/catalog";

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
