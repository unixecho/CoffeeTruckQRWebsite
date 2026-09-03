import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/redirect";

/**
 * Where Google sends the owner back to.
 *
 * Exchanges the one-time code for a session, sets the cookies, and forwards to
 * wherever they were heading. Any failure lands back on /login rather than
 * showing an error page — the only useful thing to do with a failed sign-in is
 * try it again, and the sign-in button is on /login.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  /* Vercel preview deployments serve behind a proxy, so `origin` is the
     internal host rather than the URL the owner is actually looking at.
     Redirecting to the internal one drops them onto a hostname their session
     cookie was not set for, and they arrive signed out. `x-forwarded-host` is
     the externally-visible name; it is only trusted in production, where
     Vercel sets it — locally it is whatever the client sent. */
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? origin
      : `https://${forwardedHost}`;

  if (!code) {
    return NextResponse.redirect(`${base}/login`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] code exchange failed:", error.message);
    return NextResponse.redirect(`${base}/login`);
  }

  /* Whether this account is *allowed* into the manager is not decided here.
     Middleware re-checks the owners table on the way to /manager and diverts
     to /no-access if there is no row. Doing it there rather than here keeps
     one place responsible for that question. */
  return NextResponse.redirect(`${base}${next}`);
}
