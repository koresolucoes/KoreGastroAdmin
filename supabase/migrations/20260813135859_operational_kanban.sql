begin;

create table if not exists public.admin_work_items (
  id uuid primary key default gen_random_uuid(),
  support_ticket_id uuid unique references public.support_tickets(id) on delete cascade,
  beta_application_id uuid unique references public.beta_applications(id) on delete cascade,
  assigned_to text,
  due_at timestamptz,
  board_position bigint not null default 1024,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_work_items_single_source_check check (
    num_nonnulls(support_ticket_id, beta_application_id) = 1
  )
);

create index if not exists admin_work_items_attention_idx
  on public.admin_work_items (assigned_to, due_at, board_position);

create index if not exists support_tickets_active_board_idx
  on public.support_tickets (status, updated_at desc)
  where status in ('open', 'in_progress');

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at);

alter table public.admin_work_items enable row level security;

drop policy if exists admin_work_items_service_role_all on public.admin_work_items;
create policy admin_work_items_service_role_all
  on public.admin_work_items
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.admin_work_items from anon, authenticated;
grant select, insert, update, delete on public.admin_work_items to service_role;

notify pgrst, 'reload schema';
commit;
