# CLAUDE.md

Guidance for working in this repository.

## What this is

A storefront and catalogue manager for a coffee-truck side business selling
3D-printed items. Customers scan a QR code at the truck, browse, build a cart,
see a total, and pay manually via **Bit** at the counter. There is no online
checkout — the site's job is to present the catalogue, price it correctly, and
hand off to payment.

The **manager** is the other half and the one under real pressure: the owner
uses it on a phone, one-handed, standing at the truck, to add a keychain they
brought from home. If a change makes that take longer, it is a regression.

Trilingual (Hebrew, English, Arabic), full RTL. **Hebrew is the default and the
primary language** — it is what the stand is worked in.

## Start of every session

Read [`HANDOFF.md`](./HANDOFF.md) — current state, open items, and what needs
the owner rather than us.

## Tech stack

Next 16 (App Router, Turbopack) · React 19 · Tailwind 4 · Supabase · Vercel.
TypeScript strict. No component library beyond the one in `src/components/ios/`.

```bash
npm run dev        # localhost:3000
npm run check      # lint + typecheck + tests. Run before every commit.
npm run build      # what Vercel runs
```

## Layout

```
src/app/(root)          landing "/" and "/shop"
src/app/manager/        owner-only, gated by src/proxy.ts
src/app/api/manager/    every write. Owner-checked, one route per entity.
src/components/ios/     the design system. Reuse it; do not hand-roll UI.
src/components/shop/    storefront
src/components/manager/ manager screens
src/lib/                domain model, pricing, i18n, auth, data access
src/data/seed.json      the real catalogue, as a read-only fallback
supabase/migrations/    schema, grants, RLS. 001–005 always ship together.
legacy/                 the old static site, preserved. Do not edit or revive.
docs/SETUP.md           the owner's one-time provisioning checklist
PLAYBOOK.md             cross-project security and Israeli-law reference
```

## The catalogue is three levels

```
category      "Keychains"
  subclass    "Clickers" · "Small" · "Big"
    product   one thing, one photo, one base price
```

The middle level exists for **one reason**: bundle deals are sold per subclass.
"Any three small keychains for ₪25" means *any three*, mixed — which is wider
than a product and narrower than a category. Removing that level would break
the business rule, not just the schema.

## Pricing — read `src/lib/pricing.ts` before touching anything money-shaped

- **Agorot everywhere.** Integers, never floats. ₪25.50 is `2550`. Format once,
  at the edge, with `formatAgorot`.
- **The solver is exact, not greedy.** Applying the biggest bundle first and
  charging the remainder at full price overcharges: with 2-for-₪18 and
  3-for-₪25 over a ₪10 base, five items are cheapest as 3+2 = ₪43, but
  biggest-first gives ₪45. A small dynamic program gets it right.
- **Narrowest scope wins.** A product rule beats a subclass deal beats a
  category deal. That is what lets one expensive keychain sit out of the
  subclass bundle.
- **`ladderFor` and `groupLadder` are not interchangeable.** `ladderFor` answers
  "what can this one product be had for" and includes its private deals.
  `groupLadder` answers "what deal do all of these share" and considers only
  rules at the group's own scope. A heading built with the wrong one advertises
  a price the till will not honour — that exact bug shipped once and is now
  pinned by a test.
- `src/lib/pricing.test.ts` is the only test suite, deliberately: this is the
  one module where being wrong costs real money, and it is pure. It includes a
  brute-force cross-check and an exhaustive sweep. **Keep it passing.**

## Security — the model, not a checklist

Full detail in [`docs/SECURITY.md`](./docs/SECURITY.md); the rules that bite:

- **No client role holds a write grant on any table.** RLS scopes *rows*, not
  *columns* — a table-level `UPDATE` on `products` would let a signed-in
  visitor rewrite a price under a perfectly correct row policy. Every write
  goes through `src/app/api/manager/*`.
- **`src/proxy.ts` is a convenience boundary, not the security one.** It stops
  a stranger seeing the editor; it does not stop anyone calling the API. Every
  write route calls `requireOwner()` again. Curl does not navigate.
- **Never spread a request body into a database write.** Narrow it field by
  field in `src/lib/validate.ts`. Slugs, sort orders and storage keys are
  generated server-side — a client never chooses one.
- **Every `SECURITY DEFINER` function is revoked from `PUBLIC` explicitly.**
  Postgres grants `EXECUTE` to `PUBLIC` on creation and every role inherits it,
  so revoking from `anon` alone does nothing.
- After any RLS or grant change, re-test with a real unauthenticated request.
  "The migration succeeded" is not evidence.

## Design system

Ported from the 3D Prints manager: Apple's semantic colour roles, type scale,
radii and spring curves. [`docs/DESIGN-SYSTEM.md`](./docs/DESIGN-SYSTEM.md).

- **Tokens only.** No raw hex, no arbitrary pixel sizes. Missing token? Add it
  to `globals.css` and the doc first, then use it.
- **Dark is the default look**, not a `prefers-color-scheme` fallback.
- **44pt touch targets** (`min-h-11`), visible focus, real `<label>`s, errors
  with `role="alert"`, colour never the only signal.
- **Lucide icons only**, sized from `ICON_SIZE`. Never emoji.
- Motion comes from the classes in `globals.css`. Do not invent animations.
  `prefers-reduced-motion` is handled globally — do not fight it.

## RTL is not an afterthought

- **Logical properties everywhere**: `ps-`/`pe-`/`ms-`/`me-`/`start-`/`end-`/
  `text-start`. Never `pl-`/`pr-`/`left-`/`text-left`.
  The two deliberate exceptions are the pinned floating widgets — the settings
  globe and the WhatsApp button — which stay in a fixed physical corner because
  a control that changes corner when you change language is one you have to
  hunt for. Both say so in a comment.
- **Wrap numeric expressions in `.ltr-nums`.** `3 / 5` inside Hebrew renders as
  `5 / 3` — not a cosmetic problem, a different and wrong claim. Same for
  ranges, prices beside counts, and the bundle ladder.
- Every visible string lives in `src/lib/i18n.tsx`, in **all three** languages.
  A string added to one block and not the others is a type error, which is the
  point. Product *content* lives in the database and is read with `localize()`.

## Conventions

- **Derive state during render.** `useEffect` is for real external systems only
  — listeners, scroll locking, an initial fetch. A `useEffect` that syncs props
  into state is a bug waiting to happen; remount with a `key` instead.
- Server Components read data; Client Components handle interaction. A function
  (a Lucide icon included) cannot be passed from one to the other.
- `src/lib/catalog.ts` is `server-only`. Anything a client component needs —
  `imageUrl` — lives in `src/lib/images.ts`.
- Comments explain **why**, not what. The reasoning behind a rule is the part
  that stops someone undoing it in six months.

## Verifying changes

There is no CI. `npm run check` is the gate, and it is not sufficient on its
own — **run the app**. Every defect fixed in the rebuild commit was found by
building and exercising it, not by reading it: a nested `<button>` that broke
hydration, a server-only import in a client bundle, a group heading advertising
a price that did not exist.

Check at 390px and 1280px, in Hebrew and English, dark and light. Exercise the
language switch, the cart, the product sheet, and the manager's photo upload.

## Git

Work on a branch, then fast-forward `main` and push — Vercel deploys `main`.
Do not open PRs unless asked.

At the end of a session, update `HANDOFF.md`: tick off what landed, add a dated
entry, and flag anything still open or needing the owner.
