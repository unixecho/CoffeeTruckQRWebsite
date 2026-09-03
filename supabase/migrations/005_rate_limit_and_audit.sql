-- ===========================================================================
-- 005 — rate limiting and the audit trail
--
-- Both are copied into the first migration of every project rather than added
-- later under pressure. PLAYBOOK.md §1.4 / §1.5: "we'll add retention later"
-- reliably becomes "we never did".
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Rate limiting
--
-- Postgres-backed, not in-memory. An in-memory counter is a false sense of
-- security on Vercel: concurrent requests land on different instances with
-- different memory, so the limit is really "N per instance per window", which
-- is not a limit. One row per key, one atomic upsert.
-- ---------------------------------------------------------------------------

create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0
);

create index rate_limits_window_idx on public.rate_limits (window_start);

/**
 * Returns true when the call is allowed, false when the window is saturated.
 *
 * The window is fixed rather than sliding — cruder, but it is one row and one
 * statement, and the failure mode (a burst straddling a boundary gets up to
 * 2× the limit) does not matter for what this guards.
 */
create or replace function public.check_rate_limit(
  p_key            text,
  p_max            int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count int;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else public.rate_limits.count + 1
        end,
        window_start = case
          when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else public.rate_limits.window_start
        end
  returning count into current_count;

  return current_count <= p_max;
end;
$$;

-- This one DOES take parameters, and a caller could pass p_max = 1000000 to
-- make it always return true. So it is service-role only: the API routes call
-- it, no client role may. PLAYBOOK.md §1.1 / §1.2.
revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;

revoke all on public.rate_limits from public, anon, authenticated;
alter table public.rate_limits enable row level security;
-- RLS on, no policies, no grants — two independent locks.

-- ---------------------------------------------------------------------------
-- Audit trail
--
-- Every catalogue write records who did it and what changed. This is a small
-- shop, so the point is not compliance — it is answering "why is this ₪10 now"
-- three weeks later without having to guess.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id         bigserial primary key,
  actor_id   uuid references auth.users (id) on delete set null,
  actor_email text,
  action     text not null check (action in ('create', 'update', 'delete')),
  entity     text not null,
  entity_id  uuid,
  -- Enough to reconstruct the change, not a full row copy.
  changes    jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_entity_idx  on public.audit_log (entity, entity_id);

revoke all on public.audit_log from public, anon, authenticated;
revoke all on sequence public.audit_log_id_seq from public, anon, authenticated;
alter table public.audit_log enable row level security;
-- Read goes through the service role in the manager's own screen. No client
-- policy: the log holds owner email addresses.

-- ---------------------------------------------------------------------------
-- Retention
--
-- Two tables here collect rows automatically and would otherwise grow
-- forever. Retention is decided at design time, alongside the schema, because
-- it never gets retrofitted. PLAYBOOK.md §1.4.
--
--   rate_limits — spent windows are worthless the second they expire.
--   audit_log   — 24 months. Long enough to answer a pricing question a year
--                 later; short enough that a log of who-did-what does not
--                 become an indefinite record of one person's working hours.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_expired_rows()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.audit_log   where created_at   < now() - interval '24 months';
end;
$$;

revoke execute on function public.cleanup_expired_rows() from public, anon, authenticated;

-- pg_cron ships with Supabase but is not enabled by default.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('coffee-truck-cleanup')
    where exists (select 1 from cron.job where jobname = 'coffee-truck-cleanup');

  perform cron.schedule(
    'coffee-truck-cleanup',
    '17 3 * * *', -- 03:17 daily; off the hour so it does not queue behind
                  -- every other cron job in the region
    $cron$select public.cleanup_expired_rows()$cron$
  );
exception
  when insufficient_privilege or undefined_file then
    -- Some plans and local dev stacks cannot create the extension. The
    -- cleanup function still exists and can be called by hand; this is the
    -- one thing here worth degrading rather than failing the migration for.
    raise notice 'pg_cron unavailable — schedule cleanup_expired_rows() manually';
end;
$$;
