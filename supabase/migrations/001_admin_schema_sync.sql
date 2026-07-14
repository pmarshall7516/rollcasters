-- ONLY CURRENT DATABASE MIGRATION.
--
-- Prerequisite: the existing Rollcasters schema through the former migration
-- 014 is already installed. This is intentionally not a fresh-database
-- bootstrap and contains no catalog/demo seed data.
--
-- Close remaining Content Studio persistence gaps discovered by the end-to-end
-- frontend/table audit. Dungeons now persist their editable description, boss
-- ordering follows the editor row order, and asset variants round-trip.

alter table public.dungeons
  add column if not exists description text not null default '';

create or replace function public.admin_save_dungeon(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := public.assert_content_admin();
  v_before jsonb;
  v_after jsonb;
  v_id text := payload->>'id';
  v_version integer;
  v_op jsonb;
  v_op_id uuid;
  v_pair record;
  v_ordinality bigint;
begin
  select to_jsonb(d), version into v_before, v_version
  from public.dungeons d where id = v_id for update;
  if found and v_version <> expected_version then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.dungeons(
    id,name,description,dungeon_type,difficulty,battle_format,player_active_count,
    opponent_active_count,encounter_count,next_dungeon_id,sort_order,is_active,
    is_archived,version,created_by,updated_by
  ) values (
    v_id,payload->>'name',payload->>'description',payload->'fields'->>'type',
    (payload->'fields'->>'difficulty')::int,payload->'fields'->>'format',
    coalesce((payload->'fields'->>'playerCount')::int,1),
    coalesce((payload->'fields'->>'opponentCount')::int,1),
    (payload->'fields'->>'encounterCount')::int,
    nullif(payload->'fields'->>'nextDungeon',''),
    coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',
    payload->>'status'='archived',1,v_user,v_user
  ) on conflict(id) do update set
    name=excluded.name,description=excluded.description,dungeon_type=excluded.dungeon_type,
    difficulty=excluded.difficulty,battle_format=excluded.battle_format,
    player_active_count=excluded.player_active_count,
    opponent_active_count=excluded.opponent_active_count,
    encounter_count=excluded.encounter_count,next_dungeon_id=excluded.next_dungeon_id,
    sort_order=excluded.sort_order,is_active=excluded.is_active,
    is_archived=excluded.is_archived,version=dungeons.version+1,
    updated_at=now(),updated_by=v_user;

  delete from public.dungeon_opponents where dungeon_id = v_id;
  for v_op, v_ordinality in
    select value, ordinality
    from jsonb_array_elements(coalesce(payload->'opponents','[]')) with ordinality
  loop
    insert into public.dungeon_opponents(
      dungeon_id,pool_type,sequence_index,probability,selection_weight,critter_id,
      critter_level,skill_ids,relic_ids,rollcaster_xp_reward,critter_xp_reward,
      currency_reward,drops
    ) values (
      v_id,v_op->>'pool',v_ordinality-1,
      case when v_op->>'pool'='regular_pool' then nullif(v_op->>'weight','')::numeric else null end,
      case when v_op->>'pool'='regular_pool' then nullif(v_op->>'weight','')::numeric else null end,
      v_op->>'critterId',(v_op->>'level')::int,
      array(select jsonb_array_elements_text(coalesce(v_op->'skills','[]'))),
      array(select jsonb_array_elements_text(coalesce(v_op->'relics','[]'))),
      coalesce((v_op->>'xp')::int,0),coalesce((v_op->>'xp')::int,0),
      coalesce((v_op->>'coins')::int,0),'[]'
    ) returning id into v_op_id;

    insert into public.dungeon_opponent_skills
      select v_op_id,value::text,ordinality-1
      from jsonb_array_elements_text(coalesce(v_op->'skills','[]')) with ordinality;
    insert into public.dungeon_opponent_relics
      select v_op_id,value::text,ordinality-1
      from jsonb_array_elements_text(coalesce(v_op->'relics','[]')) with ordinality;
    for v_pair in select * from jsonb_each_text(coalesce(v_op->'overrides','{}')) loop
      if v_pair.value is not null then
        insert into public.dungeon_opponent_stat_overrides
        values(v_op_id,case v_pair.key
          when 'diceMin' then 'dice_min' when 'diceMax' then 'dice_max'
          when 'block' then 'block_cost' when 'swap' then 'swap_cost'
          else v_pair.key end,v_pair.value::int);
      end if;
    end loop;
  end loop;

  select to_jsonb(d) into v_after from public.dungeons d where id=v_id;
  perform public.admin_write_audit('dungeon',v_id,
    case when v_before is null then 'create' else 'update' end,
    v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_asset(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := public.assert_content_admin();
  v_before jsonb; v_after jsonb;
  v_id uuid := (payload->>'id')::uuid;
  v_path text := btrim(payload->'fields'->>'path');
  v_category text := lower(btrim(payload->'fields'->>'category'));
  v_owner_id text := nullif(btrim(payload->'fields'->>'owner'), '');
  v_variant text := coalesce(nullif(btrim(payload->'fields'->>'variant'), ''), 'default');
  v_existing_id uuid;
begin
  if v_path is null or v_path = '' or v_path ~ '^/' or v_path ~ '(^|/)\.\.(/|$)' then raise exception 'VALIDATION: invalid Storage object path'; end if;
  if v_category is null or v_category !~ '^[a-z0-9][a-z0-9_-]*$' then raise exception 'VALIDATION: invalid category'; end if;
  if not exists(select 1 from storage.objects where bucket_id='game-assets' and name=v_path) then raise exception 'VALIDATION: Storage object does not exist in game-assets'; end if;
  select id,to_jsonb(a) into v_existing_id,v_before from public.game_assets a
    where id=v_id or (bucket_id='game-assets' and path=v_path and variant=v_variant)
    order by (id=v_id) desc limit 1 for update;
  if v_before is null and expected_version<>0 then raise exception 'VERSION_CONFLICT'; end if;
  if v_before is not null and expected_version<>1 then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.game_assets(id,bucket_id,path,category,owner_table,owner_id,variant,display_name,alt_text,content_type,is_active,sort_order,updated_at)
  values(coalesce(v_existing_id,v_id),'game-assets',v_path,v_category,
    case when v_owner_id is null then null else case v_category when 'critter' then 'critters' when 'rollcaster' then 'rollcasters' when 'relic' then 'relics' when 'element' then 'elements' else v_category end end,
    v_owner_id,v_variant,payload->>'name',nullif(payload->>'description',''),nullif(payload->'fields'->>'contentType',''),true,coalesce((payload->>'sortOrder')::int,0),now())
  on conflict(id) do update set path=excluded.path,category=excluded.category,owner_table=excluded.owner_table,owner_id=excluded.owner_id,variant=excluded.variant,display_name=excluded.display_name,alt_text=excluded.alt_text,content_type=excluded.content_type,is_active=true,sort_order=excluded.sort_order,updated_at=now();
  select to_jsonb(a) into v_after from public.game_assets a where id=coalesce(v_existing_id,v_id);
  perform public.admin_write_audit('asset',coalesce(v_existing_id,v_id)::text,case when v_before is null then 'create' else 'update' end,case when v_before is null then null else 1 end,1,v_before,v_after);
  return v_after;
end; $$;

revoke all on function public.admin_save_dungeon(jsonb,integer) from public;
grant execute on function public.admin_save_dungeon(jsonb,integer) to authenticated;
revoke all on function public.admin_save_asset(jsonb,integer) from public;
grant execute on function public.admin_save_asset(jsonb,integer) to authenticated;
