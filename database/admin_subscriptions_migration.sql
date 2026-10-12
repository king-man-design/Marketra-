-- MARKETRA admin/subscription readiness migration.
-- Safe additive migration: does not alter existing auth, business, or social tables.
-- Run in Supabase SQL Editor after reviewing. No payment provider is connected by this schema.

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  status text not null default 'none' check (status in ('none', 'trialing', 'active', 'cancelled', 'canceled', 'past_due', 'incomplete')),
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  monthly_amount numeric(12,2),
  currency text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_subscriptions_user_id_key unique (user_id)
);

create index if not exists user_subscriptions_plan_status_idx
  on public.user_subscriptions(plan, status);
create index if not exists user_subscriptions_updated_at_idx
  on public.user_subscriptions(updated_at desc);

alter table public.user_subscriptions enable row level security;
-- No user-facing policies are created. Access is server-side only via the Render service-role client.
-- Never expose SUPABASE_SERVICE_ROLE_KEY in frontend code or Netlify variables.
