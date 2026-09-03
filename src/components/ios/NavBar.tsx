"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { ICON_SIZE } from "./Icon";

/**
 * iOS large-title navigation bar.
 *
 * The large title sits in the scroll flow and collapses into the fixed,
 * translucent bar as it scrolls away — matching UINavigationBar's
 * `prefersLargeTitles` behavior. Collapse is driven by an IntersectionObserver
 * on a sentinel rather than a scroll handler, keeping the main thread free.
 */
export function NavBar({
  title,
  backTo,
  backLabel = "Back",
  trailing,
  subtitle,
}: {
  title: string;
  /** Omit for a root screen; the back affordance is then hidden. */
  backTo?: string;
  backLabel?: string;
  trailing?: ReactNode;
  subtitle?: string;
}) {
  const router = useRouter();
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    /* The sentinel sits directly below the large title. Shrinking the root by
       the bar's height means it stops intersecting exactly as the large title
       slides under the bar — which is the moment the compact title appears. */
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-44px 0px 0px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function goBack() {
    haptic("light");
    if (backTo) router.push(backTo);
  }

  return (
    <>
      <header
        className="sticky top-0 z-30 backdrop-blur-xl"
        style={{
          backgroundColor: collapsed ? "var(--material-bar)" : "transparent",
          borderBottom: collapsed
            ? "0.5px solid var(--separator)"
            : "0.5px solid transparent",
          transition: "background-color 0.25s var(--ease-ios), border-color 0.25s var(--ease-ios)",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div className="mx-auto flex h-11 max-w-3xl items-center gap-1 px-4">
          <div className="flex min-w-0 flex-1 items-center">
            {backTo && (
              <button
                onClick={goBack}
                className="press -ms-2 flex min-h-11 items-center gap-0.5 rounded-lg pe-2 ps-1"
                style={{ color: "var(--ios-blue)" }}
              >
                {/* The glyph is physical, the meaning is logical: "back" points at the
                    leading edge, which is the right-hand side in Hebrew and Arabic.
                    `--dir` is set from `dir` on <html> in globals.css. */}
                <ChevronLeft
                  size={ICON_SIZE.lg}
                  strokeWidth={2.5}
                  aria-hidden="true"
                  style={{ transform: "scaleX(var(--dir, 1))" }}
                />
                <span className="text-body truncate">{backLabel}</span>
              </button>
            )}
          </div>

          <h1
            className="text-headline pointer-events-none max-w-[55%] truncate text-center"
            style={{
              opacity: collapsed ? 1 : 0,
              transform: collapsed ? "translateY(0)" : "translateY(0.375rem)",
              transition: "opacity 0.25s var(--ease-ios), transform 0.25s var(--ease-ios)",
            }}
          >
            {title}
          </h1>

          <div className="flex flex-1 items-center justify-end gap-2">{trailing}</div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 pt-1 pb-2">
        <h2 className="text-large-title">{title}</h2>
        {subtitle && (
          <p className="text-subheadline mt-1" style={{ color: "var(--label-secondary)" }}>
            {subtitle}
          </p>
        )}
      </div>

      <div ref={sentinel} aria-hidden="true" className="h-px" />
    </>
  );
}
