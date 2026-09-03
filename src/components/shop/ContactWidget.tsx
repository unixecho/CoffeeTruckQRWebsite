"use client";

import { MessageCircle } from "lucide-react";
import { ICON_SIZE } from "@/components/ios/Icon";
import { haptic } from "@/lib/haptics";
import { useI18n } from "@/lib/i18n";

/**
 * Builds a `wa.me` deep link, or `null` when there is no number to send to.
 *
 * Returning `null` rather than a half-formed URL is the point: the phone
 * number comes from the settings table, so "the owner has not filled it in
 * yet" is a normal state, and a `https://wa.me/?text=…` link opens WhatsApp
 * onto a blank contact picker — a worse outcome than no button at all.
 *
 * Non-digits are stripped because the owner types the number the way a human
 * writes it ("+972-54-910-9603") and `wa.me` only accepts the bare digits.
 */
export function whatsappLink(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * The floating "talk to me" button.
 *
 * Pinned to the bottom-right corner **physically**, with `right` rather than
 * `inset-inline-end`. Every other placement in this codebase is logical, and
 * this is one of the two deliberate exceptions (the settings control is the
 * other): a customer who switches the shop to English should not watch the
 * contact button jump across the screen. A fixed affordance is remembered by
 * where the thumb reaches for it, not by which edge the text starts at.
 */
export function ContactWidget({ phone }: { phone: string }) {
  const { t } = useI18n();

  const href = whatsappLink(phone, t.landing.whatsappInquiry);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t.landing.contactAria}
      onClick={() => haptic("light")}
      className="press fixed z-40 flex h-14 w-14 items-center justify-center rounded-full"
      style={{
        /* The safe-area insets keep the button off the home indicator and out
           of a landscape notch; the 1rem is the same gutter the page uses. */
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
        right: "calc(env(safe-area-inset-right, 0px) + 1rem)",
        backgroundColor: "var(--ios-green)",
        color: "#fff",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <MessageCircle size={ICON_SIZE.lg} strokeWidth={2.25} aria-hidden="true" />
    </a>
  );
}
