-- Content administration foundation: authorization, lifecycle, optimistic locking, and audit.

create or replace function public.is_content_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and coalesce((select (raw_app_meta_data ->> 'content_admin')::boolean from auth.users where id = auth.uid()), false);
$$;

revoke all on function public.is_content_admin() from public;
grant execute on function public.is_content_admin() to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'elements', 'statuses', 'skills', 'critters', 'rollcasters',
    'rollcaster_abilities', 'relics', 'dungeons'
  ] loop
    -- Legacy statuses did not have catalog ordering, while every other root table did.
    -- Keep this generic so the foundation remains safe against any older table variant.
    execute format('alter table public.%I add column if not exists sort_order integer not null default 0', v_table);
    execute format('alter table public.%I add column if not exists is_active boolean not null default false', v_table);
    execute format('alter table public.%I add column if not exists is_archived boolean not null default false', v_table);
    execute format('alter table public.%I add column if not exists version integer not null default 1 check (version > 0)', v_table);
    execute format('alter table public.%I add column if not exists created_at timestamptz not null default now()', v_table);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', v_table);
    execute format('alter table public.%I add column if not exists created_by uuid null references auth.users(id)', v_table);
    execute format('alter table public.%I add column if not exists updated_by uuid null references auth.users(id)', v_table);
    execute format('update public.%I set is_active = true, is_archived = false where is_active = false and is_archived = false', v_table);
    execute format('create index if not exists %I on public.%I (is_active, is_archived, sort_order)', v_table || '_lifecycle_idx', v_table);
  end loop;
end $$;

create table if not exists public.content_change_log (
  id uuid primary key default gen_random_uuid(),
  changed_at timestamptz not null default now(),
  admin_user_id uuid not null references auth.users(id),
  entity_type text not null,
  entity_id text not null,
  operation text not null check (operation in ('create', 'update', 'publish', 'archive', 'restore', 'rename', 'delete')),
  previous_version integer,
  next_version integer,
  before_snapshot jsonb,
  after_snapshot jsonb,
  change_note text
);

create index if not exists content_change_log_entity_idx
  on public.content_change_log (entity_type, entity_id, changed_at desc);
create index if not exists content_change_log_admin_idx
  on public.content_change_log (admin_user_id, changed_at desc);

alter table public.content_change_log enable row level security;
drop policy if exists content_change_log_admin_read on public.content_change_log;
create policy content_change_log_admin_read on public.content_change_log
  for select to authenticated using (public.is_content_admin());

create or replace function public.prevent_content_change_log_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '42501', message = 'content_change_log is append-only';
end;
$$;

drop trigger if exists content_change_log_immutable on public.content_change_log;
create trigger content_change_log_immutable
  before update or delete on public.content_change_log
  for each row execute function public.prevent_content_change_log_mutation();

create or replace function public.assert_content_admin()
returns uuid language plpgsql stable security definer set search_path = public, auth as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if not public.is_content_admin() then
    raise exception using errcode = '42501', message = 'CONTENT_ADMIN_REQUIRED';
  end if;
  return v_user_id;
end;
$$;

revoke all on function public.assert_content_admin() from public;
grant execute on function public.assert_content_admin() to authenticated;

comment on function public.is_content_admin() is
  'True only when the authenticated user has server-controlled app_metadata.content_admin=true.';
comment on table public.content_change_log is
  'Append-only snapshots for all catalog mutations performed through admin RPCs.';
