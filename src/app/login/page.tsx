import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { SignInButton } from "@/components/SignInButton";
import { AuthShell } from "@/components/AuthShell";
import { safeNext } from "@/lib/redirect";

export const metadata: Metadata = {
  title: "כניסה",
  // The manager is not for customers and there is nothing here worth indexing.
  robots: { index: false, follow: false },
};

/**
 * The one door into the manager.
 *
 * `next` arrives in the query string and is echoed back through Google, so it
 * is attacker-controllable end to end — `safeNext()` is what stops this page
 * being used as an open redirect off the shop's own domain.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <AuthShell icon={KeyRound} titleKey="signIn" bodyKey="signInBlurb">
      <SignInButton next={safeNext(next)} />
    </AuthShell>
  );
}
