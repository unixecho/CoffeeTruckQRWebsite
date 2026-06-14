# CLAUDE.md

Guidance for working in this repository.

## What this is

A single-page storefront for a coffee-truck side business that sells 3D-printed
items. Customers browse products, build a cart, see a total, and pay manually via
**Bit** (an Israeli P2P payment app) at the counter. There is no backend and no
real checkout — the site's job is to present products and produce an order
summary plus a payment hand-off.

The site is trilingual (Hebrew, English, Arabic) with full RTL/LTR support.
Hebrew is the default and primary language.

## Tech stack

- **Vanilla HTML/CSS/JS.** No framework, no bundler, no build step.
- Product data is static JSON (`data/products.json`), loaded at runtime via
  `fetch()`.
- `serve` (a static file server) is the only dependency, used for local preview.
- ESLint config exists (`.eslintrc.json`, `eslint:recommended`).

## File map

| File                  | Responsibility                                                       |
| --------------------- | ------------------------------------------------------------------- |
| `index.html`          | Markup for all views (landing, store, cart drawer, modal, widgets). |
| `style.css`           | All styling, animations, responsive rules, RTL/LTR handling.        |
| `app.js`              | All behavior: i18n, rendering, cart, modal, payment/contact links.  |
| `data/products.json`  | Product catalog (the only "content" file the owner edits often).    |
| `assets/`             | Product images (`.png`/`.jpg`).                                     |

## How to run locally

A static server is required — opening `index.html` via `file://` breaks because
the catalog is loaded with `fetch()`.

```bash
npm install
npm start          # runs `serve`
# or: python3 -m http.server 8000
```

## Architecture notes

- **Two views, one page.** `#landingView` and `#storeView` are toggled by adding
  or removing the `hidden` class; there is no router.
- **i18n** lives in the `i18n` object at the top of `app.js`, keyed by language
  (`he`/`en`/`ar`). `t(key)` reads from the active language. `setLanguage(lang)`
  flips `document.dir` (RTL for `he`/`ar`), persists to `localStorage`
  (`siteLanguage`), and re-renders everything. Visible strings must be added to
  **all three** language blocks.
- **Localized product fields.** `name`, `description`, and `tags` in
  `products.json` are objects keyed by language. Use `getLocalizedValue()` /
  `getLocalizedTags()` to read them with fallbacks.
- **Pricing tiers.** Products may have a `pricingTier` array (bundle pricing,
  e.g. 3 for ₪25). `getCartProducts()` applies the largest bundles first, then
  charges the remainder at base `price`. Don't assume `quantity * price`.
- **Cart** is an in-memory `{ productId: quantity }` map (not persisted).
- **External hand-offs** are plain links/`window.open`, configured by constants
  at the top of `app.js`:
  - `BIT_PAYMENT_LINK` — the Bit payment page (⚠️ currently a placeholder,
    marked `// replace later`).
  - `WHATSAPP_PHONE` / `WHATSAPP_MESSAGE` — the floating contact widget and the
    landing-page suggestions button (prefilled `wa.me` deep links).

## Conventions

- Keep it dependency-free and build-free. Prefer vanilla solutions.
- Any new user-facing string → add it to `he`, `en`, and `ar` in `i18n`.
- Test both directions: RTL (Hebrew/Arabic) and LTR (English) can break layout
  differently.
- Match the existing motion vocabulary: easing
  `cubic-bezier(0.22, 1, 0.36, 1)`, and respect
  `@media (prefers-reduced-motion: reduce)` (already handled globally — don't
  reintroduce unconditional animation).
- Fixed/floating UI (language globe top-left, WhatsApp widget bottom-right) must
  stay pinned in the same corner regardless of RTL/LTR.

## Git workflow

- Active development branch: **`claude/ui-polish-825cax`**.
- Commit to the branch, push it, then fast-forward `main` and push `main` so the
  deployed site updates. Do not create PRs unless explicitly asked.

## Verifying changes

There are no automated tests. Verify visually with a headless browser
(Playwright is available in the dev environment) at both desktop (~1280px) and
mobile (~390px) widths, exercising: language switch (incl. RTL↔LTR), add-to-cart
animation, cart drawer, product lightbox, and the external links' generated URLs.

## Session handoffs

At the end of a working session, update `HANDOFF.md` — check off completed
items, log a short summary, and note anything left open or needing the owner.
