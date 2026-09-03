"use client";

import { Search, X } from "lucide-react";
import { ICON_SIZE } from "./Icon";
import { haptic } from "@/lib/haptics";

/** iOS UISearchBar: rounded fill, leading glyph, clear button once non-empty. */
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  label = "Search",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5"
      style={{
        backgroundColor: "var(--fill-tertiary)",
        borderRadius: "var(--radius-control)",
        minHeight: 36,
      }}
    >
      <Search
        size={ICON_SIZE.sm}
        strokeWidth={2.5}
        aria-hidden="true"
        className="shrink-0"
        style={{ color: "var(--label-secondary)" }}
      />
      <input
        type="search"
        role="searchbox"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="text-body w-full bg-transparent py-1.5 outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            haptic("selection");
            onChange("");
          }}
          className="press flex size-5 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--label-tertiary)" }}
        >
          <X size={12} strokeWidth={3} color="var(--bg-grouped-secondary)" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
