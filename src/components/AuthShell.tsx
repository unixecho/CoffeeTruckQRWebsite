"use client";

import { KeyRound, ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * The frame /login and /no-access share.
 *
 * Both are one glyph, one line of explanation, and one action — the shape iOS
 * uses for a screen that exists to tell you something rather than to be worked
 * in. Keeping them in one component is what stops the two drifting apart, and
 * they are seen back to back often enough for a drift to be noticeable.
 *
 * The caller passes a `variant`, not an icon. That is not a style choice: both
 * pages are Server Components, and a Lucide icon is a *function*, which cannot
 * cross the server-to-client boundary — passing one fails the production build
 * with "Functions cannot be passed directly to Client Components". Naming the
 * variant keeps the choice on this side of the wire, where the icon lives.
 */
const VARIANTS = {
  signin: { icon: KeyRound, titleKey: "signIn", bodyKey: "signInBlurb" },
  noAccess: { icon: ShieldX, titleKey: "noAccessTitle", bodyKey: "noAccessMessage" },
} as const;

export type AuthVariant = keyof typeof VARIANTS;

export function AuthShell({
  variant,
  children,
  footer,
}: {
  variant: AuthVariant;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const { icon: Glyph, titleKey, bodyKey } = VARIANTS[variant];

  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center px-6"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="animate-rise-in flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-[var(--radius-card)]"
          style={{ backgroundColor: "var(--fill-tertiary)" }}
        >
          <Glyph size={28} strokeWidth={1.75} style={{ color: "var(--ios-blue)" }} />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="text-title-1">{t.manager[titleKey]}</h1>
          <p className="text-subheadline text-balance" style={{ color: "var(--label-secondary)" }}>
            {t.manager[bodyKey]}
          </p>
        </div>

        <div className="flex w-full flex-col items-center gap-3">{children}</div>

        {footer}
      </div>
    </main>
  );
}
