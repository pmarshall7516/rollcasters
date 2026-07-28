-- Relics are part of an active squad loadout. Skills remain remembered on the
-- owned Critter so removing and re-adding it restores the user's skill setup.

create or replace function public.set_squad_critter_slot(p_slot_index integer,p_user_critter_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_previous_user_critter_id uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_slot_index not between 1 and 3 then raise exception 'Squad slot is locked'; end if;

  select user_critter_id
  into v_previous_user_critter_id
  from user_squad_slots
  where user_id = v_user_id
    and slot_index = p_slot_index
  for update;

  if p_user_critter_id is not null and not exists (
    select 1 from user_critters where id = p_user_critter_id and user_id = v_user_id
  ) then raise exception 'Critter is not owned'; end if;
  if p_user_critter_id is not null and exists (
    select 1 from user_squad_slots where user_id = v_user_id and user_critter_id = p_user_critter_id and slot_index <> p_slot_index
  ) then raise exception 'Critter is already in the squad'; end if;
  if p_user_critter_id is null and (
    select count(*) from user_squad_slots where user_id = v_user_id and user_critter_id is not null and slot_index <> p_slot_index
  ) < 1 then raise exception 'At least one combat-ready critter is required'; end if;

  if v_previous_user_critter_id is not null and v_previous_user_critter_id is distinct from p_user_critter_id then
    update user_critter_relic_slots
    set relic_id = null
    where user_critter_id = v_previous_user_critter_id
      and relic_id is not null;
  end if;

  insert into user_squad_slots(user_id, slot_index, user_critter_id)
  values(v_user_id, p_slot_index, p_user_critter_id)
  on conflict(user_id, slot_index) do update set user_critter_id = excluded.user_critter_id;
end;
$$;
