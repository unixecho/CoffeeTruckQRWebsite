"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ios/Controls";
import { ICON_SIZE } from "@/components/ios/Icon";
import { useToast } from "@/components/ios/Feedback";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";

/* ==========================================================================
   The two auth controls

   Both live here because they are the only places in the app that talk to
   Supabase auth from the browser. Everything else reads the session on the
   server, where it cannot be lied to.
   ========================================================================== */

export function SignInButton({ next }: { next: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);

    /* The redirect target is built from `window.location.origin` rather than
       an env var so this works unchanged on localhost, on a Vercel preview
       URL, and in production — three origins that would otherwise each need
       their own configuration. `next` has already been validated by
       `safeNext()` on the server that rendered this page. */
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      // Only reached when the request never left; a successful call navigates
      // away and this component unmounts before the promise settles.
      setBusy(false);
      toast(t.common.somethingWentWrong, "error");
    }
  }

  return (
    <Button
      onClick={signIn}
      loading={busy}
      size="lg"
      fullWidth
      icon={<LogIn size={ICON_SIZE.md} strokeWidth={2.25} aria-hidden="true" />}
    >
      {t.manager.signInWithGoogle}
    </Button>
  );
}

export function SignOutButton({ variant = "gray" }: { variant?: "gray" | "plain" }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    await createClient().auth.signOut();
    /* `refresh()` then `replace()`: the refresh drops the cached Server
       Component payload that still believes there is an owner, and the replace
       leaves no history entry pointing back into the manager. */
    router.refresh();
    router.replace("/");
  }

  return (
    <Button
      onClick={signOut}
      loading={busy}
      variant={variant}
      icon={<LogOut size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />}
    >
      {t.manager.signOut}
    </Button>
  );
}
