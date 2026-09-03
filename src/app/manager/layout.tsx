import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagerNav } from "@/components/manager/ManagerNav";
import { getOwner } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "ניהול קטלוג",
  robots: { index: false, follow: false },
};

/* The manager reads live data and must never be served from a cache — an
   owner who edits a price and sees the old one is an owner who edits it
   twice. */
export const dynamic = "force-dynamic";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  /* Middleware has already gated this path, so reaching here without an owner
     means either the session expired between the two checks or Supabase is not
     configured at all. The first redirects; the second falls through, because
     the manager's own read-only screen explains that situation far better than
     a redirect to a login page that cannot work either. */
  if (isSupabaseConfigured()) {
    const { owner } = await getOwner();
    if (!owner) redirect("/login?next=%2Fmanager");
  }

  return (
    <>
      <ManagerNav />
      {/* Room for the tab bar on a phone, for the sidebar from lg up. Both are
          fixed, so the content has to reserve the space itself. */}
      <div className="lg:ps-60">
        <main className="mx-auto max-w-3xl px-4 pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:pb-10">
          {children}
        </main>
      </div>
    </>
  );
}
