import "server-only";

import type {
  CreateSessionInput,
  NormalizedWebhookEvent,
  PaymentProvider,
  PaymentResult,
  PaymentSession,
  ProviderPaymentSnapshot,
  ProviderRef,
} from "../types";

/* ==========================================================================
   Paying at the counter

   This is not a stub, a mock, or a placeholder for the "real" provider. It is
   how the business takes money today: the customer builds a basket on their
   phone, walks four feet, and pays with Bit or cash at the truck.

   It exists as a `PaymentProvider` so that the counter flow travels the same
   pipeline as a card payment — the same order row, the same status model, the
   same manager screen, the same receipt. That is what makes turning Grow on a
   configuration change instead of a second implementation of checkout.

   It also stays after Grow arrives, permanently. A market stand runs on a
   phone tether; the day the signal drops, the counter flow is the only one
   that still works, and a checkout that cannot fall back to it is a checkout
   that closes the stand.

   ## What it deliberately does not do

   It never claims a payment happened. `fetchStatus` returns `unpaid` every
   time, because nothing here can observe money changing hands — a person
   watching a Bit confirmation on their own phone is the only witness. The
   owner attests to it in the manager by marking the order collected, and that
   attestation is recorded as exactly what it is.
   ========================================================================== */

export class ManualProvider implements PaymentProvider {
  readonly id = "manual" as const;
  readonly presentation = "at_counter" as const;

  /** Always. There is nothing to configure — a counter is a counter. */
  isConfigured(): boolean {
    return true;
  }

  async createSession(_input: CreateSessionInput): Promise<PaymentResult<PaymentSession>> {
    return { ok: true, value: { kind: "at_counter", providerRef: null } };
  }

  async fetchStatus(_ref: ProviderRef): Promise<PaymentResult<ProviderPaymentSnapshot>> {
    /* Not an error: the question is legitimate and the honest answer is "no
       money has moved that I can see". Returning an error here would make the
       polling status page show a failure for an order that is simply waiting
       for someone to reach the front of the queue. */
    return {
      ok: true,
      value: { status: "unpaid", paidAgorot: null, providerStatusCode: null },
    };
  }

  async parseWebhook(
    _request: Request,
    _rawBody: string
  ): Promise<PaymentResult<NormalizedWebhookEvent>> {
    /* Nothing calls back about a counter payment. A POST arriving on this
       provider's webhook path is either a misconfiguration or someone
       probing, and both deserve the same flat refusal. */
    return { ok: false, error: "provider_rejected", detail: "manual has no callbacks" };
  }
}
