-- ===========================================================================
-- 003 — who may run the shop
--
-- Google sign-in is open to any Google account, so being *authenticated* says
-- nothing about being *authorized*. A row in `owners` is what authorizes, and
-- it is created only two ways:
--
--   1. The bootstrap address below, on its first sign-in. One address, set
--      once, so the shop has an owner before anyone can invite anyone.
--   2. An invite created by an existing owner, claimed when that person first
--      signs in with the matching Google address.
--
-- There is no self-service path in. Someone who signs in without either lands
-- on /no-access, which explains why and gives them a phone number.
-- ===========================================================================

create table public.owners (
  auth_user_id uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  -- Coarse on purpose: this is a two-person stand, not a company.
  -- `owner` may do everything; `staff` may only change stock and availability.
  role         text not null default 'owner' check (role in ('owner', 'staff')),
  display_name text check (length(display_name) <= 80),
  created_at   timestamptz not null default now()
);

create table public.owner_invites (
  email      text primary key check (position('@' in email) > 1),
  role       text not null default 'staff' check (role in ('owner', 'staff')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bootstrap
--
-- The first owner cannot be invited, because there is nobody to invite them.
-- This address is granted on first sign-in and nowhere else. Change it here
-- and re-run if the shop changes hands; it is deliberately not a setting the
-- manager UI can edit, since an editable bootstrap is just a back door with
-- extra steps.
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_owner_email()
returns text
language sql
immutable
as $$
  select 'nikolsburgj@gmail.com'::text;
$$;

revoke execute on function public.bootstrap_owner_email() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_owner_access()
--
-- Called once per sign-in, from middleware, only when the caller has no owners
-- row yet. Links the bootstrap address or a pending invite to the now-known
-- auth user id, and returns the granted role (or null).
--
-- SECURITY DEFINER because it writes to a table no client role may touch. It
-- is safe to expose to `authenticated` because it takes **no parameters** and
-- reads the caller's identity from `auth.uid()` / `auth.jwt()` — there is
-- nothing to pass in and therefore nothing to forge. PLAYBOOK.md §1.1.
-- ---------------------------------------------------------------------------

create or replace function public.claim_owner_access()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id    uuid := auth.uid();
  caller_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  granted      text;
begin
  if caller_id is null or caller_email = '' then
    return null;
  end if;

  -- Google is the only provider configured, and it only ever issues a token
  -- for a verified address. Checking anyway means a future provider cannot
  -- quietly turn "types the owner's address" into "is the owner".
  if coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false) is not true then
    return null;
  end if;

  select role into granted from public.owners where auth_user_id = caller_id;
  if granted is not null then
    return granted;
  end if;

  if caller_email = lower(public.bootstrap_owner_email()) then
    granted := 'owner';
  else
    select role into granted from public.owner_invites where lower(email) = caller_email;
    if granted is null then
      return null;
    end if;
  end if;

  insert into public.owners (auth_user_id, email, role, display_name)
  values (
    caller_id,
    caller_email,
    granted,
    nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', '')), '')
  )
  -- A second concurrent sign-in must not error out the first.
  on conflict (auth_user_id) do update set email = excluded.email
  returning role into granted;

  delete from public.owner_invites where lower(email) = caller_email;

  return granted;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and every role
-- inherits what PUBLIC holds — so this revoke has to name PUBLIC explicitly or
-- it does nothing. PLAYBOOK.md §1.2.
revoke execute on function public.claim_owner_access() from public, anon, authenticated;
grant  execute on function public.claim_owner_access() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

revoke all on public.owners        from public, anon, authenticated;
revoke all on public.owner_invites from public, anon, authenticated;

-- A signed-in person may read their own owners row and nothing else — that is
-- how middleware learns their role. `owner_invites` stays entirely private:
-- it is a list of email addresses, and no client ever needs to read it (the
-- manager's staff screen goes through the service role).
grant select on public.owners to authenticated;

alter table public.owners        enable row level security;
alter table public.owner_invites enable row level security;

create policy owners_read_self on public.owners
  for select to authenticated
  using (auth_user_id = auth.uid());

-- `owner_invites` has RLS enabled and deliberately no policies at all. With
-- the grants revoked above that is two independent locks, not one.
