"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Check, AlertTriangle, Loader2, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { ICON_SIZE } from "./Icon";

/* ==========================================================================
   Spinner
   ========================================================================== */

export function Spinner({ size = ICON_SIZE.md, label }: { size?: number; label?: string }) {
  return (
    <Loader2
      size={size}
      strokeWidth={2.5}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ animation: "ios-spin 0.7s linear infinite", color: "var(--label-secondary)" }}
    />
  );
}

/* ==========================================================================
   Toast / HUD
   ========================================================================== */

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const TONE: Record<ToastTone, { icon: LucideIcon; color: string }> = {
  success: { icon: Check, color: "var(--ios-green)" },
  error: { icon: AlertTriangle, color: "var(--ios-red)" },
  info: { icon: Info, color: "var(--ios-blue)" },
};

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/**
 * Toasts announce politely and never take focus, so they cannot interrupt a
 * keyboard or screen reader user mid-task.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now() + Math.random();
    haptic(tone === "error" ? "error" : tone === "success" ? "success" : "light");
    setToasts((current) => [...current, { id, message, tone }]);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDone={() => setToasts((c) => c.filter((t) => t.id !== toast.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3200);
    return () => clearTimeout(timer);
  }, [onDone]);

  const { icon: Glyph, color } = TONE[toast.tone];

  return (
    <div
      className="animate-hud-in flex max-w-sm items-center gap-2.5 px-4 py-2.5"
      style={{
        backgroundColor: "var(--material-sheet)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        borderRadius: "var(--radius-sheet)",
        boxShadow: "var(--shadow-hud)",
        border: "1px solid var(--glass-border)",
      }}
    >
      <Glyph size={ICON_SIZE.md} strokeWidth={2.5} style={{ color }} aria-hidden="true" />
      <span className="text-subheadline font-medium">{toast.message}</span>
    </div>
  );
}

/* ==========================================================================
   Empty state
   ========================================================================== */

export function EmptyState({
  icon: Glyph,
  title,
  message,
  action,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      <Glyph
        size={44}
        strokeWidth={1.5}
        aria-hidden="true"
        style={{ color: "var(--label-quaternary)" }}
      />
      <h3 className="text-title-3">{title}</h3>
      <p
        className="text-subheadline max-w-xs text-balance"
        style={{ color: "var(--label-secondary)" }}
      >
        {message}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ==========================================================================
   Skeleton — shown instead of a blocking spinner for content over ~300ms
   ========================================================================== */

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg ${className}`}
      style={{ backgroundColor: "var(--fill-quaternary)" }}
    />
  );
}

/* ==========================================================================
   Progress bar
   ========================================================================== */

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-1 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: "var(--fill-tertiary)" }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${clamped}%`,
          backgroundColor: "var(--ios-blue)",
          transition: "width 0.3s var(--ease-ios)",
        }}
      />
    </div>
  );
}
