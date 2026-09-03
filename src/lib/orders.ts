import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readCatalogue } from "./catalog";
import { priceCart, toPriced, type CartPricing, type PricedProduct } from "./pricing";
import { createServiceClient, isSupabaseConfigured } from "./supabase/server";
import type { Agorot, Locale, Localized } from "./types";
import { ORDER_EXPIRY_MINUTES } from "./payments/config";
import { emitCheckoutEvent } from "./payments/analytics";
import { paymentLog, redactPayload } from "./payments/log";
import {
  canCollect,
  canCustomerCancel,
  canTransitionPayment,
  decideTransition,
} from "./payments/status";
import type {
  CheckoutRequest,
  Order,
  OrderItem,
  OrderStatus,
  PaymentErrorCode,
  PaymentMethod,
  PaymentProviderId,
  PaymentStatus,
  ProviderRef,
  PublicOrderView,
} from "./payments/types";

/* ==========================================================================
   Orders

   The only module that writes to `orders`, `order_items` or `payment_events`.
   Routes call these functions; they do not build queries of their own. That
   is not tidiness — it is the single place the two rules that matter are
   enforced, and both are easy to get right once and impossible to remember
   fourteen times:

     1. **Every amount is computed here, from the live catalogue.** No total,
        no price and no discount ever arrives from a request body. The client
        sends `{ productId, quantity }` and nothing else money-shaped, exactly
        as the cart already stores.

     2. **Every status change goes through the state machine.** `status.ts`
        decides; this file writes what it decided. A route that updates
        `payment_status` directly is a route that will one day mark a refunded
        order paid.

   Everything runs as the service role, because no client role holds any grant
   on these tables at all — not even SELECT. An order carries a name and a
   phone number, so the customer's own device reads it through an API route
   holding a bearer token rather than through PostgREST. Migration 007.
   ========================================================================== */

type Db = SupabaseClient;

/* --------------------------------------------------------------------------
   The order token

   A bearer credential: whoever holds it can read the order and cancel it.
   Generated here, never chosen by a client — the same rule slugs, sort orders
   and storage keys already follow.

   **Only the hash is stored.** The value in the URL never reaches the
   database, so a dump, a support query or a logged row cannot hand anyone an
   order. Lookup is by hash and costs one index.
   -------------------------------------------------------------------------- */

function newToken(): string {
  // 32 bytes, base64url: 256 bits, URL-safe, and short enough to sit in a
  // QR-scanned address bar without wrapping.
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/* --------------------------------------------------------------------------
   Row shapes
   -------------------------------------------------------------------------- */

interface OrderRow {
  id: string;
  order_number: number;
  status: string;
  payment_status: string;
  payment_method: string;
  provider: string | null;
  provider_ref_id: string | null;
  provider_ref_token: string | null;
  total_agorot: number;
  baseline_agorot: number;
  savings_agorot: number;
  paid_agorot: number | null;
  currency: string;
  pricing: unknown;
  customer_name: string | null;
  customer_phone: string | null;
  note: string | null;
  locale: string;
  expires_at: string;
  paid_at: string | null;
  collected_at: string | null;
  cancelled_at: string | null;
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
  order_items?: OrderItemRow[] | null;
}

interface OrderItemRow {
  id: string;
  product_id: string | null;
  name_he: string;
  name_en: string | null;
  name_ar: string | null;
  unit_price_agorot: number;
  quantity: number;
  sort_order: number;
}

const ORDER_COLUMNS =
  "id, order_number, status, payment_status, payment_method, provider, provider_ref_id, " +
  "provider_ref_token, total_agorot, baseline_agorot, savings_agorot, paid_agorot, currency, " +
  "pricing, customer_name, customer_phone, note, locale, expires_at, paid_at, collected_at, " +
  "cancelled_at, anonymized_at, created_at, updated_at";

const ORDER_WITH_ITEMS =
  `${ORDER_COLUMNS}, order_items(id, product_id, name_he, name_en, name_ar, ` +
  "unit_price_agorot, quantity, sort_order)";

function toItem(row: OrderItemRow): OrderItem {
  const name: Localized = {
    he: row.name_he,
    ...(row.name_en ? { en: row.name_en } : {}),
    ...(row.name_ar ? { ar: row.name_ar } : {}),
  };

  return {
    id: row.id,
    productId: row.product_id,
    name,
    unitPriceAgorot: row.unit_price_agorot,
    quantity: row.quantity,
  };
}

function toOrder(row: OrderRow): Order {
  const ref: ProviderRef | null = row.provider_ref_id
    ? { id: row.provider_ref_id, ...(row.provider_ref_token ? { token: row.provider_ref_token } : {}) }
    : null;

  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status as OrderStatus,
    paymentStatus: row.payment_status as PaymentStatus,
    paymentMethod: row.payment_method as PaymentMethod,
    provider: (row.provider as PaymentProviderId | null) ?? null,
    providerRef: ref,
    totalAgorot: row.total_agorot,
    baselineAgorot: row.baseline_agorot,
    savingsAgorot: row.savings_agorot,
    paidAgorot: row.paid_agorot,
    currency: "ILS",
    items: (row.order_items ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toItem),
    pricing: (row.pricing as CartPricing | null) ?? null,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    note: row.note,
    locale: row.locale as Locale,
    expiresAt: row.expires_at,
    paidAt: row.paid_at,
    collectedAt: row.collected_at,
    cancelledAt: row.cancelled_at,
    anonymizedAt: row.anonymized_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * What the customer's own device is allowed to see.
 *
 * Written out field by field rather than deleting from an `Order`, for the
 * same reason request bodies are built rather than spread: a field added to
 * `Order` later must not silently start being served to whoever holds a
 * token. Notably absent — the provider, the provider's reference, the paid
 * amount and the pricing internals. None of them help a customer and all of
 * them help somebody probing.
 */
export function toPublicView(order: Order): PublicOrderView {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    totalAgorot: order.totalAgorot,
    baselineAgorot: order.baselineAgorot,
    savingsAgorot: order.savingsAgorot,
    items: order.items,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    note: order.note,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
    anonymized: order.anonymizedAt !== null,
  };
}

/* --------------------------------------------------------------------------
   Creating an order
   -------------------------------------------------------------------------- */

export type CreateOrderResult =
  | { ok: true; order: Order; token: string; replayed: boolean }
  | { ok: false; error: PaymentErrorCode; unavailable?: string[] };

/**
 * Price a cart and write the order.
 *
 * The sequence is the interesting part:
 *
 *   1. Refuse outright if the owner has ordering switched off.
 *   2. Read the catalogue **as an anonymous visitor**, so RLS decides what
 *      exists. An order for a hidden category or an unavailable product then
 *      cannot be placed, and the filtering lives in the database rather than
 *      in a `.filter()` somebody has to remember to write here.
 *   3. Refuse the whole cart if anything in it has gone. Silently dropping a
 *      line would hand someone a smaller order than the one they confirmed,
 *      and they would find out at the counter.
 *   4. Price it with `priceCart` — the same function the storefront ran, so
 *      the number the customer saw and the number stored come from one
 *      implementation.
 *   5. Insert.
 */
export async function createOrder(request: CheckoutRequest): Promise<CreateOrderResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "checkout_disabled" };

  const catalogue = await readCatalogue();

  /* `live: false` means the storefront is serving the seed snapshot because
     the database is unreachable. Browsing degrades gracefully; ordering must
     not — an order that cannot be stored is an order the owner never sees,
     taken from a customer who believes it was placed. */
  if (!catalogue.live || !catalogue.settings.checkoutEnabled) {
    return { ok: false, error: "checkout_disabled" };
  }
  if (!catalogue.settings.open) return { ok: false, error: "checkout_disabled" };

  const db = createServiceClient();

  /* An idempotent replay. The client re-sends the same `clientRequestId` when
     a response is lost, which at a market stand is routine rather than rare. */
  const existing = await findByClientRequestId(db, request.clientRequestId);
  if (existing) {
    /* A fresh token, because the original response never reached anyone — and
       the only party who can trigger this holds the `clientRequestId`, which
       is as secret as the token it replaces. Rotating rather than returning
       the stored one is what lets the token itself stay write-only in the
       database. */
    const token = newToken();
    const { error } = await db
      .from("orders")
      .update({ token_hash: hashToken(token) })
      .eq("id", existing.id);

    if (error) {
      paymentLog("error", "order.replay.rotateFailed", { orderId: existing.id });
      return { ok: false, error: "unknown" };
    }
    return { ok: true, order: existing, token, replayed: true };
  }

  const byId = new Map(catalogue.products.map((product) => [product.id, product]));

  const unavailable: string[] = [];
  for (const line of request.lines) {
    const product = byId.get(line.productId);
    if (!product || !product.available) {
      unavailable.push(line.productId);
      continue;
    }
    if (product.stock !== null && line.quantity > product.stock) {
      unavailable.push(line.productId);
    }
  }
  if (unavailable.length > 0) {
    return { ok: false, error: "cart_unavailable", unavailable };
  }

  const priced = new Map<string, PricedProduct>();
  for (const product of catalogue.products) priced.set(product.id, toPriced(product));

  const pricing = priceCart(request.lines, priced, catalogue.rules);
  if (pricing.totalAgorot <= 0) {
    /* Zero is not a free order, it is a cart that priced to nothing — every
       line stale, or a rule set that gives things away. Either way it is not
       something to hand over on the strength of. */
    return { ok: false, error: "cart_empty" };
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60_000).toISOString();

  const { data: inserted, error } = await db
    .from("orders")
    .insert({
      token_hash: hashToken(token),
      client_request_id: request.clientRequestId,
      status: "placed",
      payment_status: "unpaid",
      payment_method: request.paymentMethod,
      total_agorot: pricing.totalAgorot,
      baseline_agorot: pricing.baselineAgorot,
      savings_agorot: pricing.savingsAgorot,
      pricing,
      customer_name: request.customerName,
      customer_phone: request.customerPhone,
      note: request.note,
      locale: request.locale,
      expires_at: expiresAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !inserted) {
    /* 23505 on `client_request_id` means two copies of the same retry landed
       at once. The other one won; read its order back rather than failing a
       customer for being on a flaky connection. */
    if (error?.code === "23505") {
      const raced = await findByClientRequestId(db, request.clientRequestId);
      if (raced) {
        const replacement = newToken();
        await db.from("orders").update({ token_hash: hashToken(replacement) }).eq("id", raced.id);
        return { ok: true, order: raced, token: replacement, replayed: true };
      }
    }
    paymentLog("error", "order.insertFailed", { code: error?.code, detail: error?.message });
    return { ok: false, error: "unknown" };
  }

  const items = request.lines.map((line, index) => {
    const product = byId.get(line.productId)!;
    return {
      order_id: inserted.id,
      product_id: product.id,
      name_he: product.name.he,
      name_en: product.name.en ?? null,
      name_ar: product.name.ar ?? null,
      unit_price_agorot: product.priceAgorot,
      quantity: line.quantity,
      sort_order: index,
    };
  });

  const { error: itemsError } = await db.from("order_items").insert(items);

  if (itemsError) {
    /* PostgREST has no client-side transaction, so this is a compensating
       delete rather than a rollback. It is safe here and only here: the order
       is seconds old, no payment session exists yet, and nothing has been
       shown to anyone — so removing it leaves no trace to reconcile. Anywhere
       later in the lifecycle this would be the wrong move. */
    await db.from("orders").delete().eq("id", inserted.id);
    paymentLog("error", "order.itemsFailed", { orderId: inserted.id, detail: itemsError.message });
    return { ok: false, error: "unknown" };
  }

  /* Read back rather than reconstructed from what was sent. One extra round
     trip, and it buys the real row: the order number the sequence handed out,
     the timestamps the database stamped, and the item ids. Assembling those
     locally would be inventing values that only look right until the first
     time a default changes. */
  const order = await findOrderById(db, inserted.id);
  if (!order) {
    paymentLog("error", "order.readBackFailed", { orderId: inserted.id });
    return { ok: false, error: "unknown" };
  }

  emitCheckoutEvent({
    name: "checkout_started",
    orderId: order.id,
    method: order.paymentMethod,
    itemCount: order.items.length,
  });

  return { ok: true, order, token, replayed: false };
}

async function findByClientRequestId(db: Db, clientRequestId: string): Promise<Order | null> {
  const { data } = await db
    .from("orders")
    .select(ORDER_WITH_ITEMS)
    .eq("client_request_id", clientRequestId)
    .maybeSingle();

  return data ? toOrder(data as unknown as OrderRow) : null;
}

/* --------------------------------------------------------------------------
   Reading
   -------------------------------------------------------------------------- */

/**
 * Look an order up by the token in the customer's URL.
 *
 * Hashes first, so the value from the URL is never compared against anything
 * stored and never reaches a query log in a form that would be useful to
 * whoever reads one.
 */
export async function findOrderByToken(token: string): Promise<Order | null> {
  if (!isSupabaseConfigured()) return null;
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;

  const db = createServiceClient();
  const { data } = await db
    .from("orders")
    .select(ORDER_WITH_ITEMS)
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!data) return null;
  return expireIfDue(db, toOrder(data as unknown as OrderRow));
}

export async function findOrderById(db: Db, id: string): Promise<Order | null> {
  const { data } = await db
    .from("orders")
    .select(ORDER_WITH_ITEMS)
    .eq("id", id)
    .maybeSingle();

  return data ? toOrder(data as unknown as OrderRow) : null;
}

/**
 * Expire an order that is past its window, on read.
 *
 * The nightly job in migration 007 is the sweeper of record, but nightly is
 * far too coarse for a fifteen-minute window: without this, a customer would
 * open a two-hour-old order and be shown a live "pay now" button for a price
 * the catalogue no longer holds. Enforcing it on read costs one conditional
 * update on exactly the rows that need one.
 */
async function expireIfDue(db: Db, order: Order): Promise<Order> {
  if (order.status !== "placed") return order;
  if (order.paymentStatus === "paid" || order.paymentStatus === "flagged") return order;
  if (Date.parse(order.expiresAt) > Date.now()) return order;

  const { error } = await db
    .from("orders")
    .update({ status: "expired", payment_status: "expired" })
    .eq("id", order.id)
    .eq("status", "placed");

  if (error) {
    paymentLog("warn", "order.expireFailed", { orderId: order.id, detail: error.message });
    return order;
  }

  emitCheckoutEvent({ name: "order_cancelled", orderId: order.id, by: "system" });
  return { ...order, status: "expired", paymentStatus: "expired" };
}

/* --------------------------------------------------------------------------
   Attaching a payment session
   -------------------------------------------------------------------------- */

/**
 * Record which provider is handling this order, and its reference.
 *
 * Guarded by a compare-and-swap on `payment_status`: two taps of the pay
 * button a moment apart both create a session at the provider, and without
 * this the second would overwrite the first's reference — leaving a live
 * payment attempt at the provider that no order points at, which is precisely
 * the payment that later cannot be reconciled.
 */
export async function attachPaymentSession(
  orderId: string,
  provider: PaymentProviderId,
  ref: ProviderRef | null,
  expectedStatus: PaymentStatus
): Promise<boolean> {
  /* The state machine stays the single authority on what may follow what, even
     for a write that is not an "event". Without this, `unpaid → pending` and
     `failed → pending` would be legal here because the code says so rather
     than because the table does — and the two would drift the first time a
     status is added. */
  if (ref && !canTransitionPayment(expectedStatus, "pending")) {
    paymentLog("warn", "order.attachSessionRefused", { orderId, from: expectedStatus });
    return false;
  }

  const db = createServiceClient();

  const { data, error } = await db
    .from("orders")
    .update({
      provider,
      provider_ref_id: ref?.id ?? null,
      provider_ref_token: ref?.token ?? null,
      payment_status: ref ? "pending" : "unpaid",
    })
    .eq("id", orderId)
    .eq("payment_status", expectedStatus)
    .select("id");

  if (error) {
    paymentLog("error", "order.attachSessionFailed", { orderId, detail: error.message });
    return false;
  }

  return (data?.length ?? 0) > 0;
}

/* --------------------------------------------------------------------------
   Applying a payment event
   -------------------------------------------------------------------------- */

export interface IncomingPaymentEvent {
  provider: PaymentProviderId;
  /** The provider's id for this delivery. Deduplicates the log. */
  providerEventId: string;
  kind: "webhook" | "poll" | "manual";
  status: PaymentStatus;
  paidAgorot: Agorot | null;
  signatureValid: boolean;
  payload?: unknown;
}

export interface AppliedEvent {
  applied: boolean;
  reason: string;
  order: Order;
}

/**
 * The one path that changes what an order's payment is.
 *
 * Idempotent by construction rather than by remembering to check: the state
 * machine refuses a transition to the status the order already holds, so a
 * provider retrying a "paid" callback five times changes nothing four times.
 * The unique index on `(provider, provider_event_id)` is a *log* deduplicator
 * on top of that, not the thing correctness rests on — which matters, because
 * whether a provider's event id is stable across retries is a promise made in
 * somebody else's documentation.
 *
 * The update is a compare-and-swap on the status it decided from. Two
 * callbacks landing together then produce one winner and one recorded
 * `raced`, instead of a last-write-wins race over money.
 */
export async function applyPaymentEvent(
  orderId: string,
  event: IncomingPaymentEvent
): Promise<AppliedEvent | null> {
  const db = createServiceClient();

  const order = await findOrderById(db, orderId);
  if (!order) return null;

  const decision = decideTransition({
    order: {
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      totalAgorot: order.totalAgorot,
    },
    incoming: event.status,
    paidAgorot: event.paidAgorot,
  });

  let applied = decision.applied;
  let reason: string = decision.reason;
  let updated = order;

  if (decision.applied) {
    const patch: Record<string, unknown> = {
      payment_status: decision.paymentStatus,
      status: decision.orderStatus,
      paid_agorot: event.paidAgorot,
    };
    if (decision.settled) patch.paid_at = new Date().toISOString();

    const { data, error } = await db
      .from("orders")
      .update(patch)
      .eq("id", order.id)
      .eq("payment_status", order.paymentStatus)
      .select(ORDER_WITH_ITEMS);

    if (error) {
      paymentLog("error", "order.applyFailed", { orderId, detail: error.message });
      applied = false;
      reason = "write_failed";
    } else if ((data?.length ?? 0) === 0) {
      // Somebody else moved it between the read and the write.
      applied = false;
      reason = "raced";
    } else {
      updated = toOrder(data![0] as unknown as OrderRow);
    }
  }

  /* Recorded whether or not it changed anything. An event log that holds only
     the events that worked cannot explain the one time something did not. */
  const { error: logError } = await db.from("payment_events").insert({
    order_id: order.id,
    provider: event.provider,
    provider_event_id: event.providerEventId,
    kind: event.kind,
    claimed_status: event.status,
    claimed_agorot: event.paidAgorot,
    applied,
    reason,
    signature_valid: event.signatureValid,
    payload: event.payload === undefined ? null : redactPayload(event.payload),
  });

  // 23505 is a duplicate delivery. Expected, and not worth a line in the log.
  if (logError && logError.code !== "23505") {
    paymentLog("warn", "order.eventLogFailed", { orderId, detail: logError.message });
  }

  if (applied) {
    if (decision.paymentStatus === "paid") {
      emitCheckoutEvent({
        name: "payment_settled",
        orderId: order.id,
        provider: event.provider,
        totalAgorot: order.totalAgorot,
      });
    } else if (decision.paymentStatus === "flagged") {
      emitCheckoutEvent({
        name: "payment_flagged",
        orderId: order.id,
        provider: event.provider,
        expectedAgorot: order.totalAgorot,
        paidAgorot: event.paidAgorot,
      });
      paymentLog("error", "payment.amountMismatch", {
        orderId: order.id,
        expected: order.totalAgorot,
        paid: event.paidAgorot,
        verdict: decision.amount,
      });
    } else if (decision.paymentStatus === "failed") {
      emitCheckoutEvent({ name: "payment_failed", orderId: order.id, provider: event.provider });
    }
  }

  return { applied, reason, order: updated };
}

/**
 * Record a callback that matched no order.
 *
 * Kept rather than dropped, and kept with `order_id` null. An unmatched
 * callback is one of three things and all of them are worth being able to see
 * later: a race with our own write of the payment reference, a stray POST
 * from somebody probing the endpoint, or a provider account shared with
 * another system. Silently discarding it turns a five-minute answer into an
 * afternoon.
 */
export async function recordUnmatchedEvent(
  db: Db,
  event: IncomingPaymentEvent,
  reason: string
): Promise<void> {
  const { error } = await db.from("payment_events").insert({
    order_id: null,
    provider: event.provider,
    provider_event_id: event.providerEventId,
    kind: event.kind,
    claimed_status: event.status,
    claimed_agorot: event.paidAgorot,
    applied: false,
    reason,
    signature_valid: event.signatureValid,
    payload: event.payload === undefined ? null : redactPayload(event.payload),
  });

  if (error && error.code !== "23505") {
    paymentLog("warn", "order.unmatchedLogFailed", { detail: error.message });
  }
}

/**
 * The order a provider callback is about, resolved **only** by the reference
 * we stored when we created the session.
 *
 * The payload's own idea of which order it concerns is never used for the
 * lookup, and that is the single most important line in the webhook path: a
 * callback endpoint is public, so anyone can POST to it, and a route that
 * looked an order up by an id from the body would let a stranger nominate
 * which order to mark paid. Knowing a live provider reference is a much
 * higher bar — and the amount is still verified against a direct read from
 * the provider afterwards, so even that is not enough on its own.
 */
export async function findOrderByProviderRef(
  db: Db,
  provider: PaymentProviderId,
  refId: string
): Promise<Order | null> {
  const { data } = await db
    .from("orders")
    .select(ORDER_WITH_ITEMS)
    .eq("provider", provider)
    .eq("provider_ref_id", refId)
    .maybeSingle();

  return data ? toOrder(data as unknown as OrderRow) : null;
}

/* --------------------------------------------------------------------------
   Customer-initiated changes
   -------------------------------------------------------------------------- */

export async function cancelOrderByCustomer(order: Order): Promise<Order | null> {
  if (!canCustomerCancel(order)) return null;

  const db = createServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("orders")
    .update({ status: "cancelled", payment_status: "cancelled", cancelled_at: now })
    .eq("id", order.id)
    .eq("status", "placed")
    .select(ORDER_WITH_ITEMS);

  if (error || (data?.length ?? 0) === 0) return null;

  emitCheckoutEvent({ name: "order_cancelled", orderId: order.id, by: "customer" });
  return toOrder(data![0] as unknown as OrderRow);
}

/**
 * Clear the name and phone number at the customer's own request.
 *
 * The self-service half of the data-rights obligation that arrives with the
 * first customer record (PLAYBOOK §1.4). The order itself stays — what was
 * sold and for how much is the shop's business record — but who bought it is
 * not, and there is no reason a customer should have to ask a person to have
 * that removed.
 *
 * The status page shows exactly the fields this clears, so "see what you hold"
 * and "delete it" are the same screen rather than a process.
 */
export async function anonymizeOrder(order: Order): Promise<Order | null> {
  const db = createServiceClient();

  const { data, error } = await db
    .from("orders")
    .update({ customer_name: null, customer_phone: null, anonymized_at: new Date().toISOString() })
    .eq("id", order.id)
    .select(ORDER_WITH_ITEMS);

  if (error || (data?.length ?? 0) === 0) return null;
  return toOrder(data![0] as unknown as OrderRow);
}

/* --------------------------------------------------------------------------
   Owner-initiated changes
   -------------------------------------------------------------------------- */

/**
 * Hand the goods over.
 *
 * One action, not two, because it is performed one-handed at a counter with
 * somebody waiting. For a counter order it also attests the payment: the
 * owner watched the Bit confirmation, and that attestation is recorded as a
 * `manual` payment event rather than as a silent column write, so the log
 * still explains how the order came to be paid.
 */
export async function collectOrder(db: Db, order: Order): Promise<Order | null> {
  if (!canCollect(order)) return null;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: "collected", collected_at: now };

  const attesting = order.paymentMethod === "counter" && order.paymentStatus !== "paid";
  if (attesting) {
    patch.payment_status = "paid";
    patch.paid_agorot = order.totalAgorot;
    patch.paid_at = now;
  }

  const { data, error } = await db
    .from("orders")
    .update(patch)
    .eq("id", order.id)
    .eq("status", "placed")
    .select(ORDER_WITH_ITEMS);

  if (error || (data?.length ?? 0) === 0) return null;

  if (attesting) {
    await db.from("payment_events").insert({
      order_id: order.id,
      provider: "manual",
      provider_event_id: `counter:${order.id}`,
      kind: "manual",
      claimed_status: "paid",
      claimed_agorot: order.totalAgorot,
      applied: true,
      reason: "owner_attested_counter_payment",
      signature_valid: false,
      payload: null,
    });
  }

  emitCheckoutEvent({ name: "order_collected", orderId: order.id, method: order.paymentMethod });
  return toOrder(data![0] as unknown as OrderRow);
}

export async function cancelOrderByOwner(db: Db, order: Order): Promise<Order | null> {
  if (order.status !== "placed") return null;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: "cancelled", cancelled_at: now };

  /* A cancelled card payment that already settled is a refund, and a refund
     is a thing that happens at the provider, not a column here. So the
     payment status is only moved when no money has moved. */
  if (order.paymentStatus !== "paid" && order.paymentStatus !== "refunded") {
    patch.payment_status = "cancelled";
  }

  const { data, error } = await db
    .from("orders")
    .update(patch)
    .eq("id", order.id)
    .eq("status", "placed")
    .select(ORDER_WITH_ITEMS);

  if (error || (data?.length ?? 0) === 0) return null;

  emitCheckoutEvent({ name: "order_cancelled", orderId: order.id, by: "owner" });
  return toOrder(data![0] as unknown as OrderRow);
}

/* --------------------------------------------------------------------------
   The manager's list
   -------------------------------------------------------------------------- */

export interface OrderListOptions {
  /** Open orders only, which is what the owner wants nine times in ten. */
  openOnly?: boolean;
  limit?: number;
}

export async function listOrders(
  db: Db,
  options: OrderListOptions = {}
): Promise<Order[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

  let query = db
    .from("orders")
    .select(ORDER_WITH_ITEMS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.openOnly) query = query.eq("status", "placed");

  const { data, error } = await query;
  if (error) {
    paymentLog("error", "orders.listFailed", { detail: error.message });
    return [];
  }

  return (data ?? []).map((row) => toOrder(row as unknown as OrderRow));
}

/**
 * Sweep anything past its window before the list is rendered.
 *
 * The nightly job is the sweeper of record; this stops the manager showing an
 * hour-old unpaid order as still open. One statement, bounded by the partial
 * index in migration 007.
 */
export async function sweepExpiredOrders(db: Db): Promise<void> {
  const { error } = await db
    .from("orders")
    .update({ status: "expired", payment_status: "expired" })
    .eq("status", "placed")
    .in("payment_status", ["unpaid", "pending", "failed"])
    .lt("expires_at", new Date().toISOString());

  if (error) paymentLog("warn", "orders.sweepFailed", { detail: error.message });
}
