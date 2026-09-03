# Session Handoff

Running log. At the end of each session: tick off what landed, add a dated
entry, and flag anything still open or needing the owner.

Start a session by reading the top entry below and the open items.

---

## Open items

**(owner)** marks something only you can do — it needs a browser login and
cannot be automated from here.

### Before this is live — do these in order

Everything below is in [`docs/SETUP.md`](docs/SETUP.md) with the exact
commands. Four steps need a browser and cannot be automated from a terminal.

- [ ] **(owner)** `npx supabase login`, create the project, `supabase link`,
      `supabase db push`. ~15 min, mostly waiting for the project to build.
- [ ] **(owner)** Google OAuth client + enable Google in the Supabase Auth
      dashboard. Without it there is no way into the manager at all.
      `docs/SETUP.md` §2 has the exact redirect URI — getting that wrong is the
      usual cause of `redirect_uri_mismatch`.
- [ ] **(owner)** Put the four env vars in `.env.local` **and** in Vercel
      (Production + Preview), then redeploy — Vercel does not pick up new
      variables until the next build.
- [ ] `node scripts/seed-supabase.mjs` to load the 11 products and their photos.
- [ ] **(owner)** Set the **Bit payment link** in Settings. It ships empty, and
      the storefront deliberately hides the pay button rather than showing a
      dead one.
- [x] **Migration 007 applied** to the linked project on 2026-09-03, and
      verified afterwards: `anon` gets 401 on both SELECT and INSERT for
      `orders`, `order_items` and `payment_events`; `service_role` reads all
      three. Test orders were placed, exercised and deleted — the tables are
      empty. `checkout_enabled` and `online_payments_enabled` are both **false**,
      which is the decision, not a to-do: this stand takes payment at the
      counter and ordering belongs to the standalone 3D Prints store.

      One cosmetic consequence: the order-number sequence sits at 2, so if
      ordering is ever switched on here the first real order is `#0003`.

### When the Osek Patur registration and Grow account come through

- [ ] Five environment variables and two switches —
      [`docs/PAYMENTS.md`](docs/PAYMENTS.md) §2. No code change; the adapter is
      written, wired in and unit-tested against a stubbed transport.
- [ ] Verify the three `TODO(grow-credentials)` blocks in
      `src/lib/payments/providers/grow.ts` against Grow's own integration
      guide. Endpoints, field names, status codes. A wrong name fails loudly on
      the first sandbox call, which is the right time to find out.
- [ ] **(owner)** Confirm the order-retention window with an accountant.
      Migration 007 deletes orders at 24 months and clears names and phone
      numbers at 90 days; both are function parameters, and Israeli
      bookkeeping rules — not this repo — set the floor.

**Check `bootstrap_owner_email()` in `supabase/migrations/003_owners.sql`
before pushing.** It is set to `nikolsburgj@gmail.com`. That address, on its
first Google sign-in, becomes the owner. Sign in with a different one and you
land on `/no-access` with no way to grant yourself access.

### Known open

- [ ] The Vercel project `mobile-3dprint-shop` reports `live: false` and
      `framework: null` — it was set up for the old static site. `vercel.json`
      now pins `framework: "nextjs"`, which overrides the dashboard setting at
      build time, but if the first deploy behaves oddly check the project's
      Framework Preset in the Vercel UI.
- [ ] No custom domain. The shop is at `mobile-3dprint-shop.vercel.app`; the QR
      code on the truck must point there, not at the old GitHub Pages URL.
- [ ] **Two real stand photos and the small-keychains split never made it into
      the new catalogue.** `main` carried on for five commits after the rebuild
      branch forked, and among them were `clickers.jpg` and
      `small-keychains.jpg` — actual photographs of the stand — plus a split of
      the single `keychains-and-clickers` product into "Small Keychains" (₪7,
      3/₪18 · 5/₪25) and "Clickers" (₪10, 3/₪25 · 5/₪40).

      The merge brought both photos across into `public/products/`, so the
      files are here. The catalogue still is not: it has one product with a
      seeded photo. Doing it properly is a few minutes in the manager on a
      phone — add the product, set its deals on the Deals screen, upload each
      photo — which is exactly the job the manager exists for. The old
      product copy and tier prices are in
      `git show original-static-site:data/products.json`.
- [ ] GitHub Pages is still serving the old site from `main` until the first
      Vercel production deploy replaces the QR target. Turn Pages off once the
      new URL is confirmed working.
- [ ] Accessibility statement (הצהרת נגישות) is **not** written yet.
      `PLAYBOOK.md` §2.2 explains why it is required regardless of the revenue
      threshold, and what it has to say.

---

## Session log

### 2026-09-03 (second session) — Orders, checkout, and the Grow-shaped hole

**Nothing a customer sees has changed.** The stand still works the way it did:
browse, see a total, pay cash or Bit at the counter. `checkout_enabled` ships
false and is false in the live project.

What landed is the machinery behind that switch — an order lifecycle, a
checkout, a manager screen, and a payment-provider port with Grow written
against it — built now so that turning it on later, in this store or in the
standalone 3D Prints one, is a switch rather than a project. Grow itself waits
on the עוסק פטור registration; nothing about that is a code problem.

**Grow is written and switched off.** `src/lib/payments/providers/grow.ts` is
wired into the same pipeline the counter flow uses and reports itself
unconfigured, so nothing offers it. Turning it on once the registration and
merchant account come through is five environment variables and two switches in
Settings — no code change, no migration, no rewrite of the checkout. That was
the point of the exercise, and the things that genuinely cannot be known yet
are confined to three blocks in that one file, each tagged
`TODO(grow-credentials)`.

**Two status axes, not one.** An order tracks *has the money moved* and *has
the customer walked away with it* separately, because they genuinely diverge —
a card order is paid before it is collected, a counter order is both at once, a
refunded order was collected and then paid back. The legal transitions are pure
functions in `payments/status.ts` with the same test treatment `pricing.ts`
gets: it is the second module here where being wrong costs real money.

**Nothing believes a browser about money.** Not the redirect to a success URL,
not the `postMessage` from the payment frame, not the webhook body — each only
*prompts* a server-to-server read of the transaction, and that read is the
evidence. A payment whose amount does not reconcile exactly becomes `flagged`,
never `paid`, in either direction; the manager shows it in red and refuses to
offer the hand-over button.

**The first public write endpoint this project has ever had.** PLAYBOOK §4 now
applies, and it gets its own opener (`lib/publicRoute.ts`) rather than an
option on the manager's: same-origin, JSON content-type, a body ceiling read
before the body, rate limiting per-IP **and** globally, a honeypot answered
with a cheerful 200, and validation that *builds* the stored object instead of
checking the caller's. The global-limit trade-off is written down in that file
rather than inherited silently.

**The first customer data this project has ever held**, so the things PLAYBOOK
§1.4 says get retrofitted badly are in from the start: a retention job with the
windows as parameters, and a self-service "remove my details" button sitting on
the same screen that lists exactly what it removes.

**A real CSP, at last.** Per-response nonce plus `strict-dynamic` for scripts,
built in `proxy.ts`. `style-src` keeps `'unsafe-inline'` and that is written
down as an accepted weakness rather than hidden — this design system styles
with inline `style` attributes several hundred call sites deep, and closing it
is a refactor, not a header.

**Verified against a running server and the real database, not by reading:**

- Every rail on `/api/checkout`: 415 without a JSON content-type, 403 to a
  foreign `Origin`, 400 with the offending field named, 200-and-nothing-written
  on a filled honeypot, 404 for a made-up token, 404 for an unknown provider,
  401 on the manager route with no session.
- A real order placed end to end, twice, and the pricing engine's number stored
  on it: ₪105 of items, one 2-for-₪50 deal, ₪85 total, ₪20 saved.
- **Idempotency:** three POSTs with one `clientRequestId` produced exactly one
  order, each reply carrying a freshly rotated token.
- **Sanitising:** a customer name padded with extra spaces and carrying a
  right-to-left override (U+202E) was stored as the two plain words דנה לוי —
  whitespace collapsed and the override stripped, which on the order screen is
  the difference between reading a price and reading it backwards.
  `"+972 (54) 910-9603"` stored as digits.
- **Expiry on read**, not just nightly: an order past its window flipped to
  `expired` and withdrew both of its capabilities on the next GET.
- **Data rights:** the customer's own DELETE cleared the name and phone, kept
  the order and the note, and was idempotent.
- **Retention:** `expire_and_age_orders(0, 24)` cleared the identifying
  columns and stamped `anonymized_at`; `cleanup_expired_rows()` calls it; both
  return 401 to `anon`.
- **Database guards:** a duplicate `(provider, provider_event_id)` is refused
  (23505), two orders cannot claim one payment reference (23505), and an
  invented `payment_status` is refused by the check constraint (23514).
- **Lockdown:** `anon` gets 401 on SELECT *and* INSERT for all three new
  tables. Not just "the migration succeeded" — real requests.
- The CSP is present on every response with a fresh nonce, and Next stamps the
  same nonce onto its own bootstrap: **zero script tags without one** in the
  production HTML, and no `unsafe-eval` outside development.
- `npm run check` — lint, typecheck, **121 tests** (was 36). `npm run build` —
  34 routes. All test orders deleted afterwards; the tables are empty.

**Two defects found this way and fixed:**

1. The nonce on the two inline no-flash scripts produced a hydration mismatch
   on every page. Browsers deliberately blank a script's `nonce` attribute
   after load so a CSS-selector injection cannot read it back, so React's
   client render legitimately disagrees with the server's.
   `suppressHydrationWarning` on those two, with the reason beside them.
2. The cancel and forget endpoints returned an order without its `can` block,
   which the order screen applies straight into the state it renders from — so
   the next paint would have read `can.cancel` off `undefined`. Every endpoint
   that hands back an order now hands back the whole shape.

**Still unexercised, and why.** The manager's own Orders screen needs a Google
session, which cannot be produced from here — its two actions are covered by
`canCollect` in the state-machine tests and its list query was run by hand
against the real schema, but nobody has looked at it rendered. And the Grow
webhook against a live provider waits on credentials; its adapter is tested
against a stubbed transport, which pins the flow but cannot pin Grow's field
names.

**One small refactor, and the reason for it.** The text sanitisers and the
result shape moved from `lib/validate.ts` into a new `lib/parse.ts`, which
`validate.ts` re-exports so no call site changed. Two parsing surfaces now
exist with different threat models, and the sanitiser that strips bidi
overrides has to be *the same code* in both — a copy is a security control that
quietly stops matching. It also made those functions unit-testable, which they
were not behind `next/server`.

---

### 2026-09-03 — Rebuilt as a Next.js + Supabase app

The static GitHub Pages site is gone. Everything below is new, on the branch
`rebuild/next-supabase`. The old site is preserved intact under `legacy/`.

**Why the rebuild.** The catalogue was a JSON file edited by hand or through a
one-off `manager.html`, product photos had to be committed to git, and bundle
pricing only worked within a single product row — a customer taking three
*different* keychains did not get the 3-for-₪25 deal. All three problems are
structural, not bugs.

**The stack**, taken from the two reference projects as asked:

| From | What |
|---|---|
| 3D Prints | The whole design language — Apple-HIG semantic tokens, the `components/ios/` library, dark-first, motion curves, the 44pt/contrast floor. Next 16 / React 19 / Tailwind 4. |
| Ayeka Bar | The architecture — Supabase with RLS and default-deny grants, middleware auth with an owner allowlist, trilingual i18n, and `PLAYBOOK.md`, which is now in this repo too. |

**The catalogue is now three levels: category → subclass → product.** The middle
level is the point of the rebuild. A deal attaches to a *scope*, and a subclass
deal is filled by any mix of products inside it — "any three small keychains for
₪25" now actually means that. Keychains ship with three subclasses ready to
fill: clickers, small, big.

**Pricing is solved exactly, not greedily.** The obvious "apply the biggest
bundle, charge the rest at full price" overcharges: with 2-for-₪18 and 3-for-₪25
over a ₪10 base, five items are cheapest as 3+2 = ₪43, but biggest-first gives
₪45. `src/lib/pricing.ts` runs a small dynamic program instead, and
`pricing.test.ts` pins it with 24 tests including a brute-force cross-check and
an exhaustive sweep asserting it never charges above base price and never bills
a bundle it did not fill.

**Security, per `PLAYBOOK.md` §1.** No client role holds a write grant on any
table — RLS scopes rows, not columns, so a table-level UPDATE on `products`
would let a signed-in visitor rewrite a price under a perfectly correct row
policy. Every write goes through an API route that re-checks ownership
(middleware guards navigation; curl does not navigate). Every `SECURITY DEFINER`
function is revoked from `PUBLIC` explicitly, which is the revoke people miss.
Rate limiting is a Postgres table, not an in-memory counter that means nothing
across serverless instances. Retention is scheduled on day one.

**Deliberate carry-overs from the old site**

- Rubik stays, self-hosted, covering all three scripts. The iOS type scale is
  layered on top of it rather than the SF Pro/Inter stack the source system uses.
- The cart now persists to `localStorage` — it was on the old backlog. Only
  `{productId, quantity}` is stored, never a price, so an owner's edit is
  reflected immediately instead of a stale total resurfacing.
- The old backlog item "make the catalogue the source of truth for categories"
  is resolved by construction: categories are database rows with their own
  localized labels, so adding one in the manager needs no code change. That was
  the deferred `app.js` refactor.

**One data correction, made deliberately.** The old catalogue advertised
"1 for ₪10 / 3 for ₪25 / **5 for ₪35**" in all three languages, but its
`pricingTier` charged **₪40** for five. They had disagreed since the row was
written. The seed takes the advertised ₪35 — undercharging by ₪5 beats charging
someone more than the sign in front of them says. Change it in the manager if
₪40 was the intent.

**Not built, on purpose:** online ordering and payment capture. The shop still
ends at "here is your total, pay with Bit at the counter", which is what the
business actually does. Nothing here forecloses adding it later.

**Verified, not asserted.** Everything below was checked against a running
server, and every defect in the list after it was found that way rather than by
reading the code:

- `/manager` → 307 to `/login?next=%2Fmanager`; `/shop` stays public.
- Every write route → 401 with no session, 403 to a foreign `Origin` (checked
  before auth, so a cross-site post never reaches the guard).
- Cart: two dragons → ₪70 before discounts, ₪50 total, "you saved −₪20", with
  the applied deal named.
- Manager on a 375px viewport: Hebrew RTL, the three keychain subclasses, and
  the live "5 for ₪35" caption derived from the pricing engine.
- `npm run check` — lint, typecheck, 36 tests. `npm run build` — 24 routes.

Defects found and fixed during that pass:

1. **A wrong price claim on the storefront.** Group headings were derived with
   `ladderFor` on a sample product, which includes that product's *own* deal —
   so a "2 for ₪50" scoped to one dragon rendered as the whole Figures
   category's offer. A customer taking any two figures to the counter would
   have been charged ₪70. Now uses `groupLadder`, with a test asserting that an
   advertised group price is what `priceCart` actually charges.
2. `ListRow` wrapped the whole row in a `<button>` *including* `trailing`, so
   the reorder arrows nested a button inside a button — invalid HTML that broke
   hydration outright.
3. `imageUrl` lived in the `server-only` catalog module, so importing it from a
   client component pulled `next/headers` into the browser bundle.
4. The auth pages passed a Lucide icon from a Server Component to a Client
   Component. A function cannot cross that boundary; the production build
   failed on it.
5. The ESLint flat config used `FlatCompat`, which died on a circular structure
   before linting a single file.
6. `middleware.ts` → `proxy.ts` for the Next 16 convention. The export name has
   to match the filename or the file silently stops running — which here would
   mean the manager stops being gated.

**A note on `.mcp.json`.** A `.mcp.json` appeared in the repo root mid-session
pointing a Supabase MCP server at project ref `sbjqgqarcavxljfnyloe`. It was
flagged as suspicious because the ref matched neither Ayeka's nor anything else
known at the time — but it is **this project's own** Supabase project, "Mobile
3DPrint Shop". The suspicion was wrong. The file was deleted and `.mcp.json` is
now gitignored, which cost nothing: `supabase link` writes its own state under
`supabase/.temp/`, and the link worked first time. Re-create it locally if you
want the Supabase MCP server back — just do not commit it, because a project
ref in a shared file is a foot-gun pointed at whichever database it names.

<!-- Everything below predates the rebuild and describes the original
     hand-written site. Kept because this is a running log and the rebuild
     branch had dropped it; the code it refers to is tagged
     original-static-site. -->

### 2026-06-30 — Small keychains product + store UI polish

- **Split keychains into two separate products** on the catalog:
  - "Small Keychains" (`small-keychains`): ₪7 each, bundle tiers 3/₪18 · 5/₪25 — new product
  - "Clickers" (`clickers`): ₪10 each, bundle tiers 3/₪25 · 5/₪40 — renamed from former "Keychains and Clickers"; descriptions cleaned up (pricing no longer baked in)
  - Both share `keychain-star.png` for now; owner needs to add a separate clicker photo (see backlog)
- **Bundle pricing visible on product cards**: new `renderTierDeals()` helper in `app.js` shows tier deals (e.g. "3 / ₪18 · 5 / ₪25") in orange beneath the base price on every card that has pricing tiers.
- **Store grid modernised**: switched from single-column horizontal cards to a 2-column grid with vertical (image-on-top) cards at ≥540px viewport width. Mobile (<540px) retains the horizontal card layout. Description lines are clamped to 3 lines on the vertical layout.
- Verified in Playwright: Hebrew RTL at 1280px and 390px, English LTR, keychains category filter, tier deal display.

### 2026-06-16 — Product manager tool (`manager.html`)

- Added a standalone, dependency-free **product manager** (`manager.html`, opened
  at `/manager.html` on the local server; marked `noindex`). It loads the live
  `data/products.json`, lets the owner add / edit / duplicate / delete / reorder
  items in a guided form, and writes out a clean `products.json`.
- **Safe by construction:** the file is always re-serialized from validated,
  normalized objects (never hand-patched), in the repo's exact field order with a
  trailing newline — it can't be saved half-broken. Validation blocks duplicate
  IDs, bad ID format, missing Hebrew name (primary language), invalid price,
  missing image, and malformed bundle tiers. An unsaved-changes guard warns before
  leaving. In Chrome/Edge it can Open→edit→Save straight to disk via the File
  System Access API; elsewhere it downloads the file.
- **Auto-discovery (no hardcoded lists):** category keys are read from the
  `categories` block in `app.js` and merged with keys present in the catalog;
  image paths are read from the `assets/` directory listing the dev server
  exposes, merged with images already referenced. New categories can be created
  inline in the editor (camelCase key). Graceful fallback to default keys +
  catalog data if `app.js` / the listing can't be read.
- Verified in-browser: load, validation, new-category create + save, schema/field
  order, image + category discovery — no console errors.
- **Open follow-up (see backlog):** a brand-new category still needs its localized
  label added to `app.js` to display translated on the site. The agreed direction
  is to eventually make `products.json` itself the source of truth for category
  definitions so the manager update is all that's needed. Deferred.
- Status: shipped to `main`.

### 2026-06-14 — Unified typography (Rubik)

- Replaced the `system-ui` stack (which rendered Hebrew, Latin, and Arabic in
  different fonts and faux-bolded the non-standard weights) with **Rubik**,
  self-hosted as variable woff2 subsets in `assets/fonts/`.
- Added `@font-face` blocks with per-subset `unicode-range`, set the body font,
  and preloaded the Hebrew + Latin subsets. Verified all three languages now
  render in one consistent typeface.
- Status: shipped to `main`.

### 2026-06-14 — Project docs + suggestions button

- Added `CLAUDE.md` (project overview, architecture, conventions, workflow).
- Added this `HANDOFF.md` session-handoff log.
- Added a **suggestions / requests** button on the landing page, beneath the
  "straight to Bit" button, that opens WhatsApp with a prefilled message so
  customers can send ideas and special requests. Localized in he/en/ar.
- Status: shipped to `main`.

### 2026-06-12 — UI polish + features

- **Motion polish:** animated cart drawer (slide-up) and overlay (fade) instead
  of instant toggle; animated toast; hover/active/focus states on all buttons;
  staggered product-card entrance; view transitions; hero phone float; respects
  `prefers-reduced-motion`.
- **Language switcher:** globe stays pinned top-left in every language; menu
  expands horizontally beside it with separators and an active-language
  highlight.
- **Quick Bit button** on the landing page for customers who already know what
  they want and want to pay directly.
- **Product lightbox:** tapping a product card opens a detail view (large image,
  description, price, add-to-cart) over a blurred backdrop; closes via ×,
  backdrop tap, or Escape.
- **WhatsApp contact widget:** permanent bottom-right floating button with a
  prefilled (gender-neutral) inquiry message about 3D printing.
- Status: all shipped to `main`.

### Pre-2026-06-12 — Baseline (prior work, from git history)

- Flying-particle add-to-cart animation and cart highlight pulse.
- Bit payment link wiring and cart animation refactor.
- Products sorted by price ascending after fetch.
- Product image paths fixed; assets renamed.
