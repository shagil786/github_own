-- Run each statement separately if your SQL runner says:
-- "cannot insert multiple commands into a prepared statement"

-- 1. Required public per-user GitHub token session table.
create table if not exists public.user_sessions (
  id text primary key,
  encrypted_payload text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- 2. Optional expiry lookup index.
create index if not exists user_sessions_expires_at_idx on public.user_sessions (expires_at);

-- 3. Lock browser/anon access to session rows.
alter table public.user_sessions enable row level security;
