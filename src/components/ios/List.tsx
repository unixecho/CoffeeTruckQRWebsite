"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { ICON_SIZE } from "./Icon";

/**
 * Inset grouped list — the backbone of iOS content layout.
 *
 * A group is a rounded container; rows within it are divided by hairlines that
 * start where the text starts rather than at the container edge. That inset is
 * the detail that separates a native-feeling list from a web table.
 */
export function ListGroup({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      {header && (
        <h3
          className="text-footnote px-4 pb-1.5 tracking-wide uppercase"
          style={{ color: "var(--label-secondary)" }}
        >
          {header}
        </h3>
      )}
      <div
        className="overflow-hidden [&>*:last-child_[data-hairline]]:border-b-0"
        style={{
          backgroundColor: "var(--bg-grouped-secondary)",
          borderRadius: "var(--radius-inset)",
        }}
      >
        {children}
      </div>
      {footer && (
        <p className="text-footnote px-4 pt-1.5" style={{ color: "var(--label-secondary)" }}>
          {footer}
        </p>
      )}
    </section>
  );
}

interface RowProps {
  /** Typically an `<IconTile>`; sits outside the separator inset. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned secondary text, e.g. a value or count. */
  value?: ReactNode;
  /** Replaces the disclosure chevron, e.g. a Switch or Button. */
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function ListRow({
  leading,
  title,
  subtitle,
  value,
  trailing,
  href,
  onClick,
  destructive,
  disabled,
}: RowProps) {
  const interactive = Boolean((href || onClick) && !disabled);

  /*
    A row that is itself tappable AND carries an interactive `trailing` — a
    Switch, a Button, a pair of reorder arrows — cannot be one big <button>.
    Nesting a button inside a button is invalid HTML: the browser hoists the
    inner one out during parsing, so the server's markup and the client's tree
    disagree and hydration fails outright. It also leaves the inner control
    unreachable by keyboard.

    So when both are present the row splits: the text region becomes the
    button, and `trailing` sits beside it as a sibling. The hairline stays on
    the wrapper spanning both, which is what keeps the separator inset to the
    text rather than the container edge.
  */
  const splitRow = interactive && Boolean(trailing);

  const label = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className="text-body truncate"
          style={{ color: destructive ? "var(--ios-red)" : "var(--label-primary)" }}
        >
          {title}
        </span>
        {subtitle && (
          <span className="text-footnote truncate" style={{ color: "var(--label-secondary)" }}>
            {subtitle}
          </span>
        )}
      </span>

      {value && (
        <span
          className="text-body tabular shrink-0 truncate"
          style={{ color: "var(--label-secondary)" }}
        >
          {value}
        </span>
      )}
      {interactive && !trailing && (
        <ChevronRight
          size={ICON_SIZE.md}
          strokeWidth={2.5}
          aria-hidden="true"
          className="shrink-0"
          style={{ color: "var(--label-tertiary)", transform: "scaleX(var(--dir, 1))" }}
        />
      )}
    </span>
  );

  const shell =
    "flex w-full items-stretch gap-3 px-4 text-start min-h-11 " +
    (interactive && !splitRow ? "press-row " : "") +
    (disabled ? "opacity-40 " : "");

  /* The hairline sits on the wrapper that starts where the text starts, so
     the separator insets to the text rather than to the container edge. That
     one detail is most of what separates a native list from an HTML table. */
  const hairline = (
    <span
      data-hairline
      className="flex min-w-0 flex-1 items-center gap-3 border-b-[0.5px] py-2.5"
      style={{ borderBottomColor: "var(--separator)" }}
    >
      {label}
      {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
    </span>
  );

  const lead = leading && <span className="flex shrink-0 items-center py-2.5">{leading}</span>;

  if (splitRow) {
    /* `-my-2.5 py-2.5` gives the button back the vertical padding the wrapper
       already applies, so its hit area covers the full row height instead of
       just the text's line box. */
    return (
      <div className={shell}>
        {lead}
        <span
          data-hairline
          className="flex min-w-0 flex-1 items-center gap-3 border-b-[0.5px] py-2.5"
          style={{ borderBottomColor: "var(--separator)" }}
        >
          {href ? (
            <Link
              href={href}
              onClick={() => haptic("selection")}
              className="press-row -my-2.5 flex min-w-0 flex-1 items-center gap-3 py-2.5 text-start"
            >
              {label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => {
                haptic("selection");
                onClick?.();
              }}
              className="press-row -my-2.5 flex min-w-0 flex-1 items-center gap-3 py-2.5 text-start"
            >
              {label}
            </button>
          )}
          <span className="flex shrink-0 items-center">{trailing}</span>
        </span>
      </div>
    );
  }

  if (href && interactive) {
    return (
      <Link href={href} onClick={() => haptic("selection")} className={shell}>
        {lead}
        {hairline}
      </Link>
    );
  }

  if (onClick && interactive) {
    return (
      <button
        type="button"
        onClick={() => {
          haptic("selection");
          onClick();
        }}
        className={shell}
      >
        {lead}
        {hairline}
      </button>
    );
  }

  return (
    <div className={shell} aria-disabled={disabled || undefined}>
      {lead}
      {hairline}
    </div>
  );
}
