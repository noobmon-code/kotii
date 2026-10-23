-- Simula o mínimo do Supabase (roles, auth, storage, grants padrão) para
-- rodar as migrations num Postgres comum. Só para teste local.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
-- As colunas de auth.users que as migrations leem (o painel do app), com os tipos da Supabase. Só o id é
-- obrigatório: os testes criam pessoas com insert into auth.users (id).
create table auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
-- As sessões vivas (sair da conta apaga a linha). refreshed_at é timestamp sem fuso, com a hora de UTC.
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  refreshed_at timestamp,
  user_agent text
);
-- Uma linha por renovação do token, apagada com a sessão. O user_id é texto (varchar), não uuid.
create table auth.refresh_tokens (
  id bigserial primary key,
  user_id varchar(255),
  session_id uuid references auth.sessions (id) on delete cascade,
  revoked boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  -- A coluna nova do Storage: o mesmo dono, como texto.
  owner_id text default auth.uid()::text
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
grant all on storage.objects to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
