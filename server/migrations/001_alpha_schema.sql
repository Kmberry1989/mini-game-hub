-- 6-week alpha reference schema (PostgreSQL)
-- Apply manually when DATABASE_URL points to a PostgreSQL instance.

create table if not exists users (
  id uuid primary key,
  email text unique not null,
  password_hash text not null,
  display_name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists refresh_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null
);

create table if not exists profiles (
  user_id uuid primary key references users(id) on delete cascade,
  selected_avatar text not null,
  stars_balance integer not null default 0,
  level integer not null default 1,
  xp_total integer not null default 0,
  equipped jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists quests (
  id text primary key,
  key text not null,
  type text not null,
  config_json jsonb,
  is_daily boolean not null default false,
  active_from timestamptz,
  active_to timestamptz
);

create table if not exists user_quests (
  user_id uuid not null references users(id) on delete cascade,
  quest_id text not null,
  status text not null,
  progress_json jsonb not null,
  completed_at timestamptz,
  claimed_at timestamptz,
  cycle text not null,
  updated_at timestamptz not null,
  primary key (user_id, quest_id)
);

create table if not exists unlock_defs (
  id text primary key,
  key text not null,
  category text not null,
  metadata_json jsonb
);

create table if not exists user_unlocks (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  unlock_id text not null,
  acquired_at timestamptz not null,
  source text not null,
  equip_state_json jsonb not null default '{}'::jsonb,
  unique (user_id, unlock_id)
);

create table if not exists currency_ledger (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  delta integer not null,
  source text not null,
  source_ref text,
  balance_after integer not null,
  created_at timestamptz not null
);

create table if not exists grant_history (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  grant_key text not null,
  created_at timestamptz not null,
  unique (user_id, grant_key)
);
