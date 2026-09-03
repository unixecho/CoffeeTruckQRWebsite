import "server-only";

import { configuredProviderId } from "./config";
import { GrowProvider } from "./providers/grow";
import { ManualProvider } from "./providers/manual";
import type { PaymentProvider, PaymentProviderId } from "./types";

/* ==========================================================================
   Choosing a provider

   A literal registry, resolved once at module load. Two things follow from
   that shape and both are deliberate:

   - **Nothing constructs a provider from a request.** The id is read from the
     environment, and a lookup key that a client could influence is the sort
     of thing that turns "which provider" into "which URL do we POST your
     order to". The webhook route is the one place an id arrives from outside,
     and it indexes this same frozen map — so an unknown id is a 404, not an
     improvised provider.

   - **Both providers exist at all times.** `manual` is not replaced by
     `grow`; it sits alongside it, because a card reader that needs a network
     is not a substitute for a person taking cash. The checkout asks for the
     one it needs by name.
   ========================================================================== */

const REGISTRY: Readonly<Record<PaymentProviderId, PaymentProvider>> = Object.freeze({
  manual: new ManualProvider(),
  grow: new GrowProvider(),
});

/** The provider a *card* payment would use, configured or not. */
export function cardProvider(): PaymentProvider {
  return REGISTRY[configuredProviderId()];
}

/** The counter flow. Always available, by construction. */
export function counterProvider(): PaymentProvider {
  return REGISTRY.manual;
}

/**
 * Whether the checkout may offer card payment at all.
 *
 * Three things have to be true, and they are three different questions:
 *   1. a provider other than `manual` is selected;
 *   2. that provider has its credentials;
 *   3. the owner has not switched online payments off in Settings.
 *
 * The third is checked by the caller, because it lives in the database rather
 * than the environment — see `onlinePaymentsEnabled` in `orders.ts`. Keeping
 * it out of here means this function never needs a database round trip and
 * can be called from anywhere.
 */
export function cardPaymentAvailable(): boolean {
  const provider = cardProvider();
  return provider.id !== "manual" && provider.isConfigured();
}

/** For the webhook route. Never falls back — an unknown id is not a provider. */
export function providerById(id: string): PaymentProvider | null {
  return Object.prototype.hasOwnProperty.call(REGISTRY, id)
    ? REGISTRY[id as PaymentProviderId]
    : null;
}
