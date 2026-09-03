import { strict as assert } from "node:assert";
import { test } from "node:test";
import { safeFrameUrl } from "./url.ts";

/* ==========================================================================
   Frame-origin allowlist tests

   This function stands between a URL that arrived in an HTTP response from a
   third party and an `<iframe src>` inside our own page. Everything it lets
   through becomes a live document rendered next to our padlock, asking for a
   card number — so the cases below are all about what it refuses.
   ========================================================================== */

const ALLOWED = ["https://secure.grow.example"];

test("a URL on an allowed origin is returned", () => {
  assert.equal(
    safeFrameUrl("https://secure.grow.example/pay/abc123", ALLOWED),
    "https://secure.grow.example/pay/abc123"
  );
});

test("a path and query on the allowed origin are preserved", () => {
  assert.equal(
    safeFrameUrl("https://secure.grow.example/p?id=7&t=x", ALLOWED),
    "https://secure.grow.example/p?id=7&t=x"
  );
});

test("http is refused even on an allowed host", () => {
  assert.equal(safeFrameUrl("http://secure.grow.example/pay", ALLOWED), null);
});

test("a scheme that executes is refused", () => {
  assert.equal(safeFrameUrl("javascript:alert(1)", ALLOWED), null);
  assert.equal(safeFrameUrl("data:text/html,<script>alert(1)</script>", ALLOWED), null);
  assert.equal(safeFrameUrl("blob:https://secure.grow.example/x", ALLOWED), null);
});

test("a host that merely ENDS WITH the allowed one is refused", () => {
  // The whole reason the check is an exact origin match rather than a suffix
  // test: anybody can register the longer name.
  assert.equal(safeFrameUrl("https://evil-secure.grow.example/pay", ALLOWED), null);
  assert.equal(safeFrameUrl("https://secure.grow.example.evil.test/pay", ALLOWED), null);
});

test("a subdomain of the allowed origin is refused", () => {
  assert.equal(safeFrameUrl("https://sub.secure.grow.example/pay", ALLOWED), null);
});

test("credentials in the URL are refused", () => {
  // Both a phishing primitive and a way to make a host read as something else
  // in an address bar. No payment page uses them.
  assert.equal(safeFrameUrl("https://user:pass@secure.grow.example/pay", ALLOWED), null);
  assert.equal(safeFrameUrl("https://secure.grow.example@evil.test/pay", ALLOWED), null);
});

test("a different port is a different origin", () => {
  assert.equal(safeFrameUrl("https://secure.grow.example:8443/pay", ALLOWED), null);
});

test("an empty allowlist refuses everything", () => {
  // The state the site is in until a provider is configured. Nothing may be
  // framed, and the CSP says the same thing from the other side.
  assert.equal(safeFrameUrl("https://secure.grow.example/pay", []), null);
});

test("nonsense is refused rather than thrown on", () => {
  assert.equal(safeFrameUrl(null, ALLOWED), null);
  assert.equal(safeFrameUrl(undefined, ALLOWED), null);
  assert.equal(safeFrameUrl(42, ALLOWED), null);
  assert.equal(safeFrameUrl("", ALLOWED), null);
  assert.equal(safeFrameUrl("   ", ALLOWED), null);
  assert.equal(safeFrameUrl("/pay/abc", ALLOWED), null);
  assert.equal(safeFrameUrl("//secure.grow.example/pay", ALLOWED), null);
});
