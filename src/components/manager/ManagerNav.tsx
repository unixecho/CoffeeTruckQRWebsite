"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, ClipboardList, Settings, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { ICON_SIZE } from "@/components/ios/Icon";
import { useI18n } from "@/lib/i18n";

/**
 * Primary navigation for the manager.
 *
 * Adaptive per Apple's compact/regular split: a bottom tab bar on a phone,
 * a persistent sidebar from `lg` up. Both are always mounted and toggled with
 * CSS, so nothing re-mounts on a route change.
 *
 * Four destinations. iOS caps a tab bar at five, and this is the ceiling —
 * everything else is reached from the screen it belongs to. Orders sits second
 * rather than last because it is the only tab with a queue behind it: the
 * catalogue is edited between customers, orders are read during one.
 */
const DESTINATIONS: {
  href: string;
  icon: LucideIcon;
  key: "catalogue" | "orders" | "deals" | "settings";
}[] = [
  { href: "/manager", icon: Boxes, key: "catalogue" },
  { href: "/manager/orders", icon: ClipboardList, key: "orders" },
  { href: "/manager/deals", icon: Tag, key: "deals" },
  { href: "/manager/settings", icon: Settings, key: "settings" },
];

function isActive(pathname: string, href: string): boolean {
  // "/manager" must not light up while on "/manager/deals".
  return href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);
}

export function ManagerNav() {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <>
      {/* Compact — bottom tab bar. */}
      <nav
        aria-label={t.manager.title}
        className="fixed inset-x-0 bottom-0 z-40 backdrop-blur-xl lg:hidden"
        style={{
          backgroundColor: "var(--material-bar)",
          borderTop: "0.5px solid var(--separator)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <ul className="mx-auto flex max-w-md">
          {DESTINATIONS.map(({ href, icon: Glyph, key }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  onClick={() => haptic("selection")}
                  aria-current={active ? "page" : undefined}
                  className="press flex min-h-[49px] flex-col items-center justify-center gap-0.5 pt-1.5 pb-1"
                  style={{ color: active ? "var(--ios-blue)" : "var(--label-secondary)" }}
                >
                  {/* Weight as well as colour: colour is never the only signal. */}
                  <Glyph size={ICON_SIZE.lg} strokeWidth={active ? 2.4 : 1.9} aria-hidden="true" />
                  <span className="text-caption-2 font-medium">{t.manager.tabs[key]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Regular — sidebar. Anchored to the leading edge, so it sits on the
          right in Hebrew and Arabic and on the left in English. */}
      <nav
        aria-label={t.manager.title}
        className="fixed inset-y-0 start-0 z-40 hidden w-60 flex-col gap-1 px-3 py-5 lg:flex"
        style={{
          backgroundColor: "var(--bg-secondary)",
          borderInlineEnd: "0.5px solid var(--separator)",
        }}
      >
        <p
          className="text-caption-1 px-3 pb-2 font-semibold tracking-wide uppercase"
          style={{ color: "var(--label-tertiary)" }}
        >
          {t.manager.title}
        </p>
        {DESTINATIONS.map(({ href, icon: Glyph, key }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => haptic("selection")}
              aria-current={active ? "page" : undefined}
              className="press flex min-h-11 items-center gap-3 rounded-[10px] px-3"
              style={{
                backgroundColor: active ? "var(--ios-blue)" : "transparent",
                color: active ? "#fff" : "var(--label-primary)",
              }}
            >
              <Glyph size={ICON_SIZE.md} strokeWidth={2} aria-hidden="true" />
              <span className="text-body flex-1 font-medium">{t.manager.tabs[key]}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
