-- Atomic, service-role-only developer operation used by the local
-- game:grant:* and game:revoke:* npm commands.

create or replace function public.dev_manage_user_collectible(
  p_action text,
  p_collectible_type text,
  p_user_email text,
  p_collectible_id text,
  p_count integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_type text := lower(btrim(coalesce(p_collectible_type, '')));
  v_email text := lower(btrim(coalesce(p_user_email, '')));
  v_collectible_id text := btrim(coalesce(p_collectible_id, ''));
  v_user_id uuid;
  v_user_matches integer;
  v_collectible_name text;
  v_owned_id uuid;
  v_default_unlock_id text;
  v_replacement_rollcaster_id uuid;
  v_previous_count integer := 0;
  v_new_count integer := 0;
  v_max_count integer;
  v_equipped_count integer := 0;
  v_slot_count integer := 1;
begin
  if v_action not in ('grant', 'revoke') then
    raise exception 'Action must be grant or revoke';
  end if;
  if v_type not in ('relic', 'critter', 'rollcaster') then
    raise exception 'Collectible type must be relic, critter, or rollcaster';
  end if;
  if v_email = '' then
    raise exception 'User email is required';
  end if;
  if v_collectible_id = '' then
    raise exception 'Collectible ID is required';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'Count must be a positive integer';
  end if;
  if v_type <> 'relic' and p_count <> 1 then
    raise exception 'Count is only supported for relics';
  end if;

  select count(*)
  into v_user_matches
  from auth.users
  where lower(email) = v_email;

  if v_user_matches = 0 then
    raise exception 'No user exists with email %', v_email;
  elsif v_user_matches > 1 then
    raise exception 'Multiple users unexpectedly match email %', v_email;
  end if;

  select id
  into v_user_id
  from auth.users
  where lower(email) = v_email;

  -- Serialize collectible changes for a user so concurrent grants cannot
  -- bypass unique ownership or relic maximum checks.
  perform id
  from auth.users
  where id = v_user_id
  for update;

  if v_type = 'relic' then
    select name, max_owned
    into v_collectible_name, v_max_count
    from public.relics
    where id = v_collectible_id;

    if not found then
      raise exception 'Relic % does not exist in the catalog', v_collectible_id;
    end if;

    select quantity
    into v_previous_count
    from public.user_relic_inventory
    where user_id = v_user_id and relic_id = v_collectible_id
    for update;
    v_previous_count := coalesce(v_previous_count, 0);

    if v_action = 'grant' then
      v_new_count := v_previous_count + p_count;
      if v_new_count > v_max_count then
        raise exception 'Cannot grant % copies of Relic % (%): user owns %, maximum is %',
          p_count, v_collectible_id, v_collectible_name, v_previous_count, v_max_count;
      end if;

      insert into public.user_relic_inventory (user_id, relic_id, quantity, discovered_at)
      values (v_user_id, v_collectible_id, v_new_count, now())
      on conflict (user_id, relic_id) do update
      set quantity = excluded.quantity,
          discovered_at = coalesce(user_relic_inventory.discovered_at, excluded.discovered_at);
    else
      if v_previous_count = 0 then
        raise exception 'User % does not have Relic % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;
      if p_count > v_previous_count then
        raise exception 'Cannot revoke % copies of Relic % (%): user only owns %',
          p_count, v_collectible_id, v_collectible_name, v_previous_count;
      end if;

      v_new_count := v_previous_count - p_count;
      select count(*)
      into v_equipped_count
      from public.user_critter_relic_slots relic_slot
      join public.user_critters owned_critter on owned_critter.id = relic_slot.user_critter_id
      where owned_critter.user_id = v_user_id
        and relic_slot.relic_id = v_collectible_id;

      if v_new_count < v_equipped_count then
        raise exception 'Cannot reduce Relic % (%) to %: % copies are equipped; unequip copies first',
          v_collectible_id, v_collectible_name, v_new_count, v_equipped_count;
      end if;

      if v_new_count = 0 then
        delete from public.user_relic_inventory
        where user_id = v_user_id and relic_id = v_collectible_id;
      else
        update public.user_relic_inventory
        set quantity = v_new_count
        where user_id = v_user_id and relic_id = v_collectible_id;
      end if;
    end if;

    return jsonb_build_object(
      'action', v_action,
      'collectible_type', v_type,
      'collectible_id', v_collectible_id,
      'collectible_name', v_collectible_name,
      'user_email', v_email,
      'user_id', v_user_id,
      'changed_count', p_count,
      'previous_count', v_previous_count,
      'new_count', v_new_count,
      'max_count', v_max_count
    );
  end if;

  if v_type = 'critter' then
    select name
    into v_collectible_name
    from public.critters
    where id = v_collectible_id;

    if not found then
      raise exception 'Critter % does not exist in the catalog', v_collectible_id;
    end if;

    select id
    into v_owned_id
    from public.user_critters
    where user_id = v_user_id and critter_id = v_collectible_id;

    if v_action = 'grant' then
      if v_owned_id is not null then
        raise exception 'User % already has Critter % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      insert into public.user_critters (user_id, critter_id)
      values (v_user_id, v_collectible_id)
      returning id into v_owned_id;

      insert into public.user_seen_critters (user_id, critter_id)
      values (v_user_id, v_collectible_id)
      on conflict do nothing;

      insert into public.user_critter_skills (user_critter_id, skill_id)
      select v_owned_id, unlock.skill_id
      from public.critter_skill_unlocks unlock
      where unlock.critter_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      on conflict do nothing;

      select unlock.skill_id
      into v_default_unlock_id
      from public.critter_skill_unlocks unlock
      where unlock.critter_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      limit 1;

      insert into public.user_critter_skill_slots (user_critter_id, slot_index, skill_id)
      select v_owned_id, slot_index,
        case when slot_index = 1 then v_default_unlock_id else null end
      from generate_series(1, 4) slot_index;
    else
      if v_owned_id is null then
        raise exception 'User % does not have Critter % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      -- Preserve combat history rows while releasing their live ownership FK.
      update public.combat_turn_actions
      set swap_in_user_critter_id = null
      where swap_in_user_critter_id = v_owned_id;

      delete from public.user_critters where id = v_owned_id;
    end if;
  else
    select name
    into v_collectible_name
    from public.rollcasters
    where id = v_collectible_id;

    if not found then
      raise exception 'Rollcaster % does not exist in the catalog', v_collectible_id;
    end if;

    select id
    into v_owned_id
    from public.user_rollcasters
    where user_id = v_user_id and rollcaster_id = v_collectible_id;

    if v_action = 'grant' then
      if v_owned_id is not null then
        raise exception 'User % already has Rollcaster % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      insert into public.user_rollcasters (user_id, rollcaster_id)
      values (v_user_id, v_collectible_id)
      returning id into v_owned_id;

      insert into public.user_rollcaster_abilities (user_id, user_rollcaster_id, ability_id)
      select v_user_id, v_owned_id, unlock.ability_id
      from public.rollcaster_ability_unlocks unlock
      where unlock.rollcaster_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      on conflict do nothing;

      select unlock.ability_id
      into v_default_unlock_id
      from public.rollcaster_ability_unlocks unlock
      where unlock.rollcaster_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      limit 1;

      select coalesce(max(progression.total_unlocked_ability_slots), 1)
      into v_slot_count
      from public.rollcaster_level_progression progression
      where progression.rollcaster_id = v_collectible_id
        and progression.level <= 1;
      v_slot_count := greatest(coalesce(v_slot_count, 1), 1);

      insert into public.user_rollcaster_ability_slots (user_rollcaster_id, slot_index, ability_id)
      select v_owned_id, slot_index,
        case when slot_index = 1 then v_default_unlock_id else null end
      from generate_series(1, v_slot_count) slot_index;

      update public.profiles
      set active_rollcaster_id = v_owned_id,
          updated_at = now()
      where user_id = v_user_id
        and active_rollcaster_id is null;
    else
      if v_owned_id is null then
        raise exception 'User % does not have Rollcaster % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      select id
      into v_replacement_rollcaster_id
      from public.user_rollcasters
      where user_id = v_user_id and id <> v_owned_id
      order by unlocked_at, id
      limit 1;

      update public.profiles
      set active_rollcaster_id = v_replacement_rollcaster_id,
          updated_at = now()
      where user_id = v_user_id
        and active_rollcaster_id = v_owned_id;

      delete from public.user_rollcasters where id = v_owned_id;
    end if;
  end if;

  return jsonb_build_object(
    'action', v_action,
    'collectible_type', v_type,
    'collectible_id', v_collectible_id,
    'collectible_name', v_collectible_name,
    'user_email', v_email,
    'user_id', v_user_id,
    'changed_count', 1,
    'previous_count', case when v_action = 'grant' then 0 else 1 end,
    'new_count', case when v_action = 'grant' then 1 else 0 end,
    'max_count', 1
  );
end;
$$;

revoke all on function public.dev_manage_user_collectible(text, text, text, text, integer) from public;
revoke all on function public.dev_manage_user_collectible(text, text, text, text, integer) from anon;
revoke all on function public.dev_manage_user_collectible(text, text, text, text, integer) from authenticated;
grant execute on function public.dev_manage_user_collectible(text, text, text, text, integer) to service_role;
