-- Spend authored progression points on collection-detail unlocks. Lock the
-- owned character row so concurrent requests cannot overspend the same point
-- balance, and keep validation, deduction, and unlock insertion atomic.

create or replace function public.unlock_critter_skill(
  p_user_critter_id uuid,
  p_skill_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_critter_id text;
  v_level int;
  v_skill_points int;
  v_unlock_level int;
  v_unlock_cost int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select owned.critter_id, owned.level, owned.skill_points
  into v_critter_id, v_level, v_skill_points
  from public.user_critters owned
  where owned.id = p_user_critter_id
    and owned.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Critter is not owned';
  end if;

  select authored.unlock_level, authored.unlock_cost
  into v_unlock_level, v_unlock_cost
  from public.critter_skill_unlocks authored
  where authored.critter_id = v_critter_id
    and authored.skill_id = p_skill_id;

  if not found then
    raise exception 'Skill is not available for this Critter';
  end if;

  if exists (
    select 1
    from public.user_critter_skills unlocked
    where unlocked.user_critter_id = p_user_critter_id
      and unlocked.skill_id = p_skill_id
  ) then
    raise exception 'Skill is already unlocked';
  end if;

  if v_level < v_unlock_level then
    raise exception 'Skill requires Critter level %', v_unlock_level;
  end if;

  if v_skill_points < v_unlock_cost then
    raise exception 'Not enough Skill points';
  end if;

  update public.user_critters
  set skill_points = skill_points - v_unlock_cost
  where id = p_user_critter_id;

  insert into public.user_critter_skills(user_critter_id, skill_id)
  values(p_user_critter_id, p_skill_id);
end;
$$;

create or replace function public.unlock_rollcaster_ability(
  p_user_rollcaster_id uuid,
  p_ability_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_rollcaster_id text;
  v_level int;
  v_ability_points int;
  v_unlock_level int;
  v_unlock_cost int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select owned.rollcaster_id, owned.level, owned.ability_points
  into v_rollcaster_id, v_level, v_ability_points
  from public.user_rollcasters owned
  where owned.id = p_user_rollcaster_id
    and owned.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Rollcaster is not owned';
  end if;

  select authored.unlock_level, authored.unlock_cost
  into v_unlock_level, v_unlock_cost
  from public.rollcaster_ability_unlocks authored
  where authored.rollcaster_id = v_rollcaster_id
    and authored.ability_id = p_ability_id;

  if not found then
    raise exception 'Ability is not available for this Rollcaster';
  end if;

  if exists (
    select 1
    from public.user_rollcaster_abilities unlocked
    where unlocked.user_rollcaster_id = p_user_rollcaster_id
      and unlocked.ability_id = p_ability_id
  ) then
    raise exception 'Ability is already unlocked';
  end if;

  if v_level < v_unlock_level then
    raise exception 'Ability requires Rollcaster level %', v_unlock_level;
  end if;

  if v_ability_points < v_unlock_cost then
    raise exception 'Not enough Ability points';
  end if;

  update public.user_rollcasters
  set ability_points = ability_points - v_unlock_cost
  where id = p_user_rollcaster_id;

  insert into public.user_rollcaster_abilities(user_id, user_rollcaster_id, ability_id)
  values(v_user_id, p_user_rollcaster_id, p_ability_id);
end;
$$;

revoke all on function public.unlock_critter_skill(uuid, text) from public;
revoke all on function public.unlock_rollcaster_ability(uuid, text) from public;
revoke all on function public.unlock_critter_skill(uuid, text) from anon;
revoke all on function public.unlock_rollcaster_ability(uuid, text) from anon;
grant execute on function public.unlock_critter_skill(uuid, text) to authenticated;
grant execute on function public.unlock_rollcaster_ability(uuid, text) to authenticated;
