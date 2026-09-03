# Start here tomorrow

Paste the block below into a fresh Claude Code session in this repo. Everything
it refers to is already committed on `rebuild/next-supabase`.

---

## The prompt

> Continue the coffee-truck rebuild. Read `HANDOFF.md` and `docs/SETUP.md`
> first — the whole app is built, tested and pushed to the branch
> `rebuild/next-supabase`, and what is left is provisioning plus a merge.
>
> I have already run these two myself, because neither can be done from a
> non-interactive shell:
>
> ```
> npx supabase login
> npx supabase link --project-ref <ref>
> ```
>
> Take it from there:
>
> 1. Run `node scripts/finish-setup.mjs`. It pushes the migrations, writes
>    `.env.local` from the project's API keys, loads the catalogue and verifies
>    the result. Read its output back to me and stop if anything is off —
>    especially the anonymous-write check.
> 2. Walk me through the Google OAuth client and enabling Google in the
>    Supabase dashboard. Give me the exact redirect URI to paste.
> 3. Start the dev server and confirm `/manager` shows the real catalogue
>    rather than the read-only banner, and that sign-in works.
> 4. Run `scripts/audit-security.sql` in the Supabase SQL editor and check the
>    results against what its header says a bad row looks like.
> 5. Tell me the four variables to put into Vercel, then redeploy and check the
>    preview.
> 6. **Only once the deployed site is confirmed working**, fast-forward `main`
>    and push. Do not do this earlier — see the GitHub Pages note below.
>
> Before step 1, confirm `bootstrap_owner_email()` in migration 003 is the
> Google address I will actually sign in with.
>
> Then: I have keychains with me. Help me add them through the manager on my
> phone, and set up the clicker / small / big subclasses with the right bundle
> prices.

---

## The one thing not to get wrong

**Do not merge to `main` until the Vercel deployment is confirmed working.**

The truck's QR code currently points at the GitHub Pages site, which is served
from `main`. The rebuild moves the old site into `legacy/`, so the moment
`main` changes, Pages has no `index.html` at the root and **the QR code goes to
a 404**. Vercel has to be verified first, and the QR code repointed at the
Vercel URL, before Pages stops mattering.

The branch is safe to push to as often as you like — it only produces preview
deployments.

---

## What is already true

- The app builds, lints and passes 36 tests. 24 routes.
- The storefront works right now with no Supabase at all: it falls back to
  `src/data/seed.json`, and the manager shows a read-only banner rather than
  pretending a save worked. So a failure during setup is not an outage.
- The manager was exercised on a 375px viewport: Hebrew RTL, the three keychain
  subclasses, live deal captions from the pricing engine.
- The auth gate and every write endpoint were checked against a running server,
  not just read.

## What is genuinely undone

- Supabase, Google OAuth, and the Vercel env vars — §1–3 of `docs/SETUP.md`.
- The Bit payment link. The storefront hides the pay button until it is set.
- The accessibility statement (`PLAYBOOK.md` §2.2). Required regardless of the
  revenue threshold, and it is a writing job, not a code one.
- A custom domain, if you want one.

## Decisions taken that you may want to revisit

- **The 5-keychain deal was seeded at ₪35, not ₪40.** The old site advertised
  ₪35 in all three languages while its code charged ₪40. Undercharging beats
  charging above the posted sign, but if ₪40 was the intent, change it in the
  manager's Deals screen — it is two taps.
- **The keychain subclasses are seeded empty** except for the one catch-all row
  carried over from the old catalogue. Tomorrow's keychains go into clickers /
  small / big, and the "any 3 for ₪25" deal is already attached to *small*.
- **Region is Frankfurt** (`fra1` on Vercel, `eu-central-1` on Supabase) as the
  closest to Israel.
