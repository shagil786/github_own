create table if not exists public.app_settings (
  id text primary key,
  encrypted_payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create table if not exists public.user_sessions (
  id text primary key,
  encrypted_payload text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists user_sessions_expires_at_idx on public.user_sessions (expires_at);

alter table public.user_sessions enable row level security;
