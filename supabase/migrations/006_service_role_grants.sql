-- ===========================================================================
-- 006 — give service_role its grants back
--
-- Fixes a real bug introduced by 002. Symptom: every write path was dead —
-- `permission denied for table <anything>` (SQLSTATE 42501) for the seed
-- script and for every manager API route.
--
-- ## What went wrong
--
-- 002 opens with, for each table:
--
--     revoke all on public.categories from public, anon, authenticated;
--
-- Naming `public` there is correct and deliberate — it is the fix for
-- PLAYBOOK §1.2, where revoking from `anon` alone does nothing because every
-- role inherits whatever the PUBLIC pseudo-role holds.
--
-- But that cuts both ways. `service_role` is also a role, and it also inherits
-- from PUBLIC. On a project where new tables are not auto-exposed — which is
-- the current Supabase default, and which `supabase/config.toml` deliberately
-- keeps by leaving `auto_expose_new_tables` unset — PUBLIC was the *only*
-- route service_role had to these tables. Revoking it took service_role's
-- access with it.
--
-- ## The assumption that caused it
--
-- "service_role bypasses RLS, so it can do anything." Half true, and the
-- dangerous half. `service_role` has the `BYPASSRLS` attribute, so **policies**
-- do not apply to it. Table **GRANTs** still do. Grants and RLS are two
-- independent layers — the whole point of PLAYBOOK §1 — and this is the same
-- distinction read from the other side: 002 got the client roles exactly right
-- and then silently locked out the server.
--
-- It was not caught earlier because the storefront reads as `anon`, which 002
-- grants correctly, so the public site worked perfectly while every write was
-- impossible.
--
-- ## Why this is safe
--
-- `service_role`'s key never reaches a browser. It lives in
-- SUPABASE_SERVICE_ROLE_KEY, server-side only, and is used exclusively by API
-- routes that have already called `requireOwner()`. Granting it full DML is
-- restoring the intended design, not widening it: the client roles keep
-- SELECT-only, and no write grant is added for `anon` or `authenticated`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tables
--
-- Written out one by one rather than `grant all on all tables in schema
-- public`, so a table added by a future migration does not silently inherit
-- server-side write access without somebody deciding it should.
-- ---------------------------------------------------------------------------

grant all on public.categories     to service_role;
grant all on public.subclasses     to service_role;
grant all on public.products       to service_role;
grant all on public.product_images to service_role;
grant all on public.pricing_rules  to service_role;
grant all on public.app_settings   to service_role;
grant all on public.owners         to service_role;
grant all on public.owner_invites  to service_role;
grant all on public.audit_log      to service_role;
grant all on public.rate_limits    to service_role;

-- `audit_log.id` is a bigserial, so the insert needs the sequence too. 002
-- revoked it from the client roles; service_role lost it the same way.
grant usage, select on sequence public.audit_log_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Functions
--
-- Same cause: 002 and 005 revoked these from PUBLIC, which is what service_role
-- was inheriting through.
--
-- `check_rate_limit` fails OPEN in the application (`withinRateLimit` in
-- lib/validate.ts logs and allows), so losing it did not break writes — it
-- silently stopped rate limiting from ever engaging, which is worse than an
-- error because nothing announces it.
-- ---------------------------------------------------------------------------

grant execute on function public.check_rate_limit(text, int, int) to service_role;
grant execute on function public.cleanup_expired_rows()            to service_role;

-- The trigger functions are invoked by the trigger mechanism rather than
-- called directly, and Postgres does not check EXECUTE on the invoking role
-- for those — but an UPDATE through PostgREST fires `touch_updated_at`, and
-- granting it costs nothing next to debugging a write that fails only on the
-- update path. Deliberately NOT granted to anon/authenticated.
grant execute on function public.touch_updated_at()                to service_role;
grant execute on function public.check_subclass_matches_category() to service_role;
grant execute on function public.check_pricing_scope_exists()      to service_role;
grant execute on function public.delete_orphaned_pricing_rules()   to service_role;

-- ---------------------------------------------------------------------------
-- And for anything created from here on.
--
-- 002 set the default privileges to revoke from anon and authenticated, which
-- is right and stays. This adds the matching positive default for the server
-- role, so the next table does not reproduce this bug.
-- ---------------------------------------------------------------------------

alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- ---------------------------------------------------------------------------
-- Guard rail.
--
-- Re-assert the thing that actually matters, so this migration can never be
-- read as "we opened everything up". If a later edit hands a client role a
-- write grant, `scripts/audit-security.sql` §2 will show it — and so will the
-- anonymous-write check in `scripts/finish-setup.mjs`.
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.categories     from anon, authenticated;
revoke insert, update, delete on public.subclasses     from anon, authenticated;
revoke insert, update, delete on public.products       from anon, authenticated;
revoke insert, update, delete on public.product_images from anon, authenticated;
revoke insert, update, delete on public.pricing_rules  from anon, authenticated;
revoke insert, update, delete on public.app_settings   from anon, authenticated;
