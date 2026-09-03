# Security

The model this codebase actually implements. Read it before touching an API
route, a migration, or anything that reads a request.

The general reference — the class of bug, the detection queries, the Israeli
legal obligations — is [`PLAYBOOK.md`](../PLAYBOOK.md) at the repo root. This
file is the specific version: what is true *here*, and which file it lives in.

---

## 1. Two clients, sharply different powers

`src/lib/supabase/server.ts` exports both. The difference is the whole model.

| | `createClient()` | `createServiceClient()` |
|---|---|---|
| Acts as | the signed-in visitor | the database owner |
| RLS | applies | **bypassed entirely** |
| Safe in | anywhere on the server | only behind an owner check |
| Used by | storefront reads | every write, and the manager's reads |

`createServiceClient()` throws rather than falling back to the anon key when
`SUPABASE_SERVICE_ROLE_KEY` is missing. A silent downgrade would turn a write
endpoint into one that fails confusingly at 3pm on a Sunday instead of loudly
at deploy time.

`src/lib/catalog.ts` has two reads for the same reason: `readCatalogue()` runs
as the visitor, `readCatalogueAsOwner()` bypasses RLS. Two differently-named
functions rather than a boolean flag, so the obligation to have checked
ownership is visible at the call site.

## 2. No client role holds a write grant. Anywhere.

Migration `002_grants_and_rls.sql` revokes everything from `public`, `anon` and
`authenticated`, then grants back `SELECT` and nothing else.

This is not belt-and-braces. **RLS scopes rows, not columns.** A table-level
`UPDATE` grant on `products` would let any signed-in visitor rewrite a price
under a perfectly correct row policy — PLAYBOOK §1.3. The only way to close
that without remembering column-level grants correctly every single time is to
never grant client writes at all.

Two independent locks on every table: the grant *and* RLS. The realistic
failure mode is somebody adding a policy while debugging, which then opens
nothing extra only because the grant is also missing.

`ALTER DEFAULT PRIVILEGES` at the end of 002 means a table created by a future
migration starts closed. A migration that forgets to think about grants fails
closed instead of open.

### The bug this caused, and the lesson in it

Migration 002 revokes from `public, anon, authenticated`. Naming `public` is
correct — it is the fix for PLAYBOOK §1.2, where revoking from `anon` alone
does nothing because every role inherits what the PUBLIC pseudo-role holds.

But `service_role` is also a role, and on a project where new tables are not
auto-exposed — the current Supabase default, which `supabase/config.toml`
deliberately keeps — PUBLIC was the *only* route it had to these tables.
Revoking took the server's access with it. Every write path returned
`permission denied` (42501) while the storefront worked perfectly, because
reads go through `anon`.

The assumption behind it: "service_role bypasses RLS, so it can do anything."
`service_role` has `BYPASSRLS`, so **policies** do not apply to it. Table
**GRANTs** still do. That is this document's opening point read from the other
side, and it is why §2 above is worded as "no *client* role holds a write
grant" rather than "nothing can write".

Fixed by `006_service_role_grants.sql`. The lasting rule: **after any
`REVOKE ... FROM PUBLIC`, test both directions** — that the client role is
locked out *and* that the server role can still work. `scripts/finish-setup.mjs`
now checks the first automatically, and `audit-security.sql` §2b the second.

## 3. Two enforcement layers, and only one of them is the boundary

**`src/proxy.ts`** gates `/manager/*` so an unauthorized person never renders
the screen. It is a *convenience* boundary.

**Every write route calls `requireOwner()` again.** This is the real one.
Middleware runs on navigation; an API route can be reached with curl, which
never navigates. A gate that exists only in middleware is a gate on the front
door of a building with open windows.

`requireOwner()` returns a discriminated union carrying the service-role
client. There is no way to reach the database without having passed the guard —
on the refusal branch the client does not exist. That is what stops the
"checked the owner, then forgot to stop" bug.

`src/lib/route.ts` bundles the four opening steps in the order that matters:
origin check → owner check → rate limit → body parse.

## 4. Request bodies are narrowed, never spread

`src/lib/validate.ts`, one parser per entity, returning column-shaped objects.

`{ ...body }` into an insert is how a client ends up choosing its own `id`,
`slug`, `sort_order` — or, on a role column, its own privileges. The bug is
invisible in review because it is the code that *isn't* there.

Generated server-side, never accepted from a client:

- **slugs** — `uniqueSlug()`. A client-chosen slug is a client-chosen URL.
- **sort orders** — `nextSortOrder()`. Otherwise one row pins itself to the top.
- **storage keys** — `productId/uuid.ext` in the upload route.

Table names are never interpolated. `REORDER_TABLES` and `SCOPE_TABLES` are
literal maps; the *value* side reaches PostgREST, never the string a client
sent.

## 5. Uploads

`src/app/api/manager/upload/route.ts`. Three things are non-negotiable:

1. **The object key is generated here** — never any part of the client's
   filename. That is the classic path-traversal vector, and a phone camera
   will happily send whatever it named the file.
2. **The type comes from the bytes**, via `sniffImage()`. A declared
   `Content-Type` is request input. An HTML file announced as `image/png` and
   served from a public bucket is stored XSS on our own origin. `file.type` is
   not consulted at all — a check that agrees with the header when it is honest
   and disagrees when it lies is just the byte check with extra steps.
3. **Size is checked before the body is buffered**, from `File.size`, which is
   known from the multipart headers.

Migration `004_storage.sql` gives the bucket public read and **no** client
write policy. `service_role` bypasses RLS, so the API route still writes. Any
policy added there later hands a signed-in stranger write access to the bucket.

## 6. Auth

Google sign-in is open to any Google account, so **authenticated is not
authorized**. A row in `owners` is what authorizes, created only two ways:

- the bootstrap address in `bootstrap_owner_email()` (migration 003), on its
  first sign-in;
- an invite created by an existing owner, claimed on first sign-in.

`claim_owner_access()` is `SECURITY DEFINER` but takes **no parameters** and
reads the caller's identity from `auth.uid()` / `auth.jwt()`. There is nothing
to pass in and therefore nothing to forge — PLAYBOOK §1.1. It also rejects an
unverified email, so a future provider cannot turn "types the owner's address"
into "is the owner".

Every `SECURITY DEFINER` function is followed, in the same migration, by
`REVOKE EXECUTE ... FROM PUBLIC`. Postgres grants `EXECUTE` to `PUBLIC` on
creation and every role inherits it, so revoking from `anon` alone does
nothing at all — PLAYBOOK §1.2. This is the one people miss.

`safeNext()` in `src/lib/redirect.ts` guards the sign-in redirect. `next`
travels from `/login` through Google and back, so it is attacker-controllable
end to end. Tested in `src/lib/redirect.test.ts` against protocol-relative
URLs, backslash smuggling and header splitting.

## 7. Rate limiting

`check_rate_limit()` is Postgres-backed. An in-memory counter is a false sense
of security on Vercel: concurrent requests land on different instances with
different memory, so the limit is really "N per instance" — which is not a
limit. Keyed per owner, not per IP, because these routes are already behind a
login and the thing worth bounding is one account's runaway loop.

It **fails open**. The limiter exists to bound a loop, not to hold a door shut,
and a broken limiter must not stop the owner pricing a keychain at the counter.
The door is `requireOwner()`.

## 8. The checkout — the one public write path

Full detail in [`PAYMENTS.md`](./PAYMENTS.md). What matters here is that this
is the **only** endpoint in the project a stranger can reach with no session,
so PLAYBOOK §4 applies to it and to nothing else. It gets its own opener,
`src/lib/publicRoute.ts`, deliberately separate from `route.ts`: two threat
models sharing one function is how the wrong assumptions get applied to the
wrong endpoint.

The rails, in execution order: same-origin → `Content-Type: application/json`
→ a body ceiling read from `content-length` → rate limiting **per-IP and
globally** → a honeypot answered with a cheerful 200 → validation that *builds*
the stored object rather than checking the caller's.

Three further rules the payment side rests on:

- **Nothing believes a browser.** Not the redirect to a success URL, not the
  `postMessage` from the payment frame, not the webhook body. Each is a prompt
  to perform a server-to-server read; that read is the evidence.
- **A webhook resolves its order only by the reference we stored.** The body's
  own idea of which order it concerns is never used for the lookup — that would
  let a stranger nominate an order to mark paid.
- **An amount that does not reconcile exactly is `flagged`, never `paid`** —
  in both directions, with no tolerance.

Order tokens are stored as a SHA-256, so the database never holds a live bearer
credential. `orders`, `order_items` and `payment_events` grant **nothing** to
any client role — not even `SELECT`, because an order carries a name and a
phone number. Migration 007, and note the GRANT/REVOKE ordering there: the
revoke names `public`, which also strips `service_role` (§2 above, PLAYBOOK
§1.7), so the server role is granted back explicitly straight afterwards.

## 9. Content-Security-Policy

Built per request in `src/proxy.ts` from `src/lib/csp.ts`, because two of its
directives depend on the path and one on a fresh random value.

Scripts get a per-response nonce plus `'strict-dynamic'`; the header is set on
the *request* as well as the response so Next stamps the same nonce onto its
own bootstrap. **`style-src` keeps `'unsafe-inline'`** — a known, accepted
weakness, not an oversight: this design system styles with inline `style`
attributes several hundred call sites deep, `style-src-attr` has no nonce
mechanism, and inline style cannot execute. Closing it is a refactor, not a
header change.

`frame-ancestors` is `'none'` everywhere except `/checkout/frame-return`, which
our own checkout frames by design. `frame-src` is `'none'` until a payment
provider is configured, and then names exactly its checkout origin — read from
`paymentFrameOrigins()`, the same function the server-side URL allowlist uses
before any provider URL reaches an `<iframe src>`. One source, so the policy
and the code cannot disagree.

## 10. What is deliberately absent

- **No card data reaches us, by construction.** The fields live in the
  provider's own iframe on the provider's own origin. `redactPayload` in
  `lib/payments/log.ts` is the belt to that brace, for the one case that would
  otherwise be invisible: a provider echoing something back in a callback.
- **No accounts, no addresses, no email, no stored IP.** An order holds an
  optional name and an optional phone number, both anonymisable, both cleared
  by the retention job at 90 days. `DELETE /api/checkout/[token]` is the
  customer's own button for it, on the same screen that lists what it removes.
- **No refunds from the manager.** A refund happens at the provider, with a
  human deciding it — not by writing a column here.
- **No cookie-consent banner**, and the checkout did not change that:
  `grep -rE "gtag|GTM-|fbevents|hotjar|mixpanel|segment" src/` still returns
  nothing, the analytics hooks are server-side only, and browser storage holds
  locale, theme, cart, and one `sessionStorage` breadcrumb during a payment.
  Adding *any* third-party script or embed is the trigger — PLAYBOOK §3.

---

## Before deploying

- [ ] `npm run check` passes (lint, typecheck, 78 tests).
- [ ] `scripts/audit-security.sql` run in the SQL editor — no `anon` or
      `authenticated` write grant on any table, **no grant of any kind on
      `orders`, `order_items` or `payment_events`**, and no `public_exec = true`
      on a `SECURITY DEFINER` function.
- [ ] An actual unauthenticated `curl` against a manager write route returns
      401, and a foreign `Origin` returns 403. Not "the migration succeeded" —
      a real request. This is exactly how PLAYBOOK §1.2 was caught.
- [ ] The public checkout endpoint too: `POST /api/checkout` without
      `Content-Type: application/json` returns 415, with a foreign `Origin`
      returns 403, and `GET /api/checkout/<made-up-token>` returns 404.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set server-side only and is **not**
      prefixed `NEXT_PUBLIC_`.
- [ ] `bootstrap_owner_email()` names the address the owner will actually sign
      in with.
