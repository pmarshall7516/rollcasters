-- Collection progression, purchasable Critter Skills, and direct slot removal.

create or replace function public.calc_critter_level(p_critter_id text, p_xp int)
returns int language sql stable set search_path = public as $$
  select coalesce(max(level), 1)
  from public.critter_level_progression
  where critter_id = p_critter_id and total_required_xp <= p_xp;
$$;

create or replace function public.calc_rollcaster_level(p_rollcaster_id text, p_xp int)
returns int language sql stable set search_path = public as $$
  select coalesce(max(level), 1)
  from public.rollcaster_level_progression
  where rollcaster_id = p_rollcaster_id and total_required_xp <= p_xp;
$$;

create or replace function public.sync_user_critter_progression()
returns trigger language plpgsql set search_path = public as $$
declare
  v_level int;
  v_processed int;
  v_granted_points int := 0;
begin
  v_level := public.calc_critter_level(new.critter_id, greatest(new.xp, 0));
  v_processed := case when tg_op = 'INSERT' then 1 else coalesce(old.highest_processed_level, 1) end;

  if v_level > v_processed then
    select coalesce(sum(grant_skill_points), 0)
    into v_granted_points
    from public.critter_level_progression
    where critter_id = new.critter_id
      and level > v_processed
      and level <= v_level;
  end if;

  new.level := v_level;
  new.skill_points := coalesce(new.skill_points, 0) + v_granted_points;
  new.highest_processed_level := greatest(coalesce(new.highest_processed_level, 1), v_processed, v_level);
  return new;
end;
$$;

drop trigger if exists sync_user_critter_progression_on_xp on public.user_critters;
create trigger sync_user_critter_progression_on_xp
before insert or update of xp on public.user_critters
for each row execute function public.sync_user_critter_progression();

create or replace function public.sync_user_rollcaster_progression()
returns trigger language plpgsql set search_path = public as $$
declare
  v_level int;
  v_processed int;
  v_granted_points int := 0;
begin
  v_level := public.calc_rollcaster_level(new.rollcaster_id, greatest(new.xp, 0));
  v_processed := case when tg_op = 'INSERT' then 1 else coalesce(old.highest_processed_level, 1) end;

  if v_level > v_processed then
    select coalesce(sum(grant_ability_points), 0)
    into v_granted_points
    from public.rollcaster_level_progression
    where rollcaster_id = new.rollcaster_id
      and level > v_processed
      and level <= v_level;
  end if;

  new.level := v_level;
  new.ability_points := coalesce(new.ability_points, 0) + v_granted_points;
  new.highest_processed_level := greatest(coalesce(new.highest_processed_level, 1), v_processed, v_level);
  return new;
end;
$$;

drop trigger if exists sync_user_rollcaster_progression_on_xp on public.user_rollcasters;
create trigger sync_user_rollcaster_progression_on_xp
before insert or update of xp on public.user_rollcasters
for each row execute function public.sync_user_rollcaster_progression();

-- Process any XP earned before these triggers were installed.
update public.user_critters set xp = xp;
update public.user_rollcasters set xp = xp;

create or replace function public.unlock_critter_skill(p_user_critter_id uuid, p_skill_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_critter_id text;
  v_level int;
  v_points int;
  v_unlock_level int;
  v_unlock_cost int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select critter_id, level, skill_points
  into v_critter_id, v_level, v_points
  from public.user_critters
  where id = p_user_critter_id and user_id = v_user_id
  for update;
  if not found then raise exception 'Critter is not owned'; end if;

  if exists (
    select 1 from public.user_critter_skills
    where user_critter_id = p_user_critter_id and skill_id = p_skill_id
  ) then return; end if;

  select unlock_level, unlock_cost
  into v_unlock_level, v_unlock_cost
  from public.critter_skill_unlocks
  where critter_id = v_critter_id and skill_id = p_skill_id;
  if not found then raise exception 'Skill is not available to this Critter'; end if;
  if v_level < v_unlock_level then raise exception 'Critter level % is required', v_unlock_level; end if;
  if v_points < v_unlock_cost then raise exception 'Not enough skill points'; end if;

  update public.user_critters
  set skill_points = skill_points - v_unlock_cost
  where id = p_user_critter_id;

  insert into public.user_critter_skills (user_critter_id, skill_id)
  values (p_user_critter_id, p_skill_id)
  on conflict do nothing;
end;
$$;

create or replace function public.set_squad_critter_slot(p_slot_index int, p_user_critter_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_current_critter_id uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_slot_index not between 1 and 3 then raise exception 'Squad slot is locked'; end if;
  if p_user_critter_id is not null and not exists (
    select 1 from public.user_critters where id = p_user_critter_id and user_id = v_user_id
  ) then raise exception 'Critter is not owned'; end if;
  if p_user_critter_id is not null and exists (
    select 1 from public.user_squad_slots where user_id = v_user_id and user_critter_id = p_user_critter_id and slot_index <> p_slot_index
  ) then raise exception 'Critter is already in the squad'; end if;
  if p_user_critter_id is null and (
    select count(*) from public.user_squad_slots where user_id = v_user_id and user_critter_id is not null and slot_index <> p_slot_index
  ) < 1 then raise exception 'At least one combat-ready Critter is required'; end if;

  select user_critter_id into v_current_critter_id
  from public.user_squad_slots
  where user_id = v_user_id and slot_index = p_slot_index;

  if p_user_critter_id is null and v_current_critter_id is not null then
    update public.user_critter_relic_slots
    set relic_id = null
    where user_critter_id = v_current_critter_id;
  end if;

  insert into public.user_squad_slots(user_id, slot_index, user_critter_id)
  values(v_user_id, p_slot_index, p_user_critter_id)
  on conflict(user_id, slot_index) do update set user_critter_id = excluded.user_critter_id;
end;
$$;

create or replace function public.set_rollcaster_ability_slot(p_user_rollcaster_id uuid, p_slot_index int, p_ability_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_level int;
  v_rollcaster_id text;
  v_slots int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  select level, rollcaster_id into v_level, v_rollcaster_id
  from public.user_rollcasters
  where id = p_user_rollcaster_id and user_id = v_user_id;
  if v_rollcaster_id is null then raise exception 'Rollcaster is not owned'; end if;

  select total_unlocked_ability_slots into v_slots
  from public.rollcaster_level_progression
  where rollcaster_id = v_rollcaster_id and level <= v_level
  order by level desc limit 1;
  if p_slot_index < 1 or p_slot_index > coalesce(v_slots, 0) then raise exception 'Ability slot is locked'; end if;
  if p_ability_id is not null and not exists (
    select 1 from public.user_rollcaster_abilities
    where user_rollcaster_id = p_user_rollcaster_id and ability_id = p_ability_id
  ) then raise exception 'Ability is not unlocked'; end if;
  if p_ability_id is not null and exists (
    select 1 from public.user_rollcaster_ability_slots
    where user_rollcaster_id = p_user_rollcaster_id and ability_id = p_ability_id and slot_index <> p_slot_index
  ) then raise exception 'Ability is already equipped'; end if;

  insert into public.user_rollcaster_ability_slots(user_rollcaster_id, slot_index, ability_id)
  values(p_user_rollcaster_id, p_slot_index, p_ability_id)
  on conflict(user_rollcaster_id, slot_index) do update set ability_id = excluded.ability_id;
end;
$$;

grant execute on function public.unlock_critter_skill(uuid, text) to authenticated;
grant execute on function public.set_squad_critter_slot(int, uuid) to authenticated;
grant execute on function public.set_rollcaster_ability_slot(uuid, int, text) to authenticated;
