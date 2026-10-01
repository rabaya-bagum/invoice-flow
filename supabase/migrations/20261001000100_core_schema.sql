-- InvoiceFlow core schema.
-- Conventions: UUID PKs, created_at/updated_at on every table, money as integer minor units
-- (bigint), tax/discount rates as basis points, tenant tables carry business_id.

create type invoice_status as enum
  ('draft', 'sent', 'viewed', 'partially_paid', 'paid', 'cancelled', 'refunded');
-- "overdue" is derived (due_date passed AND balance > 0), not stored. See docs/ASSUMPTIONS.md.

create type estimate_status as enum
  ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired');

create type payment_status as enum ('pending', 'successful', 'failed', 'refunded');

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles / business
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table business_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references profiles (id) on delete cascade, -- 1 business per user (v1)
  name text not null,
  owner_name text,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  province text,
  postal_code text,
  country text,
  website text,
  tax_number text,
  logo_path text,
  signature_path text,
  default_currency char(3) not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  default_tax_rate_bps integer not null default 0 check (default_tax_rate_bps between 0 and 10000),
  default_payment_terms_days integer not null default 14 check (default_payment_terms_days >= 0),
  timezone text not null default 'UTC',
  invoice_prefix text not null default 'INV-',
  estimate_prefix text not null default 'EST-',
  number_padding smallint not null default 4 check (number_padding between 1 and 10),
  template text not null default 'classic',
  accent_color text not null default '#2563EB' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  display_options jsonb not null default '{}'::jsonb,
  stripe_account_id text unique,
  stripe_charges_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-business, per-kind counters. Allocated atomically by next_document_number().
create table document_sequences (
  business_id uuid not null references business_profiles (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'estimate')),
  next_value bigint not null default 1 check (next_value >= 1),
  primary key (business_id, kind)
);

-- ---------------------------------------------------------------- catalogue
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles (id) on delete cascade,
  first_name text,
  last_name text,
  company_name text,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  province text,
  postal_code text,
  country text,
  notes text,
  deleted_at timestamptz, -- soft delete so historical invoices keep their customer
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (coalesce(first_name, last_name, company_name) is not null)
);
create index customers_business_idx on customers (business_id) where deleted_at is null;

create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles (id) on delete cascade,
  name text not null,
  rate_bps integer not null check (rate_bps between 0 and 10000),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles (id) on delete cascade,
  name text not null,
  description text,
  price_minor bigint not null check (price_minor >= 0),
  unit text not null default 'unit',
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 10000),
  sku text,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_business_idx on products (business_id);
create unique index products_sku_uniq on products (business_id, sku) where sku is not null;

-- ---------------------------------------------------------------- invoices
create table invoices (
  id uuid primary key default gen_random_uuid(), -- may be client-generated (offline drafts)
  business_id uuid not null references business_profiles (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete restrict,
  number text not null,
  status invoice_status not null default 'draft',
  issue_date date not null,
  due_date date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  tax_inclusive boolean not null default false,
  discount_type text check (discount_type in ('percent', 'fixed')),
  discount_value bigint check (discount_value >= 0), -- bps if percent, minor units if fixed
  fees_minor bigint not null default 0 check (fees_minor >= 0),
  -- Server-computed totals; never accepted from clients.
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_total_minor bigint not null default 0 check (discount_total_minor >= 0),
  tax_total_minor bigint not null default 0 check (tax_total_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  balance_due_minor bigint generated always as (total_minor - amount_paid_minor) stored,
  notes text,
  terms text,
  public_token text unique, -- unguessable token for the public pay page
  sent_at timestamptz,
  viewed_at timestamptz,
  paid_at timestamptz,
  version integer not null default 1, -- optimistic concurrency / offline sync
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, number),
  check ((discount_type is null) = (discount_value is null)),
  check (discount_type is distinct from 'percent' or discount_value <= 10000)
);
create index invoices_business_status_due_idx on invoices (business_id, status, due_date);
create index invoices_customer_idx on invoices (customer_id);
create index invoices_issue_date_idx on invoices (business_id, issue_date desc);

create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices (id) on delete cascade,
  business_id uuid not null references business_profiles (id) on delete cascade,
  position integer not null default 0,
  product_id uuid references products (id) on delete set null,
  description text not null,
  quantity numeric(12, 3) not null check (quantity >= 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  taxes jsonb not null default '[]'::jsonb, -- [{ "name": "GST", "rateBps": 500 }]
  line_total_minor bigint not null default 0 check (line_total_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on invoice_items (invoice_id, position);

-- ---------------------------------------------------------------- payments
create table payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0 and refunded_minor <= amount_minor),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status payment_status not null default 'pending',
  method text, -- card | apple_pay | google_pay | ...
  stripe_payment_intent_id text unique, -- one row per intent: duplicate protection
  stripe_charge_id text,
  idempotency_key text,
  failure_code text,
  receipt_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, idempotency_key)
);
create index payments_business_idx on payments (business_id, created_at desc);
create index payments_invoice_idx on payments (invoice_id);

-- Stripe event ids we have already processed (webhook idempotency).
create table webhook_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- estimates
create table estimates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete restrict,
  number text not null,
  status estimate_status not null default 'draft',
  issue_date date not null,
  expiry_date date not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  tax_inclusive boolean not null default false,
  discount_type text check (discount_type in ('percent', 'fixed')),
  discount_value bigint check (discount_value >= 0),
  fees_minor bigint not null default 0 check (fees_minor >= 0),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_total_minor bigint not null default 0 check (discount_total_minor >= 0),
  tax_total_minor bigint not null default 0 check (tax_total_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  notes text,
  terms text,
  public_token text unique,
  converted_invoice_id uuid references invoices (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, number),
  check ((discount_type is null) = (discount_value is null)),
  check (discount_type is distinct from 'percent' or discount_value <= 10000)
);
create index estimates_business_idx on estimates (business_id, status);

create table estimate_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimates (id) on delete cascade,
  business_id uuid not null references business_profiles (id) on delete cascade,
  position integer not null default 0,
  product_id uuid references products (id) on delete set null,
  description text not null,
  quantity numeric(12, 3) not null check (quantity >= 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  taxes jsonb not null default '[]'::jsonb,
  line_total_minor bigint not null default 0 check (line_total_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index estimate_items_estimate_idx on estimate_items (estimate_id, position);

-- ---------------------------------------------------------------- activity / notifications / audit
create table invoice_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete cascade,
  type text not null, -- created | sent | viewed | payment_received | marked_paid | ...
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_activity_invoice_idx on invoice_activity (invoice_id, created_at);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references business_profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_business_idx on notifications (business_id, created_at desc);

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references business_profiles (id) on delete set null,
  user_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  ip inet,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_logs_business_idx on audit_logs (business_id, created_at desc);

-- ---------------------------------------------------------------- updated_at triggers
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_set_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- functions
-- Atomically allocate the next invoice/estimate number, e.g. INV-0042.
-- Runs inside the caller's transaction, so a rolled-back create does not burn a number.
create function next_document_number(p_business_id uuid, p_kind text) returns text
language plpgsql as $$
declare
  v_next bigint;
  v_prefix text;
  v_pad smallint;
begin
  insert into document_sequences (business_id, kind, next_value)
  values (p_business_id, p_kind, 2)
  on conflict (business_id, kind)
  do update set next_value = document_sequences.next_value + 1
  returning next_value - 1 into v_next;

  select case p_kind when 'invoice' then invoice_prefix else estimate_prefix end, number_padding
  into v_prefix, v_pad
  from business_profiles where id = p_business_id;

  if v_prefix is null then
    raise exception 'business % not found', p_business_id;
  end if;
  return v_prefix || lpad(v_next::text, v_pad, '0');
end $$;

-- New auth user -> profile + default business, so every account is immediately usable.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'My Business');
  insert into profiles (id, full_name) values (new.id, v_name);
  insert into business_profiles (owner_id, name, owner_name, email)
  values (new.id, v_name, v_name, new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
