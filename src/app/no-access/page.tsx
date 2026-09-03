import type { Metadata } from "next";
import { ShieldX } from "lucide-react";
import { AuthShell } from "@/components/AuthShell";
import { SignOutButton } from "@/components/SignInButton";
import { BackToShopLink } from "@/components/BackToShopLink";

export const metadata: Metadata = {
  title: "אין הרשאה",
  robots: { index: false, follow: false },
};

/**
 * Signed in, but not allowed in.
 *
 * Google sign-in is open to any Google account, so this is a normal thing to
 * land on rather than an error — someone the owner has not invited yet, or an
 * invite sent to a different address than the one they actually used.
 *
 * Deliberately does NOT offer "sign in" again. They are already signed in;
 * offering the button reads as "try again", and trying again changes nothing.
 * The two useful actions are leaving, and signing out to try a different
 * Google account — which is the actual fix when the invite went to the wrong
 * address.
 */
export default function NoAccessPage() {
  return (
    <AuthShell
      icon={ShieldX}
      titleKey="noAccessTitle"
      bodyKey="noAccessMessage"
      footer={<BackToShopLink />}
    >
      <SignOutButton />
    </AuthShell>
  );
}
