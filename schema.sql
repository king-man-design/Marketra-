-- MARKETRA schema — run this in the Supabase SQL editor.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  subscription text default 'free',
  created_at timestamptz default now()
);

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
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

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  price numeric,
  cost numeric,
  description text
);

create table if not exists marketing_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  objective text,
  status text default 'active',
  created_at timestamptz default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  platform text,
  budget numeric,
  objective text,
  status text default 'draft',
  results jsonb,
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_message text,
  ai_response jsonb,
  created_at timestamptz default now()
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

create index if not exists idx_conversations_business on conversations(business_id, created_at desc);
create index if not exists idx_analytics_business_date on analytics(business_id, date desc);
