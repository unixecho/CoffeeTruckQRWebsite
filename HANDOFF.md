# Session Handoff

Running log of work on this project. At the **end of each session**, Claude:

1. Checks off completed items in **Backlog / open items**.
2. Adds a dated entry to the **Session log** with a short summary.
3. Flags anything still open or needing the owner (e.g. real links, decisions).

> Tip: start a session by skimming the top entry of the Session log and the open
> items below.

---

## Backlog / open items

Unchecked = not done yet. Owner actions are marked **(owner)**.

- [ ] **(owner)** Replace the placeholder `BIT_PAYMENT_LINK` in `app.js` with the
      real Bit payment page once available (currently a sample link).
- [ ] **(owner)** Confirm the WhatsApp number (`+972 54-910-9603`) and the
      prefilled messages read the way you want.
- [ ] Enable real "Online Ordering" (button exists on the landing page but is
      intentionally disabled / "coming soon").
- [ ] Consider persisting the cart to `localStorage` so it survives a refresh.
- [ ] Add real product photography where placeholders/emoji are still used.
- [ ] **Make `products.json` the single source of truth for categories.** Today
      the manager (`manager.html`) reads category *keys* from the `categories`
      block in `app.js`, and a brand-new category created in the manager has no
      translated label on the site until its key is added to `app.js` (he/en/ar).
      Idea: let the JSON itself carry category definitions (key + localized
      labels), have `app.js` build its category list from the JSON instead of the
      hardcoded `i18n.categories` blocks, and have the manager edit those
      definitions. Then adding a category in the manager would "just work" on the
      site with no `app.js` edit. Deferred — needs an `app.js` refactor.

---

## Session log

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
