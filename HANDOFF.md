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

---

## Session log

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
