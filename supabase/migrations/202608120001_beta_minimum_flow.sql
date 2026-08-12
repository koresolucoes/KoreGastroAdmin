begin;

create table if not exists public.beta_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  restaurant_name text not null,
  email text not null,
  phone text,
  establishment_type text,
  restaurant_size text,
  source text not null default 'landing',
  status text not null default 'new',
  notes text,
  assigned_to text,
  consent_terms boolean not null,
  consent_marketing boolean not null default false,
  consent_version text not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_applications_status_check check (status in ('new','review','contact','interview','approved','onboarding','active','completed','converted','closed')),
  constraint beta_applications_terms_check check (consent_terms),
  constraint beta_applications_email_check check (position('@' in email) > 1)
);

create unique index if not exists beta_applications_email_open_key
  on public.beta_applications (lower(email)) where status not in ('converted','closed');
create index if not exists beta_applications_pipeline_idx on public.beta_applications (status, submitted_at desc);

create table if not exists public.beta_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.beta_applications(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  actor_email text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists beta_application_events_application_idx on public.beta_application_events (application_id, created_at desc);

create table if not exists public.beta_participants (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.beta_applications(id),
  cohort text not null default 'founders-2026',
  status text not null default 'onboarding',
  activated_at timestamptz,
  beta_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_participants_status_check check (status in ('onboarding','active','completed','converted','closed'))
);

create table if not exists public.beta_consent_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.beta_applications(id) on delete cascade,
  consent_type text not null,
  granted boolean not null,
  document_version text not null,
  source text not null default 'landing',
  created_at timestamptz not null default now(),
  constraint beta_consent_events_type_check check (consent_type in ('program_terms','marketing'))
);

create table if not exists public.beta_submission_attempts (
  id bigint generated always as identity primary key,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create index if not exists beta_submission_attempts_limit_idx on public.beta_submission_attempts (fingerprint, created_at desc);

alter table public.beta_applications enable row level security;
alter table public.beta_application_events enable row level security;
alter table public.beta_participants enable row level security;
alter table public.beta_consent_events enable row level security;
alter table public.beta_submission_attempts enable row level security;

revoke all on public.beta_applications, public.beta_application_events, public.beta_participants, public.beta_consent_events, public.beta_submission_attempts from anon, authenticated;
grant select, insert, update on public.beta_applications to service_role;
grant select, insert on public.beta_application_events to service_role;
grant select, insert, update on public.beta_participants to service_role;
grant select, insert on public.beta_consent_events to service_role;
grant select, insert, delete on public.beta_submission_attempts to service_role;
grant usage, select on sequence public.beta_submission_attempts_id_seq to service_role;

-- Migração preserva origens antigas sem duplicar candidaturas abertas.
insert into public.beta_applications (name, restaurant_name, email, phone, establishment_type, source, consent_terms, consent_version, submitted_at)
select trim(nome), trim(nome_restaurante), lower(trim(email)), nullif(trim(telefone), ''), nullif(trim(tipo_estabelecimento), ''), 'legacy_beta_testers', true, 'legacy-import-2026-08', created_at
from public.beta_testers legacy
where nullif(trim(email), '') is not null and position('@' in trim(email)) > 1
  and not exists (select 1 from public.beta_applications current where lower(current.email) = lower(trim(legacy.email)))
on conflict do nothing;

insert into public.beta_applications (name, restaurant_name, email, phone, restaurant_size, source, consent_terms, consent_marketing, consent_version, submitted_at)
select trim(nome), coalesce(nullif(trim(nome), ''), 'Restaurante não informado'), lower(trim(email)), nullif(trim(whatsapp), ''), nullif(trim(tamanho_restaurante), ''), coalesce(nullif(trim(origem), ''), 'legacy_leads'), aceita_termos, aceita_comunicacao, 'legacy-import-2026-08', created_at
from public.leads legacy
where aceita_termos = true and nullif(trim(email), '') is not null and position('@' in trim(email)) > 1
  and not exists (select 1 from public.beta_applications current where lower(current.email) = lower(trim(legacy.email)))
on conflict do nothing;

notify pgrst, 'reload schema';
commit;
