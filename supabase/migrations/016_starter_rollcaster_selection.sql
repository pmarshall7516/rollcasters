-- Add a first onboarding step for choosing a starter Rollcaster. Existing
-- players keep their earliest owned starter Rollcaster, while new players are
-- no longer silently granted Roland by ensure_user_game_state().

create table if not exists public.starter_rollcaster_options(
  rollcaster_id text primary key references public.rollcasters(id) on update cascade on delete cascade,
  sort_order integer not null,
  is_active boolean not null default true
);

alter table public.starter_rollcaster_options enable row level security;

drop policy if exists starter_rollcaster_options_read_all on public.starter_rollcaster_options;
create policy starter_rollcaster_options_read_all
on public.starter_rollcaster_options
for select
using (true);

grant select on public.starter_rollcaster_options to anon,authenticated;

insert into public.starter_rollcaster_options(rollcaster_id,sort_order,is_active)
select rollcaster.id,rollcaster.sort_order,true
from public.rollcasters rollcaster
where rollcaster.id in ('001','002','003')
  and rollcaster.is_active
  and not rollcaster.is_archived
on conflict(rollcaster_id) do update
set sort_order=excluded.sort_order,
    is_active=excluded.is_active;

alter table public.profiles
add column if not exists starter_rollcaster_selected_at timestamptz;

-- Before this migration, ensure_user_game_state() granted Roland to every new
-- player. Treat the earliest owned starter Rollcaster as that player's
-- historical selection so established accounts do not re-enter onboarding.
with historical_selection as (
  select distinct on (owned.user_id)
    owned.user_id,
    owned.unlocked_at
  from public.user_rollcasters owned
  join public.starter_rollcaster_options starter
    on starter.rollcaster_id=owned.rollcaster_id
   and starter.is_active
  order by owned.user_id,owned.unlocked_at,starter.sort_order,owned.id
)
update public.profiles profile
set starter_rollcaster_selected_at=historical.unlocked_at
from historical_selection historical
where profile.user_id=historical.user_id
  and profile.starter_rollcaster_selected_at is null;

-- Keep historic onboarding equivalent to a new selection by completing the
-- selected Rollcaster's existing 20-shard challenge.
insert into public.user_collectible_shards(
  user_id,
  collectible_type,
  collectible_id,
  quantity,
  updated_at
)
select profile.user_id,'rollcaster',selected.rollcaster_id,20,now()
from public.profiles profile
join lateral (
  select owned.rollcaster_id
  from public.user_rollcasters owned
  join public.starter_rollcaster_options starter
    on starter.rollcaster_id=owned.rollcaster_id
   and starter.is_active
  where owned.user_id=profile.user_id
  order by owned.unlocked_at,starter.sort_order,owned.id
  limit 1
) selected on true
where profile.starter_rollcaster_selected_at is not null
on conflict(user_id,collectible_type,collectible_id) do update
set quantity=greatest(public.user_collectible_shards.quantity,excluded.quantity),
    updated_at=case
      when public.user_collectible_shards.quantity<excluded.quantity then now()
      else public.user_collectible_shards.updated_at
    end;

create or replace function public.ensure_user_game_state()
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_email text:=coalesce(auth.jwt()->>'email','player');
  v_username text:=coalesce(
    auth.jwt()->'user_metadata'->>'username',
    split_part(v_email,'@',1),
    'player'
  );
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles(user_id,username)
  values(v_user_id,v_username)
  on conflict(user_id) do nothing;

  insert into public.user_squad_slots(user_id,slot_index)
  values(v_user_id,1),(v_user_id,2),(v_user_id,3)
  on conflict do nothing;

  insert into public.user_dungeon_progress(user_id,dungeon_id,is_unlocked)
  values(v_user_id,'001',true)
  on conflict(user_id,dungeon_id) do update
  set is_unlocked=true;
end;
$$;

create or replace function public.select_starter_rollcaster(p_rollcaster_id text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_user_rollcaster_id uuid;
  v_ability_id text;
  v_ability_slots integer:=1;
  v_selected_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_user_game_state();

  if not exists(
    select 1
    from public.starter_rollcaster_options starter
    join public.rollcasters rollcaster on rollcaster.id=starter.rollcaster_id
    where starter.rollcaster_id=p_rollcaster_id
      and starter.is_active
      and rollcaster.is_active
      and not rollcaster.is_archived
  ) then
    raise exception 'Invalid starter Rollcaster';
  end if;

  select starter_rollcaster_selected_at into v_selected_at
  from public.profiles
  where user_id=v_user_id
  for update;

  if v_selected_at is not null then
    return;
  end if;

  insert into public.user_rollcasters(user_id,rollcaster_id)
  values(v_user_id,p_rollcaster_id)
  on conflict(user_id,rollcaster_id) do update
  set rollcaster_id=excluded.rollcaster_id
  returning id into v_user_rollcaster_id;

  insert into public.user_rollcaster_abilities(user_id,user_rollcaster_id,ability_id)
  select v_user_id,v_user_rollcaster_id,ability_id
  from public.rollcaster_ability_unlocks
  where rollcaster_id=p_rollcaster_id
    and unlock_level=1
    and unlock_cost=0
  order by sort_order
  on conflict do nothing;

  select ability_id into v_ability_id
  from public.rollcaster_ability_unlocks
  where rollcaster_id=p_rollcaster_id
    and unlock_level=1
    and unlock_cost=0
  order by is_default desc,sort_order,ability_id
  limit 1;

  select greatest(coalesce(max(total_unlocked_ability_slots),1),1)
  into v_ability_slots
  from public.rollcaster_level_progression
  where rollcaster_id=p_rollcaster_id
    and level<=1;

  insert into public.user_rollcaster_ability_slots(
    user_rollcaster_id,
    slot_index,
    ability_id
  )
  select
    v_user_rollcaster_id,
    slot,
    case when slot=1 then v_ability_id else null end
  from generate_series(1,v_ability_slots) slot
  on conflict(user_rollcaster_id,slot_index) do update
  set ability_id=excluded.ability_id;

  insert into public.user_collectible_shards(
    user_id,
    collectible_type,
    collectible_id,
    quantity,
    updated_at
  ) values(v_user_id,'rollcaster',p_rollcaster_id,20,now())
  on conflict(user_id,collectible_type,collectible_id) do update
  set quantity=greatest(public.user_collectible_shards.quantity,excluded.quantity),
      updated_at=case
        when public.user_collectible_shards.quantity<excluded.quantity then now()
        else public.user_collectible_shards.updated_at
      end;

  update public.profiles
  set active_rollcaster_id=v_user_rollcaster_id,
      starter_rollcaster_selected_at=now(),
      updated_at=now()
  where user_id=v_user_id;
end;
$$;

-- Enforce the authored onboarding order in the data layer as well as the UI.
create or replace function public.select_starter_critter(p_critter_id text)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_user_critter_id uuid;
  v_skill_id text;
  v_rollcaster_selected_at timestamptz;
  v_starter_selected_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_user_game_state();

  if not exists(
    select 1 from public.starter_options
    where critter_id=p_critter_id and is_active
  ) then
    raise exception 'Invalid starter critter';
  end if;

  select starter_rollcaster_selected_at,starter_selected_at
  into v_rollcaster_selected_at,v_starter_selected_at
  from public.profiles
  where user_id=v_user_id
  for update;

  if v_rollcaster_selected_at is null then
    raise exception 'Select a starter Rollcaster before selecting a starter Critter';
  end if;

  if v_starter_selected_at is not null then
    return;
  end if;

  insert into public.user_critters(user_id,critter_id)
  values(v_user_id,p_critter_id)
  on conflict(user_id,critter_id) do update set critter_id=excluded.critter_id
  returning id into v_user_critter_id;

  insert into public.user_collectible_shards(
    user_id,
    collectible_type,
    collectible_id,
    quantity,
    updated_at
  ) values(v_user_id,'critter',p_critter_id,50,now())
  on conflict(user_id,collectible_type,collectible_id) do update
  set quantity=greatest(public.user_collectible_shards.quantity,excluded.quantity),
      updated_at=case
        when public.user_collectible_shards.quantity<excluded.quantity then now()
        else public.user_collectible_shards.updated_at
      end;

  insert into public.user_seen_critters(user_id,critter_id)
  select v_user_id,critter_id
  from public.starter_options
  where is_active
  on conflict do nothing;

  for v_skill_id in
    select skill_id from public.critter_skill_unlocks
    where critter_id=p_critter_id and unlock_level=1 and unlock_cost=0
    order by sort_order
  loop
    insert into public.user_critter_skills(user_critter_id,skill_id)
    values(v_user_critter_id,v_skill_id)
    on conflict do nothing;
  end loop;

  select skill_id into v_skill_id
  from public.critter_skill_unlocks
  where critter_id=p_critter_id and unlock_level=1 and unlock_cost=0
  order by sort_order
  limit 1;

  insert into public.user_critter_skill_slots(user_critter_id,slot_index,skill_id)
  values
    (v_user_critter_id,1,v_skill_id),
    (v_user_critter_id,2,null),
    (v_user_critter_id,3,null),
    (v_user_critter_id,4,null)
  on conflict(user_critter_id,slot_index) do update set skill_id=excluded.skill_id;

  update public.user_squad_slots
  set user_critter_id=v_user_critter_id
  where user_id=v_user_id and slot_index=1;

  update public.profiles
  set starter_selected_at=now(),updated_at=now()
  where user_id=v_user_id;
end;
$$;

revoke all on function public.select_starter_rollcaster(text) from public;
revoke all on function public.select_starter_rollcaster(text) from anon;
grant execute on function public.select_starter_rollcaster(text) to authenticated;

revoke all on function public.select_starter_critter(text) from public;
revoke all on function public.select_starter_critter(text) from anon;
grant execute on function public.select_starter_critter(text) to authenticated;
