# CLAUDE.md

Guidance for working in this repository.

## What this is

A storefront plus an owner's catalogue manager for a coffee truck that also
sells 3D prints. Customers scan a QR code, browse, build a cart, see a total,
and pay at the counter with **Bit**. No checkout, no shipping, no customer
accounts. The owner signs in with Google at `/manager` and edits the catalogue
from a phone, standing at the stand. Trilingual: Hebrew (primary), English,
Arabic — Hebrew and Arabic are RTL.

## Stack

Next.js 16 App Router · React 19 · Tailwind 4 · TypeScript strict ·
Supabase (Postgres + Auth + Storage). Runtime dependencies are `lucide-react`
and `@supabase/*`, and that is all.

```bash
npm install
npm run dev          # http://localhost:3000
npm run check        # lint + typecheck + test — run before you finish
npm test             # 24 pricing tests, node:test, no framework
npm run db:push      # supabase db push
npm run seed         # loads the catalogue into Supabase
```

The site runs with **no Supabase configuration at all** — see the fallback
below — so `npm run dev` works on a clean clone. Provisioning: `docs/SETUP.md`.

## The catalogue is three levels, and the middle one earns its place

```
category      "Keychains"
  subclass    "Clickers" · "Small" · "Big"
    product   one physical thing, one photo, one base price
```

The old static site was flat, and its "3 keychains for ₪25" deal hung off a
single product row — so a customer taking three *different* keychains did not
get the deal they were being shown. A subclass is the thing a mixed handful can
fill. Do not collapse this level to simplify a screen; it is the reason the
rebuild happened.

Categories and subclasses have `visible`; products have `available` (offered at
all) and `stock` (`null` = not counted, the normal case). Hiding a category
hides everything under it — enforced in RLS, not in a `.filter()` somebody can
forget to write on the next query.

## Pricing: `src/lib/pricing.ts` is the only place money is decided

`priceCart(lines, productsById, rules)` is the single source of truth. It is a
small exact dynamic program, not `Math.floor(qty / 3)`, because biggest-bundle-
first overcharges: with "2 for ₪18" and "3 for ₪25" over a ₪10 base, five items
are ₪43 as 3+2 and ₪45 the naive way. Charging ₪2 for our own arithmetic is not
acceptable.

Invariants, all asserted in `pricing.test.ts` — if you change this file, these
must still hold:

- Never dearer than every-item-at-base-price.
- Never charges for a bundle that is not completely filled.
- Narrowest live scope wins: a product rule beats a subclass deal beats a
  category one. That is how the owner pulls one expensive item out of a deal.
- The DP matches brute force on small carts.

**Money is agorot — integers.** ₪25.50 is `2550`. No float ever touches a
price. Render only through `formatAgorot()` from `src/lib/money.ts`, with
`className="tabular"` so digits do not jitter.

## The security boundary is an API route, never the client

Two Supabase clients, and the difference is the whole model.
`createClient()` (`src/lib/supabase/server.ts`) acts as the visitor under RLS
and is safe anywhere on the server. `createServiceClient()` bypasses RLS and is
only ever reached through `requireOwner()` in `src/lib/auth.ts`, which returns
either the client or the refusal — you cannot get one without the other.

**No client role holds a write grant on any table** (`migrations/002`). RLS
scopes rows, not columns, so a table-level UPDATE on `products` would let any
signed-in visitor rewrite a price under a perfectly correct row policy.

Middleware gating `/manager/*` is a convenience, not the boundary — curl does
not navigate. Every write route opens
`checkOrigin() → readJson() → requireOwner()`, then validates **field by
field** (never spread a body into a write; an invented property rides along)
and closes with `audit()`. Details in `docs/SECURITY.md`.

## Styling: tokens only

Every colour, radius, type size and easing is a CSS variable in
`src/app/globals.css`. No raw hex in a component, no arbitrary pixel values,
spacing on the 4pt rhythm. If a token does not exist for what you need, add it
to `globals.css` and `docs/DESIGN-SYSTEM.md` first, then use it.

Reuse `src/components/ios/` (inventory and guidance in
`docs/DESIGN-SYSTEM.md`). Hand-rolling a button or a list row is how an
interface stops looking like one product. Lucide icons only, sized from
`ICON_SIZE`. Never emoji: they render differently on every platform, cannot be
tinted, and screen readers read their Unicode names aloud.

## RTL is not an afterthought

Hebrew is the default, so RTL is the common case and LTR is the exception.

- Logical properties only: `ps-/pe-/ms-/me-/start-/end-/text-start/text-end`.
  Never `pl-/pr-/ml-/mr-/left-/right-`.
- **Any expression mixing digits with a separator** — `3 / 5`, `1–5`, a price
  beside a count — goes in `<span className="ltr-nums">`. The bidi algorithm
  reorders `3 / 5` into `5 / 3`, which is not a cosmetic bug, it is a different
  and wrong claim.
- Physical transforms (`translateX`, chevron `scaleX`) are signed by
  `var(--dir)`, set from `dir` on `<html>`.

Every user-facing string comes from `useI18n().t`. Read the `Dict` interface in
`src/lib/i18n.tsx` first — the key you need almost certainly exists. A genuinely
new one goes into the interface **and** all three of `he`, `en`, `ar`, which is
a type error until you do it; the old site drifted out of sync exactly this way.
Product content is not in the dictionary — it is `localize(product.name, locale)`.

## The read-only fallback

With no Supabase env vars, or with Supabase down, `readCatalogue()` returns
`src/data/seed.json` and sets `live: false`. That is the real catalogue, not a
mock. The shop is opened at a market stand on a phone tether, and "showing this
morning's prices" beats "the site is down". The manager reads the same flag and
shows a read-only notice rather than pretending a save worked. Never remove
this path, and never let a screen assume `live === true`.

## Conventions

- **Next 16:** `params` and `searchParams` are Promises — await them.
  `cookies()` is async. Hooks need `"use client"`.
- **Derive state during render.** `useEffect` is for real external systems only:
  listeners, scroll lock, an initial fetch. `exhaustive-deps` is an error here.
- Client writes: `fetch(...)` then `router.refresh()` to re-read server data.
- Motion comes only from the classes in `globals.css` (`.press`,
  `.animate-rise-in`, `.stagger`, `.animate-sheet-in`…). Never invent one;
  `prefers-reduced-motion` is handled globally.
- Accessibility floor: 44pt targets (`min-h-11`), real `<label>`s, errors with
  `role="alert"`, colour never the only signal, loading/empty/error states that
  actually exist. Never add `outline: none`.
- Comments explain **why**. The foundation files are the house style.

## Where things live

`src/lib/` domain, pricing, money, i18n, auth, catalogue reads ·
`src/components/ios/` the component library · `src/app/` routes, with
`api/manager/*` the only write paths · `supabase/migrations/` schema, grants,
RLS, storage, audit — numbered and additive · `src/data/seed.json` the offline
catalogue, built by `scripts/build-seed.mjs` · `legacy/` the old static site,
reference only and excluded from lint and tsc · `docs/` SETUP, ARCHITECTURE,
SECURITY, DESIGN-SYSTEM.

## Verifying, and finishing

`npm run check` must pass. Then actually look at it: desktop (~1280px) and
phone (~390px), Hebrew and English, dark and light. Exercise the language
switch and watch the layout mirror, a cart total that crosses a bundle rung,
the manager's edit sheet, and the generated Bit / WhatsApp links.

Commit to a branch, then fast-forward `main` and push so the deployed site
updates. No PRs unless asked. Update `HANDOFF.md` at the end of a session.
