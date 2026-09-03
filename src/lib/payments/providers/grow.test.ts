import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { CreateSessionInput } from "../types.ts";

/* ==========================================================================
   Grow adapter tests

   What these can and cannot prove, stated plainly, because the difference
   matters more here than in any other suite:

   **They cannot verify Grow's API.** The endpoint paths, the field names and
   the status codes come from Grow's own integration documentation, which
   arrives with the merchant account. Those are the three `TODO(grow-credentials)`
   blocks in `grow.ts` and a test cannot check them against nothing.

   **They can verify everything around it**, and that is the part that would
   otherwise stay unexercised until a customer is standing at a counter: that
   a session URL is checked against the origin allowlist before it can become
   an iframe, that a rejected create is not mistaken for a successful one,
   that a write is not retried on a timeout, that an unknown status maps to
   `pending` rather than `paid`, that shekels become agorot exactly, and that
   a signature is compared rather than trusted.

   The environment is set before the module graph is imported, because a
   couple of constants in `config.ts` are evaluated at import time — hence the
   dynamic import below rather than a static one.
   ========================================================================== */

process.env.GROW_API_BASE = "https://api.grow.example";
process.env.GROW_CHECKOUT_ORIGIN = "https://secure.grow.example";
process.env.GROW_PAGE_CODE = "page-code";
process.env.GROW_USER_ID = "user-id";
process.env.GROW_API_KEY = "api-key";
process.env.PAYMENT_PROVIDER_TIMEOUT_MS = "200";
delete process.env.GROW_WEBHOOK_SECRET;

const { GrowProvider } = await import("./grow.ts");
const provider = new GrowProvider();

/* --------------------------------------------------------------------------
   A stubbed transport

   `http.ts` is the only thing between the adapter and the network, and it
   calls the global `fetch`. Replacing that is enough to drive every branch
   without a socket — and it keeps the retry policy under test, which a
   hand-rolled fake client would quietly bypass.
   -------------------------------------------------------------------------- */

interface Call {
  url: string;
  body: string;
}

function stubFetch(
  responder: (call: Call, attempt: number) => { status: number; body: unknown | string }
): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realWarn = console.warn;
  const realError = console.error;

  // The adapter logs every attempt. Useful in production, noise here.
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), body: String(init?.body ?? "") };
    calls.push(call);
    const { status, body } = responder(call, calls.length);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as Response;
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = realFetch;
      console.log = realLog;
      console.warn = realWarn;
      console.error = realError;
    },
  };
}

const INPUT: CreateSessionInput = {
  orderId: "11111111-1111-4111-8111-111111111111",
  orderNumber: 42,
  amountAgorot: 8500,
  currency: "ILS",
  locale: "he",
  description: "3D Prints #0042",
  customerName: "דנה לוי",
  customerPhone: "0549109603",
  returnUrls: {
    success: "https://shop.example/checkout/frame-return?status=success",
    failure: "https://shop.example/checkout/frame-return?status=failure",
    cancel: "https://shop.example/checkout/frame-return?status=cancel",
  },
  idempotencyKey: "order:1",
};

function created(url: string) {
  return { status: 1, data: { url, processId: 987, processToken: "ptok" } };
}

/* --------------------------------------------------------------------------
   Creating a session
   -------------------------------------------------------------------------- */

test("a session on the allowed origin comes back ready to frame", async () => {
  const stub = stubFetch(() => ({ status: 200, body: created("https://secure.grow.example/p/1") }));
  try {
    const result = await provider.createSession(INPUT);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.value.kind, "embedded_iframe");
    if (result.value.kind !== "embedded_iframe") return;
    assert.equal(result.value.url, "https://secure.grow.example/p/1");
    assert.deepEqual(result.value.providerRef, { id: "987", token: "ptok" });
  } finally {
    stub.restore();
  }
});

test("the amount is sent as shekels, and exactly", async () => {
  const stub = stubFetch(() => ({ status: 200, body: created("https://secure.grow.example/p/1") }));
  try {
    await provider.createSession({ ...INPUT, amountAgorot: 2550 });
    const sent = new URLSearchParams(stub.calls[0]!.body);
    assert.equal(sent.get("sum"), "25.50");
    assert.equal(sent.get("pageCode"), "page-code");
    assert.equal(sent.get("cField1"), INPUT.orderId);
    assert.equal(sent.get("successUrl"), INPUT.returnUrls.success);
  } finally {
    stub.restore();
  }
});

test("nothing about the cart is sent to the provider", async () => {
  const stub = stubFetch(() => ({ status: 200, body: created("https://secure.grow.example/p/1") }));
  try {
    await provider.createSession(INPUT);
    const sent = stub.calls[0]!.body;
    // A statement line and a third party's records are not places for a list
    // of what somebody bought.
    assert.equal(sent.includes("keychain"), false);
    assert.equal(sent.includes("items"), false);
    assert.equal(sent.includes("email"), false);
  } finally {
    stub.restore();
  }
});

test("a session URL on a FOREIGN origin is refused, not framed", async () => {
  // The single most important assertion in this file. A compromised provider
  // account, or the wrong host in an env var, must not put somebody else's
  // document inside our checkout.
  const stub = stubFetch(() => ({ status: 200, body: created("https://evil.example/p/1") }));
  try {
    const result = await provider.createSession(INPUT);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "invalid_response");
  } finally {
    stub.restore();
  }
});

test("a plain-http session URL is refused", async () => {
  const stub = stubFetch(() => ({ status: 200, body: created("http://secure.grow.example/p/1") }));
  try {
    const result = await provider.createSession(INPUT);
    assert.equal(result.ok, false);
  } finally {
    stub.restore();
  }
});

test("a rejected create is not mistaken for a successful one", async () => {
  const stub = stubFetch(() => ({
    status: 200,
    body: { status: 0, err: { message: "bad page code" } },
  }));
  try {
    const result = await provider.createSession(INPUT);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "provider_rejected");
  } finally {
    stub.restore();
  }
});

test("a response that is not JSON is refused rather than parsed hopefully", async () => {
  const stub = stubFetch(() => ({ status: 200, body: "<html>gateway error</html>" }));
  try {
    const result = await provider.createSession(INPUT);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "invalid_response");
    // The body must not travel into the error: an error page from a proxy can
    // be kilobytes of HTML, and `detail` ends up in a log line.
    assert.equal(result.detail, "not json");
  } finally {
    stub.restore();
  }
});

/* --------------------------------------------------------------------------
   Retries — the rule that stops a double charge
   -------------------------------------------------------------------------- */

test("a create is NOT retried on a 4xx", async () => {
  const stub = stubFetch(() => ({ status: 400, body: { status: 0 } }));
  try {
    const result = await provider.createSession(INPUT);
    assert.equal(stub.calls.length, 1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "provider_rejected");
  } finally {
    stub.restore();
  }
});

test("a create IS retried on a 5xx, because the provider said it did nothing", async () => {
  const stub = stubFetch((_call, attempt) =>
    attempt < 3
      ? { status: 503, body: "" }
      : { status: 200, body: created("https://secure.grow.example/p/9") }
  );
  try {
    const result = await provider.createSession(INPUT);
    assert.equal(stub.calls.length, 3);
    assert.equal(result.ok, true);
  } finally {
    stub.restore();
  }
});

test("a create is NOT retried when the connection itself failed", async () => {
  // A transport failure on a write means "we do not know", not "it did not
  // happen", and re-sending on "we do not know" is how somebody is charged
  // twice. The caller gets a retryable error and decides.
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const realLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("socket hang up");
  }) as typeof fetch;

  try {
    const result = await provider.createSession(INPUT);
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "provider_timeout");
    assert.equal(result.retryable, true);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    console.log = realLog;
  }
});

/* --------------------------------------------------------------------------
   Reading a status back — the evidence, not the claim
   -------------------------------------------------------------------------- */

function info(statusCode: unknown, sum?: unknown) {
  return { status: 1, data: { statusCode, ...(sum === undefined ? {} : { sum }) } };
}

test("a success code settles, with the amount in agorot", async () => {
  const stub = stubFetch(() => ({ status: 200, body: info("1", "85.00") }));
  try {
    const result = await provider.fetchStatus({ id: "987", token: "ptok" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, "paid");
    assert.equal(result.value.paidAgorot, 8500);
    assert.equal(result.value.providerStatusCode, "1");
  } finally {
    stub.restore();
  }
});

test("an UNKNOWN status code maps to pending, never to paid", async () => {
  // The mapping that must not be wrong in this direction. "We do not know"
  // must never hand goods over; a stuck order is recoverable, a given-away
  // one is not.
  for (const code of ["77", "weird", "", null, undefined]) {
    const stub = stubFetch(() => ({ status: 200, body: info(code, "85.00") }));
    try {
      const result = await provider.fetchStatus({ id: "987" });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.status, "pending", `code ${String(code)}`);
    } finally {
      stub.restore();
    }
  }
});

test("failure, cancellation and refund map to themselves", async () => {
  const cases: [string, string][] = [
    ["0", "failed"],
    ["declined", "failed"],
    ["cancelled", "cancelled"],
    ["refunded", "refunded"],
    ["expired", "expired"],
  ];
  for (const [code, expected] of cases) {
    const stub = stubFetch(() => ({ status: 200, body: info(code) }));
    try {
      const result = await provider.fetchStatus({ id: "987" });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.status, expected, code);
    } finally {
      stub.restore();
    }
  }
});

test("an unreadable sum comes back null, so nothing can settle on it", async () => {
  const stub = stubFetch(() => ({ status: 200, body: info("1", "eighty five") }));
  try {
    const result = await provider.fetchStatus({ id: "987" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.paidAgorot, null);
  } finally {
    stub.restore();
  }
});

test("a status read IS retried, because a read is safe to repeat", async () => {
  const stub = stubFetch((_call, attempt) =>
    attempt < 2 ? { status: 500, body: "" } : { status: 200, body: info("1", "85") }
  );
  try {
    const result = await provider.fetchStatus({ id: "987" });
    assert.equal(stub.calls.length, 2);
    assert.equal(result.ok, true);
  } finally {
    stub.restore();
  }
});

/* --------------------------------------------------------------------------
   Callbacks
   -------------------------------------------------------------------------- */

function formRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("https://shop.example/api/payments/webhook/grow", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

test("a urlencoded callback is read into a normalized event", async () => {
  const body = "processId=987&processToken=ptok&statusCode=1&sum=85.00&transactionId=tx-5&cField1=order-1";
  const result = await provider.parseWebhook(formRequest(body), body);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.provider, "grow");
  assert.equal(result.value.providerEventId, "tx-5");
  assert.deepEqual(result.value.providerRef, { id: "987", token: "ptok" });
  assert.equal(result.value.status, "paid");
  assert.equal(result.value.paidAgorot, 8500);
  assert.equal(result.value.orderId, "order-1");
});

test("a JSON callback is read too", async () => {
  const body = JSON.stringify({ processId: "987", statusCode: "0", sum: "85.00" });
  const request = new Request("https://shop.example/api/payments/webhook/grow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const result = await provider.parseWebhook(request, body);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.status, "failed");
  assert.equal(result.value.providerRef?.id, "987");
});

test("a callback with no process id is refused", async () => {
  // Without it the route has nothing to look the order up by, and looking one
  // up by anything the body chose is the hole this refusal exists to keep shut.
  const body = "statusCode=1&sum=85.00";
  const result = await provider.parseWebhook(formRequest(body), body);
  assert.equal(result.ok, false);
});

test("an unsigned callback reports itself unsigned", async () => {
  const body = "processId=987&statusCode=1&sum=85.00";
  const result = await provider.parseWebhook(formRequest(body), body);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Not a rejection — the route confirms it with a server-to-server read
  // instead. But it must not claim to be verified.
  assert.equal(result.value.signatureValid, false);
});

test("a correct signature verifies, a wrong one does not", async () => {
  process.env.GROW_WEBHOOK_SECRET = "s3cr3t";
  try {
    const body = "processId=987&statusCode=1&sum=85.00";
    const good = createHmac("sha256", "s3cr3t").update(body, "utf8").digest("hex");

    const ok = await provider.parseWebhook(formRequest(body, { "x-grow-signature": good }), body);
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.value.signatureValid, true);

    const bad = await provider.parseWebhook(
      formRequest(body, { "x-grow-signature": "00".repeat(32) }),
      body
    );
    assert.equal(bad.ok, true);
    if (!bad.ok) return;
    assert.equal(bad.value.signatureValid, false);

    // A signature over a *different* body must not verify — this is the whole
    // point of hashing the bytes on the wire rather than a re-serialization.
    const tampered = "processId=987&statusCode=1&sum=850.00";
    const swapped = await provider.parseWebhook(
      formRequest(tampered, { "x-grow-signature": good }),
      tampered
    );
    assert.equal(swapped.ok, true);
    if (!swapped.ok) return;
    assert.equal(swapped.value.signatureValid, false);
  } finally {
    delete process.env.GROW_WEBHOOK_SECRET;
  }
});

test("the callback payload is redacted before it leaves the adapter", async () => {
  const body = "processId=987&statusCode=1&cardNumber=4111111111111111&processToken=live";
  const result = await provider.parseWebhook(formRequest(body), body);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.value.payload);
  assert.equal(serialized.includes("4111111111111111"), false);
  assert.equal(serialized.includes("live"), false);
});

/* --------------------------------------------------------------------------
   Unconfigured
   -------------------------------------------------------------------------- */

test("with no credentials the provider refuses everything and claims nothing", async () => {
  const saved = process.env.GROW_API_KEY;
  delete process.env.GROW_API_KEY;
  try {
    assert.equal(provider.isConfigured(), false);

    const session = await provider.createSession(INPUT);
    assert.equal(session.ok, false);
    if (session.ok) return;
    assert.equal(session.error, "provider_not_configured");

    const status = await provider.fetchStatus({ id: "1" });
    assert.equal(status.ok, false);
  } finally {
    process.env.GROW_API_KEY = saved;
  }
});

test("with credentials it reports itself configured", () => {
  assert.equal(provider.isConfigured(), true);
});
