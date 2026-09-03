"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronRight, Loader2, Minus, Plus } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { ICON_SIZE } from "./Icon";

/* ==========================================================================
   Button
   ========================================================================== */

type ButtonVariant = "filled" | "tinted" | "gray" | "plain" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

/* Width is never baked into a size — the caller owns layout, so buttons can
   sit side by side without one of them being forced to fill the row. */
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 text-subheadline rounded-[8px]",
  md: "min-h-11 px-4 text-body rounded-[12px]",
  lg: "min-h-[50px] px-5 text-headline rounded-[14px]",
};

function variantStyle(variant: ButtonVariant): React.CSSProperties {
  switch (variant) {
    case "filled":
      return { backgroundColor: "var(--ios-blue)", color: "#fff" };
    case "tinted":
      return { backgroundColor: "var(--fill-tertiary)", color: "var(--ios-blue)" };
    case "gray":
      return { backgroundColor: "var(--fill-tertiary)", color: "var(--label-primary)" };
    case "destructive":
      return { backgroundColor: "var(--ios-red)", color: "#fff" };
    case "plain":
      return { backgroundColor: "transparent", color: "var(--ios-blue)" };
  }
}

export function Button({
  children,
  onClick,
  variant = "filled",
  size = "md",
  loading,
  disabled,
  icon,
  type = "button",
  ariaLabel,
  fullWidth,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  type?: "button" | "submit";
  ariaLabel?: string;
  fullWidth?: boolean;
}) {
  const inert = disabled || loading;

  return (
    <button
      type={type}
      onClick={() => {
        if (inert) return;
        haptic(variant === "destructive" ? "warning" : "light");
        onClick?.();
      }}
      disabled={inert}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={`press inline-flex items-center justify-center gap-1.5 font-medium ${SIZES[size]} ${
        fullWidth ? "w-full" : "shrink-0"
      }`}
      style={{
        ...variantStyle(variant),
        opacity: inert ? 0.4 : 1,
      }}
    >
      {loading ? (
        <Loader2
          size={ICON_SIZE.sm}
          strokeWidth={2.5}
          className="shrink-0"
          style={{ animation: "ios-spin 0.7s linear infinite" }}
          aria-hidden="true"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

/* ==========================================================================
   Switch — the iOS toggle
   ========================================================================== */

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Required for assistive tech when the row's text isn't programmatically tied. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        haptic("light");
        onChange(!checked);
      }}
      className="relative shrink-0 rounded-full"
      style={{
        width: 51,
        height: 31,
        backgroundColor: checked ? "var(--ios-green)" : "var(--fill-primary)",
        transition: "background-color 0.25s var(--ease-ios)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <span
        className="absolute top-0.5 left-0.5 rounded-full bg-white"
        style={{
          width: 27,
          height: 27,
          boxShadow: "0 3px 8px rgb(0 0 0 / 0.15), 0 1px 1px rgb(0 0 0 / 0.16)",
          transform: checked ? "translateX(20px)" : "translateX(0)",
          transition: "transform 0.25s var(--ease-ios)",
        }}
      />
    </button>
  );
}

/* ==========================================================================
   Segmented control
   ========================================================================== */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      className="relative flex rounded-[9px] p-0.5"
      style={{ backgroundColor: "var(--fill-quaternary)" }}
    >
      {/* One sliding pill rather than each button toggling its own
          background — reads as a single control moving, not options
          swapping places. The math assumes a physical left-to-right track
          (`translateX` is a physical transform, not a logical one); callers
          inside RTL content that want the track itself to stay in a fixed
          order — a language switcher, say — should wrap this in a
          `dir="ltr"` container rather than let it mirror. */}
      <div
        aria-hidden="true"
        className="absolute rounded-[7px]"
        style={{
          top: 2,
          bottom: 2,
          insetInlineStart: 2,
          width: `calc((100% - 4px) / ${options.length})`,
          /* `translateX` is physical while the flex track mirrors, so the
             travel has to be signed by the reading direction or the pill
             walks off the wrong end in Hebrew and Arabic. */
          transform: `translateX(calc(${index * 100}% * var(--dir, 1)))`,
          backgroundColor: "var(--bg-grouped-secondary)",
          boxShadow: "0 1px 3px rgb(0 0 0 / 0.12)",
          transition: "transform 0.28s var(--ease-ios)",
        }}
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => {
              haptic("selection");
              onChange(option.value);
            }}
            className="text-subheadline relative z-10 min-h-8 flex-1 rounded-[7px] px-3 font-medium"
            style={{
              color: "var(--label-primary)",
              transition: "color 0.2s var(--ease-ios)",
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   Text field — iOS grouped-list input
   ========================================================================== */

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  helper,
  error,
  multiline,
  prefix,
  suffix,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "url";
  inputMode?: "text" | "decimal" | "numeric" | "url";
  helper?: string;
  error?: string;
  multiline?: boolean;
  /** Static leading text inside the field, e.g. a currency symbol. */
  prefix?: string;
  /** Static trailing text inside the field, e.g. a unit like "g". */
  suffix?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : helper ? `${id}-helper` : undefined;

  const shared = {
    id,
    value,
    placeholder,
    "aria-describedby": describedBy,
    "aria-invalid": Boolean(error) || undefined,
    className: "text-body w-full bg-transparent outline-none placeholder:font-normal",
    style: { color: "var(--label-primary)" },
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
        {label}
      </label>

      {/* A subtle fill rather than a surface colour: these sit inside white
          grouped cards, where a surface-coloured field would be invisible. */}
      <div
        className="flex items-center gap-1.5 px-3.5 py-2.5"
        style={{
          backgroundColor: "var(--fill-quaternary)",
          borderRadius: "var(--radius-button)",
          border: `1px solid ${error ? "var(--ios-red)" : "transparent"}`,
          minHeight: 44,
        }}
      >
        {prefix && (
          <span className="text-body shrink-0" style={{ color: "var(--label-secondary)" }}>
            {prefix}
          </span>
        )}
        {multiline ? (
          <textarea
            {...shared}
            rows={3}
            autoFocus={autoFocus}
            className={`${shared.className} resize-none`}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            {...shared}
            type={type}
            inputMode={inputMode}
            autoFocus={autoFocus}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {suffix && (
          <span className="text-body shrink-0" style={{ color: "var(--label-secondary)" }}>
            {suffix}
          </span>
        )}
      </div>

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-footnote px-1" style={{ color: "var(--ios-red)" }}>
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-helper`} className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Stepper — a labelled +/- control for small counts, matching UIStepper
   ========================================================================== */

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  decreaseLabel = "Decrease",
  increaseLabel = "Increase",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decreaseLabel?: string;
  increaseLabel?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <StepperButton
        label={decreaseLabel}
        icon={Minus}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      />
      <span className="text-headline tabular w-10 text-center" aria-live="polite">
        {value}
      </span>
      <StepperButton
        label={increaseLabel}
        icon={Plus}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      />
    </span>
  );
}

function StepperButton({
  label,
  icon: Glyph,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Plus;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        haptic("light");
        onClick();
      }}
      // 44pt touch target even though the visible glyph is smaller.
      className="press flex size-11 items-center justify-center rounded-full"
      style={{
        backgroundColor: "var(--fill-tertiary)",
        color: "var(--label-primary)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Glyph size={ICON_SIZE.md} strokeWidth={2.5} aria-hidden="true" />
    </button>
  );
}

/* ==========================================================================
   Disclosure — a collapsible "Advanced" section, iOS Settings style

   Secondary fields that matter to few people (an odd spool size, a custom
   reorder threshold) start collapsed so the common path stays short, but
   are never hidden entirely — nothing here should require a support call.
   ========================================================================== */

export function Disclosure({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          haptic("light");
          setOpen((current) => !current);
        }}
        className="press text-subheadline -ms-1 flex min-h-9 items-center gap-1 px-1 font-medium"
        style={{ color: "var(--ios-blue)" }}
      >
        <ChevronRight
          size={ICON_SIZE.sm}
          strokeWidth={2.75}
          aria-hidden="true"
          style={{
            transform: open
              ? "rotate(90deg)"
              : "rotate(0deg) scaleX(var(--dir, 1))",
            transition: "transform 0.22s var(--ease-ios)",
          }}
        />
        {label}
      </button>
      {open && <div className="animate-rise-in mt-3 flex flex-col gap-4">{children}</div>}
    </div>
  );
}
