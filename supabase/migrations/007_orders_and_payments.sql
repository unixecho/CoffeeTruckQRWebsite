-- ===========================================================================
-- 007 — orders and payments
--
-- The first tables in this project that hold anything about a customer, and
-- the first write path that a stranger can reach without signing in. Both
-- facts drive most of the decisions below; neither applied to 001–006.
--
-- ## What changes about the security model
--
-- Nothing weakens. The rule stays exactly what `002` established: **no client
-- role holds a write grant on any table, and here not a read grant either.**
-- An order carries a name and a phone number, so `anon` cannot select from it
-- at all — the customer's own device reads its order through
-- `/api/checkout/[token]`, server-side, with a bearer token, which is a much
-- narrower hole than a row policy over a table.
--
-- Note the order of the GRANT/REVOKE blocks at the bottom. Revoking from
-- `public` also strips `service_role`, because `service_role` inherits from
-- the PUBLIC pseudo-role like every other role does — that is the bug 006
-- exists to fix, and reproducing it here would take every write path down
-- while the storefront kept working perfectly. Revoke first, then grant the
-- server role back explicitly. PLAYBOOK §1.7.
--
-- ## Why the order token is stored hashed
--
-- The token in `/checkout/<token>` is a bearer credential: whoever has it can
-- read the order. It lands in browser history and, on a shared phone at a
-- market stand, in front of the next person. Storing the SHA-256 instead of
-- the value means the database never holds a live credential — a dump, a
-- support query, or a logged row cannot hand anyone an order. Lookup is by
-- hash, so it costs one index and nothing else.
--
-- ## Retention
--
-- Decided here, at design time, with the schema — not "later", which
-- reliably becomes never (PLAYBOOK §1.4). Two different treatments, because
-- the two things age differently:
--
--   the identifying columns (name, phone)  cleared after 90 days
--   the order row itself                   deleted after 24 months
--
-- Both are function parameters rather than literals in the job, so they can
-- move without a migration. ⚠ The owner should confirm the second number
-- with an accountant once registered as an עוסק פטור: Israeli bookkeeping
-- rules govern how long a record of a sale must be kept, and they, not this
-- file, decide the floor. The numbers here are a reasoned default, not
-- advice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Order numbers
--
-- A short integer the owner calls out across the truck. Deliberately not the
-- uuid: nobody shouts a uuid. Deliberately not random either — it has to be
-- readable aloud and comparable at a glance, and a sequence gives that for
-- free. It leaks how many orders the stand has taken, which for a coffee
-- truck is not a secret; it is called out loud all day.
-- ---------------------------------------------------------------------------

create sequence if not exists public.order_number_seq as int start with 1 increment by 1;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      int  not null unique default nextval('public.order_number_seq'),

  -- SHA-256 hex of the customer's bearer token. Never the token itself.
  token_hash        text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  -- The browser generates this once per checkout attempt and re-sends it on
  -- every retry. A tethered phone drops its connection mid-request routinely;
  -- without this, the retry is a second order and the owner packs two bags.
  client_request_id uuid not null unique,

  -- Two independent lifecycles. Collapsing them into one enum is the mistake
  -- that makes every later question unanswerable — see src/lib/payments/types.ts.
  status            text not null default 'placed'
                      check (status in ('placed', 'collected', 'cancelled', 'expired')),
  payment_status    text not null default 'unpaid'
                      check (payment_status in
                        ('unpaid','pending','paid','failed','cancelled','expired','refunded','flagged')),

  payment_method    text not null check (payment_method in ('counter', 'card')),
  provider          text check (provider in ('manual', 'grow')),

  -- The provider's own handle on the payment attempt. Two columns rather than
  -- a jsonb blob, because the first one is looked up by the webhook route on
  -- every callback and an index on a jsonb path for that is work for nothing.
  provider_ref_id    text check (length(provider_ref_id) <= 200),
  provider_ref_token text check (length(provider_ref_token) <= 400),

  -- Agorot, computed server-side by priceCart against the live catalogue. A
  -- total arriving from a browser is a claim, and none of these ever come
  -- from a request body.
  total_agorot      int not null check (total_agorot >= 0 and total_agorot <= 100000000),
  baseline_agorot   int not null check (baseline_agorot >= 0),
  savings_agorot    int not null check (savings_agorot >= 0),
  -- What the provider says actually moved. Null until something does.
  paid_agorot       int check (paid_agorot is null or paid_agorot >= 0),
  currency          text not null default 'ILS' check (currency = 'ILS'),

  -- The full CartPricing breakdown as it stood at the moment of ordering, so
  -- a receipt can name the deals that produced the total. Re-deriving it
  -- later would read today's rules against yesterday's order.
  pricing           jsonb,

  -- Both optional, both anonymisable. A phone number buys the ability to call
  -- someone who wandered off; requiring one to buy a ₪25 keychain would be
  -- collecting personal data to solve a problem that shouting the order
  -- number already solves.
  customer_name     text check (customer_name is null or length(customer_name) between 1 and 60),
  customer_phone    text check (customer_phone is null or customer_phone ~ '^[0-9]{8,15}$'),
  note              text check (note is null or length(note) <= 280),
  locale            text not null default 'he' check (locale in ('he', 'en', 'ar')),

  -- An unpaid order is swept past this. The bound exists because the owner
  -- edits prices between customers, and an order that outlives an edit to its
  -- own prices is a receipt nobody can reproduce.
  expires_at        timestamptz not null,
  paid_at           timestamptz,
  collected_at      timestamptz,
  cancelled_at      timestamptz,
  -- Set when the identifying columns were cleared, by retention or at the
  -- customer's own request. Kept so the order still explains itself.
  anonymized_at     timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The manager's list: today's orders, newest first.
create index orders_created_idx on public.orders (created_at desc);
-- The manager's default filter: what still needs doing.
create index orders_open_idx on public.orders (status, created_at desc) where status = 'placed';
-- The sweeper's query. Partial, so it only walks orders that can still expire.
create index orders_expiry_idx on public.orders (expires_at)
  where status = 'placed' and payment_status in ('unpaid', 'pending', 'failed');

-- The webhook route's lookup, and a guard: two orders must never claim the
-- same payment attempt. Partial because the columns are null until a session
-- is created, and a plain unique index would then collide on nothing.
create unique index orders_provider_ref_idx on public.orders (provider, provider_ref_id)
  where provider_ref_id is not null;

create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Order items
--
-- Snapshotted, not joined. The name and the unit price are copied in at the
-- moment of ordering: the owner edits prices from her phone between
-- customers, and a receipt that silently re-reads the current price is not a
-- receipt. `product_id` nulls out rather than cascading if the product is
-- later deleted — the order has to survive that, which is the whole point of
-- snapshotting in the first place.
-- ---------------------------------------------------------------------------

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid references public.products (id) on delete set null,

  name_he          text not null check (length(btrim(name_he)) between 1 and 120),
  name_en          text check (length(name_en) <= 120),
  name_ar          text check (length(name_ar) <= 120),

  unit_price_agorot int not null check (unit_price_agorot >= 0),
  quantity          int not null check (quantity between 1 and 99),
  sort_order        int not null default 0,

  created_at        timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id, sort_order);

-- ---------------------------------------------------------------------------
-- Payment events
--
-- Every callback and every server-to-server status read, in arrival order,
-- whether or not it changed anything. This is the log that answers "the
-- customer says they paid" three days later, and it is worth more than the
-- orders table itself when that conversation happens.
--
-- `applied` and `reason` are recorded even for events that changed nothing —
-- a duplicate delivery, an illegal transition, an amount that did not
-- reconcile. An event log that only holds the events that worked is a log
-- that cannot explain the one time something did not.
-- ---------------------------------------------------------------------------

create table public.payment_events (
  id                bigserial primary key,
  order_id          uuid references public.orders (id) on delete cascade,
  provider          text not null check (provider in ('manual', 'grow')),

  -- The provider's own id for this delivery. Providers retry; a retried
  -- "paid" applied twice is a refund conversation.
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),

  kind              text not null check (kind in ('webhook', 'poll', 'manual')),
  claimed_status    text not null,
  claimed_agorot    int,

  applied           boolean not null default false,
  -- Mirrors TransitionDecision.reason in src/lib/payments/status.ts.
  reason            text not null,
  -- False is not a rejection: several providers authenticate a callback by
  -- making you read the transaction back rather than by signing it.
  signature_valid   boolean not null default false,

  -- Already redacted by `redactPayload` before it gets here. No card data can
  -- reach us — the fields live in the provider's own iframe — but a payload
  -- echoing something back is exactly the case that rule exists for.
  payload           jsonb,

  received_at       timestamptz not null default now(),

  -- The idempotency guard. A second delivery of the same event fails this
  -- and the route answers 200 without touching the order.
  unique (provider, provider_event_id)
);

create index payment_events_order_idx on public.payment_events (order_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Settings
--
-- Two switches, and they are different kinds of thing.
--
--   checkout_enabled        gates a write into live operations — an order the
--                           owner has to fulfil. Fails CLOSED in the app: if
--                           the setting cannot be read, ordering is off.
--   online_payments_enabled whether card payment is offered at all.
--
-- **Both ship false, and that is a business decision, not a default.**
--
-- This site is the mobile stand: a customer scans the QR code at the truck,
-- browses, sees a total, and pays cash or Bit at the counter, four feet away.
-- Ordering ahead is the standalone 3D Prints store's job, not this one's —
-- taking an order here would create a queue for a shop whose whole premise is
-- that the person is already standing in front of it.
--
-- The machinery is built and tested all the same, because the two stores share
-- this codebase's spine and the day either one needs it, it is a switch rather
-- than a project. Turning it on is Settings → Orders.
--
-- `online_payments_enabled` additionally cannot do anything until a Grow
-- merchant account exists, which waits on the עוסק פטור registration.
--
-- PLAYBOOK §4.1.5: a kill switch is an operational lever, not a security
-- boundary, and being honest about which decides whether it fails open.
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value) values
  ('checkout_enabled',        'false'::jsonb),
  ('online_payments_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- The public read policy in 002 is an allowlist, so a key added later is
-- private until somebody deliberately adds it. These two have to be readable:
-- the storefront decides whether to render an order button from them.
drop policy if exists app_settings_public_read on public.app_settings;
create policy app_settings_public_read on public.app_settings
  for select to anon, authenticated
  using (key in (
    'shop_open',
    'closed_message',
    'bit_payment_link',
    'whatsapp_phone',
    'announcement',
    'checkout_enabled',
    'online_payments_enabled'
  ));

-- ---------------------------------------------------------------------------
-- Expiry and retention
--
-- One function, parameterised, called by the nightly job from 005 — which is
-- redefined below to include it rather than being given a second schedule.
-- ---------------------------------------------------------------------------

create or replace function public.expire_and_age_orders(
  p_anonymize_after_days   int default 90,
  p_delete_after_months    int default 24
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 1. Sweep orders nobody paid for. Only ever touches orders that are still
  --    open AND still unsettled: a paid order past its expiry is a paid
  --    order, and the state machine revives it rather than expiring it.
  update public.orders
     set status         = 'expired',
         payment_status = case
                            when payment_status in ('unpaid', 'pending', 'failed')
                              then 'expired'
                            else payment_status
                          end
   where status = 'placed'
     and payment_status in ('unpaid', 'pending', 'failed')
     and expires_at < now();

  -- 2. Clear the identifying columns once they have stopped being useful.
  --    The order itself stays: what was sold and for how much is a business
  --    record, who bought it is not.
  update public.orders
     set customer_name  = null,
         customer_phone = null,
         anonymized_at  = now()
   where anonymized_at is null
     and created_at < now() - make_interval(days => p_anonymize_after_days)
     and (customer_name is not null or customer_phone is not null);

  -- 3. Delete outright, much later. `order_items` and `payment_events`
  --    cascade, so this is the only statement needed.
  delete from public.orders
   where created_at < now() - make_interval(months => p_delete_after_months);
end;
$$;

revoke execute on function public.expire_and_age_orders(int, int) from public, anon, authenticated;
grant  execute on function public.expire_and_age_orders(int, int) to service_role;

-- Redefined to add the orders sweep. Same name and same schedule, so the
-- pg_cron job created in 005 picks it up with no change.
create or replace function public.cleanup_expired_rows()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  delete from public.audit_log   where created_at   < now() - interval '24 months';
  perform public.expire_and_age_orders();
end;
$$;

revoke execute on function public.cleanup_expired_rows() from public, anon, authenticated;
grant  execute on function public.cleanup_expired_rows() to service_role;

-- ---------------------------------------------------------------------------
-- Grants and RLS
--
-- Order matters. The revoke names `public` — required, because every role
-- inherits what the PUBLIC pseudo-role holds and revoking from `anon` alone
-- does nothing (PLAYBOOK §1.2). That same line strips `service_role`, which
-- also inherits from PUBLIC (PLAYBOOK §1.7). So the server role is granted
-- back explicitly, immediately after, table by table.
--
-- No client grant of any kind on these three tables. Not even SELECT: an
-- order holds a name and a phone number, and the customer's own device reads
-- it through an API route holding a bearer token rather than through
-- PostgREST.
-- ---------------------------------------------------------------------------

revoke all on public.orders         from public, anon, authenticated;
revoke all on public.order_items    from public, anon, authenticated;
revoke all on public.payment_events from public, anon, authenticated;
revoke all on sequence public.payment_events_id_seq from public, anon, authenticated;
revoke all on sequence public.order_number_seq      from public, anon, authenticated;

grant all on public.orders         to service_role;
grant all on public.order_items    to service_role;
grant all on public.payment_events to service_role;
grant usage, select on sequence public.payment_events_id_seq to service_role;
grant usage, select on sequence public.order_number_seq      to service_role;

-- RLS on with no policies: the second, independent lock. The realistic
-- failure mode is somebody adding a policy while debugging, and that opens
-- nothing extra only because the grant is also missing.
alter table public.orders         enable row level security;
alter table public.order_items    enable row level security;
alter table public.payment_events enable row level security;
