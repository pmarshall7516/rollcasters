-- Newly unlocked Critter Skills fill the first available skill slot. If all
-- slots are occupied, the Skill remains unlocked for manual equipment later.

create or replace function public.unlock_critter_skill(p_user_critter_id uuid,p_skill_id text)
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
  v_open_slot_index int;
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

  select slot_index
  into v_open_slot_index
  from public.user_critter_skill_slots
  where user_critter_id = p_user_critter_id
    and skill_id is null
  order by slot_index
  limit 1;

  if v_open_slot_index is not null then
    update public.user_critter_skill_slots
    set skill_id = p_skill_id
    where user_critter_id = p_user_critter_id
      and slot_index = v_open_slot_index;
  end if;
end;
$$;
