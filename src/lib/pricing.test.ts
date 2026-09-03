import { strict as assert } from "node:assert";
import { test } from "node:test";
import { groupLadder, ladderFor, priceCart, type PricedProduct } from "./pricing.ts";
import type { PricingRule, PricingScope } from "./types.ts";

/* ==========================================================================
   Pricing tests

   Run with `npm test`. These are the only tests in the project, deliberately:
   this is the one module where being wrong costs the owner real money at the
   counter, and it is pure, so it is cheap to pin down completely.
   ========================================================================== */

const CATEGORY = "cat-keychains";
const SUBCLASS_SMALL = "sub-small";
const SUBCLASS_BIG = "sub-big";

function product(id: string, priceAgorot: number, subclassId: string | null = SUBCLASS_SMALL): PricedProduct {
  return { id, categoryId: CATEGORY, subclassId, priceAgorot };
}

function rule(
  id: string,
  scope: PricingScope,
  scopeId: string,
  minQty: number,
  priceAgorot: number,
  overrides: Partial<PricingRule> = {}
): PricingRule {
  return {
    id,
    scope,
    scopeId,
    minQty,
    priceAgorot,
    active: true,
    startsAt: null,
    endsAt: null,
    label: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function catalogue(...items: PricedProduct[]): Map<string, PricedProduct> {
  return new Map(items.map((item) => [item.id, item]));
}

/* --------------------------------------------------------------------------
   The counter deal the owner actually sells
   -------------------------------------------------------------------------- */

const KEYCHAIN_LADDER = [
  rule("r3", "subclass", SUBCLASS_SMALL, 3, 2500),
  rule("r5", "subclass", SUBCLASS_SMALL, 5, 3500),
];

test("single item pays base price", () => {
  const result = priceCart(
    [{ productId: "a", quantity: 1 }],
    catalogue(product("a", 1000)),
    KEYCHAIN_LADDER
  );
  assert.equal(result.totalAgorot, 1000);
  assert.equal(result.savingsAgorot, 0);
});

test("three of the SAME keychain hit the subclass deal", () => {
  const result = priceCart(
    [{ productId: "a", quantity: 3 }],
    catalogue(product("a", 1000)),
    KEYCHAIN_LADDER
  );
  assert.equal(result.totalAgorot, 2500);
  assert.equal(result.savingsAgorot, 500);
});

test("three DIFFERENT keychains hit the same deal — this is the whole point", () => {
  const result = priceCart(
    [
      { productId: "a", quantity: 1 },
      { productId: "b", quantity: 1 },
      { productId: "c", quantity: 1 },
    ],
    catalogue(product("a", 1000), product("b", 1000), product("c", 1000)),
    KEYCHAIN_LADDER
  );
  assert.equal(result.totalAgorot, 2500);
  assert.equal(result.groups.length, 1, "mixed keychains price as one group");
});

test("five mixed keychains take the 5-rung, not 3 + 2 singles", () => {
  const result = priceCart(
    [
      { productId: "a", quantity: 2 },
      { productId: "b", quantity: 3 },
    ],
    catalogue(product("a", 1000), product("b", 1000)),
    KEYCHAIN_LADDER
  );
  assert.equal(result.totalAgorot, 3500);
});

test("seven keychains split 5 + (3 is worse than 2 singles)", () => {
  // 5 for ₪35 then two at ₪10 = ₪55. The alternative 3+3+1 is ₪60.
  const result = priceCart(
    [{ productId: "a", quantity: 7 }],
    catalogue(product("a", 1000)),
    KEYCHAIN_LADDER
  );
  assert.equal(result.totalAgorot, 5500);
});

test("eight keychains split 5 + 3", () => {
  const result = priceCart(
    [{ productId: "a", quantity: 8 }],
    catalogue(product("a", 1000)),
    KEYCHAIN_LADDER
  );
  assert.equal(result.totalAgorot, 6000);
});

/* --------------------------------------------------------------------------
   The case naive biggest-bundle-first gets wrong
   -------------------------------------------------------------------------- */

test("exactness: 5 items with 2-for-18 and 3-for-25 costs 43, not 45", () => {
  const rules = [
    rule("r2", "subclass", SUBCLASS_SMALL, 2, 1800),
    rule("r3", "subclass", SUBCLASS_SMALL, 3, 2500),
  ];
  const result = priceCart(
    [{ productId: "a", quantity: 5 }],
    catalogue(product("a", 1000)),
    rules
  );
  // Biggest-first would charge 2500 + 1000 + 1000 = 4500.
  assert.equal(result.totalAgorot, 4300);
});

test("a bundle is never charged unless it is completely filled", () => {
  // Two items, only a 3-rung exists. Must pay 2 × base, not the bundle price.
  const result = priceCart(
    [{ productId: "a", quantity: 2 }],
    catalogue(product("a", 1000)),
    [rule("r3", "subclass", SUBCLASS_SMALL, 3, 2500)]
  );
  assert.equal(result.totalAgorot, 2000);
  assert.equal(result.groups[0]?.bundles.length, 0);
  assert.equal(result.groups[0]?.remainderUnits, 2);
});

/* --------------------------------------------------------------------------
   Mixed base prices inside one subclass
   -------------------------------------------------------------------------- */

test("bundles swallow the dearest items, leaving the cheapest at base price", () => {
  // Big ₪15 × 2 and small ₪10 × 2, with "3 for ₪25" across the subclass.
  // Best: the bundle takes 15 + 15 + 10, leaving one 10 → 3500.
  const result = priceCart(
    [
      { productId: "big", quantity: 2 },
      { productId: "small", quantity: 2 },
    ],
    catalogue(product("big", 1500), product("small", 1000)),
    [rule("r3", "subclass", SUBCLASS_SMALL, 3, 2500)]
  );
  assert.equal(result.totalAgorot, 3500);
  assert.equal(result.baselineAgorot, 5000);
  assert.equal(result.savingsAgorot, 1500);
});

/* --------------------------------------------------------------------------
   Scope precedence
   -------------------------------------------------------------------------- */

test("subclasses price independently of each other", () => {
  const result = priceCart(
    [
      { productId: "s", quantity: 2 },
      { productId: "b", quantity: 2 },
    ],
    catalogue(product("s", 1000, SUBCLASS_SMALL), product("b", 2000, SUBCLASS_BIG)),
    [rule("r3s", "subclass", SUBCLASS_SMALL, 3, 2500)]
  );
  // Neither subclass reaches 3, so nothing is discounted.
  assert.equal(result.totalAgorot, 6000);
  assert.equal(result.groups.length, 2, "each subclass is its own group");
});

test("a product-scope rule pulls that product out of the subclass deal", () => {
  // The premium keychain has its own ladder, so it must not fill the
  // subclass bundle alongside the ordinary ones.
  const result = priceCart(
    [
      { productId: "premium", quantity: 2 },
      { productId: "plain", quantity: 2 },
    ],
    catalogue(product("premium", 3000), product("plain", 1000)),
    [
      rule("r3", "subclass", SUBCLASS_SMALL, 3, 2500),
      rule("rp2", "product", "premium", 2, 5000),
    ]
  );
  // premium: 2 for 5000. plain: 2 × 1000, no bundle reached.
  assert.equal(result.totalAgorot, 7000);
  assert.equal(result.groups.length, 2);
});

test("category rules apply when no subclass rule exists", () => {
  const result = priceCart(
    [
      { productId: "a", quantity: 1 },
      { productId: "b", quantity: 2 },
    ],
    catalogue(product("a", 1000, SUBCLASS_SMALL), product("b", 1000, SUBCLASS_BIG)),
    [rule("rc", "category", CATEGORY, 3, 2500)]
  );
  assert.equal(result.totalAgorot, 2500, "a category deal spans both subclasses");
});

/* --------------------------------------------------------------------------
   Rule liveness
   -------------------------------------------------------------------------- */

test("an inactive rule does not price", () => {
  const result = priceCart(
    [{ productId: "a", quantity: 3 }],
    catalogue(product("a", 1000)),
    [rule("r3", "subclass", SUBCLASS_SMALL, 3, 2500, { active: false })]
  );
  assert.equal(result.totalAgorot, 3000);
});

test("a rule outside its window does not price, and inside it does", () => {
  const seasonal = rule("rs", "subclass", SUBCLASS_SMALL, 3, 2500, {
    startsAt: "2026-09-01T00:00:00Z",
    endsAt: "2026-09-30T23:59:59Z",
  });
  const cart = [{ productId: "a", quantity: 3 }];
  const stock = catalogue(product("a", 1000));

  assert.equal(
    priceCart(cart, stock, [seasonal], new Date("2026-08-15T12:00:00Z")).totalAgorot,
    3000,
    "before the window"
  );
  assert.equal(
    priceCart(cart, stock, [seasonal], new Date("2026-09-15T12:00:00Z")).totalAgorot,
    2500,
    "inside the window"
  );
  assert.equal(
    priceCart(cart, stock, [seasonal], new Date("2026-10-15T12:00:00Z")).totalAgorot,
    3000,
    "after the window"
  );
});

test("a nonsensical 1-for-N rule is ignored rather than applied per unit", () => {
  const result = priceCart(
    [{ productId: "a", quantity: 3 }],
    catalogue(product("a", 1000)),
    [rule("bad", "subclass", SUBCLASS_SMALL, 1, 100)]
  );
  assert.equal(result.totalAgorot, 3000);
});

/* --------------------------------------------------------------------------
   Robustness
   -------------------------------------------------------------------------- */

test("an empty cart is free, not a crash", () => {
  const result = priceCart([], catalogue(), []);
  assert.equal(result.totalAgorot, 0);
  assert.deepEqual(result.groups, []);
});

test("a cart line for a deleted product is skipped", () => {
  const result = priceCart(
    [
      { productId: "gone", quantity: 2 },
      { productId: "a", quantity: 1 },
    ],
    catalogue(product("a", 1000)),
    []
  );
  assert.equal(result.totalAgorot, 1000);
});

test("zero and negative quantities are ignored", () => {
  const result = priceCart(
    [
      { productId: "a", quantity: 0 },
      { productId: "a", quantity: -3 },
    ],
    catalogue(product("a", 1000)),
    []
  );
  assert.equal(result.totalAgorot, 0);
});

test("duplicate lines for one product are summed, not priced separately", () => {
  const result = priceCart(
    [
      { productId: "a", quantity: 2 },
      { productId: "a", quantity: 1 },
    ],
    catalogue(product("a", 1000)),
    KEYCHAIN_LADDER
  );
  assert.equal(result.totalAgorot, 2500, "2 + 1 must reach the 3-rung");
});

/* --------------------------------------------------------------------------
   The invariants, over a wide sweep

   Exhaustive rather than random: the whole space that matters here is small,
   and a fixed sweep fails identically every time instead of once in twenty runs.
   -------------------------------------------------------------------------- */

test("invariant: never dearer than base price, over every ladder and quantity", () => {
  const ladders: PricingRule[][] = [
    [],
    [rule("a2", "subclass", SUBCLASS_SMALL, 2, 1800)],
    [rule("a3", "subclass", SUBCLASS_SMALL, 3, 2500)],
    KEYCHAIN_LADDER,
    [
      rule("b2", "subclass", SUBCLASS_SMALL, 2, 1800),
      rule("b3", "subclass", SUBCLASS_SMALL, 3, 2500),
      rule("b5", "subclass", SUBCLASS_SMALL, 5, 3500),
    ],
    // Deliberately silly ladders: a rung dearer than paying singly, and one
    // that is cheaper per unit at a smaller count than a larger one.
    [rule("c3", "subclass", SUBCLASS_SMALL, 3, 9900)],
    [
      rule("d3", "subclass", SUBCLASS_SMALL, 3, 2000),
      rule("d4", "subclass", SUBCLASS_SMALL, 4, 3900),
    ],
  ];

  for (const rules of ladders) {
    for (let qty = 0; qty <= 24; qty++) {
      const result = priceCart(
        [{ productId: "a", quantity: qty }],
        catalogue(product("a", 1000)),
        rules
      );
      assert.ok(
        result.totalAgorot <= qty * 1000,
        `qty ${qty} priced at ${result.totalAgorot}, above base ${qty * 1000}`
      );
      assert.ok(result.savingsAgorot >= 0, `negative saving at qty ${qty}`);

      // Units are conserved: everything is either in a filled bundle or a remainder.
      const group = result.groups[0];
      if (group) {
        const bundled = group.bundles.reduce((sum, b) => sum + b.minQty * b.times, 0);
        assert.equal(bundled + group.remainderUnits, qty, `unit count mismatch at qty ${qty}`);
      }
    }
  }
});

test("invariant: the DP matches brute force on small carts", () => {
  const rules = [
    rule("e2", "subclass", SUBCLASS_SMALL, 2, 1700),
    rule("e3", "subclass", SUBCLASS_SMALL, 3, 2500),
    rule("e4", "subclass", SUBCLASS_SMALL, 4, 3100),
  ];

  /** Independent, obviously-correct reference: try every split recursively. */
  function brute(prices: number[]): number {
    if (prices.length === 0) return 0;
    let best = prices[0]! + brute(prices.slice(1));
    for (const r of rules) {
      if (r.minQty <= prices.length) {
        best = Math.min(best, r.priceAgorot + brute(prices.slice(r.minQty)));
      }
    }
    return best;
  }

  for (let qty = 0; qty <= 10; qty++) {
    const prices = Array.from({ length: qty }, () => 1000);
    const result = priceCart(
      [{ productId: "a", quantity: qty }],
      catalogue(product("a", 1000)),
      rules
    );
    assert.equal(result.totalAgorot, brute(prices), `mismatch at qty ${qty}`);
  }
});

/* --------------------------------------------------------------------------
   The displayed ladder
   -------------------------------------------------------------------------- */

test("ladderFor always starts at the single-unit price", () => {
  const ladder = ladderFor(product("a", 1000), KEYCHAIN_LADDER);
  assert.deepEqual(ladder, [
    { qty: 1, priceAgorot: 1000 },
    { qty: 3, priceAgorot: 2500 },
    { qty: 5, priceAgorot: 3500 },
  ]);
});

test("ladderFor shows only the narrowest scope, matching what is charged", () => {
  const ladder = ladderFor(product("a", 1000), [
    rule("sub", "subclass", SUBCLASS_SMALL, 3, 2500),
    rule("prod", "product", "a", 2, 1800),
  ]);
  assert.deepEqual(ladder, [
    { qty: 1, priceAgorot: 1000 },
    { qty: 2, priceAgorot: 1800 },
  ]);
});

test("ladderFor keeps the cheaper of two rules for the same quantity", () => {
  const ladder = ladderFor(product("a", 1000), [
    rule("x", "subclass", SUBCLASS_SMALL, 3, 2500),
    rule("y", "subclass", SUBCLASS_SMALL, 3, 2200),
  ]);
  assert.deepEqual(ladder, [
    { qty: 1, priceAgorot: 1000 },
    { qty: 3, priceAgorot: 2200 },
  ]);
});

/* --------------------------------------------------------------------------
   Group ladders

   The bug these pin: a heading above a grid of products was derived from
   `ladderFor` on a sample product, which correctly includes that product's OWN
   deal — so "2 for 50" on a single dragon was rendered as the whole Figures
   category's offer. A customer would have taken any two figures to the counter
   expecting 50.
   -------------------------------------------------------------------------- */

test("groupLadder ignores a product-scope rule inside the group", () => {
  const rules = [rule("dragon", "product", "dragon", 2, 5000)];
  assert.deepEqual(groupLadder("subclass", SUBCLASS_SMALL, 1000, rules), []);
  assert.deepEqual(groupLadder("category", CATEGORY, 1000, rules), []);
});

test("groupLadder returns the group's own rungs, seeded with the base price", () => {
  assert.deepEqual(groupLadder("subclass", SUBCLASS_SMALL, 1000, KEYCHAIN_LADDER), [
    { qty: 1, priceAgorot: 1000 },
    { qty: 3, priceAgorot: 2500 },
    { qty: 5, priceAgorot: 3500 },
  ]);
});

test("groupLadder does not leak another group's deal", () => {
  const rules = [rule("other", "subclass", SUBCLASS_BIG, 3, 2500)];
  assert.deepEqual(groupLadder("subclass", SUBCLASS_SMALL, 1000, rules), []);
});

test("groupLadder respects the active flag and the date window", () => {
  const parked = rule("p", "subclass", SUBCLASS_SMALL, 3, 2500, { active: false });
  assert.deepEqual(groupLadder("subclass", SUBCLASS_SMALL, 1000, [parked]), []);

  const seasonal = rule("s", "subclass", SUBCLASS_SMALL, 3, 2500, {
    startsAt: "2026-09-01T00:00:00Z",
    endsAt: "2026-09-30T23:59:59Z",
  });
  assert.deepEqual(
    groupLadder("subclass", SUBCLASS_SMALL, 1000, [seasonal], new Date("2026-08-01T00:00:00Z")),
    []
  );
  assert.equal(
    groupLadder("subclass", SUBCLASS_SMALL, 1000, [seasonal], new Date("2026-09-15T00:00:00Z"))
      .length,
    2
  );
});

test("a heading built from groupLadder agrees with what priceCart charges", () => {
  // The invariant the bug broke: if the shop advertises "N for X" on a group,
  // then buying N different items from that group must actually cost X.
  const stock = catalogue(
    product("a", 1000, SUBCLASS_SMALL),
    product("b", 1500, SUBCLASS_SMALL),
    product("c", 1200, SUBCLASS_SMALL)
  );
  const ladder = groupLadder("subclass", SUBCLASS_SMALL, 1000, KEYCHAIN_LADDER);
  const rung = ladder.find((entry) => entry.qty === 3);
  assert.ok(rung, "the 3-rung is advertised");

  const charged = priceCart(
    [
      { productId: "a", quantity: 1 },
      { productId: "b", quantity: 1 },
      { productId: "c", quantity: 1 },
    ],
    stock,
    KEYCHAIN_LADDER
  );
  assert.equal(charged.totalAgorot, rung.priceAgorot);
});
