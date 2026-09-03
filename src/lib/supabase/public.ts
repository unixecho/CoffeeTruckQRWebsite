import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * The storefront's read client. Anonymous, and deliberately cookie-free.
 *
 * The shop is public: what a visitor may see is decided entirely by the RLS
 * policies for `anon`, never by who they are. Reading the session to fetch it
 * would be work with no effect on the answer — and worse, calling `cookies()`
 * marks the route dynamic, which is how the seed data ended up *baked into*
 * the static build of `/` and `/shop`: the read threw `DynamicServerError`
 * during prerender, the fallback caught it, and the page shipped with a
 * snapshot that no amount of editing in the manager would ever change.
 *
 * A signed-in owner browsing the shop therefore sees exactly what a customer
 * sees, which is the correct answer anyway — the manager is where hidden rows
 * belong, and it uses `createServiceClient()`.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
