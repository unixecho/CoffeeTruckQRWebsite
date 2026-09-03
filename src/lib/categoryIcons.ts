import {
  Boxes,
  Car,
  Coffee,
  CupSoda,
  Flower2,
  Gamepad2,
  Gift,
  Headphones,
  Heart,
  KeyRound,
  Lamp,
  Magnet,
  MousePointerClick,
  Package,
  Puzzle,
  Sparkles,
  Star,
  Trophy,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Category and subclass styling.
 *
 * A category stores an icon *name* and a tint *name*, never a component or a
 * hex value, so the owner's choice survives a round trip through the database
 * and still resolves to a real icon in the browser. Keeping the set curated
 * also stops the interface drifting into a mix of unrelated icon styles the
 * first time someone wants a picture of a cat.
 *
 * Lucide only — never emoji. Emoji render differently on every platform, they
 * cannot be tinted, and they are read aloud by screen readers as whatever
 * their Unicode name happens to be.
 */
export const CATEGORY_ICONS = {
  KeyRound,
  MousePointerClick,
  Sparkles,
  Magnet,
  CupSoda,
  Coffee,
  Trophy,
  Lamp,
  Package,
  Boxes,
  Gamepad2,
  Car,
  Heart,
  Star,
  Gift,
  Wrench,
  Puzzle,
  Headphones,
  Flower2,
} satisfies Record<string, LucideIcon>;

export type CategoryIconName = keyof typeof CATEGORY_ICONS;

/**
 * Tints resolve to design tokens, not raw colours, so a category looks right
 * in both light and dark. Hardcoding `#007AFF` would give a blue too dim to
 * read on black.
 */
export const CATEGORY_TINTS = {
  blue: "var(--ios-blue)",
  green: "var(--ios-green)",
  indigo: "var(--ios-indigo)",
  orange: "var(--ios-orange)",
  pink: "var(--ios-pink)",
  purple: "var(--ios-purple)",
  red: "var(--ios-red)",
  teal: "var(--ios-teal)",
  yellow: "var(--ios-yellow)",
  gray: "var(--ios-gray)",
} as const;

export type CategoryTintName = keyof typeof CATEGORY_TINTS;

export const ICON_NAMES = Object.keys(CATEGORY_ICONS) as CategoryIconName[];
export const TINT_NAMES = Object.keys(CATEGORY_TINTS) as CategoryTintName[];

export function resolveIcon(name: string | null | undefined): LucideIcon {
  return CATEGORY_ICONS[name as CategoryIconName] ?? Package;
}

export function resolveTint(name: string | null | undefined): string {
  return CATEGORY_TINTS[name as CategoryTintName] ?? CATEGORY_TINTS.gray;
}

export function isIconName(name: string): name is CategoryIconName {
  return name in CATEGORY_ICONS;
}

export function isTintName(name: string): name is CategoryTintName {
  return name in CATEGORY_TINTS;
}
