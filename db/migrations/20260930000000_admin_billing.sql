-- ── Admin billing: plans, subscriptions, coupons, audit log ───────────────────
-- Platform-owner billing controls for the admin console:
--   • subscription_plans   — plan tiers with first-month / monthly pricing
--   • user_subscriptions   — per-user subscription + price overrides
--   • coupons              — percent/fixed discount codes (global or per user)
--   • coupon_redemptions   — discount usage history
--   • admin_audit_log      — who changed what in the admin console
--
-- Also seeds the platform-owner account: bood68155@gmail.com / password 123123
-- (bcrypt hash, 10 rounds). The hash covers the literal password "123123".

do $$ begin
  create type public.subscription_status as enum ('trial', 'active', 'past_due', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.discount_type as enum ('percent', 'fixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.coupon_duration as enum ('once', 'repeating', 'forever');
exception when duplicate_object then null; end $$;

-- Platform owner (bcrypt hash of "123123", cost 10).
insert into public.users (email, password_hash, email_verified)
values (
  'bood68155@gmail.com',
  '$2b$10$9WH69mIWIgu4zO/QsJ0TKeygm3kNEZW9FN0uAhlBa13aownZZ/xnW',
  now()
)
on conflict (email) do update
  set password_hash = excluded.password_hash,
      disabled = false,
      updated_at = now();

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  first_month_price numeric(12,2) not null default 0,
  monthly_price numeric(12,2) not null default 30,
  currency text not null default 'USD',
  trial_days integer not null default 14,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed the default tiers: first month free, then the recurring monthly rate.
insert into public.subscription_plans (code, name, first_month_price, monthly_price, trial_days, is_default)
values
  ('standard', 'Standard', 0, 30, 14, true),
  ('pro', 'Pro', 0, 99, 14, false)
on conflict (code) do nothing;

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  plan_id uuid references public.subscription_plans(id) on delete set null,
  status public.subscription_status not null default 'trial',
  -- Per-user price overrides (null = inherit the plan price)
  monthly_price numeric(12,2),
  first_month_price numeric(12,2),
  period_start timestamptz not null default now(),
  period_end timestamptz,
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  coupon_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type public.discount_type not null,
  discount_value numeric(12,2) not null,
  -- null = global coupon; otherwise redeemable by this user only
  user_id uuid references public.users(id) on delete cascade,
  starts_at timestamptz,
  expires_at timestamptz,
  max_redemptions integer,
  times_used integer not null default 0,
  duration public.coupon_duration not null default 'once',
  duration_months integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_discount_value_check check (discount_value >= 0),
  constraint coupons_percent_cap_check check (discount_type <> 'percent' or discount_value <= 100)
);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  code text not null,
  discount_amount numeric(12,2) not null default 0,
  redeemed_at timestamptz not null default now()
);

create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id, redeemed_at desc);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
