import { strict as assert } from "node:assert";
import { test } from "node:test";
import { HONEYPOT_FIELD, honeypotFilled, parseCheckoutRequest } from "./validate.ts";

/* ==========================================================================
   Checkout request tests

   This parser guards the only endpoint in the project a stranger can reach
   with no session, so the cases below are mostly about what it *refuses* —
   and specifically about the properties that must not survive it. PLAYBOOK §4.
   ========================================================================== */

const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function body(overrides: Record<string, unknown> = {}) {
  return {
    lines: [{ productId: PRODUCT_A, quantity: 2 }],
    paymentMethod: "counter",
    locale: "he",
    clientRequestId: REQUEST_ID,
    ...overrides,
  };
}

function ok(input: unknown) {
  const parsed = parseCheckoutRequest(input);
  assert.equal(parsed.ok, true, `expected ok, got ${JSON.stringify(parsed)}`);
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.value;
}

function rejected(input: unknown, field: string) {
  const parsed = parseCheckoutRequest(input);
  assert.equal(parsed.ok, false, "expected a rejection");
  if (parsed.ok) throw new Error("unreachable");
  assert.equal(parsed.error.field, field);
}

/* --------------------------------------------------------------------------
   The shape that gets through
   -------------------------------------------------------------------------- */

test("a minimal order parses", () => {
  const value = ok(body());
  assert.deepEqual(value.lines, [{ productId: PRODUCT_A, quantity: 2 }]);
  assert.equal(value.paymentMethod, "counter");
  assert.equal(value.locale, "he");
  assert.equal(value.customerName, null);
  assert.equal(value.customerPhone, null);
  assert.equal(value.note, null);
});

test("a missing locale defaults to Hebrew, the shop's primary language", () => {
  assert.equal(ok(body({ locale: undefined })).locale, "he");
});

/* --------------------------------------------------------------------------
   The rule the whole file exists for: the object is BUILT, not checked
   -------------------------------------------------------------------------- */

test("invented properties do not survive", () => {
  const value = ok(
    body({
      // Every one of these is a real column somewhere in the orders table.
      id: "00000000-0000-4000-8000-000000000000",
      orderNumber: 1,
      status: "collected",
      paymentStatus: "paid",
      totalAgorot: 1,
      paidAgorot: 999999,
      provider: "grow",
      tokenHash: "deadbeef",
      isPaid: true,
    })
  );

  const keys = Object.keys(value).sort();
  assert.deepEqual(keys, [
    "clientRequestId",
    "customerName",
    "customerPhone",
    "lines",
    "locale",
    "note",
    "paymentMethod",
  ]);
});

test("a price cannot be sent for a line", () => {
  const value = ok(
    body({ lines: [{ productId: PRODUCT_A, quantity: 1, priceAgorot: 1, unitPrice: 1 }] })
  );
  assert.deepEqual(value.lines, [{ productId: PRODUCT_A, quantity: 1 }]);
});

/* --------------------------------------------------------------------------
   Lines
   -------------------------------------------------------------------------- */

test("an empty cart is refused", () => {
  rejected(body({ lines: [] }), "lines");
  rejected(body({ lines: undefined }), "lines");
  rejected(body({ lines: "everything" }), "lines");
});

test("a product id must be a uuid", () => {
  rejected(body({ lines: [{ productId: "'; drop table orders; --", quantity: 1 }] }), "lines");
  rejected(body({ lines: [{ productId: 7, quantity: 1 }] }), "lines");
});

test("quantities must be whole and bounded", () => {
  rejected(body({ lines: [{ productId: PRODUCT_A, quantity: 0 }] }), "lines");
  rejected(body({ lines: [{ productId: PRODUCT_A, quantity: -3 }] }), "lines");
  rejected(body({ lines: [{ productId: PRODUCT_A, quantity: 1.5 }] }), "lines");
  rejected(body({ lines: [{ productId: PRODUCT_A, quantity: 100 }] }), "lines");
  rejected(body({ lines: [{ productId: PRODUCT_A, quantity: 1e9 }] }), "lines");
});

test("the same product twice is refused rather than merged", () => {
  // Merging would leave the order's own line list disagreeing with what was
  // charged, and the receipt is built from the line list.
  rejected(
    body({
      lines: [
        { productId: PRODUCT_A, quantity: 1 },
        { productId: PRODUCT_A, quantity: 1 },
      ],
    }),
    "lines"
  );
});

test("a cart nobody could carry is refused", () => {
  const many = Array.from({ length: 41 }, (_, index) => ({
    productId: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
    quantity: 1,
  }));
  rejected(body({ lines: many }), "lines");

  // Under the distinct-line cap, but over the total-unit cap.
  rejected(
    body({
      lines: [
        { productId: PRODUCT_A, quantity: 99 },
        { productId: PRODUCT_B, quantity: 99 },
        { productId: "44444444-4444-4444-8444-444444444444", quantity: 99 },
      ],
    }),
    "lines"
  );
});

/* --------------------------------------------------------------------------
   Method, and the idempotency key
   -------------------------------------------------------------------------- */

test("the payment method is one of two known strings", () => {
  assert.equal(ok(body({ paymentMethod: "card" })).paymentMethod, "card");
  rejected(body({ paymentMethod: "free" }), "paymentMethod");
  rejected(body({ paymentMethod: undefined }), "paymentMethod");
});

test("the client request id is required, not generated", () => {
  // Generating one server-side would defeat its purpose entirely: every retry
  // would get a fresh one, and every retry would be a second order.
  rejected(body({ clientRequestId: undefined }), "clientRequestId");
  rejected(body({ clientRequestId: "retry-1" }), "clientRequestId");
});

/* --------------------------------------------------------------------------
   Contact details
   -------------------------------------------------------------------------- */

test("a name is cleaned, not rejected, for ordinary mess", () => {
  assert.equal(ok(body({ customerName: "  Yossi   Levi  " })).customerName, "Yossi Levi");
  assert.equal(ok(body({ customerName: "   " })).customerName, null);
});

test("a bidi override in a name is stripped", () => {
  // U+202E in a name reorders every price and count rendered beside it, so on
  // the owner's order screen it means reading the wrong number off the till.
  const RLO = String.fromCharCode(0x202e);   // right-to-left override
  const LRI = String.fromCharCode(0x2066);   // left-to-right isolate
  const name = ok(body({ customerName: RLO + "Dana" + LRI })).customerName;
  assert.equal(name, "Dana");
});

test("control characters in a name become spaces", () => {
  const NUL = String.fromCharCode(0x00);
  const US = String.fromCharCode(0x1f);
  assert.equal(ok(body({ customerName: "Da" + NUL + "na" + US })).customerName, "Da na");
});

test("an over-long name is refused rather than truncated", () => {
  rejected(body({ customerName: "a".repeat(61) }), "customerName");
});

test("a phone number is reduced to digits", () => {
  assert.equal(ok(body({ customerPhone: "054-910-9603" })).customerPhone, "0549109603");
  assert.equal(ok(body({ customerPhone: "+972 (54) 910 9603" })).customerPhone, "972549109603");
  assert.equal(ok(body({ customerPhone: "" })).customerPhone, null);
});

test("something that is not a phone number is refused", () => {
  rejected(body({ customerPhone: "call me" }), "customerPhone");
  rejected(body({ customerPhone: "1234567" }), "customerPhone");
  rejected(body({ customerPhone: "1".repeat(16) }), "customerPhone");
});

test("a note keeps its line breaks and loses its control characters", () => {
  assert.equal(ok(body({ note: "no bag\nplease" })).note, "no bag\nplease");
  rejected(body({ note: "x".repeat(281) }), "note");
});

/* --------------------------------------------------------------------------
   The honeypot
   -------------------------------------------------------------------------- */

test("an untouched honeypot reads as untouched", () => {
  assert.equal(honeypotFilled(body()), false);
  assert.equal(honeypotFilled(body({ [HONEYPOT_FIELD]: "" })), false);
  assert.equal(honeypotFilled(body({ [HONEYPOT_FIELD]: "   " })), false);
  assert.equal(honeypotFilled("not an object"), false);
});

test("a filled honeypot is detected", () => {
  assert.equal(honeypotFilled(body({ [HONEYPOT_FIELD]: "Acme Ltd" })), true);
});

/* --------------------------------------------------------------------------
   Nonsense
   -------------------------------------------------------------------------- */

test("a body that is not an object is refused", () => {
  rejected(null, "body");
  rejected([], "body");
  rejected("lines=1", "body");
  rejected(42, "body");
});
