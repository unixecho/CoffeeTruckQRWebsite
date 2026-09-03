"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { ICON_SIZE } from "@/components/ios/Icon";

/**
 * A labelled select, styled to match `TextField`.
 *
 * A native `<select>` rather than a custom listbox, deliberately: on a phone
 * it opens the platform's own wheel, which is faster to use one-handed than
 * anything reimplementable, is already accessible, and already handles a long
 * list. The only thing added is the chrome so it does not look out of place.
 */
export function Picker({
  label,
  value,
  options,
  onChange,
  error,
  helper,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (next: string) => void;
  error?: string;
  helper?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : helper ? `${id}-helper` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
        {label}
      </label>

      <div
        className="relative flex items-center"
        style={{
          backgroundColor: "var(--fill-quaternary)",
          borderRadius: "var(--radius-button)",
          border: `1px solid ${error ? "var(--ios-red)" : "transparent"}`,
          minHeight: 44,
        }}
      >
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
          onChange={(event) => onChange(event.target.value)}
          /* `appearance-none` plus a drawn chevron, because the native arrow
             sits on whichever side the platform decides and would end up on
             the wrong one in Hebrew. `pe-10` reserves room for ours. */
          className="text-body w-full appearance-none bg-transparent px-3.5 py-2.5 pe-10 outline-none"
          style={{ color: "var(--label-primary)" }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <ChevronDown
          size={ICON_SIZE.sm}
          strokeWidth={2.5}
          aria-hidden="true"
          className="pointer-events-none absolute end-3.5"
          style={{ color: "var(--label-tertiary)" }}
        />
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
