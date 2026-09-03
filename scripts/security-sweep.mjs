/**
 * Live security sweep against the real project.
 *
 *     npm run dev          # in one terminal
 *     node scripts/security-sweep.mjs
 *
 * Run before any deploy, and again after any migration that touches grants,
 * policies or functions.
 *
 * Everything here is an actual HTTP request, because "the migration succeeded"
 * is not evidence — PLAYBOOK §1.2 was found by re-testing live, and §1.7 by
 * the same method from the other side.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const site = "http://localhost:3000";

let pass = 0;
let fail = 0;
const check = (label, good, detail = "") => {
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

const rest = (path, init = {}) =>
  fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, ...(init.headers ?? {}) },
  });

console.log("\n=== 1. Anonymous cannot write the catalogue ===");
for (const table of ["categories", "subclasses", "products", "product_images", "pricing_rules", "app_settings"]) {
  const r = await rest(table, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name_he: "x", price_agorot: 1, key: "x", value: true, path: "x", scope: "product", min_qty: 2 }),
  });
  check(`INSERT ${table} refused`, !r.ok, `${r.status}`);
}

console.log("\n=== 2. Anonymous cannot change a price ===");
{
  const r = await rest("products?slug=eq.articulated-dragon", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ price_agorot: 1 }),
  });
  check("UPDATE products refused", !r.ok, `${r.status}`);
  const after = await (await rest("products?slug=eq.articulated-dragon&select=price_agorot")).json();
  check("dragon still costs 3500", after?.[0]?.price_agorot === 3500, `is ${after?.[0]?.price_agorot}`);
}

console.log("\n=== 3. Private tables are invisible to anonymous ===");
/* The last three are the strictest tables in the schema: every other one
   grants `anon` SELECT, and these grant nothing at all, because they hold a
   customer's name and phone number. Migration 007. */
for (const table of [
  "owners",
  "owner_invites",
  "audit_log",
  "rate_limits",
  "orders",
  "order_items",
  "payment_events",
]) {
  const r = await rest(`${table}?select=*&limit=1`);
  check(`SELECT ${table} refused`, !r.ok, `${r.status}`);
}

console.log("\n=== 4. Nobody can make themselves an owner ===");
{
  const r = await rest("owners", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ auth_user_id: "00000000-0000-0000-0000-000000000000", email: "attacker@example.com", role: "owner" }),
  });
  check("INSERT owners refused", !r.ok, `${r.status}`);
  const r2 = await rest("owner_invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "attacker@example.com", role: "owner" }),
  });
  check("INSERT owner_invites refused", !r2.ok, `${r2.status}`);
}

console.log("\n=== 5. SECURITY DEFINER functions are not anonymously callable ===");
for (const [fn, body] of [
  ["claim_owner_access", {}],
  ["check_rate_limit", { p_key: "x", p_max: 999999, p_window_seconds: 1 }],
  ["cleanup_expired_rows", {}],
  ["bootstrap_owner_email", {}],
  // Takes the retention windows as parameters, so an anonymous caller passing
  // zeroes would delete every order on the system.
  ["expire_and_age_orders", { p_anonymize_after_days: 0, p_delete_after_months: 0 }],
]) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  check(`rpc ${fn} refused`, !r.ok, `${r.status}`);
}

console.log("\n=== 6. Storage: public read, no anonymous write ===");
{
  const r = await fetch(`${url}/storage/v1/object/public/product-photos/seed/keychain-star.png`);
  check("photo reads publicly", r.ok, `${r.status}`);
  const up = await fetch(`${url}/storage/v1/object/product-photos/evil/payload.html`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "text/html" },
    body: "<script>alert(1)</script>",
  });
  check("anonymous upload refused", !up.ok, `${up.status}`);
}

console.log("\n=== 7. The app's own boundaries ===");
{
  const m = await fetch(`${site}/manager`, { redirect: "manual" });
  check("/manager redirects to login", m.status === 307 || m.status === 302, `${m.status}`);

  const api = await fetch(`${site}/api/manager/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categoryId: "x", name: { he: "x" }, priceAgorot: 1 }),
  });
  check("API write without a session is 401", api.status === 401, `${api.status}`);

  const cross = await fetch(`${site}/api/manager/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: "{}",
  });
  check("API write from a foreign Origin is 403", cross.status === 403, `${cross.status}`);

  const upload = await fetch(`${site}/api/manager/upload`, { method: "POST" });
  check("upload without a session is 401", upload.status === 401, `${upload.status}`);

  const orderPatch = await fetch(
    `${site}/api/manager/orders/11111111-1111-4111-8111-111111111111`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "collect" }),
    }
  );
  check("order PATCH without a session is 401", orderPatch.status === 401, `${orderPatch.status}`);

  /* Grepping the whole page for the hostile value proves nothing: Next echoes
     the raw searchParams into the RSC payload regardless of what the component
     does with them. The question is what value reached the sign-in button, so
     read that prop out of the flight data instead. */
  const BACKSLASH = String.fromCharCode(92);
  const QUOTE = '"';

  /* Scanned rather than matched with a regex: the flight data escapes its
     quotes, so the marker is sometimes `"next":"` and sometimes `\"next\":\"`,
     and a pattern covering both is less readable than reading forward to the
     first quote or backslash. */
  const propOf = (html) => {
    const found = new Set();
    for (const marker of [`${QUOTE}next${QUOTE}:${QUOTE}`, `${BACKSLASH}${QUOTE}next${BACKSLASH}${QUOTE}:${BACKSLASH}${QUOTE}`]) {
      let from = 0;
      for (;;) {
        const at = html.indexOf(marker, from);
        if (at === -1) break;
        const start = at + marker.length;
        let end = start;
        while (end < html.length && html[end] !== QUOTE && html[end] !== BACKSLASH) end += 1;
        found.add(html.slice(start, end));
        from = end;
      }
    }
    return [...found];
  };

  for (const bad of ["//evil.example", "///evil.example", "https://evil.example", "javascript:alert(1)"]) {
    const html = await (await fetch(`${site}/login?next=${encodeURIComponent(bad)}`)).text();
    const values = propOf(html);
    const escapes = values.some(
      (v) => v.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith("/\\")
    );
    check(`open redirect neutralised: ${bad}`, !escapes && values.length > 0, values.join(","));
  }

  /* The other half — a guard that rejects everything is not a working guard. */
  for (const good of ["/manager", "/manager/deals"]) {
    const html = await (await fetch(`${site}/login?next=${encodeURIComponent(good)}`)).text();
    check(`legitimate path preserved: ${good}`, propOf(html).includes(good), propOf(html).join(","));
  }
}

/* The public checkout is the only endpoint a stranger can reach with no
   session, so its rails get re-tested live rather than trusted to the code
   that implements them — the same reasoning as everything above. PLAYBOOK §4.

   These pass whether or not ordering is switched on: a refusal is a refusal.
   The one thing they do NOT prove is that an order can be placed, which is
   deliberate — this script's job is to establish what cannot happen. */
console.log("\n=== 8. The public checkout's rails ===");
{
  const noType = await fetch(`${site}/api/checkout`, { method: "POST" });
  check("checkout without JSON content-type is 415", noType.status === 415, `${noType.status}`);

  const foreign = await fetch(`${site}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
    body: "{}",
  });
  check("checkout from a foreign Origin is 403", foreign.status === 403, `${foreign.status}`);

  const junk = await fetch(`${site}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lines: [{ productId: "not-a-uuid", quantity: 1 }],
      paymentMethod: "counter",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
    }),
  });
  check("checkout with a junk product id is 400", junk.status === 400, `${junk.status}`);

  const unknown = await fetch(`${site}/api/checkout/made-up-token-aaaaaaaaaaaaaaaaaaaa`);
  check("an unknown order token is 404", unknown.status === 404, `${unknown.status}`);

  const hook = await fetch(`${site}/api/payments/webhook/not-a-provider`, {
    method: "POST",
    body: "x=1",
  });
  check("an unknown webhook provider is 404", hook.status === 404, `${hook.status}`);
}

console.log(`\n${fail === 0 ? "ALL CLEAR" : "PROBLEMS FOUND"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
