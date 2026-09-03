# Architecture

## The shape

```
                    ┌──────────────────────────────────────────┐
   QR code  ─────▶  │  /            landing                    │
                    │  /shop        catalogue + cart           │  public
                    └────────────────┬─────────────────────────┘
                                     │  readCatalogue()   ← runs as the visitor,
                                     │                       RLS filters the rows
                    ┌────────────────▼─────────────────────────┐
                    │            Supabase Postgres             │
                    └────────────────▲─────────────────────────┘
                                     │  readCatalogueAsOwner() ← service role
   owner's phone ──▶ /manager  ──────┤     + POST/PATCH/DELETE
                     (proxy.ts gate) │       /api/manager/*
                    ┌────────────────┴─────────────────────────┐
                    │  requireOwner() on every single write     │
                    └──────────────────────────────────────────┘
```

Reads on the storefront are Server Components hitting Supabase directly as the
visitor. Writes are never direct: they go through an API route that establishes
ownership first and then uses the service-role client. See
[`SECURITY.md`](./SECURITY.md).

## Data model

```
categories ──┬── subclasses ──┬── products ── product_images
             │                │        │
             └────────────────┴────────┴──── pricing_rules (scope, scope_id)
```

Three levels, because **bundle deals are sold per subclass**. "Any three small
keychains for ₪25" is wider than a product and narrower than a category, so the
deal needs something to hang off that matches how it is actually sold at the
counter. Remove the middle level and you break the business rule, not just the
schema.

`pricing_rules.scope_id` is an untyped uuid pointing at one of three tables, so
no foreign key can hold it. Migration 001 enforces referential integrity with
triggers instead: `check_pricing_scope_exists` on write, and
`delete_orphaned_pricing_rules` on each parent's delete so a rule never
outlives what it prices.

Money is **agorot** — integer hundredths of a shekel. ₪25.50 is `2550`. Never a
float: a bundle price divided across lines accumulates error immediately, and a
till that is off by an agora is a till nobody trusts.

## Pricing

`src/lib/pricing.ts` is the single source of truth. The storefront calls it for
a running total, the manager calls it to preview a deal, and it is the same
function in both — a preview computed by different code from the charge is a
preview worth nothing.

**Grouping.** Every unit is bucketed by the *narrowest scope that has a live
rule*: product beats subclass beats category. Anything with no rule is grouped
alone and pays base price, which keeps the rest of the code free of null
branches. Narrowest-wins is what lets one expensive keychain sit out of the
subclass deal by having its own ladder.

**The solver is exact.** The obvious implementation — biggest bundle first,
remainder at full price — overcharges. With 2-for-₪18 and 3-for-₪25 over a ₪10
base, five items are cheapest as 3+2 = ₪43; biggest-first gives ₪45. So a small
dynamic program walks backwards over the group: each position either pays its
own way or starts a bundle that swallows the next `minQty` items. Groups are a
handful of items, so exactness is free.

**Ordering.** Items in a group can have different base prices, so they are
sorted dearest-first before solving — bundles absorb the expensive units and
the cheap ones are what remain at base price. Because a bundle price is flat
regardless of what fills it, no other arrangement can beat that.

**Two ladders, not one.** `ladderFor` answers "what can this product be had
for" and includes its private deals. `groupLadder` answers "what deal do all of
these share" and considers only rules at the group's own scope. Using the first
where the second belongs advertises one item's deal as the whole group's — that
bug shipped once and is now pinned by a test.

Invariants, asserted in `pricing.test.ts`: never charges above base price,
never bills a bundle it did not fill, units are conserved, and it agrees with a
brute-force reference on small carts.

## The read-only fallback

`readCatalogue()` falls back to `src/data/seed.json` on any failure — no
configuration, network down, a table not migrated yet — and reports `live:
false`.

This is not a mock. It is the real catalogue, generated from the old static
site by `scripts/build-seed.mjs`, and it exists because the shop is opened at a
market stand on a phone tether. "The site is down because Supabase is down" is
a worse failure than "the site is showing this morning's prices".

The manager reads the same flag and disables every write control behind a
banner. It must never pretend a save worked.

## i18n

`src/lib/i18n.tsx` holds every visible string in all three languages, typed —
a string added to one block and not the others is a compile error. Product
*content* lives in the database as `name_he` / `name_en` / `name_ar` columns and
is read with `localize()`, which falls back to Hebrew. That asymmetry is real:
the owner writes Hebrew at the counter and may never translate, and a product
with no English name must still be sellable.

The locale store uses `useSyncExternalStore`, not `useState` plus an effect. A
server render has no `localStorage`, so it can only ever render Hebrew;
starting the client at anything else renders English text against Hebrew-shaped
server HTML and fails hydration. An inline script in the root layout stamps
`lang` and `dir` before React hydrates so the layout never flips after load.

The cart store works the same way, for the same reason, and persists only
`{productId, quantity}` — never a price. A stored price goes stale the moment
the owner edits one.

## Why Next 16 and not the Ayeka stack

Ayeka Bar runs Next 14. This is a greenfield rebuild with no migration cost, so
it takes the newer stack the 3D Prints manager already proved out: React 19,
Tailwind 4, Turbopack. The consequences worth knowing:

- `params` and `searchParams` are Promises. Await them.
- `cookies()` is async.
- The middleware file convention is now `proxy.ts` exporting `proxy()`. **The
  export name must match the filename** or the file silently stops running —
  which here would mean the manager stops being gated.
