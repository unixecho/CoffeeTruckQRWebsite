-- ===========================================================================
-- 001 — the catalogue
--
-- Three levels: category → subclass → product. The middle level exists because
-- bundle deals are sold per subclass ("any three small keychains for ₪25"),
-- which is wider than a product and narrower than a category.
--
-- Grants and RLS are deliberately NOT in this file. Supabase's
-- ALTER DEFAULT PRIVILEGES hands ALL on every new public table to anon and
-- authenticated, so a table is wide open between being created here and being
-- locked down in 002. Both migrations always ship together; 002 is where the
-- default-deny happens. See PLAYBOOK.md §1.5.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Keeps updated_at honest without every writer having to remember it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- Hebrew is the primary language and is required; the other two are
  -- optional and fall back to it in the app. A product the owner has not
  -- translated yet must still be sellable.
  name_he     text not null check (length(btrim(name_he)) between 1 and 80),
  name_en     text check (length(name_en) <= 80),
  name_ar     text check (length(name_ar) <= 80),

  -- A key into CATEGORY_ICONS / CATEGORY_TINTS in src/lib/categoryIcons.ts,
  -- not a component and not a hex value, so the choice survives the round trip.
  icon        text not null default 'Package',
  tint        text not null default 'gray',

  sort_order  int  not null default 0,
  -- Hiding a category keeps its products; it just leaves the storefront.
  visible     boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index categories_visible_sort_idx on public.categories (visible, sort_order);

create trigger categories_touch
  before update on public.categories
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Subclasses
-- ---------------------------------------------------------------------------

create table public.subclasses (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete cascade,
  slug        text not null
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  name_he     text not null check (length(btrim(name_he)) between 1 and 80),
  name_en     text check (length(name_en) <= 80),
  name_ar     text check (length(name_ar) <= 80),

  sort_order  int not null default 0,
  visible     boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Slugs are unique within a category, not globally: "small" is a reasonable
  -- subclass of both keychains and magnets.
  unique (category_id, slug)
);

create index subclasses_category_idx on public.subclasses (category_id, visible, sort_order);

create trigger subclasses_touch
  before update on public.subclasses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories (id) on delete restrict,
  -- Null means the product hangs directly off its category. Deleting a
  -- subclass must not delete the things in it — the owner is reorganising,
  -- not throwing stock away — so this nulls out instead of cascading.
  subclass_id  uuid references public.subclasses (id) on delete set null,

  slug         text not null unique
                 check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  name_he      text not null check (length(btrim(name_he)) between 1 and 120),
  name_en      text check (length(name_en) <= 120),
  name_ar      text check (length(name_ar) <= 120),

  description_he text check (length(description_he) <= 2000),
  description_en text check (length(description_en) <= 2000),
  description_ar text check (length(description_ar) <= 2000),

  -- Agorot. Integer, never a float: a till that is off by an agora is a till
  -- nobody trusts. Capped at ₪10,000 so a slipped decimal point is caught
  -- here rather than at the counter.
  price_agorot int not null check (price_agorot >= 0 and price_agorot <= 1000000),

  -- Offered at all. Distinct from stock: a design no longer printed is
  -- unavailable, whereas one that merely sold out today has stock = 0.
  available    boolean not null default true,
  -- Null means "not counted", which is the common case at a market stand.
  stock        int check (stock is null or stock >= 0),

  sort_order   int not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_category_idx on public.products (category_id, sort_order);
create index products_subclass_idx on public.products (subclass_id);
create index products_available_idx on public.products (available) where available;

create trigger products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();

-- A product's subclass must belong to its own category. Nothing in the UI
-- offers a mismatched pair, but "nothing in the UI offers it" is not a
-- constraint — a bad row here would silently break bundle grouping.
create or replace function public.check_subclass_matches_category()
returns trigger
language plpgsql
as $$
declare
  parent uuid;
begin
  if new.subclass_id is null then
    return new;
  end if;

  select category_id into parent from public.subclasses where id = new.subclass_id;

  if parent is null or parent <> new.category_id then
    raise exception 'subclass % does not belong to category %', new.subclass_id, new.category_id;
  end if;

  return new;
end;
$$;

create trigger products_subclass_matches_category
  before insert or update of category_id, subclass_id on public.products
  for each row execute function public.check_subclass_matches_category();

-- ---------------------------------------------------------------------------
-- Product images
-- ---------------------------------------------------------------------------

create table public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  -- A Supabase Storage object path, or a `/products/...` path for the photos
  -- seeded from the old static site.
  path        text not null check (length(path) between 1 and 500),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index product_images_product_idx on public.product_images (product_id, sort_order);

-- ---------------------------------------------------------------------------
-- Pricing rules
--
-- One rung of a bundle ladder. Rules do not have to nest or agree with each
-- other — src/lib/pricing.ts finds the cheapest combination of whatever
-- exists, so the owner can add "3 for ₪25" today and "5 for ₪35" next week
-- without checking the arithmetic.
--
-- scope_id is an untyped uuid rather than three nullable foreign keys, because
-- a rule points at exactly one of three different tables. The trigger below
-- does the referential integrity a FK cannot.
-- ---------------------------------------------------------------------------

create table public.pricing_rules (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('product', 'subclass', 'category')),
  scope_id     uuid not null,

  -- A "bundle" of one is just the base price; the app ignores those, and
  -- there is no reason to let one into the table.
  min_qty      int not null check (min_qty between 2 and 999),
  price_agorot int not null check (price_agorot >= 0 and price_agorot <= 1000000),

  active       boolean not null default true,
  starts_at    timestamptz,
  ends_at      timestamptz,
  check (starts_at is null or ends_at is null or starts_at < ends_at),

  -- Optional shout line shown on the card: "מבצע סוף עונה".
  label_he     text check (length(label_he) <= 80),
  label_en     text check (length(label_en) <= 80),
  label_ar     text check (length(label_ar) <= 80),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Two live rungs for the same count on the same thing is a mistake, not a
  -- feature. The app would show both and charge the cheaper.
  unique (scope, scope_id, min_qty)
);

create index pricing_rules_scope_idx on public.pricing_rules (scope, scope_id) where active;

create trigger pricing_rules_touch
  before update on public.pricing_rules
  for each row execute function public.touch_updated_at();

create or replace function public.check_pricing_scope_exists()
returns trigger
language plpgsql
as $$
declare
  found boolean;
begin
  case new.scope
    when 'product'  then select exists(select 1 from public.products   where id = new.scope_id) into found;
    when 'subclass' then select exists(select 1 from public.subclasses where id = new.scope_id) into found;
    when 'category' then select exists(select 1 from public.categories where id = new.scope_id) into found;
  end case;

  if not found then
    raise exception 'pricing rule scope % % does not exist', new.scope, new.scope_id;
  end if;

  return new;
end;
$$;

create trigger pricing_rules_scope_exists
  before insert or update of scope, scope_id on public.pricing_rules
  for each row execute function public.check_pricing_scope_exists();

-- A pricing rule must not outlive the thing it prices. There is no FK to
-- hang this off, so each parent sweeps its own rules on the way out.
create or replace function public.delete_orphaned_pricing_rules()
returns trigger
language plpgsql
as $$
begin
  delete from public.pricing_rules
   where scope = tg_argv[0] and scope_id = old.id;
  return old;
end;
$$;

create trigger products_sweep_pricing_rules
  after delete on public.products
  for each row execute function public.delete_orphaned_pricing_rules('product');

create trigger subclasses_sweep_pricing_rules
  after delete on public.subclasses
  for each row execute function public.delete_orphaned_pricing_rules('subclass');

create trigger categories_sweep_pricing_rules
  after delete on public.categories
  for each row execute function public.delete_orphaned_pricing_rules('category');

-- ---------------------------------------------------------------------------
-- Shop settings — business rules the owner changes without a deploy.
-- ---------------------------------------------------------------------------

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

insert into public.app_settings (key, value) values
  ('shop_open',        'true'::jsonb),
  ('closed_message',   '{"he":"סגור כרגע — נתראה בקרוב!","en":"Closed right now — see you soon!","ar":"مغلق حالياً — نراكم قريباً!"}'::jsonb),
  ('bit_payment_link', '""'::jsonb),
  ('whatsapp_phone',   '"972549109603"'::jsonb),
  ('announcement',     'null'::jsonb)
on conflict (key) do nothing;
