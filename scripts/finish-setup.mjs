/**
 * Everything in docs/SETUP.md that does not need a browser.
 *
 *     npx supabase login                          # you — needs a browser
 *     npx supabase link --project-ref <ref>       # you — prompts for the DB password
 *     node scripts/finish-setup.mjs               # this
 *
 * The two commands above are yours because they are the two that cannot be
 * automated: `login` refuses to run its device flow outside a TTY, and `link`
 * prompts for the database password, which should go from your password
 * manager to the prompt and nowhere else.
 *
 * Everything after that is mechanical and error-prone by hand — copying three
 * keys out of a dashboard into the right variable names is exactly the step
 * that gets done wrong at 7am — so it happens here:
 *
 *   1. push the five migrations
 *   2. read the project's API keys and write .env.local
 *   3. load the catalogue
 *   4. check the result
 *
 * Safe to re-run. Nothing here creates a project or costs money.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const skipSeed = args.includes("--skip-seed");
const dryRun = args.includes("--dry-run");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  node scripts/finish-setup.mjs [--dry-run] [--skip-seed]

  Run after 'supabase login' and 'supabase link'. Pushes migrations, writes
  .env.local from the linked project's API keys, and loads the catalogue.

  --dry-run     show what would happen, change nothing
  --skip-seed   push and configure, but do not load the catalogue
`);
  process.exit(0);
}

/* -------------------------------------------------------------------------- */

const ok = (m) => console.log(`  ✓ ${m}`);
const step = (m) => console.log(`\n▸ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);

function die(message, hint) {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

/** Runs a command, returning stdout. Throws with the child's stderr attached. */
function run(command, commandArgs, { quiet = false } = {}) {
  try {
    return execFileSync(command, commandArgs, {
      cwd: root,
      encoding: "utf8",
      stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    });
  } catch (error) {
    const detail = (error.stderr || error.stdout || error.message || "").toString().trim();
    const failure = new Error(detail);
    failure.code = error.status;
    throw failure;
  }
}

/* `quiet` captures stderr instead of inheriting it. Needed wherever the
   child's error text is inspected rather than just shown -- with stderr
   inherited, `error.stderr` is null and the message is only ever
   "Command failed", which is not something to branch on. */
const supabase = (a, options) => run("npx", ["--yes", "supabase", ...a], options);

/* --------------------------------------------------------------------------
   0. Preconditions
   -------------------------------------------------------------------------- */

step("Checking you are logged in and linked");

let projects;
try {
  projects = supabase(["projects", "list", "-o", "json"], { quiet: true });
} catch (error) {
  if (/unauthor|not logged in|access token/i.test(error.message)) {
    die(
      "The Supabase CLI is not logged in.",
      "Run:  npx supabase login\n  It needs a browser, which is why it is not done here."
    );
  }
  die(`Could not reach Supabase: ${error.message}`);
}

let linked;
try {
  const rows = JSON.parse(projects);
  linked = rows.find((row) => row.linked === true);
} catch {
  die("Could not read the project list.", projects.slice(0, 300));
}

if (!linked) {
  die(
    "No project is linked to this directory.",
    "Run:  npx supabase link --project-ref <your-project-ref>\n" +
      "  It prompts for the database password you saved when creating the project."
  );
}

ok(`linked to ${linked.name} (${linked.id}) in ${linked.region}`);

if (dryRun) {
  console.log("\n--dry-run: would push migrations, write .env.local, and seed. Stopping.\n");
  process.exit(0);
}

/* --------------------------------------------------------------------------
   1. Migrations
   -------------------------------------------------------------------------- */

step("Pushing migrations");

try {
  supabase(["db", "push", "--include-all"]);
  ok("migrations applied");
} catch (error) {
  die(
    "Migration push failed.",
    `${error.message}\n\n  Nothing after this will work. Fix the error above and re-run.`
  );
}

/* --------------------------------------------------------------------------
   2. API keys -> .env.local

   The keys are written straight to the file and never printed. A secret echoed
   to a terminal ends up in scrollback, in a screen share, and in whatever is
   capturing this session's output.
   -------------------------------------------------------------------------- */

step("Reading API keys and writing .env.local");

let keys;
try {
  keys = JSON.parse(
    supabase(["projects", "api-keys", "--project-ref", linked.id, "--reveal", "-o", "json"], {
      quiet: true,
    })
  );
} catch (error) {
  die("Could not read the project's API keys.", error.message);
}

const findKey = (...names) => {
  for (const name of names) {
    const row = keys.find((k) => k.name === name || k.type === name);
    if (row?.api_key) return row.api_key;
  }
  return null;
};

/* Supabase is mid-rename: legacy projects expose `anon` / `service_role`,
   newer ones `publishable` / `secret`. Accept either rather than assuming. */
const anonKey = findKey("anon", "publishable");
const serviceKey = findKey("service_role", "secret");

if (!anonKey) die("No anon/publishable key came back.", "Check the project's API settings page.");
if (!serviceKey) die("No service_role/secret key came back.", "Check the project's API settings page.");

const url = `https://${linked.id}.supabase.co`;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mobile-3dprint-shop.vercel.app";

const envPath = join(root, ".env.local");

/* An existing .env.local is preserved, not clobbered: it may hold a real
   NEXT_PUBLIC_SITE_URL or a value added by hand. Only the four keys this
   script owns are replaced. */
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const owned = {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  NEXT_PUBLIC_SITE_URL: siteUrl,
};

const lines = existing ? existing.split(/\r?\n/) : [];
for (const [name, value] of Object.entries(owned)) {
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index >= 0) lines[index] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
}

const header = existing
  ? ""
  : "# Written by scripts/finish-setup.mjs. Gitignored.\n" +
    "# SUPABASE_SERVICE_ROLE_KEY bypasses row-level security completely --\n" +
    "# server-side only, and never prefixed NEXT_PUBLIC_.\n";

writeFileSync(envPath, header + lines.filter(Boolean).join("\n") + "\n", "utf8");

ok(`.env.local written — url + 3 keys (values not printed)`);
warn("the same four values must also go into Vercel, then redeploy");

/* --------------------------------------------------------------------------
   3. Catalogue
   -------------------------------------------------------------------------- */

if (skipSeed) {
  step("Skipping the catalogue load (--skip-seed)");
} else {
  step("Loading the catalogue");
  try {
    run("node", ["scripts/seed-supabase.mjs"]);
  } catch (error) {
    warn("seeding did not complete:");
    console.error(`    ${error.message.split("\n").slice(0, 6).join("\n    ")}`);
    warn("the schema is fine; re-run 'node scripts/seed-supabase.mjs' once resolved");
  }
}

/* --------------------------------------------------------------------------
   4. Check it
   -------------------------------------------------------------------------- */

step("Checking the result");

/** The public settings endpoint tells you what is really enabled. */
try {
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
  const settings = await response.json();
  if (settings?.external?.google) ok("Google sign-in is enabled");
  else warn("Google sign-in is NOT enabled yet — docs/SETUP.md §2. Without it there is no way into the manager.");
} catch {
  warn("could not read the auth settings endpoint");
}

try {
  const response = await fetch(`${url}/rest/v1/products?select=id&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (response.ok) ok(`the catalogue reads back as an anonymous visitor (${response.status})`);
  else warn(`anonymous read returned ${response.status} — check migration 002 applied`);
} catch {
  warn("could not reach the REST endpoint");
}

/* The other direction, and the one that was missing the first time this ran.
   Revoking from PUBLIC in migration 002 also stripped `service_role`, because
   PUBLIC was the only route it had to these tables — so the storefront worked
   perfectly while every write was dead. Migration 006 fixes it; this makes
   sure it stays fixed. PLAYBOOK.md §1.7. */
try {
  const response = await fetch(`${url}/rest/v1/products?select=id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (response.ok) {
    ok("the server role can reach the tables — writes will work");
  } else {
    const body = await response.json().catch(() => ({}));
    console.error(
      [
        "",
        `✖ The service role cannot read the catalogue (${response.status}).`,
        `  ${body.message ?? ""}`,
        "  Every write path is dead, even though the public site works.",
        "  Check migration 006 applied. PLAYBOOK.md §1.7.",
      ].join("\n")
    );
    process.exit(1);
  }
} catch {
  warn("could not test the server role's access");
}

/* An anonymous WRITE must fail. This is the check worth having: it is the one
   that catches a grant nobody meant to give. PLAYBOOK.md #1.2 was found
   exactly this way — by re-testing live rather than trusting the migration. */
try {
  const response = await fetch(`${url}/rest/v1/products`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name_he: "should not be possible", price_agorot: 1 }),
  });
  if (response.ok) {
    console.error(
      "\n✖ SECURITY: an anonymous INSERT into products SUCCEEDED.\n" +
        "  Migration 002 has not applied, or a grant was added since.\n" +
        "  Do not deploy. Run scripts/audit-security.sql and fix before going further."
    );
    process.exit(1);
  }
  ok(`an anonymous write is refused (${response.status}) — as it must be`);
} catch {
  warn("could not test the anonymous write path");
}

/* An anonymous READ of orders must fail too, which is a stronger claim than
   the one above and worth testing separately. Every other table in this schema
   grants `anon` SELECT; `orders` grants nothing at all, because it holds a
   customer's name and phone number. A default-privileges slip on a future
   migration would show up here and nowhere else. Migration 007. */
try {
  const response = await fetch(`${url}/rest/v1/orders?select=id&limit=1`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });

  if (response.ok) {
    console.error(
      "\n✖ SECURITY: orders are readable anonymously.\n" +
        "  That table holds customer names and phone numbers and must grant\n" +
        "  nothing to any client role. Run scripts/audit-security.sql §2 and\n" +
        "  fix before going further. Do not deploy."
    );
    process.exit(1);
  }

  if (response.status === 404) {
    warn("orders table not found — migration 007 has not been applied yet");
  } else {
    ok(`orders are not readable anonymously (${response.status}) — as they must not be`);
  }
} catch {
  warn("could not test anonymous access to orders");
}

console.log(`
Done. What is left, and only you can do it:

  1. Google OAuth client + enable Google in the Supabase dashboard
     docs/SETUP.md §2 has the exact redirect URI.
  2. Put the four variables from .env.local into Vercel (Production AND
     Preview), then redeploy. Vercel does not pick up new variables until the
     next build.
  3. Set the Bit payment link in the manager's Settings screen.

  Then, and only once the deployed site is confirmed working, merge to main.
  The truck's QR code points at GitHub Pages, which is served from main --
  see docs/TOMORROW.md.
`);
