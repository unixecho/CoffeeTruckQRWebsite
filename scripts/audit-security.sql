-- ===========================================================================
-- Security audit
--
-- Paste into the Supabase dashboard's SQL editor and run the whole file.
-- Run it before the first deploy, and again whenever a migration adds a table,
-- a view, or a function.
--
-- Adapted from PLAYBOOK.md §1.6. Each query below says what a BAD row looks
-- like, so the answer is readable without knowing Postgres' grant model.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. SECURITY DEFINER functions — who can call them?
--
-- These run as the function's owner and bypass row-level security, so who may
-- execute one is the whole question.
--
-- BAD: any row where `public_exec` or `anon_exec` is true.
--
--   `public_exec` is the one people miss. Postgres grants EXECUTE to the
--   PUBLIC pseudo-role on every newly created function, and every real role
--   inherits whatever PUBLIC holds — so "revoke from anon" does nothing at all
--   while PUBLIC still has it. This is exactly the bug PLAYBOOK §1.2 records.
--
-- EXPECTED for this project:
--   claim_owner_access     anon:f  auth:t  public:f   ← intentional; no params
--   check_rate_limit       anon:f  auth:f  public:f
--   cleanup_expired_rows   anon:f  auth:f  public:f
--   bootstrap_owner_email  anon:f  auth:f  public:f
--   the trigger functions  all f              ← called by the engine, not clients
-- ---------------------------------------------------------------------------

select
  p.proname                                                  as function_name,
  pg_get_function_identity_arguments(p.oid)                  as args,
  has_function_privilege('anon',          p.oid, 'EXECUTE')  as anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_exec,
  has_function_privilege('public',        p.oid, 'EXECUTE')  as public_exec
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosecdef = true
order by public_exec desc, anon_exec desc, p.proname;


-- ---------------------------------------------------------------------------
-- 2. Table and view grants.
--
-- BAD: any `true` in an insert/update/delete column, for either client role.
--
--   This project grants client roles SELECT and nothing else — every write
--   goes through an owner-checked API route using the service role. RLS scopes
--   *rows*, not *columns*, so a table-level UPDATE grant on `products` would
--   let a signed-in visitor rewrite a price under a perfectly correct row
--   policy (PLAYBOOK §1.3).
--
-- ALSO BAD: `is_updatable = YES` on a view, combined with any write grant.
--   A single-table view with no joins is automatically updatable in standard
--   SQL, so a blanket grant on it writes straight through to the base table.
--
-- EXPECTED: select true only on categories, subclasses, products,
--   product_images, pricing_rules, app_settings, and owners (authenticated
--   only). Everything else false everywhere. No views exist.
-- ---------------------------------------------------------------------------

select
  t.table_name,
  has_table_privilege('anon',          'public.' || t.table_name, 'SELECT') as anon_select,
  has_table_privilege('anon',          'public.' || t.table_name, 'INSERT') as anon_insert,
  has_table_privilege('anon',          'public.' || t.table_name, 'UPDATE') as anon_update,
  has_table_privilege('anon',          'public.' || t.table_name, 'DELETE') as anon_delete,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'SELECT') as auth_select,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'INSERT') as auth_insert,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'UPDATE') as auth_update,
  has_table_privilege('authenticated', 'public.' || t.table_name, 'DELETE') as auth_delete,
  coalesce(v.is_updatable, 'n/a')                                          as is_updatable,
  coalesce(v.is_insertable_into, 'n/a')                                    as is_insertable_into
from information_schema.tables t
left join information_schema.views v
  on v.table_schema = t.table_schema and v.table_name = t.table_name
where t.table_schema = 'public'
order by anon_update desc, anon_insert desc, anon_delete desc, t.table_name;


-- ---------------------------------------------------------------------------
-- 3. Is row-level security actually on?
--
-- BAD: `rls_enabled = false` on any table.
--
--   Grants and RLS are two independent locks and both are wanted. The
--   realistic failure is somebody adding a policy while debugging, which then
--   opens nothing extra only because the grant is also missing.
--
-- NOTE: `policy_count = 0` is CORRECT for owner_invites, rate_limits and
--   audit_log. Those are service-role-only: RLS on with no policies means no
--   client can read a single row, which is the intent.
-- ---------------------------------------------------------------------------

select
  c.relname                                             as table_name,
  c.relrowsecurity                                      as rls_enabled,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;


-- ---------------------------------------------------------------------------
-- 4. What the policies actually say.
--
-- Read the `using` expressions. Every storefront policy should constrain
-- visibility through the whole chain — a product is readable only if its
-- category is visible too, or hiding a category leaks what is inside it.
-- ---------------------------------------------------------------------------

select tablename, policyname, roles, cmd, qual as using_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ---------------------------------------------------------------------------
-- 5. Storage.
--
-- BAD: any policy on storage.objects for the product-photos bucket with a cmd
--   other than SELECT. Uploads go through the API route, which generates the
--   object key itself and sniffs the file's magic bytes — a client-side write
--   policy would mean trusting a browser to name its own file.
-- ---------------------------------------------------------------------------

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'product-photos';

select policyname, roles, cmd, qual as using_expression
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by cmd, policyname;


-- ---------------------------------------------------------------------------
-- 6. Retention is actually scheduled.
--
-- BAD: no row. `rate_limits` and `audit_log` both accumulate automatically and
--   would otherwise grow forever. If pg_cron was unavailable when 005 ran, the
--   migration logged a notice and carried on — in that case schedule
--   `cleanup_expired_rows()` another way, or call it by hand periodically.
-- ---------------------------------------------------------------------------

select jobname, schedule, command, active
from cron.job
where jobname = 'coffee-truck-cleanup';


-- ---------------------------------------------------------------------------
-- 7. Who has access to the manager.
--
-- Should be exactly the people you expect. `owner_invites` rows are pending —
-- they become access on that person's first Google sign-in.
-- ---------------------------------------------------------------------------

select email, role, created_at from public.owners        order by created_at;
select email, role, created_at from public.owner_invites order by created_at;
