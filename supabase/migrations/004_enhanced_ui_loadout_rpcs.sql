insert into public.game_assets (
  path, category, owner_table, owner_id, variant, display_name, alt_text, content_type, sort_order
) values
  ('ui/logo.png', 'ui', 'global', 'logo', 'full', 'Rollcasters logo', 'Rollcasters', 'image/png', 1),
  ('ui/small-logo.png', 'ui', 'global', 'logo', 'compact', 'Rollcasters compact logo', 'Rollcasters home', 'image/png', 2),
  ('ui/relic-slot.png', 'ui', 'global', 'relic-slot', 'empty', 'Empty relic slot', 'Empty relic slot', 'image/png', 12)
on conflict (category, owner_table, owner_id, variant) do update set
  path = excluded.path, display_name = excluded.display_name, alt_text = excluded.alt_text,
  content_type = excluded.content_type, sort_order = excluded.sort_order, is_active = true, updated_at = now();

create or replace function public.set_squad_critter_slot(p_slot_index int, p_user_critter_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_slot_index not between 1 and 3 then raise exception 'Squad slot is locked'; end if;
  if p_user_critter_id is not null and not exists (
    select 1 from user_critters where id = p_user_critter_id and user_id = v_user_id
  ) then raise exception 'Critter is not owned'; end if;
  if p_user_critter_id is not null and exists (
    select 1 from user_squad_slots where user_id = v_user_id and user_critter_id = p_user_critter_id and slot_index <> p_slot_index
  ) then raise exception 'Critter is already in the squad'; end if;
  if p_user_critter_id is null and (
    select count(*) from user_squad_slots where user_id = v_user_id and user_critter_id is not null and slot_index <> p_slot_index
  ) < 1 then raise exception 'At least one combat-ready critter is required'; end if;
  insert into user_squad_slots(user_id, slot_index, user_critter_id)
  values(v_user_id, p_slot_index, p_user_critter_id)
  on conflict(user_id, slot_index) do update set user_critter_id = excluded.user_critter_id;
end; $$;

create or replace function public.set_critter_skill_slot(p_user_critter_id uuid, p_slot_index int, p_skill_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid();
begin
  if not exists (select 1 from user_critters where id = p_user_critter_id and user_id = v_user_id) then raise exception 'Critter is not owned'; end if;
  if p_slot_index not between 1 and 4 then raise exception 'Skill slot is locked'; end if;
  if p_skill_id is not null and not exists (
    select 1 from user_critter_skills where user_critter_id = p_user_critter_id and skill_id = p_skill_id
  ) then raise exception 'Skill is not unlocked'; end if;
  if p_skill_id is not null and exists (
    select 1 from user_critter_skill_slots where user_critter_id = p_user_critter_id and skill_id = p_skill_id and slot_index <> p_slot_index
  ) then raise exception 'Skill is already equipped'; end if;
  if p_skill_id is null and (
    select count(*) from user_critter_skill_slots where user_critter_id = p_user_critter_id and skill_id is not null and slot_index <> p_slot_index
  ) < 1 then raise exception 'At least one skill must remain equipped'; end if;
  insert into user_critter_skill_slots(user_critter_id, slot_index, skill_id)
  values(p_user_critter_id, p_slot_index, p_skill_id)
  on conflict(user_critter_id, slot_index) do update set skill_id = excluded.skill_id;
end; $$;

create or replace function public.set_critter_relic_slot(p_user_critter_id uuid, p_slot_index int, p_relic_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_level int; v_critter_id text; v_slots int; v_owned int; v_equipped int;
begin
  select level, critter_id into v_level, v_critter_id from user_critters where id = p_user_critter_id and user_id = v_user_id;
  if v_critter_id is null then raise exception 'Critter is not owned'; end if;
  select total_unlocked_relic_slots into v_slots from critter_level_progression
    where critter_id = v_critter_id and level <= v_level order by level desc limit 1;
  if p_slot_index < 1 or p_slot_index > coalesce(v_slots, 0) then raise exception 'Relic slot is locked'; end if;
  if p_relic_id is not null then
    select quantity into v_owned from user_relic_inventory where user_id = v_user_id and relic_id = p_relic_id;
    select count(*) into v_equipped from user_critter_relic_slots urs
      join user_critters uc on uc.id = urs.user_critter_id
      where uc.user_id = v_user_id and urs.relic_id = p_relic_id
        and not (urs.user_critter_id = p_user_critter_id and urs.slot_index = p_slot_index);
    if coalesce(v_owned, 0) <= v_equipped then raise exception 'No relic copies available'; end if;
  end if;
  insert into user_critter_relic_slots(user_critter_id, slot_index, relic_id)
  values(p_user_critter_id, p_slot_index, p_relic_id)
  on conflict(user_critter_id, slot_index) do update set relic_id = excluded.relic_id;
end; $$;

create or replace function public.set_rollcaster_ability_slot(p_user_rollcaster_id uuid, p_slot_index int, p_ability_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_level int; v_rollcaster_id text; v_slots int;
begin
  select level, rollcaster_id into v_level, v_rollcaster_id from user_rollcasters where id = p_user_rollcaster_id and user_id = v_user_id;
  if v_rollcaster_id is null then raise exception 'Rollcaster is not owned'; end if;
  select total_unlocked_ability_slots into v_slots from rollcaster_level_progression
    where rollcaster_id = v_rollcaster_id and level <= v_level order by level desc limit 1;
  if p_slot_index < 1 or p_slot_index > coalesce(v_slots, 0) then raise exception 'Ability slot is locked'; end if;
  if p_ability_id is not null and not exists (
    select 1 from user_rollcaster_abilities where user_rollcaster_id = p_user_rollcaster_id and ability_id = p_ability_id
  ) then raise exception 'Ability is not unlocked'; end if;
  if p_ability_id is not null and exists (
    select 1 from user_rollcaster_ability_slots where user_rollcaster_id = p_user_rollcaster_id and ability_id = p_ability_id and slot_index <> p_slot_index
  ) then raise exception 'Ability is already equipped'; end if;
  if p_ability_id is null and (
    select count(*) from user_rollcaster_ability_slots where user_rollcaster_id = p_user_rollcaster_id and ability_id is not null and slot_index <> p_slot_index
  ) < 1 then raise exception 'At least one ability must remain equipped'; end if;
  insert into user_rollcaster_ability_slots(user_rollcaster_id, slot_index, ability_id)
  values(p_user_rollcaster_id, p_slot_index, p_ability_id)
  on conflict(user_rollcaster_id, slot_index) do update set ability_id = excluded.ability_id;
end; $$;

create or replace function public.set_active_rollcaster(p_user_rollcaster_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid();
begin
  if not exists (select 1 from user_rollcasters where id = p_user_rollcaster_id and user_id = v_user_id) then raise exception 'Rollcaster is not owned'; end if;
  update profiles set active_rollcaster_id = p_user_rollcaster_id, updated_at = now() where user_id = v_user_id;
end; $$;

grant execute on function public.set_squad_critter_slot(int, uuid) to authenticated;
grant execute on function public.set_critter_skill_slot(uuid, int, text) to authenticated;
grant execute on function public.set_critter_relic_slot(uuid, int, text) to authenticated;
grant execute on function public.set_rollcaster_ability_slot(uuid, int, text) to authenticated;
grant execute on function public.set_active_rollcaster(uuid) to authenticated;
