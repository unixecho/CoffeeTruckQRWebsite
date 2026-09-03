import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { parseShekels } from "../../money";
import type { Agorot } from "../../types";
import { growConfig, paymentFrameOrigins, type GrowConfig } from "../config";
import { postForm } from "../http";
import { paymentLog, redactPayload } from "../log";
import type {
  CreateSessionInput,
  NormalizedWebhookEvent,
  PaymentProvider,
  PaymentResult,
  PaymentSession,
  PaymentStatus,
  ProviderPaymentSnapshot,
  ProviderRef,
} from "../types";
import { safeFrameUrl } from "../url";

/* ==========================================================================
   Grow

   Grow (formerly Meshulam) is the Israeli payment processor this shop will
   run once the owner is registered as an עוסק פטור and has a merchant
   account. Nothing in this file can work before then, and that is the point:
   it is written, reviewed and shaped now so that switching it on is filling
   in five environment variables and confirming the field names below.

   ## What is real here and what is pending

   **Real, and reviewed:** the flow, the failure handling, the amount
   reconciliation, the redaction, the retry policy, the fact that the frame
   URL is checked against an origin allowlist before it is rendered, and the
   rule that a callback is never believed on its own.

   **Pending, and marked `TODO(grow-credentials)`:** the exact endpoint paths,
   the exact request field names, and the exact status codes. Those come from
   Grow's own integration documentation, which is issued with the merchant
   account. They are all confined to the three mapping blocks below — the rest
   of the file, and every other file in the codebase, does not change when
   they are corrected.

   The shapes written below follow Grow's publicly described "Light Server"
   API. **Treat them as a starting point to verify, not as fact.** Getting one
   field name wrong here fails loudly on the first sandbox call, which is the
   right time to find out.

   ## Card data

   None reaches us, ever. `createPaymentProcess` returns a URL to a page Grow
   hosts on its own origin; that page renders inside an `<iframe>` and owns
   the card fields. Our JavaScript cannot read across that boundary, our
   server never sees a pan, and our logs cannot contain one. This is the
   entire reason to use hosted fields rather than posting a form ourselves,
   and it is why `presentation` is `embedded_iframe` rather than anything that
   would have us handling the input.
   ========================================================================== */

/* --------------------------------------------------------------------------
   TODO(grow-credentials) — block 1 of 3: endpoints

   Verify against Grow's integration guide. The base host is the sandbox one
   during integration and the live one afterwards, and it is `GROW_API_BASE`
   rather than a constant precisely so that promotion is an env change.
   -------------------------------------------------------------------------- */

const ENDPOINTS = {
  createProcess: "/api/light/server/1.0/createPaymentProcess",
  processInfo: "/api/light/server/1.0/getPaymentProcessInfo",
} as const;

/* --------------------------------------------------------------------------
   TODO(grow-credentials) — block 2 of 3: response shapes
   -------------------------------------------------------------------------- */

interface GrowEnvelope<T> {
  /** 1 on success, 0 on failure, in the documented shape. */
  status?: number | string;
  data?: T;
  err?: { message?: string; code?: string | number } | string;
}

interface GrowCreateProcessData {
  /** The hosted payment page. Rendered in the iframe. */
  url?: string;
  processId?: string | number;
  processToken?: string;
}

interface GrowProcessInfoData {
  /** Grow's own transaction state. Mapped by `mapStatusCode` below. */
  statusCode?: string | number;
  status?: string | number;
  /** Shekels, as a string or a number, per the API. */
  sum?: string | number;
  transactionId?: string | number;
  transactionToken?: string;
}

/* --------------------------------------------------------------------------
   TODO(grow-credentials) — block 3 of 3: status mapping

   The one mapping that must be exactly right. Anything unrecognised maps to
   `pending`, never to `paid`: an unknown code means we do not know, and "we
   do not know" must never hand over goods. The status page keeps polling and
   the owner sees the order as awaiting payment, which is recoverable. The
   other direction is not.
   -------------------------------------------------------------------------- */

function mapStatusCode(raw: string | number | null | undefined): PaymentStatus {
  const code = String(raw ?? "").trim().toLowerCase();

  switch (code) {
    case "1":
    case "2":
    case "success":
    case "approved":
      return "paid";
    case "0":
    case "failed":
    case "declined":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
    case "3":
      return "cancelled";
    case "expired":
      return "expired";
    case "refunded":
      return "refunded";
    default:
      return "pending";
  }
}

/* --------------------------------------------------------------------------
   Money at the boundary
   -------------------------------------------------------------------------- */

/** Agorot → the shekel string the API expects. `2550` → `"25.50"`. */
function agorotToShekelString(agorot: Agorot): string {
  return (agorot / 100).toFixed(2);
}

/**
 * Whatever the API said the sum was → agorot, or null.
 *
 * Routed through `parseShekels`, the same function the manager's price field
 * uses, so there is one definition of "a shekel amount as text" in the
 * codebase. A value it cannot read comes back null, which the state machine
 * treats as `unknown` — and an unknown amount can never settle an order.
 */
function sumToAgorot(sum: string | number | null | undefined): Agorot | null {
  if (sum === null || sum === undefined) return null;
  return parseShekels(String(sum));
}

/* --------------------------------------------------------------------------
   The adapter
   -------------------------------------------------------------------------- */

export class GrowProvider implements PaymentProvider {
  readonly id = "grow" as const;
  readonly presentation = "embedded_iframe" as const;

  isConfigured(): boolean {
    return growConfig() !== null;
  }

  /* Credentials are read per call rather than captured in a constructor, so
     that an env change on a redeploy takes effect without depending on when
     this module happened to be instantiated. */
  private config(): GrowConfig | null {
    return growConfig();
  }

  async createSession(input: CreateSessionInput): Promise<PaymentResult<PaymentSession>> {
    const config = this.config();
    if (!config) return { ok: false, error: "provider_not_configured" };

    /* TODO(grow-credentials): confirm every field name in this object, and
       whether Grow wants `pageField[fullName]`-style keys for the customer
       details. The values are already correct — they are ours. */
    const fields: Record<string, string> = {
      pageCode: config.pageCode,
      userId: config.userId,
      apiKey: config.apiKey,

      sum: agorotToShekelString(input.amountAgorot),
      description: input.description,

      successUrl: input.returnUrls.success,
      cancelUrl: input.returnUrls.cancel,

      /* Our own order id, echoed back on the callback. Belt and braces: the
         webhook route resolves the order by the process id it stored, and
         this is the second route to the same answer if a callback arrives
         with fields we did not expect. */
      cField1: input.orderId,

      /* Not sent: an email address, an ID number, an address. We do not
         collect them and there is no reason to start in order to place a ₪25
         keychain order. */
      ...(input.customerName ? { "pageField[fullName]": input.customerName } : {}),
      ...(input.customerPhone ? { "pageField[phone]": input.customerPhone } : {}),
    };

    const response = await postForm<GrowEnvelope<GrowCreateProcessData>>(
      {
        url: `${config.apiBase}${ENDPOINTS.createProcess}`,
        label: "grow.createProcess",
        headers: { "Idempotency-Key": input.idempotencyKey },
      },
      fields
    );

    if (!response.ok) return response;

    const envelope = response.value;
    if (String(envelope.status ?? "") !== "1" || !envelope.data) {
      paymentLog("error", "grow.createProcess.rejected", {
        orderId: input.orderId,
        detail: typeof envelope.err === "string" ? envelope.err : envelope.err?.message,
      });
      return { ok: false, error: "provider_rejected", detail: "create rejected" };
    }

    const { url, processId, processToken } = envelope.data;

    /* The single most important line in this file. A URL from a third party
       is about to become a live document inside our page; it is checked
       against the same origin allowlist that the CSP `frame-src` is built
       from, and a failure degrades to the counter rather than rendering it
       anyway. */
    const frameUrl = safeFrameUrl(url, paymentFrameOrigins());
    if (!frameUrl || processId === undefined || processId === null) {
      paymentLog("error", "grow.createProcess.badUrl", { orderId: input.orderId });
      return { ok: false, error: "invalid_response", detail: "unusable session" };
    }

    return {
      ok: true,
      value: {
        kind: "embedded_iframe",
        url: frameUrl,
        providerRef: { id: String(processId), token: processToken },
        /* TODO(grow-credentials): Grow may return its own expiry. Until that
           is confirmed, the order's own `expiresAt` is the bound, which is
           the shorter of the two in every realistic case. */
        expiresAt: null,
      },
    };
  }

  async fetchStatus(ref: ProviderRef): Promise<PaymentResult<ProviderPaymentSnapshot>> {
    const config = this.config();
    if (!config) return { ok: false, error: "provider_not_configured" };

    const response = await postForm<GrowEnvelope<GrowProcessInfoData>>(
      {
        url: `${config.apiBase}${ENDPOINTS.processInfo}`,
        label: "grow.processInfo",
      },
      {
        pageCode: config.pageCode,
        userId: config.userId,
        apiKey: config.apiKey,
        processId: ref.id,
        ...(ref.token ? { processToken: ref.token } : {}),
      }
    );

    if (!response.ok) return response;

    const envelope = response.value;
    if (String(envelope.status ?? "") !== "1" || !envelope.data) {
      return { ok: false, error: "provider_rejected", detail: "info rejected" };
    }

    const raw = envelope.data.statusCode ?? envelope.data.status ?? null;

    return {
      ok: true,
      value: {
        status: mapStatusCode(raw),
        paidAgorot: sumToAgorot(envelope.data.sum),
        providerStatusCode: raw === null ? null : String(raw),
      },
    };
  }

  /**
   * Turn a callback into an event.
   *
   * Grow's callbacks arrive as a form post rather than JSON, so this reads
   * both encodings — a provider that changes to JSON later must not silently
   * start being ignored.
   *
   * **What this does not do is decide the outcome.** It reports what the
   * callback claimed and whether the claim was signed. The route then reads
   * the transaction back from Grow with `fetchStatus` before anything is
   * written, because the callback URL is a public endpoint and a POST to it
   * is not evidence of anything.
   */
  async parseWebhook(
    request: Request,
    rawBody: string
  ): Promise<PaymentResult<NormalizedWebhookEvent>> {
    const config = this.config();
    if (!config) return { ok: false, error: "provider_not_configured" };

    const payload = decodeBody(request, rawBody);
    if (!payload) return { ok: false, error: "invalid_response", detail: "undecodable body" };

    const processId = firstString(payload, ["processId", "process_id", "data[processId]"]);
    const processToken = firstString(payload, ["processToken", "process_token"]);
    const orderId = firstString(payload, ["cField1", "customFields[cField1]", "orderId"]);
    const statusRaw = firstString(payload, ["statusCode", "status", "transactionStatus"]);
    const sum = firstString(payload, ["sum", "amount", "transactionSum"]);

    if (!processId) {
      return { ok: false, error: "invalid_response", detail: "no process id" };
    }

    return {
      ok: true,
      value: {
        provider: "grow",
        /* The provider's own id for *this delivery*. A retry of the same
           outcome must carry the same value or the unique index cannot
           deduplicate it — so a transaction id is preferred over anything
           timestamp-shaped, and the process id is the fallback.
           TODO(grow-credentials): confirm which field is stable across
           retries. Getting this wrong means duplicate events are stored, not
           that they are applied twice — the state machine still refuses the
           second — but the log becomes harder to read. */
        providerEventId:
          firstString(payload, ["transactionId", "transaction_id"]) ??
          `${processId}:${statusRaw ?? "?"}`,
        orderId: orderId ?? null,
        providerRef: { id: processId, token: processToken ?? undefined },
        status: mapStatusCode(statusRaw),
        paidAgorot: sumToAgorot(sum),
        payload: redactPayload(payload),
        signatureValid: verifySignature(config, request, rawBody),
      },
    };
  }
}

/* --------------------------------------------------------------------------
   Body decoding and signature checking
   -------------------------------------------------------------------------- */

function decodeBody(request: Request, rawBody: string): Record<string, string> | null {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
      // Flattened to strings so the field readers below have one shape to
      // deal with regardless of how the provider encoded the body.
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          typeof value === "object" && value !== null ? JSON.stringify(value) : String(value),
        ])
      );
    } catch {
      return null;
    }
  }

  try {
    return Object.fromEntries(new URLSearchParams(rawBody));
  } catch {
    return null;
  }
}

/** First present, non-empty value among several spellings of the same field. */
function firstString(
  payload: Record<string, string>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * HMAC over the raw body, when a secret is configured.
 *
 * Returns false rather than throwing when there is no secret — which is the
 * expected case if Grow authenticates callbacks by making us read the
 * transaction back instead of by signing them. The route treats `false` as
 * "not proven, confirm with the provider before believing it", so the absence
 * of a secret costs a round trip rather than any safety.
 *
 * The raw body is hashed, not a re-serialization of the parsed body: any
 * normalisation between the bytes on the wire and the bytes hashed is a way
 * for two different payloads to produce one signature.
 *
 * TODO(grow-credentials): confirm the header name and the digest encoding.
 */
function verifySignature(config: GrowConfig, request: Request, rawBody: string): boolean {
  if (!config.webhookSecret) return false;

  const presented =
    request.headers.get("x-grow-signature") ??
    request.headers.get("x-signature") ??
    "";
  if (presented.trim() === "") return false;

  const expected = createHmac("sha256", config.webhookSecret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented.trim().toLowerCase(), "utf8");
  // `timingSafeEqual` throws on a length mismatch, which is itself a leak of
  // one bit — but a wrong-length signature is a refusal either way.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
