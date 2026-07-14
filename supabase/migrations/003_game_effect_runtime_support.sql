-- Add the persistent runtime inputs required by deterministic in-game effects.
-- This migration is additive and assumes the established Rollcasters schema,
-- including effect templates/definitions and owner attachment tables.

alter table public.statuses
  add column if not exists stacking_policy text not null default 'refresh',
  add column if not exists default_duration integer not null default 3,
  add column if not exists max_stacks integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.statuses'::regclass
      and conname = 'statuses_stacking_policy_check'
  ) then
    alter table public.statuses
      add constraint statuses_stacking_policy_check
      check (stacking_policy in ('refresh', 'extend', 'stack', 'ignore'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.statuses'::regclass
      and conname = 'statuses_default_duration_check'
  ) then
    alter table public.statuses
      add constraint statuses_default_duration_check
      check (default_duration >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.statuses'::regclass
      and conname = 'statuses_max_stacks_check'
  ) then
    alter table public.statuses
      add constraint statuses_max_stacks_check
      check (max_stacks >= 1);
  end if;
end $$;

alter table public.dungeon_runs
  add column if not exists effect_snapshot jsonb;

create or replace function public.snapshot_dungeon_run_effects(
  p_run_id uuid,
  p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_snapshot is null
     or jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_snapshot->'effects') <> 'array'
     or jsonb_typeof(p_snapshot->'loadouts') <> 'object'
     or jsonb_typeof(p_snapshot->'statuses') <> 'array'
     or jsonb_typeof(p_snapshot->'seed') <> 'number' then
    raise exception 'Invalid effect snapshot';
  end if;

  select effect_snapshot
  into v_existing
  from public.dungeon_runs
  where id = p_run_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Run not found';
  end if;

  if v_existing is not null then
    if v_existing = p_snapshot then return; end if;
    raise exception 'Effect snapshot already exists';
  end if;

  update public.dungeon_runs
  set effect_snapshot = p_snapshot
  where id = p_run_id
    and user_id = v_user_id
    and status = 'started';

  if not found then
    raise exception 'Run is not active';
  end if;
end;
$$;

revoke all on function public.snapshot_dungeon_run_effects(uuid, jsonb) from public;
grant execute on function public.snapshot_dungeon_run_effects(uuid, jsonb) to authenticated;

comment on column public.dungeon_runs.effect_snapshot is
  'Write-once resolved effect/status/loadout/RNG inputs used for deterministic combat replay.';

comment on function public.snapshot_dungeon_run_effects(uuid, jsonb) is
  'Stores the authenticated user''s deterministic effect snapshot exactly once per started dungeon run.';
