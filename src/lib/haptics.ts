/**
 * Haptic feedback, mirroring UIFeedbackGenerator semantics.
 *
 * The Vibration API is unsupported in iOS Safari, so on Apple hardware these
 * calls are silently inert — they are a progressive enhancement for Android
 * and desktop Chrome, never a channel for information the user must receive.
 */

type HapticStyle = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

const PATTERNS: Record<HapticStyle, number | number[]> = {
  selection: 8,
  light: 10,
  medium: 18,
  heavy: 28,
  success: [12, 60, 12],
  warning: [18, 80, 18],
  error: [24, 70, 24, 70, 24],
};

export function haptic(style: HapticStyle = "selection"): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate(PATTERNS[style]);
  } catch {
    // Vibration can throw if the document isn't user-activated yet; ignore.
  }
}
