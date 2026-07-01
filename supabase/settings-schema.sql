create table if not exists public.app_settings (
  id text primary key,
  encrypted_payload text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
