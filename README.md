# Coffee Truck · 3D Prints

A small storefront and its catalogue manager, for a coffee truck in Israel that
also sells 3D-printed things off a table beside the counter.

A customer scans the QR code, browses in Hebrew, English or Arabic, builds a
cart, and sees a total with the bundle deals already worked out. They pay at the
counter with **Bit**. There is no online checkout, no shipping, and no customer
accounts — the site's job is to show what is on the table and produce a number.

The owner opens `/manager` on a phone, signs in with Google, and edits the
catalogue: categories, subclasses, products, photos, deals, and the shop's own
settings. Nobody else can reach it.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript (strict) ·
Supabase for Postgres, Auth and Storage. The only runtime dependencies are
`lucide-react` and the two `@supabase/*` packages.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

That works on a clean clone with no configuration at all. Without Supabase env
vars the site serves the catalogue from `src/data/seed.json`, read-only, and
says so — see [the read-only fallback](docs/ARCHITECTURE.md#the-read-only-fallback).

To connect it to a real database, follow **[docs/SETUP.md](docs/SETUP.md)** end
to end. It is written as a numbered checklist for a phone.

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Development server.                              |
| `npm run build`     | Production build.                                |
| `npm start`         | Serve the production build.                      |
| `npm run lint`      | ESLint (`next/core-web-vitals` + `next/typescript`). |
| `npm run typecheck` | `tsc --noEmit`.                                  |
| `npm test`          | The pricing tests — 24 of them, `node:test`.     |
| `npm run check`     | Lint, typecheck and test together.               |
| `npm run db:push`   | `supabase db push` — applies `supabase/migrations/`. |
| `npm run seed`      | Loads the catalogue into Supabase.               |

## What is worth knowing before changing anything

- **The catalogue is three levels**: category → subclass → product. The middle
  level exists because bundle deals are sold across a subclass ("any three small
  keychains for ₪25"), which is wider than one product and narrower than a
  category.
- **All money is agorot**, stored and computed as integers. `src/lib/pricing.ts`
  is the only place a price is decided, and it solves the cheapest combination
  of bundles exactly rather than applying the biggest one repeatedly — the naive
  version overcharges.
- **No client role can write to any table.** Every catalogue change goes through
  an owner-checked API route under `/api/manager`. See
  [docs/SECURITY.md](docs/SECURITY.md).
- **Hebrew is the default and RTL is the common case.** Logical CSS properties
  everywhere, and any digits-plus-separator expression wrapped so the bidi
  algorithm cannot reorder it into a different claim.

## Documentation

| File                                             | For                                        |
| ------------------------------------------------ | ------------------------------------------ |
| [docs/SETUP.md](docs/SETUP.md)                   | Getting it live. The owner's checklist.    |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Request flow, data model, pricing contract.|
| [docs/SECURITY.md](docs/SECURITY.md)             | The access model and the pre-deploy check. |
| [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md)   | Tokens, components, motion, RTL, a11y.     |
| [CLAUDE.md](CLAUDE.md)                           | House rules for working in this repo.      |
| [PLAYBOOK.md](PLAYBOOK.md)                       | Cross-project security and Israeli law.    |

`legacy/` holds the static site this replaced. It is kept for reference and is
excluded from linting and type-checking.
