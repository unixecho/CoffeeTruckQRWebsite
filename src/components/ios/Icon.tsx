import type { LucideIcon } from "lucide-react";

/**
 * Icon sizes as tokens. Never pass arbitrary pixel values — mixing 20/24/28
 * randomly is the fastest way to make an interface look amateur.
 */
export const ICON_SIZE = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

export type IconSize = keyof typeof ICON_SIZE;

/**
 * The rounded-square tinted icon used in iOS Settings-style list rows.
 * Provides the 29pt colored container that makes grouped lists scannable.
 */
export function IconTile({
  icon: Glyph,
  tint,
  size = "md",
}: {
  icon: LucideIcon;
  /** A CSS color — pass a design token such as `var(--ios-blue)`. */
  tint: string;
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? 32 : 29;
  const glyph = size === "lg" ? ICON_SIZE.md : ICON_SIZE.sm;

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[7px]"
      style={{ width: box, height: box, backgroundColor: tint }}
    >
      <Glyph size={glyph} strokeWidth={2.25} color="#fff" />
    </span>
  );
}
