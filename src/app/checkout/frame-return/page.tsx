import type { Metadata } from "next";

import { FrameReturn } from "@/components/checkout/FrameReturn";

export const metadata: Metadata = {
  title: "תשלום",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Where the payment provider sends the browser when it is finished.
 *
 * Deliberately the smallest page in the app. It is our own origin, loaded
 * inside the payment iframe, and its only job is to tell the page around it
 * that the customer is done — so that page can go and ask our server what
 * actually happened.
 *
 * **Nothing identifying is in its URL.** The provider is handed this address
 * when the session is created, so anything in it becomes something a third
 * party holds. A `?status=` is all it carries, and even that decides nothing:
 * the parent treats it as a prompt to re-read the order, never as an answer.
 */
export default function FrameReturnPage() {
  return <FrameReturn />;
}
