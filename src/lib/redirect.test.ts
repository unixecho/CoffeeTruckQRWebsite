import { strict as assert } from "node:assert";
import { test } from "node:test";
import { safeNext } from "./redirect.ts";

/* ==========================================================================
   Open-redirect guard

   `next` travels from /login through Google and back into /auth/callback, so
   it is attacker-controllable the whole way: anyone can send the owner a link
   carrying any `next` they like. Without this guard that link bounces off the
   real domain — correct padlock, correct hostname — onto a page of the
   attacker's choosing.

   Every rejection below falls back to /manager rather than erroring, because a
   malformed `next` is not worth a dead end.
   ========================================================================== */

const FALLBACK = "/manager";

test("a plain path on this site is kept", () => {
  assert.equal(safeNext("/manager"), "/manager");
  assert.equal(safeNext("/manager/deals"), "/manager/deals");
  assert.equal(safeNext("/manager/settings?tab=staff"), "/manager/settings?tab=staff");
});

test("missing or empty falls back", () => {
  assert.equal(safeNext(null), FALLBACK);
  assert.equal(safeNext(undefined), FALLBACK);
  assert.equal(safeNext(""), FALLBACK);
});

test("a protocol-relative URL is rejected", () => {
  // The one people miss: a browser reads "//host" as a host, not a path.
  assert.equal(safeNext("//evil.example"), FALLBACK);
  assert.equal(safeNext("//evil.example/manager"), FALLBACK);
  assert.equal(safeNext("///evil.example"), FALLBACK);
});

test("an absolute URL is rejected whatever the scheme", () => {
  assert.equal(safeNext("https://evil.example"), FALLBACK);
  assert.equal(safeNext("http://evil.example"), FALLBACK);
  assert.equal(safeNext("javascript:alert(1)"), FALLBACK);
  assert.equal(safeNext("data:text/html,<script>alert(1)</script>"), FALLBACK);
});

test("a backslash cannot smuggle a host past the slash check", () => {
  // Some parsers normalise "\" to "/", turning "/\host" into "//host".
  assert.equal(safeNext("/\\evil.example"), FALLBACK);
  assert.equal(safeNext("/\\/evil.example"), FALLBACK);
});

test("control characters and whitespace are rejected", () => {
  // A newline or tab inside a Location value can split the header downstream,
  // and no legitimate path contains one.
  assert.equal(safeNext("/manager\nSet-Cookie: a=b"), FALLBACK);
  assert.equal(safeNext("/manager\r\nLocation: https://evil.example"), FALLBACK);
  assert.equal(safeNext("/man ager"), FALLBACK);
  assert.equal(safeNext("/manager\u0000"), FALLBACK);
  assert.equal(safeNext("	/manager"), FALLBACK);
});

test("a relative path with no leading slash is rejected", () => {
  // "manager" would resolve against whatever the current directory happens to
  // be, which is not something to guess at during a sign-in redirect.
  assert.equal(safeNext("manager"), FALLBACK);
  assert.equal(safeNext("../admin"), FALLBACK);
  assert.equal(safeNext("evil.example"), FALLBACK);
});
