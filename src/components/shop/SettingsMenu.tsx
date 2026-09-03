"use client";

import { useState } from "react";
import { Globe } from "lucide-react";
import { Sheet } from "@/components/ios/Sheet";
import { SegmentedControl } from "@/components/ios/Controls";
import { ICON_SIZE } from "@/components/ios/Icon";
import { haptic } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";
import { useTheme, type Theme } from "@/lib/theme";
import { LOCALES, type Locale } from "@/lib/types";

/**
 * Language and appearance, behind one pinned globe.
 *
 * Pinned to the top-LEFT **physically**, with `left` rather than
 * `inset-inline-start`. This is one of the two deliberate exceptions to the
 * logical-properties rule in this codebase (the WhatsApp widget is the other),
 * and the reason is the same: a control that changes corner when you change
 * language is a control you have to hunt for immediately after using it. It
 * lives where the thumb learned it lives.
 */
export function SettingsMenu() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const s = t.manager.settingsScreen;

  return (
    <>
      <button
        type="button"
        aria-label={t.common.settings}
        onClick={() => {
          haptic("light");
          setOpen(true);
        }}
        className="press fixed z-40 flex size-11 items-center justify-center rounded-full backdrop-blur-xl"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
          left: "calc(env(safe-area-inset-left, 0px) + 0.75rem)",
          backgroundColor: "var(--material-bar)",
          border: "0.5px solid var(--glass-border)",
          color: "var(--label-primary)",
        }}
      >
        <Globe size={ICON_SIZE.md} strokeWidth={2} aria-hidden="true" />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissLabel={t.common.dismiss}
        title={t.common.settings}
      >
        <div className="flex flex-col gap-6 pb-2">
          <div className="flex flex-col gap-2">
            <span className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
              {t.common.language}
            </span>
            {/* The track itself must not mirror. Each language is written in
                its own script — the convention iOS uses — so the order is a
                fixed list of three names, not a reading order. */}
            <div dir="ltr">
              <SegmentedControl<Locale>
                label={t.common.language}
                value={locale}
                onChange={setLocale}
                options={LOCALES.map((code) => ({
                  value: code,
                  label: code === "he" ? s.langHe : code === "en" ? s.langEn : s.langAr,
                }))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
              {t.common.appearance}
            </span>
            <SegmentedControl<Theme>
              label={t.common.appearance}
              value={theme}
              onChange={setTheme}
              options={[
                { value: "dark", label: t.common.dark },
                { value: "light", label: t.common.light },
              ]}
            />
          </div>
        </div>
      </Sheet>
    </>
  );
}
