"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { haptic } from "@/lib/haptics";

/**
 * A button-shaped navigation control.
 *
 * Distinct from `Button` on purpose: navigation must render a real anchor so
 * middle-click, open-in-new-tab, and assistive-tech link semantics all work.
 */
type LinkButtonVariant = "filled" | "tinted" | "gray" | "plain";
type LinkButtonSize = "sm" | "md" | "lg";

const SIZES: Record<LinkButtonSize, string> = {
  sm: "min-h-8 px-3 text-subheadline rounded-[8px]",
  md: "min-h-11 px-4 text-body rounded-[12px]",
  lg: "min-h-[50px] px-5 text-headline rounded-[14px]",
};

function variantStyle(variant: LinkButtonVariant): React.CSSProperties {
  switch (variant) {
    case "filled":
      return { backgroundColor: "var(--ios-blue)", color: "#fff" };
    case "tinted":
      return { backgroundColor: "var(--fill-tertiary)", color: "var(--ios-blue)" };
    case "gray":
      return { backgroundColor: "var(--fill-tertiary)", color: "var(--label-primary)" };
    case "plain":
      return { backgroundColor: "transparent", color: "var(--ios-blue)" };
  }
}

export function LinkButton({
  href,
  children,
  variant = "plain",
  size = "sm",
  fullWidth,
  ariaLabel,
}: {
  href: string;
  children: ReactNode;
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  fullWidth?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      onClick={() => haptic("light")}
      className={`press inline-flex items-center justify-center gap-1.5 font-medium ${SIZES[size]} ${
        fullWidth ? "w-full" : "shrink-0"
      }`}
      style={variantStyle(variant)}
    >
      {children}
    </Link>
  );
}
