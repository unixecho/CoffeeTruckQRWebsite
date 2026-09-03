"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase in the browser.
 *
 * Only ever used for auth — starting the Google sign-in redirect and signing
 * out. Catalogue reads happen on the server so the storefront can be cached,
 * and catalogue writes go through API routes that check ownership first. There
 * is deliberately no path from this client to a write.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
