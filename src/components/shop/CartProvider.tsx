"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { priceCart, toPriced, type CartPricing, type PricedProduct } from "@/lib/pricing";
import type { CartLine, PricingRule, Product, ShopSettings } from "@/lib/types";

/* ==========================================================================
   The cart

   Two decisions shape everything below.

   **It survives a refresh.** The old static site kept the cart in a plain
   object and lost it every time the phone slept, the browser evicted the tab,
   or somebody followed the WhatsApp link and came back. At a stand where the
   customer is standing three feet from the till, losing their basket is worse
   than any other bug this site can have.

   **It stores picks, never prices.** Only `{ productId, quantity }` goes into
   localStorage. A total written down yesterday is a claim about a catalogue
   that no longer exists — the owner edits prices from her phone between
   customers — so the cart is re-priced from the live catalogue on every read.
   `priceCart` is the only thing in the codebase allowed to say what something
   costs, and the checkout hand-off re-runs it server-side anyway.
   ========================================================================== */

const STORAGE_KEY = "coffeetruck-cart";

/**
 * Ceiling on a single line.
 *
 * Not a business rule — a safety rail. `priceCart` expands a line into one
 * array entry per unit so bundles can span products, so a quantity of 10^9
 * arriving from a hand-edited localStorage value would hang the customer's own
 * browser. Nobody buys a hundred keychains at a coffee truck.
 */
const MAX_PER_LINE = 99;

/* --------------------------------------------------------------------------
   The store

   `useSyncExternalStore` for the same reason the locale store uses it (see
   `lib/i18n.tsx`): a server render cannot know what is in a visitor's
   localStorage, so it can only render an empty cart. Starting the client at
   the stored value instead would render a three-item cart against empty
   server HTML and fail hydration. This API renders the server snapshot
   through hydration and resyncs to the real one immediately after.

   One deliberate divergence from that file. The locale store re-reads
   localStorage on every snapshot because a string compares by value; a cart is
   an array, and `useSyncExternalStore` compares snapshots by *identity*.
   Re-parsing on every read would hand React a fresh array each time and spin
   the render loop forever ("The result of getSnapshot should be cached"). So
   the parsed array is the value here, and localStorage is a mirror: written on
   every change, re-read only when another tab changes it.
   -------------------------------------------------------------------------- */

/** One stable empty cart. A fresh `[]` per read is the identity trap above. */
const EMPTY: CartLine[] = [];

const listeners = new Set<() => void>();

/** `null` until the first read pulls the cart out of storage. */
let lines: CartLine[] | null = null;

/**
 * Whatever is in storage, treated as hostile.
 *
 * The key can hold anything: an older format from a previous version of this
 * site, a collision with another app on the same origin, a value somebody
 * typed into devtools. Every entry is checked field by field, and anything
 * that fails is dropped rather than rejected wholesale — one corrupt row must
 * not empty a cart that is otherwise fine.
 */
function readStorage(): CartLine[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode Safari throws on any access. A cart that cannot persist is
    // still a working cart for this visit.
    return EMPTY;
  }
  if (!raw) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;

  const clean: CartLine[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { productId, quantity } = entry as Partial<CartLine>;
    if (typeof productId !== "string" || productId === "") continue;
    if (typeof quantity !== "number" || !Number.isFinite(quantity)) continue;
    const units = Math.min(Math.floor(quantity), MAX_PER_LINE);
    if (units <= 0) continue;
    clean.push({ productId, quantity: units });
  }

  return clean.length > 0 ? clean : EMPTY;
}

function notify() {
  listeners.forEach((listener) => listener());
}

/** Written once, on the first subscription — this only ever runs in a browser. */
let watchingOtherTabs = false;

function subscribe(listener: () => void) {
  listeners.add(listener);

  /* Two tabs on the same phone are common here: the QR code opens one, a
     WhatsApp link opens another. `storage` fires only in the *other* tabs, so
     this cannot loop back on our own write. */
  if (!watchingOtherTabs) {
    watchingOtherTabs = true;
    window.addEventListener("storage", (event) => {
      // `key === null` means the whole store was cleared.
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      lines = readStorage();
      notify();
    });
  }

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CartLine[] {
  if (lines === null) lines = readStorage();
  return lines;
}

function getServerSnapshot(): CartLine[] {
  return EMPTY;
}

function write(next: CartLine[]) {
  lines = next;
  try {
    // Rebuilt field by field rather than stringifying `next` directly, so a
    // future field on CartLine can never leak into the persisted shape.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(next.map(({ productId, quantity }) => ({ productId, quantity })))
    );
  } catch {
    // Quota exhausted or storage blocked. The cart still works for this visit;
    // it just will not survive a refresh, which is the old site's behaviour.
  }
  notify();
}

/* --------------------------------------------------------------------------
   The context
   -------------------------------------------------------------------------- */

export interface CartContextValue {
  lines: CartLine[];
  add(productId: string): void;
  remove(productId: string): void;
  setQuantity(productId: string, quantity: number): void;
  clear(): void;
  /** Total units, not lines — what the badge on the floating button shows. */
  count: number;
  /** Derived during render. There is no total in state, ever. */
  pricing: CartPricing;
  products: Map<string, Product>;
  open: boolean;
  setOpen(next: boolean): void;
}

const EMPTY_PRICING: CartPricing = {
  groups: [],
  totalAgorot: 0,
  baselineAgorot: 0,
  savingsAgorot: 0,
};

const CartContext = createContext<CartContextValue>({
  lines: EMPTY,
  add: () => {},
  remove: () => {},
  setQuantity: () => {},
  clear: () => {},
  count: 0,
  pricing: EMPTY_PRICING,
  products: new Map(),
  open: false,
  setOpen: () => {},
});

export function useCart(): CartContextValue {
  return useContext(CartContext);
}

/* Settings ride in a second context rather than on the cart value, because
   `useCart()` is an interface several other components are written against and
   widening it would make every consumer's type drift. `CartSheet` is the only
   thing that needs the Bit link, and it is the only thing that reads this. */
const ShopSettingsContext = createContext<ShopSettings | null>(null);

/** The shop settings the provider was given. Null outside a `CartProvider`. */
export function useShopSettings(): ShopSettings | null {
  return useContext(ShopSettingsContext);
}

/* --------------------------------------------------------------------------
   The provider
   -------------------------------------------------------------------------- */

export function CartProvider({
  products,
  rules,
  settings,
  children,
}: {
  products: Product[];
  rules: PricingRule[];
  settings: ShopSettings;
  children: ReactNode;
}) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [open, setOpen] = useState(false);

  const catalogue = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products]
  );

  const priced = useMemo(() => {
    const map = new Map<string, PricedProduct>();
    for (const product of products) map.set(product.id, toPriced(product));
    return map;
  }, [products]);

  /* A cart entry outlives the product it points at — the owner deletes a
     keychain while a phone sleeps with one in its cart. Stale lines are dropped
     here, on read, rather than repaired in an effect: `priceCart` already
     prices an unknown id as nothing, so leaving it in would show a free row
     that no total accounts for.

     The `every` check keeps the array's identity when nothing is dropped,
     which is the common case and what stops `pricing` recomputing needlessly. */
  const lines = useMemo(
    () =>
      stored.every((line) => catalogue.has(line.productId))
        ? stored
        : stored.filter((line) => catalogue.has(line.productId)),
    [stored, catalogue]
  );

  const pricing = useMemo(() => priceCart(lines, priced, rules), [lines, priced, rules]);

  const count = useMemo(
    () => lines.reduce((total, line) => total + line.quantity, 0),
    [lines]
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      const product = catalogue.get(productId);
      if (!product) return; // never let a stale id back into the cart

      /* Clamped to stock when stock is counted at all. Letting somebody order
         seven of something there are three of produces an order the stand
         cannot fill, and they find that out at the counter. `CartSheet` passes
         the same ceiling to its Stepper, so the limit is visible rather than a
         tap that silently does nothing. */
      const ceiling = Math.min(product.stock ?? MAX_PER_LINE, MAX_PER_LINE);
      const units = Math.min(Math.max(0, Math.floor(quantity)), ceiling);

      /* Read through the store rather than the render closure. Two taps landing
         in the same tick both see the live value this way, so the second does
         not overwrite the first — the classic double-tap-drops-an-item bug. */
      const base = getSnapshot().filter((line) => catalogue.has(line.productId));
      const existing = base.find((line) => line.productId === productId);

      if (units <= 0) {
        if (!existing) return;
        write(base.filter((line) => line.productId !== productId));
        return;
      }

      if (!existing) {
        write([...base, { productId, quantity: units }]);
        return;
      }

      if (existing.quantity === units) return; // nothing changed; do not wake listeners
      write(
        base.map((line) =>
          line.productId === productId ? { productId, quantity: units } : line
        )
      );
    },
    [catalogue]
  );

  const add = useCallback(
    (productId: string) => {
      const current = getSnapshot().find((line) => line.productId === productId);
      setQuantity(productId, (current?.quantity ?? 0) + 1);
    },
    [setQuantity]
  );

  /** Drops the line outright. Stepping down to zero goes through `setQuantity`. */
  const remove = useCallback(
    (productId: string) => setQuantity(productId, 0),
    [setQuantity]
  );

  const clear = useCallback(() => write(EMPTY), []);

  const value = useMemo<CartContextValue>(
    () => ({
      lines,
      add,
      remove,
      setQuantity,
      clear,
      count,
      pricing,
      products: catalogue,
      open,
      setOpen,
    }),
    [lines, add, remove, setQuantity, clear, count, pricing, catalogue, open, setOpen]
  );

  return (
    <ShopSettingsContext.Provider value={settings}>
      <CartContext.Provider value={value}>{children}</CartContext.Provider>
    </ShopSettingsContext.Provider>
  );
}
