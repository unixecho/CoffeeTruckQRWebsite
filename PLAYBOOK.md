# Cross-Project Security & Compliance Playbook

Living reference. Started 2026-08-31 during Ayeka Bar's security-hardening
round, meant to be copied into (and kept updated across) every project this
account works on — not specific to one stack once you're past §1.

**How to use this file in a new/existing project:** copy it to the project
root, read it once before shipping anything Supabase-backed or
customer-facing, and update it — here, in the source project — whenever a
new class of issue turns up anywhere. Copy the updated file back out to
other projects' roots periodically; there's no automatic sync between
copies, this is a manually-propagated reference, not a package.

> **Arrived in this project 2026-09-03**, copied from Ayeka Bar during the
> Next.js + Supabase rebuild. Nothing below has been rewritten — it is the
> shared reference, and edits belong in the source project so they propagate.
>
> What this codebase already implements, so a reader knows what is done rather
> than aspirational:
>
> | Section | Status here |
> |---|---|
> | §1.1 auto-updatable views | No views exist. Nothing to expose. |
> | §1.2 implicit `PUBLIC` grant | Every `SECURITY DEFINER` function is revoked from `PUBLIC` explicitly in migrations 003 and 005. |
> | §1.3 row- vs column-scoped RLS | Closed by construction: **no client role holds a write grant on any table** (migration 002). All writes go through `src/app/api/manager/*`. |
> | §1.4 retention | `cleanup_expired_rows()` on a nightly `pg_cron` job — rate-limit windows after a day, audit log after 24 months (migration 005). |
> | §1.4 rate limiting | Postgres-backed `check_rate_limit()`, not per-instance memory (migration 005). |
> | §1.4 data rights | **Not applicable yet** — the site stores no customer data. It becomes applicable the moment online ordering is added. |
> | §1.5 day-one conventions | Followed. `ALTER DEFAULT PRIVILEGES` revokes on new tables so a future migration fails closed. |
> | §1.6 audit script | `scripts/audit-security.sql`, adapted to this schema. |
> | §2 accessibility | Code-level floor is in place (see `docs/DESIGN-SYSTEM.md` §8). **The accessibility statement is not written yet** — see `HANDOFF.md`. |
> | §2.4 focus indicator | Global `:focus-visible` rule in `globals.css`. |
> | §2.4 `lang`/`dir` | Set from the active locale, not a server default (`src/lib/i18n.tsx`). |
> | §2.4 RTL numerals | `.ltr-nums` wraps every numeric expression. |
> | §3 cookie consent | **No banner required, verified**: the grep below returns nothing, and storage is limited to locale, theme and cart. Re-check when any analytics or third-party embed is added. |
> | §4 unauthenticated writes | **None exist.** Every write endpoint is behind the owner check. |

---

## §1 — Supabase / Postgres security

### The core principle

Supabase's REST API (PostgREST) enforces **two independent layers**:
Postgres **GRANTs** (can this role touch this table/function at all?) and
**RLS policies** (which rows, once it can). Almost every bug below is a
case where one layer was configured correctly and the other wasn't — and
because both layers "look" secure in isolation, it's easy to review one and
never check the other.

### Pre-launch checklist

Run before any Supabase project goes live, and again any time a new table,
view, or RPC function is added. The audit script in §1.6 automates the
first four rows.

- [ ] Every `SECURITY DEFINER` function taking an id/uuid parameter either
      checks that parameter against the caller's own identity
      (`auth.uid()`), or is only reachable via a service-role backend —
      never both unchecked *and* anon/authenticated-executable.
- [ ] Every view built on RLS-restricted tables is checked for
      `is_updatable`/`is_insertable_into` — if either is `YES` and the view
      should be read-only, the write grants are revoked explicitly (a bare
      `GRANT SELECT` isn't enough if a broader grant already exists).
- [ ] Every `REVOKE` written during a security fix explicitly includes
      `PUBLIC`, not just `anon, authenticated` — verified by re-testing
      live, not by re-reading the migration.
- [ ] Every "update your own row" RLS policy is checked for which
      *columns* it actually leaves writable — a financial/points/role/
      status column sitting in the same table as a name field needs a
      column-level grant or a server-mediated write path; row-scoping
      alone does not protect it.
- [ ] Every table holding personal data has a stated retention period and
      a scheduled job enforcing it.
- [ ] Every public-facing write endpoint has rate limiting that survives
      multiple serverless instances — not an in-memory counter.
- [ ] A user has a real way to see, correct, export, and delete their own
      data — not just a support-ticket process.
- [ ] Auth providers actually enabled at the platform level match what the
      app's UI claims — check via the public, unauthenticated
      `GET /auth/v1/settings` endpoint, not the app's own login screen.

### §1.1 SECURITY DEFINER + auto-updatable view + blanket grant — CRITICAL

A view meant as a read-only convenience was `SECURITY DEFINER` (bypasses
the base table's RLS, runs as the view owner) and granted full
`SELECT/INSERT/UPDATE/DELETE` to `anon`. Because it was a simple
single-table query with no joins/aggregates, Postgres treats it as
**automatically updatable** — a plain SQL-standard feature, not a
Supabase-specific one. The combination meant an anonymous `PATCH` could
write directly into the base table with owner-level privileges — in the
found case, `{"role":"owner"}` against any row, no login required.

**Detect:**
```sql
select table_name, is_updatable, is_insertable_into
from information_schema.views where table_schema = 'public';
-- cross-reference any 'YES' against:
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
  and privilege_type in ('INSERT','UPDATE','DELETE');
```

**Fix:** a read-only view gets *exactly* `GRANT SELECT` to the roles that
need it — never a blanket grant "to be safe," never copy-pasted from a
table's own grant set. No legitimate reader at all → revoke everything.

### §1.2 The implicit PUBLIC grant on new functions — CRITICAL

`revoke execute on function f() from anon, authenticated;` was applied,
then re-tested live — and the function was *still* callable anonymously.
Postgres grants `EXECUTE` on a newly created function to the `PUBLIC`
pseudo-role automatically unless explicitly revoked. Every real role
inherits whatever `PUBLIC` holds, on top of its own grants — revoking a
role's own grant does nothing if `PUBLIC` still has it underneath. This is
specifically a function/procedure default — tables and views do **not**
get an implicit PUBLIC grant (confirmed by testing both).

**Detect:**
```sql
select proname,
       has_function_privilege('anon', oid, 'EXECUTE')   as anon_exec,
       has_function_privilege('public', oid, 'EXECUTE') as public_exec
from pg_proc where pronamespace = 'public'::regnamespace and prosecdef;
-- public_exec = true on anything you meant to lock down is the bug.
```

**Fix:** every lockdown `REVOKE` names `PUBLIC` explicitly, as a standing
habit: `revoke execute on function f() from public, anon, authenticated;`

### §1.3 Row-scoped RLS ≠ column-scoped RLS — MEDIUM/HIGH depending on the column

A table storing both a safe field (`first_name`) and a sensitive one
(`points`) had one RLS policy: `UPDATE ... USING (auth.uid() = user_id)`.
Correctly scoped to *which row* — but RLS cannot restrict *which column*
within an allowed row. A legitimately signed-in user, with nothing but
their own real session, could `PATCH` their own row's `points` directly.

**Fix, in order of preference:**
1. Don't grant table-level `UPDATE` to the client role at all for tables
   with any sensitive column — mediate writes through a server backend
   (service-role) that only ever touches the specific validated fields.
2. If direct client writes are genuinely wanted: column-level grants —
   `grant update (first_name, last_name) on customers to authenticated;`
   instead of a blanket `grant update`.

### §1.4 No retention, no shared-state rate limit, no user data-rights — MEDIUM, compounding

Three gaps that show up on day one and never get retrofitted unless
something forces the question:

- **Retention:** logs collected automatically (IP, device fingerprint)
  accumulate forever with no code ever written to age them out. Supabase
  bundles `pg_cron` on every project (usually just needs
  `create extension if not exists pg_cron;`) — a nightly job calling a
  small cleanup function is enough. The exact number of months is a legal
  judgment call, not a technical one — pick a reasoned default and get it
  confirmed alongside the privacy policy.
- **Rate limiting:** an in-memory counter is a false sense of security on
  any serverless platform (Vercel, Netlify, Lambda) — concurrent requests
  land on different instances with different memory. A Postgres-backed
  counter table (one row per key, one atomic upsert) is simple and
  actually shared. Reference implementation: a `rate_limits(key, window_
  start, count)` table + a `check_rate_limit(key, max, window_seconds)`
  function doing an atomic `INSERT ... ON CONFLICT DO UPDATE`.
- **Self-service data rights:** a user's own right to see/correct/export/
  delete their data is cheap to build early, expensive to retrofit once
  ten more tables reference the user. When building delete: check
  `pg_constraint` for every FK into the user's table and its `ON DELETE`
  behavior *before* writing the delete flow — don't assume cascades exist,
  confirm them. Nullable FKs with no cascade (e.g. a fraud/security log
  referencing the user) should be nulled, not left to error the delete out
  — this anonymizes the security record instead of destroying it.

### §1.5 Day-one conventions

| Convention | Why |
|---|---|
| Every `CREATE FUNCTION ... SECURITY DEFINER` is immediately followed, same migration, by an explicit `REVOKE EXECUTE ... FROM PUBLIC` | Closes §1.2 by construction. |
| Every table/view meant for one role only gets an explicit `GRANT SELECT` (or nothing) — never rely on a dashboard "expose to API" toggle's default | Closes §1.1. Default-deny, then open exactly what's needed. |
| A service-role-only table gets `revoke all ... from public, anon, authenticated` **as well as** RLS-with-no-policies | Supabase's `ALTER DEFAULT PRIVILEGES` grants ALL on every new `public` table to `anon`/`authenticated`, so "RLS on, no policies" is ONE lock, not two — and the realistic failure mode is somebody adding a policy while debugging, which then opens the table on its own. |
| Any table with a financial/role/status column never gets a blanket client-side `UPDATE` grant | Closes §1.3 without needing to remember column-level grants correctly every time. |
| After *every* RLS/grant change: re-test live with an actual unauthenticated request, not just "the migration succeeded" | This is literally how §1.2 was caught — the fix looked correct and wasn't. |
| A `rate_limits` table + `check_rate_limit()` function gets copied into every new project's first migration, not added later under pressure | Cheap early, annoying to retrofit once endpoints are live. |
| Any table collecting data automatically gets a retention decision at design time, alongside a scheduled `pg_cron` cleanup | "We'll add retention later" reliably becomes "we never did." |

### §1.6 Copy-paste audit script

```sql
-- Every SECURITY DEFINER function, its arguments, who can call it
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_exec,
       has_function_privilege('public', p.oid, 'EXECUTE')         as public_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef = true
order by anon_exec desc, public_exec desc, p.proname;

-- Every view/table, write-grant status, auto-updatable flags
select
  t.table_name,
  has_table_privilege('anon', 'public.'||t.table_name, 'SELECT')  as anon_select,
  has_table_privilege('anon', 'public.'||t.table_name, 'UPDATE')  as anon_update,
  has_table_privilege('anon', 'public.'||t.table_name, 'INSERT')  as anon_insert,
  has_table_privilege('authenticated', 'public.'||t.table_name, 'UPDATE') as auth_update,
  coalesce(v.is_updatable, 'n/a')       as is_updatable,
  coalesce(v.is_insertable_into, 'n/a') as is_insertable_into
from information_schema.tables t
left join information_schema.views v
  on v.table_schema = t.table_schema and v.table_name = t.table_name
where t.table_schema = 'public'
order by anon_update desc, anon_insert desc, t.table_name;
```

---

## §2 — Israeli accessibility law (נגישות)

Real, specific, and has actual teeth — not a "best practice," a statutory
requirement under **תקנות נגישות השירות** (Accessibility of Service
Regulations), referencing **Israeli Standard 5568** (which itself points
to WCAG 2.0). Applies whenever a site provides a service or information
about one.

### §2.1 Who's actually covered

- **Existing sites** (launched before 26.10.2017): must be accessible if
  annual revenue exceeds ~1,000,000 ₪ (3-year average).
- **New sites** (launched after 27.10.2017): must be accessible if annual
  revenue exceeds ~100,000 ₪ (3-year average) — a genuinely low bar; most
  operating businesses clear it.
- Below the threshold → automatically exempt, no application needed — but
  even exempt sites must publish an accessible way to request the service
  (a phone number/contact method presented accessibly).
- Non-compliance exposure (per general legal-info sources — confirm exact
  figures with counsel): civil suits, class actions, fines that don't
  require proving actual damage. Take the "we're probably too small"
  read with real skepticism given how low the new-site threshold is.

### §2.2 The two things this requires, always

1. **An accessible website**, per TI 5568 / WCAG 2.0 AA-equivalent.
2. **A public accessibility statement** (הצהרת נגישות) — required
   *regardless* of which compliance route is taken, including if an
   exemption applies. Must state: the accessibility level implemented,
   browsers tested, contact info for reporting accessibility problems,
   the main accessibility adaptations made (including to the *physical*
   premises if there's a real-world location — this is not just about the
   website), any exemption claimed, and the statement's date/last update.

### §2.3 On accessibility overlay/widget tools — read before adopting one

Third-party embeddable widgets (add a script tag, get a floating
accessibility button with contrast/font-size/reading tools) are common,
often free, and genuinely easy to install. **They are not a substitute for
an accessible codebase, and treating one as sufficient carries real risk:**

- Widely documented technical failure mode: the widget's JS runs *after* a
  screen reader has already parsed the (still inaccessible) DOM — it
  patches the visual experience for sighted users adjusting contrast/text
  size, not the underlying structure assistive technology actually reads.
- Over 700 accessibility professionals (including from Google, Microsoft,
  Apple, Shopify) have publicly stated overlays "do not repair the
  underlying problems with inaccessible websites" (the "Overlay Fact
  Sheet" — search for it directly).
- Regulators have taken action against overlay vendors specifically for
  overstating what their product achieves (an FTC enforcement action fined
  one such vendor $1M in 2025 for false WCAG-compliance claims — verify
  current status before citing).
- In jurisdictions with heavy accessibility litigation, sites *using* an
  overlay have still been sued and lost — the widget's presence has in
  some cases been read as evidence the site owner knew about the
  requirement and reached for a superficial fix instead of a real one.
- Israel's own regulations do not name overlay/widget tools as an
  accepted compliance method one way or the other.

**Practical stance:** a free, reputable overlay widget aligned with the
local standard (e.g. one explicitly built to TI 5568) is a reasonable
*supplementary* layer — real, low-cost tools for visitors who want them —
**but pair it with genuine code-level work** (semantic HTML, real alt
text, keyboard navigation, WCAG-AA color contrast, visible focus
indicators), and always ship the accessibility statement regardless of
which tools are or aren't installed. Don't let "we installed a widget"
become the whole answer.

### §2.4 Concrete code-level fixes worth doing on every project (cheap, high-leverage)

- **A global visible-focus-indicator fallback.** Codebases accumulate
  `outline: none` on custom inputs/buttons over time (found: 16 files in
  one audit) with no replacement — a keyboard user then has no way to see
  where they are (WCAG 2.4.7). Inline `style` always wins over a plain
  CSS rule for the same property, so fixing this file-by-file doesn't
  scale. One global rule, deliberately using `!important` (a rare
  legitimate use of it):
  ```css
  :focus-visible {
    outline: 2px solid <your-accent-color> !important;
    outline-offset: 2px !important;
  }
  ```
  `outline` never affects layout and `:focus-visible` only fires for
  keyboard/programmatic focus, not mouse clicks — this is a pure,
  low-risk addition.
- **Check your dimmest text-color token for contrast**, not just your
  primary text color. Design systems often have a "faint/muted" tier used
  for captions and hints that nobody contrast-checked because the primary
  text color is fine. Compute against every background it's actually
  used on:
  ```python
  def lin(c):
      c = c/255
      return c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
  def luminance(hexc):
      r,g,b = int(hexc[0:2],16), int(hexc[2:4],16), int(hexc[4:6],16)
      return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
  def contrast(c1,c2):
      l1,l2 = luminance(c1), luminance(c2)
      return (max(l1,l2)+0.05)/(min(l1,l2)+0.05)
  # need >= 4.5 for normal text, >= 3.0 for large text/UI components
  ```
- `lang`/`dir` attributes should reflect the actual displayed language,
  not just a hardcoded server default, on any multilingual site — a
  client-side language switcher that doesn't update
  `document.documentElement.lang` leaves screen readers assuming the
  wrong language.
- Respect `prefers-reduced-motion` everywhere animation is used — cheap,
  easy to forget project-wide, and a real WCAG 2.3.3 consideration.
- **Audit anything that programmatically `.click()`s a hidden element for
  focus theft.** Found 2026-09-01 in a real codebase: the standard iOS
  haptic-feedback trick (iOS Safari has no Vibration API, but flipping an
  `<input type="checkbox" switch>` produces a tap, so apps create a hidden
  one and click it from script) **moves keyboard focus to that hidden
  input**, because activating a checkbox focuses it. `pointer-events: none`
  does not help — a scripted `.click()` never hit-tests, and `tabIndex=-1`
  only removes it from the *Tab* order, not from being focused. The blast
  radius is every control that calls the helper, on every device where the
  fallback path runs. Two consequences: keyboard users lose their place on
  every tap (WCAG 2.4.3), and any dialog opened from such a control can
  never restore focus to its opener, because the "what had focus before"
  snapshot is already the hidden input. Fix at the source — capture
  `document.activeElement` before the click and `.focus({preventScroll:
  true})` it back after. Generalises: **any helper called from a tap
  handler must be focus-neutral**, because no call site says otherwise.
- **RTL: wrap numeric expressions in `dir="ltr"`.** A character counter
  written `{used} / {max}` renders as `1000 / 0` inside an RTL block — the
  bidi algorithm reorders it, and the result is not cosmetic, it is a
  different and wrong claim. Same class of bug for ranges (`3–7`), scores,
  version numbers and IP addresses. The containing row keeps
  `text-align: end` so placement still mirrors correctly.
- **A honeypot field and a focus trap can collide.** A spam honeypot is
  usually `tabIndex=-1` and visually hidden, which is enough for native
  tabbing — but a modal's focus trap typically finds its first/last
  focusable with a selector like `input:not([disabled])`, which still
  matches it. If the honeypot happens to be the first or last focusable in
  the dialog, wrapping focuses it, and a keyboard user can type their
  message into the field whose whole purpose is to make the server discard
  the submission. Either exclude it from the trap's selector or guarantee
  structurally that it is never first or last — and write the invariant
  down next to the field.

---

## §3 — Israeli cookie-consent law (Amendment 13)

Amendment 13 to the Protection of Privacy Law introduced a real cookie-
banner obligation — but a **selective** one, not universal:

- **Essential/functional cookies** (session/auth cookies, things the
  service can't work without) — no consent banner required. Can be
  "condition the service on providing it."
- **Non-essential cookies** (analytics, advertising, marketing, tracking
  pixels — Google Analytics, Meta Pixel, ad tech) — an explicit opt-in
  banner *is* required, and it must:
  - Block the non-essential script from loading *before* consent is given
    (not just hide a banner while the script already ran).
  - Give "reject all" equal visual prominence to "accept all" — no dark
    patterns nudging toward acceptance.
  - Allow granular choice, not just an all-or-nothing toggle.
  - Log when and how consent was given (a records requirement, not just a
    UI requirement).

**The practical trigger:** if a project has zero non-essential
cookies/tracking (verified by an actual grep for GA/Meta Pixel/ad-tech
script tags, not assumed), **no banner is currently required** — building
one anyway adds an active opt-in gate with nothing real for it to gate,
which is its own kind of over-engineering. The moment *any* non-essential
tool is added (an analytics package, an ad pixel, or — a real edge case —
a third-party embedded widget like an accessibility overlay that sets its
own tracking-adjacent cookie), that's the trigger to build and activate
the banner, not before. Check what any new third-party embed actually
sets (cookies, localStorage, its own analytics) before assuming it's
"just" the feature it's marketed as.

**Detect what a project currently has, before deciding:**
```
grep -rE "gtag|G-[A-Z0-9]{6,}|GTM-|fbevents|facebook\.net|hotjar|mixpanel|segment\.com" src/
```
Zero hits + a check of `document.cookie`/localStorage usage limited to
session/preference data → no banner needed yet, but keep this playbook's
trigger condition in mind for every new third-party script added later.

---

---

## §4 — Public, unauthenticated write endpoints

Written 2026-09-01 while building a customer feedback box. Applies to any
endpoint a total stranger can POST to with no session, no signed token and
no prior contact — a suggestion box, a contact form, a waitlist signup, an
error-report beacon. These are rarer than they look, and it is worth
naming which ones a project has, because the reasoning below does not
apply to anything sitting behind a login.

The design mistake to avoid is reaching for a guard that isn't there. You
cannot authenticate the caller; that is the point of the feature. So the
containment is a stack of cheap, independent rails, each of which is
worthless alone.

### §4.1 The rails, in execution order

1. **Same-origin.** Refuse a present-but-foreign `Origin` (a *missing*
   Origin means same-origin or a non-browser client, so allow it — modern
   browsers always send it cross-origin). Then **require
   `Content-Type: application/json`**: that is the rail that actually
   closes cross-site form posts, because an HTML form can only ever send
   `text/plain`, urlencoded or multipart. Worth doing even when CSRF
   "can't steal anything" — if the endpoint opportunistically attaches the
   caller's identity when a session happens to exist, a forged request
   writes a row attributed to someone who did not write it, and the
   database then holds that small lie forever.
2. **A body ceiling read from `content-length`, before the body is read.**
3. **Rate limiting — per-IP AND global.** Per-IP alone does nothing
   against a proxy pool or a botnet, and an unauthenticated write path
   with no ceiling is bounded only by how many addresses the attacker can
   rent. Set the global limit ~100× above real peak usage so reaching it
   means something is actually wrong. **Write the trade-off down**: while
   the global window is saturated, honest users are refused too. That is
   acceptable for a suggestion box and might not be for a signup funnel —
   decide deliberately, do not inherit the decision.
4. **A honeypot** before a CAPTCHA. One hidden input, no third party, no
   cookie, nothing for a consent-banner obligation (§3) to catch. Answer a
   filled honeypot with a cheerful **200** and write nothing — a bot that
   learns which field gave it away just stops filling that one in. See
   §2.4 for the focus-trap collision to avoid.
5. **A kill switch the operator can reach without a deploy**, and be
   honest in the code about what it is: an operational lever, not a
   security boundary. That distinction decides whether it fails open or
   closed. A switch guarding a *convenience* should fail open (a settings
   blip must not silently remove the feature); a switch gating a *write
   into live operations* should fail closed.
6. **Validation that BUILDS the stored object** rather than checking a few
   fields on the caller's own. Otherwise an invented property
   (`status`, `is_admin`, `resolved_by`, an id) rides along into the
   insert. This is one line of discipline and it removes a whole class.

Then resolve any identity from the caller's **own session**, never from
the body, and let that step fail softly — the submission is the point, the
attribution is a bonus.

### §4.2 Store less than you are handed

- **Do not store the IP** unless the table exists to investigate abuse. A
  rate limiter needs the IP and already has it, in a row that ages out in
  a day. A permanent record of who complained about what is precisely what
  stops people complaining, and it is a subject-access-request liability
  for no operational gain.
- **Never store a full URL the client sent.** Reduce it to a path, and do
  the reduction in the SERVER-SIDE VALIDATOR, not in the one client
  function that happens to build it — a future caller will forget, and a
  hostile one never intended to comply. Two specifics that bite:
  - `//evil.com` is a valid, entirely off-site protocol-relative URL, and
    it is exactly what a naive `startsWith('/')` waves through.
  - Browsers fold `\` into `/`, so `/\evil.com` resolves off-site too —
    strip backslashes **before** the `//` test, not after.
  This matters because the value lands in an admin screen where the
  obvious thing to do is make it clickable, and an attacker-chosen
  destination there is a link the operator has every reason to trust.
- **Drop the query string** while you are at it, unless you have a
  specific use for it. Query strings are where apps put tokens — a signed
  check-in token, a password-reset code, a session hand-off — and copying
  one into a table an operator reads at leisure weeks later undoes
  whatever `Referrer-Policy` was set to keep it out of logs.
- **Set a retention window at design time and schedule the job then.**
  Split the treatment by what the field actually is: clear the
  *identifying* column (a reply-to address) at the point it stops being
  useful, and delete the row itself later, if at all. Make both numbers
  function parameters so they can move without a migration.

### §4.3 Foreign keys into the user's own account

If the row can optionally reference the submitter's account, use
`ON DELETE SET NULL`, not `CASCADE`, and state why in the schema. Deleting
an account should anonymise what the person said, not retract it — the
message was never *about* their account. The bonus is that the
"delete my data" flow then needs **no new code**: the cascade reaches the
table on its own. Remember to add the table to the **export** flow, though;
an export that claims to cover "everything we hold about you" and quietly
skips a table is worse than no export.

### §4.4 Error messages on a multilingual surface

Return **codes**, not sentences, from any validator whose output reaches a
multilingual UI; let the client map them. Telling a visitor reading your
Arabic site why their message was refused, in Hebrew, is a bug — and it is
an easy one to ship, because the validator is usually written next to a
single-language admin screen where returning a sentence was right. Map
unknown codes to a generic message so adding a reason server-side can
never render blank.


## Changelog

- **2026-09-01 (b)** — added §4 (public, unauthenticated write
  endpoints) after building a customer feedback box: the rail stack, the
  path-not-URL rule (`//evil.com`, backslash folding, query strings), the
  store-less-than-you-are-handed list, and the codes-not-sentences rule.
  Added to §1.5 that a service-role-only Supabase table needs its GRANTS
  revoked as well as RLS — Supabase default privileges hand `anon` ALL on
  every new public table. Added to §2.4: programmatic `.click()` on a
  hidden element steals keyboard focus (the iOS haptic trick, found live),
  RTL bidi reordering of numeric counters, and the honeypot/focus-trap
  collision.
- **2026-09-01 (a)** — added §2 (Israeli accessibility law) and §3 (Israeli
  cookie-consent law) after researching Negishot.co.il (an Israeli
  accessibility-overlay provider) and Amendment 13's actual cookie-banner
  scope for Ayeka Bar. Added §1.4's rate-limiting/retention reference
  implementation notes.
- **2026-08-31** — initial version, §1 only, written after closing a real
  unauthenticated privilege-escalation hole in Ayeka Bar's production
  Supabase project (migrations 042–047 in that project's history).
