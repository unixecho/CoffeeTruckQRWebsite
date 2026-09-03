import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/* ==========================================================================
   The manager gate

   Two jobs, in this order:

   1. Refresh the Supabase session on every request, so a signed-in owner
      working the stand for an hour is not thrown out mid-edit.
   2. Keep unauthorized people out of `/manager/*` before the screen renders.

   Step 2 is a *convenience* boundary, not the security boundary. It stops a
   stranger seeing the catalogue editor; it does not stop anyone calling the
   API. That is why every write route calls `requireOwner()` again — see
   `lib/auth.ts`. Middleware runs on navigation, and curl does not navigate.

   Deliberately absent: any rule touching the storefront. The shop is public,
   it should be cacheable, and running an auth round trip on every product
   page view would be paying for a check nobody asked for.
   ========================================================================== */

const MANAGER_PREFIX = "/manager";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /* Not configured yet. The storefront still works — it falls back to
     `src/data/seed.json` — and the manager renders its own read-only notice,
     which is a far more useful thing to see than a redirect loop. */
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refreshes the session as a side effect. Must run on every request, not
  // just protected ones, or the token expires while someone browses the shop
  // and they are signed out the moment they open the manager.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isManager = pathname === MANAGER_PREFIX || pathname.startsWith(`${MANAGER_PREFIX}/`);

  if (!isManager) return response;

  if (!user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    // Where to land after signing in. Only ever a path from this site's own
    // URL object, so it cannot be pointed at another origin.
    login.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(login);
  }

  /* Authenticated is not authorized. Google sign-in is open to any account,
     so the owners row is what actually grants access. RLS lets a user read
     only their own row, so this cannot be used to enumerate anyone else. */
  const { data: owner } = await supabase
    .from("owners")
    .select("role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!owner) {
    /* The owner may have been invited by email before ever signing in, and
       the bootstrap address has no row until its first visit. Only runs on
       the miss path, so it costs established owners nothing. */
    const { data: claimed } = await supabase.rpc("claim_owner_access");
    if (!claimed) {
      const denied = request.nextUrl.clone();
      denied.pathname = "/no-access";
      denied.search = "";
      /* Not back to /login: they ARE signed in, and re-offering the button
         reads as "try again" when trying again changes nothing. */
      return NextResponse.redirect(denied);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /* Everything except static assets. The session refresh has to run broadly
       for it to be any use, but there is no point paying for it on an image. */
    "/((?!_next/static|_next/image|favicon.ico|fonts/|products/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|woff2)$).*)",
  ],
};
