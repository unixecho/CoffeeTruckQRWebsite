-- ===========================================================================
-- 002 — grants and row-level security
--
-- Default-deny, then open exactly what is needed. This file exists separately
-- from 001 because Supabase's ALTER DEFAULT PRIVILEGES hands ALL on every new
-- public table to anon and authenticated the moment it is created; without
-- this migration the catalogue would be world-writable. PLAYBOOK.md §1.5.
--
-- The shape of the model:
--
--   anon / authenticated   read the visible catalogue. Nothing more.
--   service_role           everything, and only from an API route that has
--                          already checked the caller is an owner.
--
-- No client role holds a write grant on ANY table. That is not belt-and-braces
-- — RLS scopes rows, not columns, so a table-level UPDATE grant on `products`
-- would let a signed-in visitor rewrite a price even under a perfectly correct
-- row policy. PLAYBOOK.md §1.3. Writes go through `src/app/api/manager/*`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Step 1 — take everything away.
-- ---------------------------------------------------------------------------

revoke all on public.categories     from public, anon, authenticated;
revoke all on public.subclasses     from public, anon, authenticated;
revoke all on public.products       from public, anon, authenticated;
revoke all on public.product_images from public, anon, authenticated;
revoke all on public.pricing_rules  from public, anon, authenticated;
revoke all on public.app_settings   from public, anon, authenticated;

-- Trigger functions are called by the engine as the table owner, never by a
-- client. Postgres grants EXECUTE on a new function to PUBLIC automatically,
-- and every role inherits whatever PUBLIC holds — so revoking from anon alone
-- would do nothing at all. PLAYBOOK.md §1.2.
revoke execute on function public.touch_updated_at()                from public, anon, authenticated;
revoke execute on function public.check_subclass_matches_category() from public, anon, authenticated;
revoke execute on function public.check_pricing_scope_exists()      from public, anon, authenticated;
revoke execute on function public.delete_orphaned_pricing_rules()   from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Step 2 — give back read, and only read.
-- ---------------------------------------------------------------------------

grant select on public.categories     to anon, authenticated;
grant select on public.subclasses     to anon, authenticated;
grant select on public.products       to anon, authenticated;
grant select on public.product_images to anon, authenticated;
grant select on public.pricing_rules  to anon, authenticated;
grant select on public.app_settings   to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Step 3 — RLS, as the second independent lock.
--
-- Grants answer "may this role touch the table at all"; policies answer "which
-- rows, once it can". Both are needed: the realistic failure mode is somebody
-- adding a policy while debugging, which opens nothing extra only because the
-- grant is also missing.
-- ---------------------------------------------------------------------------

alter table public.categories     enable row level security;
alter table public.subclasses     enable row level security;
alter table public.products       enable row level security;
alter table public.product_images enable row level security;
alter table public.pricing_rules  enable row level security;
alter table public.app_settings   enable row level security;

-- service_role bypasses RLS by design, so these policies constrain only the
-- public storefront.

create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (visible);

create policy subclasses_public_read on public.subclasses
  for select to anon, authenticated
  using (
    visible
    and exists (
      select 1 from public.categories c
       where c.id = subclasses.category_id and c.visible
    )
  );

-- A product is visible only if its whole chain is. Hiding a category must
-- actually hide what is in it — otherwise the products keep answering direct
-- queries and the storefront leaks a category the owner took down.
create policy products_public_read on public.products
  for select to anon, authenticated
  using (
    available
    and exists (
      select 1 from public.categories c
       where c.id = products.category_id and c.visible
    )
    and (
      products.subclass_id is null
      or exists (
        select 1 from public.subclasses s
         where s.id = products.subclass_id and s.visible
      )
    )
  );

create policy product_images_public_read on public.product_images
  for select to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_images.product_id)
  );

-- Pricing rules are readable so the storefront can render the ladder and
-- compute a live total. They carry no margin data — only what a customer is
-- told at the counter anyway.
create policy pricing_rules_public_read on public.pricing_rules
  for select to anon, authenticated
  using (active);

-- Settings are a mixed bag, so this is an allowlist rather than a blanket
-- read. A key added later is private until somebody deliberately adds it here.
create policy app_settings_public_read on public.app_settings
  for select to anon, authenticated
  using (key in ('shop_open', 'closed_message', 'bit_payment_link', 'whatsapp_phone', 'announcement'));

-- ---------------------------------------------------------------------------
-- Step 4 — stop the next table being open by accident.
--
-- Anything created in `public` from here on starts with no client privileges
-- at all, so a future migration that forgets to think about grants fails
-- closed instead of open.
-- ---------------------------------------------------------------------------

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
