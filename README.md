# Coffee Truck · 3D Prints

A storefront and catalogue manager for a coffee-truck side business selling
3D-printed items. Customers scan a QR code at the truck, browse, build a cart,
see a total, and pay with **Bit** at the counter.

Trilingual — Hebrew, English, Arabic — with full RTL. Hebrew is the default.

Next 16 · React 19 · Tailwind 4 · Supabase · Vercel.

## Run it

```bash
npm install
npm run dev
```

<http://localhost:3000>. It works with no configuration: the catalogue falls
back to a committed snapshot and the manager shows a read-only banner.

To go live — Supabase, Google sign-in, Vercel — follow
**[`docs/SETUP.md`](docs/SETUP.md)**.

## Checks

```bash
npm run check     # lint + typecheck + tests
npm run build     # what Vercel runs
```

## Where things are

| | |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | how to work in this repo — read first |
| [`HANDOFF.md`](HANDOFF.md) | current state and open items |
| [`docs/SETUP.md`](docs/SETUP.md) | one-time provisioning |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | data model and the pricing engine |
| [`docs/SECURITY.md`](docs/SECURITY.md) | the access model |
| [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) | tokens, components, RTL rules |
| [`PLAYBOOK.md`](PLAYBOOK.md) | cross-project security and Israeli-law reference |
| `legacy/` | the previous static site, preserved |

## The one thing worth knowing

The catalogue is **category → subclass → product**, and the middle level is the
point. Bundle deals attach to a scope, and a subclass deal is filled by any mix
of products inside it — "any three small keychains for ₪25" means *any three*.

The pricing engine solves that exactly rather than greedily, because
biggest-bundle-first overcharges. See
[`src/lib/pricing.ts`](src/lib/pricing.ts); it is the one module with tests.
