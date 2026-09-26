-- MARKETRA schema — run this in the Supabase SQL editor.
-- Uses Supabase's built-in Auth (auth.users) instead of a custom users table.

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  business_name text not null,
  industry text,
  description text,
  target_customer text,
  location text,
  monthly_marketing_budget numeric,
  current_goal text,
  current_stage text,
  sales_channels text[],
  created_at timestamptz default now()
);

create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade not null,
  title text default 'New chat',
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references chat_sessions(id) on delete cascade not null,
  business_id uuid references businesses(id) on delete cascade,
  user_message text,
  ai_response jsonb,
  created_at timestamptz default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  price numeric,
  cost numeric,
  description text
);

create table if not exists analytics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  date date not null,
  reach integer default 0,
  clicks integer default 0,
  leads integer default 0,
  sales integer default 0,
  revenue numeric default 0,
  spend numeric default 0
);

create index if not exists idx_sessions_business on chat_sessions(business_id, created_at desc);
create index if not exists idx_conversations_session on conversations(session_id, created_at asc);
create index if not exists idx_analytics_business_date on analytics(business_id, date desc);

-- Row Level Security: each user can only see their own data.
-- The frontend talks to Supabase directly with a public anon key for
-- everything except the actual AI call, so RLS is what keeps one
-- user's businesses/chats private from another's.

alter table businesses enable row level security;
alter table chat_sessions enable row level security;
alter table conversations enable row level security;
alter table products enable row level security;
alter table analytics enable row level security;

drop policy if exists "Users manage their own businesses" on businesses;
create policy "Users manage their own businesses" on businesses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage sessions on their own businesses" on chat_sessions;
create policy "Users manage sessions on their own businesses" on chat_sessions
  for all using (
    exists (select 1 from businesses b where b.id = business_id and b.user_id = auth.uid())
  ) with check (
    exists (select 1 from businesses b where b.id = business_id and b.user_id = auth.uid())
  );

drop policy if exists "Users manage conversations in their own sessions" on conversations;
create policy "Users manage conversations in their own sessions" on conversations
  for all using (
    exists (
      select 1 from chat_sessions s
      join businesses b on b.id = s.business_id
      where s.id = session_id and b.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from chat_sessions s
      join businesses b on b.id = s.business_id
      where s.id = session_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "Users manage their own products" on products;
create policy "Users manage their own products" on products
  for all using (
    exists (select 1 from businesses b where b.id = business_id and b.user_id = auth.uid())
  ) with check (
    exists (select 1 from businesses b where b.id = business_id and b.user_id = auth.uid())
  );

drop policy if exists "Users manage their own analytics" on analytics;
create policy "Users manage their own analytics" on analytics
  for all using (
    exists (select 1 from businesses b where b.id = business_id and b.user_id = auth.uid())
  ) with check (
    exists (select 1 from businesses b where b.id = business_id and b.user_id = auth.uid())
  );

-- ---------- Phyllo social account connections ----------
-- Note: mapped to the Marketra user (not a business) since Phyllo's own
-- user model is per-person, and the Phyllo user ID must never come from
-- the browser (see backend/phyllo.js — always server-derived).

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  marketra_user_id uuid references auth.users(id) on delete cascade not null,
  phyllo_user_id text not null,
  phyllo_account_id text unique,
  platform text,
  handle text,
  connection_status text default 'pending',
  last_sync_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_social_accounts_user on social_accounts(marketra_user_id);
create unique index if not exists idx_social_accounts_phyllo_user on social_accounts(phyllo_user_id);

alter table social_accounts enable row level security;

drop policy if exists "Users manage their own social accounts" on social_accounts;
create policy "Users manage their own social accounts" on social_accounts
  for all using (auth.uid() = marketra_user_id) with check (auth.uid() = marketra_user_id);

-- Note: this table is written to only by the backend (service role, which
-- bypasses RLS) — the webhook and token-generation endpoints are the only
-- writers. The policy above governs the frontend's read access only.

-- ---------- Data integrity constraints ----------
-- Added via ALTER TABLE (not the CREATE TABLE blocks above) so this is
-- safe to re-run even though the tables already exist — each is wrapped
-- to skip quietly if the constraint is already present.

do $$ begin
  alter table businesses add constraint businesses_budget_non_negative
    check (monthly_marketing_budget is null or monthly_marketing_budget >= 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table businesses add constraint businesses_name_not_blank
    check (length(trim(business_name)) > 0);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table social_accounts add constraint social_accounts_status_valid
    check (connection_status in ('pending', 'connected', 'failed', 'disconnected'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table chat_sessions add constraint chat_sessions_title_length
    check (length(title) <= 200);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table conversations add constraint conversations_message_length
    check (user_message is null or length(user_message) <= 4000);
exception when duplicate_object then null;
end $$;

-- ---------- Webhook idempotency ----------
-- InsightIQ/Phyllo webhooks are at-least-once delivery — the same event
-- can arrive more than once. This table lets the webhook handler skip
-- an event it has already processed.

create table if not exists webhook_events (
  event_id text primary key,
  received_at timestamptz default now()
);
