# Setup — getting this live

The one-time provisioning. Roughly 30–40 minutes, most of it waiting for a
Supabase project to finish creating.

**Four of these steps need a browser and cannot be automated:** signing in to
Supabase, creating the Google OAuth client, enabling Google in the Supabase
dashboard, and setting the environment variables in Vercel. Everything else is
a command you can paste.

Until this is done the site still works — the storefront falls back to
`src/data/seed.json` and the manager shows a "read-only" banner and refuses to
pretend a save worked. Nothing here is urgent-or-broken; it is urgent-or-you-
cannot-add-keychains-from-your-phone.

---

## 1. Supabase

### 1.1 Sign in

```bash
npx supabase login
```

Opens a browser. Paste the code it shows you back into the terminal.

### 1.2 Create the project

Either in the dashboard at <https://supabase.com/dashboard>, or:

```bash
npx supabase projects create coffee-truck-shop --region eu-central-1 --size micro
```

`eu-central-1` (Frankfurt) is the closest region to Israel — it is the same
reasoning as the `fra1` in `vercel.json`. You will be asked for a database
password; **save it in your password manager now**, because you need it in the
next step and Supabase will not show it again.

Creating the project takes a couple of minutes. Wait for it to go green.

### 1.3 Link this repo to it

Copy the **project ref** from the dashboard URL — the part after
`/project/`, twenty lowercase letters.

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

### 1.4 Push the schema

```bash
npx supabase db push
```

This applies `supabase/migrations/001` through `005`: the catalogue tables, the
grants and row-level security, the owners table, the photo bucket, and rate
limiting plus the audit log.

Check it did what it should:

```bash
npx supabase db push --dry-run
```

should now report nothing left to apply.

---

## 2. Google sign-in

The manager is owner-only and Google is the only way in, so this step is not
optional.

### 2.1 Create the OAuth client

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create a project if you have none. Any name.
3. **Configure the OAuth consent screen** first (Google refuses to make a
   client without one): External, app name, your email, save. It can stay in
   "Testing" — add your own address under **Test users**.
4. **Create credentials → OAuth client ID → Web application.**
5. Under **Authorised redirect URIs**, add exactly:

   ```
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

   This is the *Supabase* callback, not the site's. Getting this wrong is the
   single most common reason sign-in fails with `redirect_uri_mismatch`.

6. Copy the **Client ID** and **Client secret**.

### 2.2 Turn it on in Supabase

Dashboard → **Authentication → Sign In / Providers → Google** → enable, paste
the client ID and secret, save.

While you are there, under **URL Configuration**, set the **Site URL** to
`https://mobile-3dprint-shop.vercel.app` and add
`https://mobile-3dprint-shop.vercel.app/**` plus `http://localhost:3000/**` to
**Redirect URLs**. Without these, sign-in bounces to the wrong host and you
arrive signed out.

### 2.3 Check it without opening the app

```bash
curl -s https://YOUR_PROJECT_REF.supabase.co/auth/v1/settings | grep -o '"google":[a-z]*'
```

Should print `"google":true`. This reads the public settings endpoint, so it
tells you what is *actually* enabled rather than what a login screen claims.

---

## 3. Environment variables

Copy `.env.example` to `.env.local` and fill it in. Dashboard →
**Project Settings → API**:

| Variable | Where it comes from | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / publishable key | no |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key | **yes** |
| `NEXT_PUBLIC_SITE_URL` | `https://mobile-3dprint-shop.vercel.app` | no |

**The service-role key bypasses row-level security completely.** It belongs in
`.env.local` (which is gitignored) and in Vercel's server-side environment, and
nowhere else. Never prefix it with `NEXT_PUBLIC_` — that would ship it to every
visitor's browser.

Check it locally:

```bash
npm run dev
```

Open <http://localhost:3000/manager>. The read-only banner should be gone, and
you should be sent to a Google sign-in.

---

## 4. Load the catalogue

```bash
node scripts/seed-supabase.mjs
```

Loads the 5 categories, the 3 keychain subclasses, the 11 products and their
photos from `src/data/seed.json`. It is idempotent — running it twice changes
nothing — and it refuses to run if it finds products that are not in the seed,
so it cannot quietly overwrite a week of real edits. Pass `--force` only when
you actually mean to.

---

## 5. Vercel

The project **already exists** and is already linked to this GitHub repo:
`mobile-3dprint-shop`, on the `unixechos-projects` team. Pushing to `main`
deploys it. `vercel.json` pins the framework to Next.js, which matters because
the project was originally set up for the old static site.

Set the same four variables in **Project Settings → Environment Variables**,
for Production **and** Preview. Then redeploy — Vercel does not pick up new
variables until the next build.

> If the first deploy serves the old static site instead of building, check the
> **Framework Preset** in the Vercel UI. `vercel.json` should override it, but
> the project's stored setting was `Other`.

---

## 6. Check it end to end

In order, because each step depends on the one before:

1. Open the deployed URL. The landing page loads in Hebrew.
2. **Shop** → products appear, with "5 for ₪35" on the small keychains.
3. Add two of something with a deal → the cart shows the discount *and* names
   which deal produced it.
4. Open `/manager` → Google sign-in → you land on the catalogue.
   - If you land on **/no-access**, the address you signed in with is not the
     one in `bootstrap_owner_email()` (migration 003). Fix it there and
     re-run `npx supabase db push`.
5. Add a product, take a photo with the phone camera, save.
6. Open the shop in a private window → the new product is there.

### If something is wrong

```bash
# Every SECURITY DEFINER function and who may execute it, plus every table's
# client grants. Run in the dashboard's SQL editor.
cat scripts/audit-security.sql
```

The header of that file explains what a bad result looks like for each query.

---

## Afterwards

- Point the truck's **QR code** at the Vercel URL, not the old GitHub Pages
  one, then turn Pages off in the repo settings.
- Set the **Bit payment link** in the manager's Settings screen. Until it is
  set, the storefront deliberately hides the pay button rather than showing a
  dead one.
- Write the **accessibility statement** (`PLAYBOOK.md` §2.2). It is required
  regardless of the revenue threshold.
