# Payments and checkout

What exists, why it is shaped this way, and the short list of things that have
to be filled in when the Grow merchant account arrives.

The general security reference is [`PLAYBOOK.md`](../PLAYBOOK.md); what this
codebase implements is [`SECURITY.md`](./SECURITY.md). This file is the
payment-specific version of both.

---

## 1. The state of it, honestly

### This shop does not take orders

`checkout_enabled` ships **false**, and that is the business decision, not a
default nobody got round to changing. This site is the mobile stand: somebody
scans the QR code while standing at the truck, browses, sees a total, and pays
cash or Bit at the counter four feet away. Ordering ahead is the standalone
3D Prints store's job. Taking an order here would create a queue for a shop
whose whole premise is that the customer has already arrived.

So the storefront behaves exactly as it did before this work: cart, total, Bit
link, pay at the counter.

### Why the machinery exists anyway

Because the two stores share this codebase's spine, and because Grow arrives
whenever the עוסק פטור registration does — which is not a date anybody
controls. Everything below is built, tested and switched off, so that turning
it on in either store is a switch and five environment variables rather than a
project started under time pressure.

**Built, and exercised end-to-end against the real database:** placing an
order, the order lifecycle, the counter flow, the retention job, the
customer's data-rights action, expiry, idempotent retries, and the security
rails around all of it.

**Built, unit-tested, and waiting on credentials:** card payment.
`src/lib/payments/providers/grow.ts` is written and wired in; it reports itself
unconfigured, so nothing offers it. Its flow is tested against a stubbed
transport — what it cannot be tested against is Grow's actual field names,
which is what §2 is for.

**Deliberately absent:** refunds from the manager, partial payments, tips,
saved cards, and anything resembling a customer account. Each is a real
feature and none is this shop's problem.

---

## 2. Turning Grow on

Blocked on one thing that is not technical: the **עוסק פטור** registration.
Grow will not issue a merchant account without it, and there is no sandbox
shortcut worth building against in the meantime — an adapter tested against a
fake is tested against a fake.

When it comes through: five environment variables and two switches. Nothing
else changes — no code, no migration, no redeploy of anything but the
environment.

```bash
PAYMENT_PROVIDER=grow
GROW_API_BASE=https://<the host Grow gives you>
GROW_CHECKOUT_ORIGIN=https://<the host the payment PAGE is served from>
GROW_PAGE_CODE=...
GROW_USER_ID=...
GROW_API_KEY=...
GROW_WEBHOOK_SECRET=...      # only if Grow issues one; see §6
```

Then, in the manager: **Settings → Orders**. Two switches, and on this site
both are off:

- **Accept orders** — turns the checkout on at all. Leave it off here unless
  the stand's model changes; see §1.
- **Card payment** — offers card inside the checkout. Needs credentials
  behind it, and the switch is disabled in the UI until they exist.

Both halves of the second are required on purpose: the switch alone shows
nothing without credentials, and credentials alone show nothing until somebody
turns it on. A button that dead-ends at a counter is worse than no button.

`GROW_CHECKOUT_ORIGIN` is separate from `GROW_API_BASE` because the hosted page
can live on a different host from the API, and that origin ends up in two
security-relevant places — the CSP `frame-src` and the allowlist checked before
any URL reaches an `<iframe src>`. Both read
`paymentFrameOrigins()` in `src/lib/payments/config.ts`, so they cannot
disagree. Guessing it wrong is a blank frame at a counter in one direction and
a hole in the other.

### What still has to be verified against Grow's own documentation

All of it is confined to three clearly marked blocks in
[`src/lib/payments/providers/grow.ts`](../src/lib/payments/providers/grow.ts),
each tagged `TODO(grow-credentials)`:

| Block | What to check |
|---|---|
| 1 — endpoints | The two paths: create-process and process-info. |
| 2 — response shapes | Field names in the envelope and in the data object. |
| 3 — status mapping | Which codes mean paid, failed, cancelled, refunded. |

Plus, in the same file: the callback field names, which field is stable across
callback retries, and the signature header name and digest encoding.

**Nothing outside that file changes** — not the checkout, not the routes, not
the order service. That separation is the point of the whole exercise, and it
is worth resisting any temptation to reach around it.

The shapes written there follow Grow's publicly described "Light Server" API.
Treat them as a starting point to verify, not as fact. A wrong field name fails
loudly on the first sandbox call, which is the right time to find out.

---

## 3. The two status axes

An order has two independent lifecycles, and collapsing them into one enum is
the mistake that makes every later question unanswerable.

```
paymentStatus   unpaid → pending → paid
                            ↘ failed → pending (retry)
                            ↘ cancelled → pending (retry)
                            ↘ flagged            (amount did not reconcile)
                  paid → refunded
                  any  → expired               (swept, terminal)

orderStatus     placed → collected
                       → cancelled
                       → expired → placed      (a late payment revives it)
```

They genuinely diverge. A card order is `paid` before it is `collected`. A
counter order is both in the same moment. A refunded order was collected and
then paid back. One enum would need a state per pairing, and the transition
table would be a guess.

The legal transitions live in
[`src/lib/payments/status.ts`](../src/lib/payments/status.ts) as pure
functions, tested exhaustively in `status.test.ts` — the same treatment
`pricing.ts` gets, for the same reason: this is the second module in the
codebase where being wrong costs real money.

### `flagged` is the one to understand

A payment arrived whose amount does not match what we priced. It is **never**
silently accepted as paid, in either direction — an overpayment means the two
sides disagree about the price just as much as an underpayment does, and
handing goods over against a total nobody can reproduce is how a dispute
starts. The order parks, the manager shows it in red, and a human decides.

There is no tolerance and there must not be one. Both sides are integers in
agorot, so any difference is a real disagreement.

### The late payment on an expired order

An unpaid order is swept to `expired` after twenty minutes. A payment can
legitimately land after that: the phone lost signal in the queue, the provider
retried its callback, the frame sat open while somebody found their card.

The money is real either way, so a settled payment **revives** the order rather
than being refused. Refusing it would leave a customer charged for an order
that does not exist, which is far worse than an order that came back to life.

---

## 4. Where money is decided

One rule, and everything else follows from it: **every amount is computed
server-side, from the live catalogue, by the same `priceCart` the storefront
runs.**

The checkout request carries `{ productId, quantity }`, a name, a phone and a
note. No prices, no totals, no discounts. `createOrder` in
[`src/lib/orders.ts`](../src/lib/orders.ts) reads the catalogue **as an
anonymous visitor**, so RLS decides what exists — an order for a hidden
category or an unavailable product cannot be placed, and the filtering lives in
the database rather than in a `.filter()` somebody has to remember to write.

The total is then snapshotted onto the order along with the full pricing
breakdown, and the item names and unit prices are copied onto `order_items`.
An order is a record of what was agreed at a moment; the owner edits prices
between customers, and a receipt that silently re-reads today's price is not a
receipt.

---

## 5. Nothing believes a browser

Three places could be mistaken for evidence that a payment happened. None of
them is:

1. **The redirect to a success URL.** Anybody can navigate to one.
2. **The `postMessage` from the payment frame.** It is same-origin-checked, and
   it still only *prompts* a check.
3. **The webhook body.** The endpoint is public; anyone can POST to it.

The evidence is a server-to-server read — `fetchStatus`, over a connection we
opened, to a host we configured, with credentials only we hold. The webhook
route performs it before an order settles even when the payload arrived with a
valid signature, because a signature proves the bytes came from the provider
and says nothing about whether the amount matches what we priced.

The webhook also resolves the order **only** by the payment reference we
ourselves stored when the session was created. The body's own idea of which
order it concerns is never used for the lookup — that would let a stranger
nominate an order to mark paid.

### Idempotency, twice over

- **Placing an order** is idempotent on `clientRequestId`, a uuid the browser
  mints per attempt and re-sends on every retry. Without it, a dropped response
  on a market-stand tether is a second order and a second bag.
- **Applying a payment event** is idempotent through the state machine: a
  transition to the status an order already holds is refused, so a provider
  retrying "paid" five times changes nothing four times. The unique index on
  `(provider, provider_event_id)` deduplicates the *log* on top of that — it is
  not what correctness rests on, because whether an event id is stable across
  retries is a promise in somebody else's documentation.

---

## 6. Card data

None reaches us. Ever.

`createPaymentProcess` returns a URL to a page Grow hosts on its own origin.
That page renders inside an `<iframe>` and owns the card fields. Our JavaScript
cannot read across that boundary, our server never sees a pan, and our logs
cannot contain one. This is the entire reason to use hosted fields rather than
posting a form ourselves.

The belt to that brace is `redactPayload` in
[`src/lib/payments/log.ts`](../src/lib/payments/log.ts), which strips
card-shaped keys and long digit runs from anything before it reaches a log line
or the `payment_events` table. Nothing sensitive should ever get that far; it
exists for the one case that would be invisible otherwise — a provider echoing
something back in a callback.

The frame's `sandbox` allows the smallest set a hosted payment page can work
with, and each token is justified in place in
[`PaymentFrame.tsx`](../src/components/checkout/PaymentFrame.tsx). Notably
absent: `allow-modals`, `allow-downloads`, and unqualified
`allow-top-navigation`.

---

## 7. The public write endpoint

`POST /api/checkout` is the **first endpoint in this project a stranger can
reach with no session**, so PLAYBOOK §4 applies here and nowhere else. The
rails, in execution order, live in
[`src/lib/publicRoute.ts`](../src/lib/publicRoute.ts):

1. **Same-origin.** A missing `Origin` is allowed (same-origin or a non-browser
   client); a present-but-foreign one is refused.
2. **`Content-Type: application/json` required.** This is the rail that
   actually closes cross-site form posts — an HTML form can only ever send
   `text/plain`, urlencoded or multipart.
3. **A body ceiling from `content-length`, read before the body is.**
4. **Rate limiting, per-IP *and* global.** Per-IP alone does nothing against a
   proxy pool.
5. **A honeypot**, answered with a cheerful 200 and nothing written.
6. **Validation that BUILDS the stored object** rather than checking the
   caller's. `parseCheckoutRequest` names every field it accepts, so `status`,
   `paidAgorot` or an invented `isPaid` ride along into nothing. Pinned by a
   test that asserts the exact key set.

**The trade-off in rail 4, stated deliberately:** while the global window is
saturated, honest customers are refused too. That is acceptable here — an order
can be placed again thirty seconds later, or simply spoken to the person behind
the counter, which is what happened before this site existed. The ceiling is
set roughly a hundred times above any plausible peak for one truck.

The limiter keys are a truncated SHA-256 of the address, not the address. The
limiter needs to tell callers apart; it does not need to know who they are, and
the `rate_limits` table should not read as a list of who visited.

---

## 8. What is stored about a customer, and for how long

The first customer data this project has ever held. Two fields, both optional,
both anonymisable:

| Field | Why it exists |
|---|---|
| `customer_name` | So the owner can call out something other than a number. |
| `customer_phone` | So somebody who wandered off can be reached. |

Requiring either to buy a ₪25 keychain would be collecting personal data to
solve a problem shouting the order number already solves — so neither is
required, and the checkout says so.

**Not collected:** email, address, ID number, IP address, or anything about the
device. The order token is stored **hashed**, so the database never holds a
live credential.

### Retention

Decided at design time with the schema, and enforced by
`expire_and_age_orders()` on the nightly `pg_cron` job from migration 005:

| What | When | Why |
|---|---|---|
| unpaid orders → `expired` | 20 minutes | prices move during the day |
| `customer_name`, `customer_phone` cleared | 90 days | who bought it stops being useful long before what was sold does |
| the order row deleted | 24 months | |

Both numbers are **function parameters**, not literals in the job, so they can
move without a migration.

> ⚠ **For the owner.** The 24-month figure is a reasoned default, not advice.
> Israeli bookkeeping rules govern how long a record of a sale must be kept
> once you are registered as an עוסק פטור, and they — not this file — set the
> floor. Confirm it with an accountant and change the parameter.

### The customer's own rights

`DELETE /api/checkout/[token]`, offered as a button on the order screen next to
a list of exactly what it removes. It anonymises rather than deleting: what was
sold and for how much is the shop's business record; who bought it is not.

This is the self-service half of PLAYBOOK §1.4, and it is here now rather than
later because it is cheap to build early and expensive to retrofit once more
tables reference an order.

### Consent banners

Still none required, and this work did not change that. The checkout sets no
cookie, loads no third-party script, and its analytics hooks
([`analytics.ts`](../src/lib/payments/analytics.ts)) are **server-side only** —
they emit typed events to the platform log and carry no identifier for a
person. Adding a Google tag, a Meta pixel, or any embed that sets its own
storage is the trigger to build the banner. PLAYBOOK §3.

---

## 9. Content-Security-Policy

Added with this work, built per request in [`src/proxy.ts`](../src/proxy.ts)
from [`src/lib/csp.ts`](../src/lib/csp.ts).

- **Scripts get a per-response nonce plus `'strict-dynamic'`.** Only scripts
  carrying this response's nonce run, and only what they load runs after that.
  Next stamps the same nonce onto its own bootstrap because the header is set
  on the *request* as well as the response; the two inline no-flash scripts in
  the root layout take it explicitly.
- **`style-src` keeps `'unsafe-inline'`**, and that is a known, accepted
  weakness rather than an oversight. This design system styles with inline
  `style={{ … }}` attributes carrying tokens, several hundred call sites deep,
  and `style-src-attr` has no nonce mechanism. Inline style is a far narrower
  primitive than inline script — it can restyle and leak layout-based signals,
  but it cannot execute. Closing it properly is a Tailwind-only refactor, not a
  header change.
- **`frame-ancestors 'none'`** everywhere except `/checkout/frame-return`,
  which is framed by our own checkout by design. `X-Frame-Options` mirrors it
  with a negative-lookahead source in `next.config.ts` rather than relying on
  which duplicate header wins.
- **`frame-src`** is `'none'` until a payment provider is configured, then
  exactly its checkout origin.

Reading the nonce makes every page dynamic. That is the real cost, and it is
accepted: the storefront and manager were already per-request, and the two
pages that were not have no data to cache.

---

## 10. Files

```
src/lib/payments/
  types.ts        the vocabulary — statuses, the provider port, the order shape
  status.ts       the state machine. Pure, exhaustively tested.
  config.ts       every payment env var, read once, statically
  provider.ts     the frozen registry; nothing is built from a request
  providers/
    manual.ts     pay at the counter — a real provider, not a stub
    grow.ts       the Grow adapter. Three TODO blocks; nothing else changes.
  http.ts         timeouts, and retries only where a retry is safe
  log.ts          structured logging and the payload redactor
  url.ts          the frame-origin allowlist
  validate.ts     the checkout parser. Builds the object; never checks one.
  analytics.ts    server-side event hooks. No cookies, no third parties.

src/lib/orders.ts        the only module that writes an order or an event
src/lib/publicRoute.ts   the rail stack for unauthenticated writes
src/lib/csp.ts           the policy
src/lib/site.ts          one definition of "this site's origin"

src/app/api/checkout/               place, read, pay, cancel, forget
src/app/api/payments/webhook/[…]/   the provider calling back
src/app/api/manager/orders/[id]/    hand over, or call off

src/app/checkout/                   the flow, the order screen, the frame return
src/components/checkout/            all of the above, as components
src/components/manager/OrdersView   what is waiting at the counter

supabase/migrations/007_orders_and_payments.sql
```

---

## 11. Before the first real payment

- [ ] `npm run check` — lint, typecheck, tests.
- [ ] Migration 007 applied, and `scripts/audit-security.sql` re-run: no client
      role holds **any** grant on `orders`, `order_items` or `payment_events`,
      and `service_role` holds all three.
- [ ] A real unauthenticated `curl`: `POST /api/checkout` with a foreign
      `Origin` → 403; without `Content-Type: application/json` → 415;
      `GET /api/checkout/<made-up-token>` → 404. Not "the migration succeeded".
- [ ] One sandbox payment end to end, then **check the amount** on the order
      row against what the provider says. That single comparison is what the
      `flagged` state exists for.
- [ ] A deliberately wrong amount in the sandbox, if Grow's tools allow it, to
      see `flagged` actually appear in the manager.
- [ ] The callback URL registered with Grow points at
      `https://<site>/api/payments/webhook/grow`.
- [ ] A payment left open past the order's expiry, to watch the revival path.
- [ ] The frame renders — `frame-src` in the CSP has to name the same origin
      the session URL comes from, or it is a blank box at a counter.
