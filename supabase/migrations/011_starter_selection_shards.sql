-- Treat starter selection as the 50-shard unlock that it replaces. Keep the
-- shard balance in sync so collection challenge history remains truthful for
-- both new selections and players who selected a starter before this fix.

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

  select starter_selected_at into v_starter_selected_at
  from public.profiles
  where user_id=v_user_id
  for update;

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

-- The original starter RPC inserts user_critters and stamps the profile with
-- now() in one transaction, so equal timestamps identify the historic starter
-- without mistaking starter species unlocked later for the selected starter.
insert into public.user_collectible_shards(
  user_id,
  collectible_type,
  collectible_id,
  quantity,
  updated_at
)
select profile.user_id,'critter',owned.critter_id,50,now()
from public.profiles profile
join public.user_critters owned
  on owned.user_id=profile.user_id
 and owned.unlocked_at=profile.starter_selected_at
join public.starter_options starter on starter.critter_id=owned.critter_id
where profile.starter_selected_at is not null
on conflict(user_id,collectible_type,collectible_id) do update
set quantity=greatest(public.user_collectible_shards.quantity,excluded.quantity),
    updated_at=case
      when public.user_collectible_shards.quantity<excluded.quantity then now()
      else public.user_collectible_shards.updated_at
    end;
