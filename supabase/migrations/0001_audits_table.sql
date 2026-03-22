-- ProxyRank: proxy_audits table
-- Run this in your Supabase SQL editor (existing project is fine).

create extension if not exists "pgcrypto";

create table if not exists public.proxy_audits (
  id               uuid primary key default gen_random_uuid(),
  url              text not null,
  score            smallint not null check (score >= 0 and score <= 100),
  mode             text not null default 'mcp' check (mode in ('mcp', 'cli')),
  breakdown        jsonb not null default '{}',
  user_id          uuid references auth.users(id) on delete set null,
  is_gold_standard boolean not null default false,
  label            text,               -- e.g. "Stripe MCP" for gold standards
  created_at       timestamptz not null default now()
);

create index if not exists proxy_audits_user_id_idx    on public.proxy_audits (user_id);
create index if not exists proxy_audits_created_at_idx on public.proxy_audits (created_at desc);
create index if not exists proxy_audits_gold_idx       on public.proxy_audits (is_gold_standard) where is_gold_standard = true;

alter table public.proxy_audits enable row level security;

-- Anonymous inserts allowed (free tier — no auth required)
create policy "allow_anonymous_insert" on public.proxy_audits
  for insert with check (true);

-- Anyone can read gold standard benchmarks
create policy "allow_gold_standard_select" on public.proxy_audits
  for select using (is_gold_standard = true);

-- Users can read their own audits; anonymous audits are readable by anyone with the ID
create policy "allow_owner_select" on public.proxy_audits
  for select using (user_id = auth.uid() or user_id is null);
