-- Compact authenticated game bootstrap kept separate from the shared release ledger.\n-- Keep the transitional live-development catalog RPC explicit as well. The
-- baseline version used to_jsonb(row), which unnecessarily exposed authoring
-- timestamps/version/actor fields to public clients.
create or replace function public.get_collectible_shop_catalog()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'asset_path', c.asset_path, 'text_color', c.text_color,
        'is_default', c.is_default, 'is_system', c.is_system,
        'sort_order', c.sort_order, 'is_active', c.is_active, 'is_archived', c.is_archived
      ) order by c.is_default desc, c.sort_order, c.name, c.id)
      from public.currencies c where c.is_active and not c.is_archived
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'collectible_type', r.collectible_type, 'collectible_id', r.collectible_id,
        'required_challenges', r.required_challenges
      ) order by r.collectible_type, r.collectible_id)
      from public.collectible_unlock_requirements r
    ), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ch.id, 'collectible_type', ch.collectible_type, 'collectible_id', ch.collectible_id,
        'challenge_type', ch.challenge_type, 'target_category', ch.target_category,
        'target_id', ch.target_id, 'target_mode', ch.target_mode, 'any_target', ch.any_target,
        'target_ids', ch.target_ids, 'required_amount', case when ch.required_amount is null then null else ch.required_amount::text end,
        'required_level', ch.required_level, 'sort_order', ch.sort_order, 'gate_order', ch.gate_order
      ) order by ch.collectible_type, ch.collectible_id, ch.sort_order, ch.id)
      from public.collectible_unlock_challenges ch
    ), '[]'::jsonb),
    'shop_entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'shop_type', s.shop_type, 'name', s.name, 'description', s.description,
        'target_category', s.target_category, 'target_id', s.target_id, 'quantity', s.quantity,
        'currency_id', s.currency_id, 'price', s.price::text, 'sort_order', s.sort_order,
        'is_active', s.is_active, 'is_archived', s.is_archived
      ) order by s.shop_type, s.sort_order, s.name, s.id)
      from public.shop_entries s where s.is_active and not s.is_archived
    ), '[]'::jsonb)
  );
$$;

alter table public.profiles
  add column if not exists player_state_revision bigint not null default 0;

create or replace function public.bump_profile_state_revision_on_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.player_state_revision = old.player_state_revision then
    new.player_state_revision := old.player_state_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_profile_state_revision on public.profiles;
create trigger bump_profile_state_revision
before update on public.profiles
for each row execute function public.bump_profile_state_revision_on_update();

create or replace function public.bump_player_state_revision_direct()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then v_user := old.user_id; else v_user := new.user_id; end if;
  update public.profiles
  set player_state_revision = player_state_revision + 1
  where user_id = v_user;
  return coalesce(new, old);
end;
$$;

create or replace function public.bump_player_state_revision_indirect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned_id uuid;
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_owned_id := case
      when tg_table_name like 'user_rollcaster_%' then old.user_rollcaster_id
      else old.user_critter_id
    end;
  else
    v_owned_id := case
      when tg_table_name like 'user_rollcaster_%' then new.user_rollcaster_id
      else new.user_critter_id
    end;
  end if;

  if tg_table_name like 'user_rollcaster_%' then
    select user_id into v_user from public.user_rollcasters where id = v_owned_id;
  else
    select user_id into v_user from public.user_critters where id = v_owned_id;
  end if;

  if v_user is not null then
    update public.profiles
    set player_state_revision = player_state_revision + 1
    where user_id = v_user;
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'user_rollcasters',
    'user_critters',
    'user_relic_inventory',
    'user_squad_slots',
    'user_dungeon_progress',
    'user_currencies',
    'user_collectible_shards',
    'user_collectible_challenge_progress',
    'user_tracked_collectible_challenges',
    'user_collectible_unlock_events'
  ] loop
    execute format('drop trigger if exists bump_player_state_revision on public.%I', v_table);
    execute format(
      'create trigger bump_player_state_revision after insert or update or delete on public.%I for each row execute function public.bump_player_state_revision_direct()',
      v_table
    );
  end loop;

  foreach v_table in array array[
    'user_critter_skill_slots',
    'user_critter_relic_slots',
    'user_critter_skills',
    'user_rollcaster_ability_slots',
    'user_rollcaster_abilities'
  ] loop
    execute format('drop trigger if exists bump_player_state_revision on public.%I', v_table);
    execute format(
      'create trigger bump_player_state_revision after insert or update or delete on public.%I for each row execute function public.bump_player_state_revision_indirect()',
      v_table
    );
  end loop;
end;
$$;

create or replace function public.player_bootstrap_v1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_collectibles jsonb;
  v_result jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  -- This call also reconciles gated tracking and evaluates pending unlocks.
  v_collectibles := public.get_collectible_player_snapshot();

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'user_id', p.user_id,
        'username', p.username,
        'coins', p.coins,
        'starter_rollcaster_selected_at', p.starter_rollcaster_selected_at,
        'starter_selected_at', p.starter_selected_at,
        'active_rollcaster_id', p.active_rollcaster_id
      ) from public.profiles p where p.user_id = v_user
    ),
    'rollcasters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'user_id', u.user_id, 'rollcaster_id', u.rollcaster_id,
        'level', u.level, 'xp', u.xp, 'ability_points', u.ability_points
      ) order by u.unlocked_at, u.id)
      from public.user_rollcasters u where u.user_id = v_user
    ), '[]'::jsonb),
    'critters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'user_id', u.user_id, 'critter_id', u.critter_id,
        'level', u.level, 'xp', u.xp, 'skill_points', u.skill_points
      ) order by u.unlocked_at, u.id)
      from public.user_critters u where u.user_id = v_user
    ), '[]'::jsonb),
    'relic_inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', u.user_id, 'relic_id', u.relic_id, 'quantity', u.quantity,
        'discovered_at', u.discovered_at
      ) order by u.relic_id)
      from public.user_relic_inventory u where u.user_id = v_user
    ), '[]'::jsonb),
    'squad_slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', u.user_id, 'slot_index', u.slot_index, 'user_critter_id', u.user_critter_id
      ) order by u.slot_index)
      from public.user_squad_slots u where u.user_id = v_user
    ), '[]'::jsonb),
    'skill_slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_critter_id', s.user_critter_id, 'slot_index', s.slot_index, 'skill_id', s.skill_id
      ) order by s.user_critter_id, s.slot_index)
      from public.user_critter_skill_slots s
      join public.user_critters u on u.id = s.user_critter_id
      where u.user_id = v_user
    ), '[]'::jsonb),
    'ability_slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_rollcaster_id', s.user_rollcaster_id, 'slot_index', s.slot_index, 'ability_id', s.ability_id
      ) order by s.user_rollcaster_id, s.slot_index)
      from public.user_rollcaster_ability_slots s
      join public.user_rollcasters u on u.id = s.user_rollcaster_id
      where u.user_id = v_user
    ), '[]'::jsonb),
    'relic_slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_critter_id', s.user_critter_id, 'slot_index', s.slot_index, 'relic_id', s.relic_id
      ) order by s.user_critter_id, s.slot_index)
      from public.user_critter_relic_slots s
      join public.user_critters u on u.id = s.user_critter_id
      where u.user_id = v_user
    ), '[]'::jsonb),
    'unlocked_skills', coalesce((
      select jsonb_agg(jsonb_build_object('user_critter_id', s.user_critter_id, 'skill_id', s.skill_id)
        order by s.user_critter_id, s.skill_id)
      from public.user_critter_skills s
      join public.user_critters u on u.id = s.user_critter_id
      where u.user_id = v_user
    ), '[]'::jsonb),
    'unlocked_abilities', coalesce((
      select jsonb_agg(jsonb_build_object('user_rollcaster_id', a.user_rollcaster_id, 'ability_id', a.ability_id)
        order by a.user_rollcaster_id, a.ability_id)
      from public.user_rollcaster_abilities a
      join public.user_rollcasters u on u.id = a.user_rollcaster_id
      where u.user_id = v_user
    ), '[]'::jsonb),
    'dungeon_progress', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', d.user_id, 'dungeon_id', d.dungeon_id, 'is_unlocked', d.is_unlocked,
        'completed_at', d.completed_at, 'clear_count', d.clear_count
      ) order by d.dungeon_id)
      from public.user_dungeon_progress d where d.user_id = v_user
    ), '[]'::jsonb),
    'collectible_snapshot', v_collectibles,
    'player_state_revision', p.player_state_revision::text,
    'server_catalog_version', (
      select channel.current_release_id
      from public.content_release_channels channel
      where channel.channel = 'production'
    )
  ) into v_result
  from public.profiles p
  where p.user_id = v_user;

  if v_result is null then raise exception 'PLAYER_STATE_MISSING'; end if;
  return v_result;
end;
$$;

revoke all on function public.player_bootstrap_v1() from public, anon;
grant execute on function public.player_bootstrap_v1() to authenticated, service_role;
revoke all on function public.bump_profile_state_revision_on_update() from public, anon, authenticated;
revoke all on function public.bump_player_state_revision_direct() from public, anon, authenticated;
revoke all on function public.bump_player_state_revision_indirect() from public, anon, authenticated;

comment on table public.content_releases is
  'Authoritative metadata for immutable static catalog releases. Artifact bytes live on the configured static host.';
comment on function public.player_bootstrap_v1() is
  'Compact versioned authenticated player bootstrap. Public catalog definitions are intentionally excluded.';
