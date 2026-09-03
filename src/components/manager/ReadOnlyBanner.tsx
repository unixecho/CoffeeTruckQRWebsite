"use client";

import { CloudOff } from "lucide-react";
import { ICON_SIZE } from "@/components/ios/Icon";
import { useI18n } from "@/lib/i18n";

/**
 * Shown across the manager when the catalogue came from `seed.json` rather
 * than the database.
 *
 * The manager must never pretend a save worked. Every write control on a
 * read-only screen is disabled, and this says why — an editor that accepts a
 * price and silently drops it is worse than one that refuses.
 *
 * Calm rather than alarming: orange, not red. Nothing is broken; the database
 * simply is not connected yet, and that is a setup step, not an incident.
 */
export function ReadOnlyBanner() {
  const { t } = useI18n();

  return (
    <div
      role="status"
      className="animate-rise-in mb-6 flex items-start gap-3 p-4"
      style={{
        backgroundColor: "var(--fill-quaternary)",
        borderRadius: "var(--radius-card)",
        borderInlineStart: "3px solid var(--ios-orange)",
      }}
    >
      <CloudOff
        size={ICON_SIZE.md}
        strokeWidth={2}
        aria-hidden="true"
        className="mt-0.5 shrink-0"
        style={{ color: "var(--ios-orange)" }}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-subheadline font-semibold">{t.manager.readOnlyTitle}</p>
        <p className="text-footnote" style={{ color: "var(--label-secondary)" }}>
          {t.manager.readOnlyMessage}
        </p>
      </div>
    </div>
  );
}
