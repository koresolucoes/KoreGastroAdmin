begin;

-- Evolução aditiva da allowlist atual. O e-mail continua sendo a chave durante a
-- transição para não quebrar o sistema principal nem os administradores existentes.
alter table public.system_admins
  add column if not exists auth_user_id uuid,
  add column if not exists display_name text,
  add column if not exists role text not null default 'platform_admin',
  add column if not exists status text not null default 'active',
  add column if not exists invited_by text,
  add column if not exists mfa_required boolean not null default false,
  add column if not exists last_seen_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists suspended_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists access_reason text;

update public.system_admins
set email = lower(trim(email)),
    role = coalesce(nullif(role, ''), 'platform_admin'),
    status = coalesce(nullif(status, ''), 'active'),
    updated_at = coalesce(updated_at, now());

update public.system_admins admin
set auth_user_id = users.id,
    display_name = coalesce(admin.display_name, users.raw_user_meta_data ->> 'full_name', split_part(admin.email, '@', 1))
from auth.users users
where lower(users.email) = lower(admin.email)
  and admin.auth_user_id is null;

-- Garante um proprietário inicial sem exigir uma escolha destrutiva na migração.
-- Depois da publicação, o papel pode ser atribuído ao ROOT_ADMIN_EMAILS pelo painel.
update public.system_admins
set role = 'owner', updated_at = now()
where email = (
  select email from public.system_admins order by created_at asc nulls last, email asc limit 1
)
and not exists (
  select 1 from public.system_admins where role = 'owner' and status = 'active'
);

update public.system_admins
set mfa_required = true, updated_at = now()
where role in ('owner', 'platform_admin');

do $$
begin
  alter table public.system_admins
    add constraint system_admins_role_check
    check (role in ('owner', 'platform_admin', 'finance', 'support', 'auditor')) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.system_admins
    add constraint system_admins_status_check
    check (status in ('invited', 'active', 'suspended', 'revoked')) not valid;
exception when duplicate_object then null;
end $$;

alter table public.system_admins validate constraint system_admins_role_check;
alter table public.system_admins validate constraint system_admins_status_check;

create unique index if not exists system_admins_auth_user_id_key
  on public.system_admins (auth_user_id) where auth_user_id is not null;
create index if not exists system_admins_status_role_idx
  on public.system_admins (status, role);

create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text not null,
  action text not null,
  category text not null,
  severity text not null default 'low',
  target_type text,
  target_id text,
  tenant_id uuid,
  store_id uuid,
  outcome text not null default 'success',
  reason text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  constraint admin_audit_events_outcome_check check (outcome in ('success', 'failure', 'blocked')),
  constraint admin_audit_events_severity_check check (severity in ('low', 'medium', 'high', 'critical'))
);

create index if not exists admin_audit_events_created_at_idx
  on public.admin_audit_events (created_at desc);
create index if not exists admin_audit_events_actor_idx
  on public.admin_audit_events (actor_email, created_at desc);
create index if not exists admin_audit_events_category_idx
  on public.admin_audit_events (category, outcome, created_at desc);
create index if not exists admin_audit_events_target_idx
  on public.admin_audit_events (target_type, target_id, created_at desc);

create table if not exists public.admin_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  overall_status text not null,
  duration_ms integer not null default 0,
  checks jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  initiated_by text,
  source text not null default 'manual',
  checked_at timestamptz not null default now(),
  constraint admin_health_snapshots_status_check check (overall_status in ('healthy', 'attention', 'degraded', 'critical', 'unknown'))
);

create index if not exists admin_health_snapshots_checked_at_idx
  on public.admin_health_snapshots (checked_at desc);

create table if not exists public.admin_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  service text not null,
  severity text not null,
  status text not null default 'open',
  owner_email text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_incidents_severity_check check (severity in ('low', 'medium', 'high', 'critical')),
  constraint admin_incidents_status_check check (status in ('open', 'acknowledged', 'resolved'))
);

create index if not exists admin_incidents_status_idx
  on public.admin_incidents (status, started_at desc);

create or replace function public.touch_admin_control_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists system_admins_touch_updated_at on public.system_admins;
create trigger system_admins_touch_updated_at
before update on public.system_admins
for each row execute function public.touch_admin_control_updated_at();

drop trigger if exists admin_incidents_touch_updated_at on public.admin_incidents;
create trigger admin_incidents_touch_updated_at
before update on public.admin_incidents
for each row execute function public.touch_admin_control_updated_at();

create or replace function public.protect_last_admin_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removes_active_owner boolean := false;
begin
  if old.role = 'owner' and old.status = 'active' then
    removes_active_owner := tg_op = 'DELETE';
    if tg_op <> 'DELETE' then
      removes_active_owner := new.role <> 'owner' or new.status <> 'active';
    end if;
  end if;
  if removes_active_owner then
    if not exists (
      select 1 from public.system_admins
      where email <> old.email and role = 'owner' and status = 'active'
    ) then
      raise exception 'O último proprietário ativo não pode ser removido, suspenso ou rebaixado.'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_last_admin_owner on public.system_admins;
create trigger protect_last_admin_owner
before update or delete on public.system_admins
for each row execute function public.protect_last_admin_owner();

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.system_admins
    where lower(email) = lower(auth.jwt() ->> 'email')
      and status = 'active'
  );
$$;

-- Fecha o bypass direto: usuários autenticados podem consultar a equipe, mas
-- alterações passam exclusivamente pelas APIs com service role e auditoria.
drop policy if exists "Admins can manage admins" on public.system_admins;
drop policy if exists "Admins can view admins" on public.system_admins;
drop policy if exists "System admins read access" on public.system_admins;
create policy "Active admins can view admins"
  on public.system_admins for select to authenticated
  using (public.is_system_admin());

revoke insert, update, delete, truncate, references, trigger on public.system_admins from anon, authenticated;
grant select on public.system_admins to authenticated;

alter table public.admin_audit_events enable row level security;
alter table public.admin_health_snapshots enable row level security;
alter table public.admin_incidents enable row level security;
revoke all on public.admin_audit_events from anon, authenticated;
revoke all on public.admin_health_snapshots from anon, authenticated;
revoke all on public.admin_incidents from anon, authenticated;
grant select, insert on public.admin_audit_events to service_role;
grant select, insert on public.admin_health_snapshots to service_role;
grant select, insert, update on public.admin_incidents to service_role;
grant select, insert, update, delete on public.system_admins to service_role;
grant execute on function public.is_system_admin() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
