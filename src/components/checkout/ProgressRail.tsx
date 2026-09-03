"use client";

import { Check } from "lucide-react";
import { ICON_SIZE } from "@/components/ios/Icon";

/* ==========================================================================
   Where you are in the checkout

   Three steps is short enough that a progress indicator is about *reassurance*
   rather than navigation — the question it answers is "how much more of this
   is there", and the honest answer at a market stand is "almost none".

   Two things it does that a row of dots usually gets wrong:

   - **Colour is never the only signal.** A completed step gets a tick, the
     current one gets a filled bar and a weighted label. Somebody who cannot
     tell the blue from the grey still knows where they are.
   - **It is a real `<ol>` with `aria-current="step"`**, not a decorated div.
     The visible labels are the accessible names, so nothing is announced
     twice and nothing is missing.

   The track mirrors on its own: it is a flex row of equal segments with no
   physical positioning in it, so Hebrew and Arabic fill from the right
   without a single directional rule.
   ========================================================================== */

export function ProgressRail({
  labels,
  current,
  stepAria,
  navLabel,
}: {
  labels: string[];
  /** Zero-based. */
  current: number;
  stepAria: (index: number, total: number) => string;
  navLabel: string;
}) {
  return (
    <nav aria-label={navLabel}>
      <p className="sr-only" aria-live="polite">
        {stepAria(current + 1, labels.length)}
      </p>

      <ol className="flex items-start gap-2">
        {labels.map((label, index) => {
          const done = index < current;
          const active = index === current;

          return (
            <li
              key={label}
              className="flex min-w-0 flex-1 flex-col gap-1.5"
              aria-current={active ? "step" : undefined}
            >
              <span
                aria-hidden="true"
                className="h-1 w-full rounded-full"
                style={{
                  backgroundColor: done || active ? "var(--ios-blue)" : "var(--fill-tertiary)",
                  transition: "background-color 0.3s var(--ease-ios)",
                }}
              />
              <span className="flex items-center gap-1">
                {done && (
                  <Check
                    size={ICON_SIZE.sm}
                    strokeWidth={3}
                    aria-hidden="true"
                    className="shrink-0"
                    style={{ color: "var(--ios-blue)" }}
                  />
                )}
                <span
                  className="text-caption-1 truncate"
                  style={{
                    color: active ? "var(--label-primary)" : "var(--label-secondary)",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {label}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
