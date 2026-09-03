import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/* ==========================================================================
   Supabase, server side

   Two clients with sharply different powers, and the difference is the whole
   security model:

   - `createClient()`  — acts as the signed-in visitor. RLS applies. Safe
                         anywhere on the server.
   - `createServiceClient()` — bypasses RLS entirely. Only ever behind an
                         owner check in an API route, and never imported into
                         anything that ships to the browser.

   Every catalogue write goes through the service client, because the client
   roles hold no write grants at all (see supabase/migrations/002). That is
   deliberate: RLS scopes *rows*, not *columns*, so a table-level UPDATE grant
   on `products` would let a signed-in visitor rewrite a price even with a
   perfectly correct row policy. PLAYBOOK.md §1.3.
   ========================================================================== */

/** True when the project has been pointed at a Supabase instance at all. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * The visitor's own client. Reads run under RLS, so a storefront query returns
 * exactly the rows an anonymous person is allowed to see and nothing more.
 *
 * `cookies()` is awaited — it is async from Next 15 onwards.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /* Called from a Server Component, where cookies cannot be set.
               The session is still read from the request, so this is a no-op
               rather than a failure — middleware does the refreshing. */
          }
        },
      },
    }
  );
}

/**
 * The service-role client. Bypasses RLS completely.
 *
 * Call this only after establishing that the caller is an owner
 * (`requireOwner()` in `lib/auth.ts`). It throws rather than falling back to
 * the anon key if the secret is missing, because a silent downgrade would turn
 * a write endpoint into one that fails in a confusing way at 3pm on a Sunday
 * instead of loudly at deploy time.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Catalogue writes need it; see .env.example."
    );
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
