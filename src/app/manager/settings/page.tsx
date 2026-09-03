import { SettingsView } from "@/components/manager/SettingsView";
import { getOwner } from "@/lib/auth";
import { readCatalogueAsOwner } from "@/lib/catalog";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

interface Invite {
  email: string;
  role: string;
}

/**
 * Pending invites, read server-side.
 *
 * `owner_invites` has no client grant at all by design — it is a list of
 * people's email addresses and no browser needs to read it. This page is
 * already behind the manager layout's owner check, so the service client is
 * the right tool here and the only one that can see the table.
 */
async function readInvites(): Promise<Invite[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const { data, error } = await createServiceClient()
      .from("owner_invites")
      .select("email, role")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[settings] could not read invites:", error.message);
      return [];
    }
    return (data ?? []) as Invite[];
  } catch {
    return [];
  }
}

export default async function ManagerSettingsPage() {
  const [catalogue, { owner }, invites] = await Promise.all([
    readCatalogueAsOwner(),
    getOwner(),
    readInvites(),
  ]);

  return (
    <SettingsView
      settings={catalogue.settings}
      live={catalogue.live}
      ownerEmail={owner?.email ?? null}
      invites={invites}
    />
  );
}
