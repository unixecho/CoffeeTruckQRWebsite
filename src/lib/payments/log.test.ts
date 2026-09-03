import { strict as assert } from "node:assert";
import { test } from "node:test";
import { redactPayload } from "./log.ts";

/* ==========================================================================
   Redaction tests

   The backstop on the one thing this system must never hold. Card fields live
   inside the provider's own iframe, so nothing sensitive should ever reach
   us — but a provider echoing something back in a callback would land it in
   two places that outlive the request: the platform log, and the
   `payment_events` table an owner reads at leisure weeks later.

   Provider payloads are third-party JSON whose key names are not ours to fix,
   so this is a denylist by necessity. The cases below are the ones that make
   the difference between a denylist that works and one that reads as though
   it does.
   ========================================================================== */

test("card-shaped keys are removed whatever their spelling", () => {
  const out = redactPayload({
    cardNumber: "4111111111111111",
    card_number: "4111111111111111",
    CardNum: "4111111111111111",
    cvv: "123",
    CVC: "123",
    expiryDate: "12/29",
    exp_date: "12/29",
  }) as Record<string, unknown>;

  for (const value of Object.values(out)) {
    assert.equal(value, "[redacted]");
  }
});

test("credentials and bearer values are removed", () => {
  const out = redactPayload({
    apiKey: "secret",
    api_key: "secret",
    Authorization: "Bearer abc",
    password: "hunter2",
    signature: "deadbeef",
    processToken: "tok_live_x",
  }) as Record<string, unknown>;

  for (const value of Object.values(out)) {
    assert.equal(value, "[redacted]");
  }
});

test("an Israeli ID number is removed — we have no use for one", () => {
  const out = redactPayload({ idNumber: "123456789", id_number: "1" }) as Record<string, unknown>;
  assert.equal(out.idNumber, "[redacted]");
  assert.equal(out.id_number, "[redacted]");
});

test("a long digit run is scrubbed even under an innocent key", () => {
  // The case a key denylist cannot catch: a provider putting a pan in a field
  // called `description`, or a customer typing one into a note.
  const out = redactPayload({ description: "paid with 4111 1111 1111 1111 today" });
  assert.equal(out && (out as Record<string, string>).description.includes("4111"), false);
  assert.match((out as Record<string, string>).description, /\[redacted-digits\]/);
});

test("ordinary numbers survive", () => {
  // A total, a quantity, an order number. Redacting these would make the log
  // useless, which is its own failure.
  const out = redactPayload({ sum: "35.00", quantity: 3, orderNumber: 42 }) as Record<
    string,
    unknown
  >;
  assert.equal(out.sum, "35.00");
  assert.equal(out.quantity, 3);
  assert.equal(out.orderNumber, 42);
});

test("nesting is followed, and bounded", () => {
  const deep = { a: { b: { c: { d: { e: { f: { g: { cvv: "1" } } } } } } } };
  const out = JSON.stringify(redactPayload(deep));
  assert.equal(out.includes('"1"'), false);
  assert.match(out, /redacted-depth/);
});

test("arrays are followed and capped", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ cvv: String(i) }));
  const out = redactPayload(many) as unknown[];
  assert.equal(out.length, 51); // 50 entries plus the "30 more" marker
  assert.equal(JSON.stringify(out).includes('"7"'), false);
  assert.match(String(out.at(-1)), /30 more/);
});

test("a very long string is truncated", () => {
  const out = redactPayload({ note: "x".repeat(2000) }) as Record<string, string>;
  assert.ok(out.note.length < 600);
  assert.match(out.note, /…$/);
});

test("the input is never mutated", () => {
  // The caller still needs the real payload to act on; only the copy is safe
  // to store.
  const input = { cvv: "123", nested: { apiKey: "k" } };
  redactPayload(input);
  assert.equal(input.cvv, "123");
  assert.equal(input.nested.apiKey, "k");
});

test("primitives and nulls pass through", () => {
  assert.equal(redactPayload(null), null);
  assert.equal(redactPayload(undefined), undefined);
  assert.equal(redactPayload(true), true);
  assert.equal(redactPayload(7), 7);
});
