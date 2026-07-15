-- Keep Rollcaster Ability slots independently removable, including the final
-- equipped Ability. Combat and loadout rendering already support empty slots.

create or replace function public.set_rollcaster_ability_slot(
  p_user_rollcaster_id uuid,
  p_slot_index int,
  p_ability_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_level int;
  v_rollcaster_id text;
  v_slots int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select level, rollcaster_id
  into v_level, v_rollcaster_id
  from public.user_rollcasters
  where id = p_user_rollcaster_id and user_id = v_user_id;
  if v_rollcaster_id is null then raise exception 'Rollcaster is not owned'; end if;

  select total_unlocked_ability_slots
  into v_slots
  from public.rollcaster_level_progression
  where rollcaster_id = v_rollcaster_id and level <= v_level
  order by level desc
  limit 1;
  if p_slot_index < 1 or p_slot_index > coalesce(v_slots, 0) then
    raise exception 'Ability slot is locked';
  end if;

  if p_ability_id is not null and not exists (
    select 1
    from public.user_rollcaster_abilities
    where user_rollcaster_id = p_user_rollcaster_id and ability_id = p_ability_id
  ) then
    raise exception 'Ability is not unlocked';
  end if;

  if p_ability_id is not null and exists (
    select 1
    from public.user_rollcaster_ability_slots
    where user_rollcaster_id = p_user_rollcaster_id
      and ability_id = p_ability_id
      and slot_index <> p_slot_index
  ) then
    raise exception 'Ability is already equipped';
  end if;

  insert into public.user_rollcaster_ability_slots(user_rollcaster_id, slot_index, ability_id)
  values(p_user_rollcaster_id, p_slot_index, p_ability_id)
  on conflict(user_rollcaster_id, slot_index)
  do update set ability_id = excluded.ability_id;
end;
$$;

grant execute on function public.set_rollcaster_ability_slot(uuid, int, text) to authenticated;
