begin;

-- Starter selection grants the collectible directly instead of going through
-- the challenge evaluator. Materialize the same durable unlock authority so
-- starter items remain usable by every gated loadout RPC.
create or replace function public.select_starter_critter(p_critter_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
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

  insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id)
  values(v_user_id,'critter',p_critter_id)
  on conflict(user_id,collectible_type,collectible_id) do nothing;

  update public.profiles
  set starter_selected_at=now(),updated_at=now()
  where user_id=v_user_id;
end;
$$;

create or replace function public.select_starter_rollcaster(p_rollcaster_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
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

  insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id)
  values(v_user_id,'rollcaster',p_rollcaster_id)
  on conflict(user_id,collectible_type,collectible_id) do nothing;

  update public.profiles
  set active_rollcaster_id=v_user_rollcaster_id,
      starter_rollcaster_selected_at=now(),
      updated_at=now()
  where user_id=v_user_id;
end;
$$;

-- Repair accounts that completed onboarding before starter selections began
-- materializing durable unlock authority. The earliest owned item created by
-- onboarding is the only starter item this backfill can safely identify.
with starter_rollcaster as (
  select distinct on (profile.user_id)
    profile.user_id,
    owned.rollcaster_id
  from public.profiles profile
  join public.user_rollcasters owned on owned.user_id=profile.user_id
  where profile.starter_rollcaster_selected_at is not null
    and owned.unlocked_at<=profile.starter_rollcaster_selected_at
  order by profile.user_id,owned.unlocked_at,owned.id
)
insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id)
select user_id,'rollcaster',rollcaster_id
from starter_rollcaster
on conflict(user_id,collectible_type,collectible_id) do nothing;

with starter_critter as (
  select distinct on (profile.user_id)
    profile.user_id,
    owned.critter_id
  from public.profiles profile
  join public.user_critters owned on owned.user_id=profile.user_id
  where profile.starter_selected_at is not null
    and owned.unlocked_at<=profile.starter_selected_at
  order by profile.user_id,owned.unlocked_at,owned.id
)
insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id)
select user_id,'critter',critter_id
from starter_critter
on conflict(user_id,collectible_type,collectible_id) do nothing;

commit;
