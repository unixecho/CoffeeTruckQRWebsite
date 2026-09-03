"use client";

import type { LucideIcon } from "lucide-react";
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
 * A client component only because the strings come from `useI18n()`, which
 * reads the visitor's stored language.
 */
export function AuthShell({
  icon: Glyph,
  titleKey,
  bodyKey,
  children,
  footer,
}: {
  icon: LucideIcon;
  titleKey: "signIn" | "noAccessTitle";
  bodyKey: "signInBlurb" | "noAccessMessage";
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center px-6"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
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
