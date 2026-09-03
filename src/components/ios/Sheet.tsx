"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { haptic } from "@/lib/haptics";

/**
 * Modal sheet presented from the bottom edge, matching UISheetPresentation.
 *
 * Supports the three dismissal routes iOS users expect: the grabber drag,
 * a tap on the dimmed backdrop, and the Escape key. Body scroll is locked
 * while presented so the page behind cannot move under the sheet.
 */
interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Localized label for the backdrop dismiss button. */
  dismissLabel: string;
}

/* Unmounting while closed gives the panel fresh drag state on every present,
   with no effect needed to reset it. */
export function Sheet({ open, ...props }: SheetProps) {
  if (!open) return null;
  return <SheetPanel {...props} />;
}

function SheetPanel({ onClose, title, children, footer, dismissLabel }: Omit<SheetProps, "open">) {
  const panel = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);

  /* Mount-only: locks the page behind the sheet and moves focus in once.
     This must NOT depend on `onClose` — every call site passes an inline
     `() => setX(null)`, a fresh function identity on every render, and this
     component re-renders on every keystroke typed into any field inside the
     sheet (the field's onChange updates state in the parent page). If
     `panel.current?.focus()` lived in an effect keyed on `onClose`, it would
     re-run after each keystroke and steal focus back to the panel container
     mid-word — the "can only type one character before it stops responding"
     bug. Splitting this out is what actually fixes it, project-wide, rather
     than asking every caller to memoize the callback it passes in. */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  /* Kept separate so Escape always calls the latest `onClose` without that
     requirement dragging the focus/scroll-lock effect above along with it. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function onPointerDown(event: React.PointerEvent) {
    dragStart.current = event.clientY;
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (dragStart.current === null) return;
    // Only track downward movement; upward drag must not stretch the sheet.
    setDragY(Math.max(0, event.clientY - dragStart.current));
  }

  function onPointerUp() {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragging(false);
    // Past ~120px the gesture reads as a dismiss rather than a nudge.
    if (dragY > 120) {
      haptic("light");
      onClose();
    } else {
      setDragY(0);
    }
  }

  /* Portalled to `document.body` rather than rendered in place: `fixed`
     only escapes to the viewport if no ancestor sets `transform`,
     `filter`, `backdrop-filter`, `perspective`, or `will-change` — any of
     those makes that ancestor the containing block instead. Both the shop
     and manager headers are `backdrop-blur-xl`, so a trigger button living
     in either one (the settings icon, anything in `NavBar`) would otherwise
     pin this sheet inside a 48px-tall header box instead of the viewport,
     clipping most of it off-screen above. */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        aria-label={dismissLabel}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 cursor-default"
        style={{ backgroundColor: "var(--scrim)", backdropFilter: "blur(2px)" }}
      />

      {/* Never flush against the viewport edge on desktop: the padding
          above guarantees breathing room so a short sheet can't end up
          reading as clipped even at an unusually short window height. */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-sheet-in relative flex max-h-[88vh] w-full flex-col rounded-t-[var(--radius-sheet)] outline-none sm:max-h-[calc(100vh-2rem)] sm:max-w-lg sm:rounded-[var(--radius-sheet)]"
        style={{
          backgroundColor: "var(--material-sheet)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid var(--glass-border)",
          boxShadow: "var(--shadow-sheet)",
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : "transform 0.3s var(--ease-ios)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 pb-1 active:cursor-grabbing"
        >
          <span
            aria-hidden="true"
            className="h-1 w-9 rounded-full"
            style={{ backgroundColor: "var(--label-quaternary)" }}
          />
        </div>

        <header className="shrink-0 px-5 pt-2 pb-3">
          <h2 className="text-title-3">{title}</h2>
        </header>

        <div className="scroll-region flex-1 overflow-y-auto px-5 pb-4">{children}</div>

        {footer && (
          <footer
            className="shrink-0 px-5 pt-3 pb-5"
            style={{ borderTop: "0.5px solid var(--separator)" }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ==========================================================================
   Action sheet — a short list of choices, with destructive actions separated
   ========================================================================== */

export interface SheetAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

export function ActionSheet({
  open,
  onClose,
  title,
  message,
  actions,
  cancelLabel,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  actions: SheetAction[];
  /** Localized. The cancel row is part of the control, not a caller's button. */
  cancelLabel: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Portalled for the same reason as `SheetPanel` above — see its comment.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center">
      <button
        aria-label={cancelLabel}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 cursor-default"
        style={{ backgroundColor: "var(--scrim)" }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Actions"}
        className="animate-sheet-in relative w-full sm:max-w-sm"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          className="mb-2 overflow-hidden"
          style={{
            backgroundColor: "var(--material-sheet)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            border: "1px solid var(--glass-border)",
            borderRadius: "var(--radius-card)",
          }}
        >
          {(title || message) && (
            <div
              className="px-4 py-3 text-center"
              style={{ borderBottom: "0.5px solid var(--separator)" }}
            >
              {title && (
                <p className="text-footnote font-semibold" style={{ color: "var(--label-secondary)" }}>
                  {title}
                </p>
              )}
              {message && (
                <p className="text-footnote mt-0.5" style={{ color: "var(--label-secondary)" }}>
                  {message}
                </p>
              )}
            </div>
          )}

          {actions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                haptic(action.destructive ? "warning" : "selection");
                action.onSelect();
                onClose();
              }}
              className="press-row text-body min-h-[57px] w-full px-4 [&:not(:last-child)]:border-b-[0.5px]"
              style={{
                borderBottomColor: "var(--separator)",
                color: action.destructive ? "var(--ios-red)" : "var(--ios-blue)",
              }}
            >
              {action.label}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="press text-headline min-h-[57px] w-full"
          style={{
            backgroundColor: "var(--bg-grouped-secondary)",
            borderRadius: "var(--radius-card)",
            color: "var(--ios-blue)",
          }}
        >
          {cancelLabel}
        </button>
      </div>
    </div>,
    document.body
  );
}
