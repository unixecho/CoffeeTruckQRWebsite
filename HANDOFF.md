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
