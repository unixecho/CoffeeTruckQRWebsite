# Session Handoff

Running log. At the end of each session: tick off what landed, add a dated
entry, and flag anything still open or needing the owner.

Start a session by reading the top entry below and the open items.

---

## Open items

**(owner)** marks something only you can do — it needs a browser login and
cannot be automated from here.

### Before this is live

- [ ] **(owner)** Provision Supabase and connect it. Full checklist in
      [`docs/SETUP.md`](docs/SETUP.md). Roughly: `npx supabase login`, create the
      project, `supabase link`, `supabase db push`, then copy three keys into
      `.env.local` and into the Vercel project.
- [ ] **(owner)** Create the Google OAuth client and enable Google in the
      Supabase Auth dashboard. Without it there is no way into the manager.
      `docs/SETUP.md` §2 has the exact redirect URI.
- [ ] **(owner)** Set the real **Bit payment link** in the manager's Settings
      screen. It ships empty, and the storefront deliberately hides the pay
      button rather than showing a dead one.
- [ ] Run `node scripts/seed-supabase.mjs` once the database is up, to load the
      11 existing products and their photos.

### Known open

- [ ] The Vercel project `mobile-3dprint-shop` reports `live: false` and
      `framework: null` — it was set up for the old static site. `vercel.json`
      now pins `framework: "nextjs"`, which overrides the dashboard setting at
      build time, but if the first deploy behaves oddly check the project's
      Framework Preset in the Vercel UI.
- [ ] No custom domain. The shop is at `mobile-3dprint-shop.vercel.app`; the QR
      code on the truck must point there, not at the old GitHub Pages URL.
- [ ] GitHub Pages is still serving the old site from `main` until the first
      Vercel production deploy replaces the QR target. Turn Pages off once the
      new URL is confirmed working.
- [ ] Accessibility statement (הצהרת נגישות) is **not** written yet.
      `PLAYBOOK.md` §2.2 explains why it is required regardless of the revenue
      threshold, and what it has to say.

---

## Session log

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
