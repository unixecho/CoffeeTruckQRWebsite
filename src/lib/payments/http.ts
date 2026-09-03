import "server-only";

import { PROVIDER_TIMEOUT_MS } from "./config";
import { paymentLog } from "./log";
import type { PaymentResult } from "./types";

/* ==========================================================================
   Talking to a payment provider over HTTP

   Three rails, and every provider adapter goes through them rather than
   calling `fetch` directly.

   ## 1. A timeout, always

   `fetch` has none. A provider that hangs would hold a serverless invocation
   until the platform kills it, and the customer — standing at a counter —
   watches a spinner until their phone gives up. Twelve seconds, then a
   `provider_timeout` they can retry.

   ## 2. Retries only where a retry is safe

   A read is idempotent and is retried. A **write is not retried on a
   timeout**, because a timeout does not mean "it did not happen" — it means
   "we do not know", and re-sending a create-payment on "we do not know" is
   how a customer gets charged twice. The idempotency key we send makes a
   retry survivable on providers that honour it, but honouring it is their
   promise and not something to bet a double charge on.

   So: `getJson` retries. `postJson` retries only on a connection failure
   before any bytes were sent, and on an explicit 429/5xx, which are the two
   cases where the provider is telling us it did nothing.

   ## 3. Nothing about the request body reaches a log

   The body carries the API key. `paymentLog` scrubs, but the simplest rail
   is not to hand it over in the first place — only the URL path, the status
   and the elapsed time are logged.
   ========================================================================== */

const MAX_ATTEMPTS = 3;
/** Doubling, from 250ms. Small: there is a person waiting. */
const BASE_BACKOFF_MS = 250;

function backoffFor(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A status the provider is telling us it did not act on. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

interface Attempt {
  ok: boolean;
  status: number;
  bodyText: string;
  /** True when the request never completed — no response at all. */
  transport: boolean;
}

async function once(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      /* Never send our cookies to a third party, and never let a redirect
         chain take the request somewhere else — a provider that 302s to
         another host would otherwise receive our Authorization header. */
      credentials: "omit",
      redirect: "manual",
    });

    const bodyText = await response.text();
    return { ok: response.ok, status: response.status, bodyText, transport: false };
  } catch {
    return { ok: false, status: 0, bodyText: "", transport: true };
  } finally {
    clearTimeout(timer);
  }
}

function parse<T>(bodyText: string): PaymentResult<T> {
  if (bodyText.trim() === "") {
    return { ok: false, error: "invalid_response", detail: "empty body" };
  }
  try {
    return { ok: true, value: JSON.parse(bodyText) as T };
  } catch {
    /* Deliberately does not include the body in `detail`: an error page from
       a proxy in front of the provider can be kilobytes of HTML, and it would
       land in a log line and in an event row. */
    return { ok: false, error: "invalid_response", detail: "not json" };
  }
}

export interface JsonRequest {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** For the log line only. Never the full URL — it can carry identifiers. */
  label: string;
}

/** An idempotent read. Retried on transport failure and on 5xx/429. */
export async function getJson<T>(request: JsonRequest): Promise<PaymentResult<T>> {
  return send<T>(request, { method: "GET" }, true);
}

/**
 * A write. Retried **only** where the provider told us it did nothing.
 *
 * See the header: a timeout on a write is "we do not know", and the safe move
 * is to surface it and let the caller reconcile by reading the status back,
 * not to fire the write again.
 */
export async function postJson<T>(
  request: JsonRequest,
  body: unknown
): Promise<PaymentResult<T>> {
  return send<T>(
    request,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(request.headers ?? {}) },
      body: JSON.stringify(body),
    },
    false
  );
}

/**
 * Some Israeli payment APIs, Grow's included, take urlencoded forms rather
 * than JSON while answering in JSON. Same rails, different encoding.
 */
export async function postForm<T>(
  request: JsonRequest,
  fields: Record<string, string>
): Promise<PaymentResult<T>> {
  return send<T>(
    request,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        ...(request.headers ?? {}),
      },
      body: new URLSearchParams(fields).toString(),
    },
    false
  );
}

async function send<T>(
  request: JsonRequest,
  init: RequestInit,
  retryTransport: boolean
): Promise<PaymentResult<T>> {
  const timeoutMs = request.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const headers = { Accept: "application/json", ...(request.headers ?? {}), ...(init.headers ?? {}) };

  let last: Attempt | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    const result = await once(request.url, { ...init, headers }, timeoutMs);
    last = result;

    paymentLog(result.ok ? "info" : "warn", "provider.http", {
      label: request.label,
      attempt,
      status: result.status,
      ms: Date.now() - started,
    });

    if (result.ok) return parse<T>(result.bodyText);

    const worthRetrying = result.transport
      ? retryTransport
      : isRetryableStatus(result.status);

    if (!worthRetrying || attempt === MAX_ATTEMPTS) break;
    await sleep(backoffFor(attempt));
  }

  if (!last || last.transport) {
    return { ok: false, error: "provider_timeout", retryable: true };
  }

  /* A 4xx that is not 408/425/429 is the provider saying the request was
     wrong. That is our bug or our configuration, and retrying it just makes
     the same mistake faster. */
  return {
    ok: false,
    error: last.status >= 500 ? "provider_unavailable" : "provider_rejected",
    detail: `http ${last.status}`,
    retryable: last.status >= 500 || last.status === 429,
  };
}
