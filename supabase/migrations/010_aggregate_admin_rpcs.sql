-- Narrow, transactional content-admin RPCs. All writes remain inaccessible through direct table policies.

create or replace function public.admin_write_audit(
  p_entity_type text, p_entity_id text, p_operation text,
  p_previous_version integer, p_next_version integer,
  p_before jsonb, p_after jsonb, p_note text default null
) returns void language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.content_change_log
    (admin_user_id,entity_type,entity_id,operation,previous_version,next_version,before_snapshot,after_snapshot,change_note)
  values
    (public.assert_content_admin(),p_entity_type,p_entity_id,p_operation,p_previous_version,p_next_version,p_before,p_after,p_note);
end;
$$;

create or replace function public.admin_save_element(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid := public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text := payload->>'id'; v_version integer;
begin
  if v_id is null or v_id !~ '^[a-z0-9_-]+$' or nullif(btrim(payload->>'name'),'') is null then raise exception 'VALIDATION: id and name are required'; end if;
  select to_jsonb(e),version into v_before,v_version from public.elements e where id=v_id for update;
  if found and v_version <> expected_version then raise exception 'VERSION_CONFLICT: expected %, current %',expected_version,v_version; end if;
  insert into public.elements(id,name,description,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,asset_path=excluded.asset_path,sort_order=excluded.sort_order,
    is_active=excluded.is_active,is_archived=excluded.is_archived,version=elements.version+1,updated_at=now(),updated_by=v_user;
  select to_jsonb(e) into v_after from public.elements e where id=v_id;
  perform public.admin_write_audit('element',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_status(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid := public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text := payload->>'id'; v_version integer;
begin
  if nullif(v_id,'') is null or nullif(btrim(payload->>'name'),'') is null or nullif(btrim(payload->>'description'),'') is null then raise exception 'VALIDATION: id, name, and description are required'; end if;
  select to_jsonb(s),version into v_before,v_version from public.statuses s where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.statuses(id,name,description,effect,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description','{}',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,is_active=excluded.is_active,is_archived=excluded.is_archived,
    sort_order=excluded.sort_order,version=statuses.version+1,updated_at=now(),updated_by=v_user;
  delete from public.status_effect_attachments where status_id=v_id;
  insert into public.status_effect_attachments(status_id,effect_id,sort_order)
  select v_id,value::text,ordinality-1 from jsonb_array_elements_text(coalesce(payload->'attachments','[]')) with ordinality;
  select to_jsonb(s) into v_after from public.statuses s where id=v_id;
  perform public.admin_write_audit('status',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_effect_definition(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int; v_template text:=payload->'fields'->>'template';
begin
  if nullif(v_id,'') is null or nullif(payload->>'name','') is null or nullif(v_template,'') is null then raise exception 'VALIDATION: id, name, and template are required'; end if;
  if not exists(select 1 from public.effect_templates where id=v_template and is_active and is_runtime_supported) and payload->>'status'='active' then raise exception 'UNSUPPORTED_TEMPLATE'; end if;
  select to_jsonb(e),version into v_before,v_version from public.effect_definitions e where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.effect_definitions(id,name,description,template_id,parameters,is_active,is_archived,version,sort_order,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',v_template,coalesce(payload->'fields','{}')-'template'-'usage',payload->>'status'='active',payload->>'status'='archived',1,coalesce((payload->>'sortOrder')::int,0),v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,template_id=excluded.template_id,parameters=excluded.parameters,
    is_active=excluded.is_active,is_archived=excluded.is_archived,sort_order=excluded.sort_order,version=effect_definitions.version+1,updated_at=now(),updated_by=v_user;
  select to_jsonb(e) into v_after from public.effect_definitions e where id=v_id;
  perform public.admin_write_audit('effect',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_skill(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int; v_type text:=payload->'fields'->>'type';
begin
  if nullif(v_id,'') is null or nullif(payload->>'name','') is null or v_type not in ('attack','support') then raise exception 'VALIDATION: invalid skill identity/type'; end if;
  if v_type='attack' and coalesce((payload->'fields'->>'power')::int,0)<=0 then raise exception 'VALIDATION: attack power must be positive'; end if;
  select to_jsonb(s),version into v_before,v_version from public.skills s where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.skills(id,name,element_id,skill_type,power,mana_cost,description,effect,targeting,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'elementId',v_type,case when v_type='support' then 0 else (payload->'fields'->>'power')::int end,
    coalesce((payload->'fields'->>'manaCost')::int,0),payload->>'description','{}',coalesce(payload->'fields'->>'targeting','single_enemy'),coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,element_id=excluded.element_id,skill_type=excluded.skill_type,power=excluded.power,mana_cost=excluded.mana_cost,
    description=excluded.description,targeting=excluded.targeting,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,
    version=skills.version+1,updated_at=now(),updated_by=v_user;
  delete from public.skill_effect_attachments where skill_id=v_id;
  insert into public.skill_effect_attachments(skill_id,effect_id,role,sort_order)
  select v_id,value::text,'secondary',ordinality-1 from jsonb_array_elements_text(coalesce(payload->'attachments','[]')) with ordinality;
  select to_jsonb(s) into v_after from public.skills s where id=v_id;
  perform public.admin_write_audit('skill',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_ability(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  select to_jsonb(a),version into v_before,v_version from public.rollcaster_abilities a where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if payload->>'status'='active' and jsonb_array_length(coalesce(payload->'attachments','[]'))=0 then raise exception 'VALIDATION: published ability requires an effect'; end if;
  insert into public.rollcaster_abilities(id,name,description,effect,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description','{}',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=rollcaster_abilities.version+1,updated_at=now(),updated_by=v_user;
  delete from public.ability_effect_attachments where ability_id=v_id;
  insert into public.ability_effect_attachments select v_id,value::text,ordinality-1 from jsonb_array_elements_text(coalesce(payload->'attachments','[]')) with ordinality;
  select to_jsonb(a) into v_after from public.rollcaster_abilities a where id=v_id;
  perform public.admin_write_audit('ability',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_relic(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  if coalesce((payload->'fields'->>'maxOwned')::int,0)<1 then raise exception 'VALIDATION: max owned must be positive'; end if;
  select to_jsonb(r),version into v_before,v_version from public.relics r where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.relics(id,name,description,max_owned,effect,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',(payload->'fields'->>'maxOwned')::int,'{}',payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,max_owned=excluded.max_owned,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=relics.version+1,updated_at=now(),updated_by=v_user;
  delete from public.relic_effect_attachments where relic_id=v_id;
  insert into public.relic_effect_attachments select v_id,value::text,ordinality-1 from jsonb_array_elements_text(coalesce(payload->'attachments','[]')) with ordinality;
  select to_jsonb(r) into v_after from public.relics r where id=v_id;
  perform public.admin_write_audit('relic',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_critter(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int; v_row jsonb; v_prev jsonb;
begin
  if coalesce((payload->'fields'->>'baseHp')::int,0)<1 or coalesce((payload->'fields'->>'diceMin')::int,0)<1 or (payload->'fields'->>'diceMax')::int<(payload->'fields'->>'diceMin')::int then raise exception 'VALIDATION: invalid base stats'; end if;
  select to_jsonb(c),version into v_before,v_version from public.critters c where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.critters(id,name,description,element_id,base_hp,base_atk,base_def,base_spd,base_dice_min,base_dice_max,base_block_cost,base_swap_cost,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',payload->>'elementId',(payload->'fields'->>'baseHp')::int,(payload->'fields'->>'baseAtk')::int,(payload->'fields'->>'baseDef')::int,(payload->'fields'->>'baseSpd')::int,(payload->'fields'->>'diceMin')::int,(payload->'fields'->>'diceMax')::int,(payload->'fields'->>'blockCost')::int,(payload->'fields'->>'swapCost')::int,payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,element_id=excluded.element_id,base_hp=excluded.base_hp,base_atk=excluded.base_atk,base_def=excluded.base_def,base_spd=excluded.base_spd,base_dice_min=excluded.base_dice_min,base_dice_max=excluded.base_dice_max,base_block_cost=excluded.base_block_cost,base_swap_cost=excluded.base_swap_cost,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=critters.version+1,updated_at=now(),updated_by=v_user;
  delete from public.critter_skill_unlocks where critter_id=v_id;
  insert into public.critter_skill_unlocks(critter_id,skill_id,unlock_level,unlock_cost,is_default,sort_order)
  select v_id,u->>'refId',(u->>'level')::int,(u->>'cost')::int,coalesce((u->>'isDefault')::boolean,false),ordinality-1 from jsonb_array_elements(coalesce(payload->'unlocks','[]')) with ordinality x(u,ordinality);
  delete from public.critter_level_progression where critter_id=v_id;
  v_prev:=null;
  for v_row in select value from jsonb_array_elements(coalesce(payload->'levels','[]')) loop
    insert into public.critter_level_progression(critter_id,level,total_required_xp,grant_skill_points,hp_delta,atk_delta,def_delta,spd_delta,dice_min_delta,dice_max_delta,block_cost_delta,swap_cost_delta,total_unlocked_relic_slots)
    values(v_id,(v_row->>'level')::int,(v_row->>'xp')::int,(v_row->>'points')::int,
      case when v_prev is null then 0 else (v_row->>'hp')::int-(v_prev->>'hp')::int end,case when v_prev is null then 0 else (v_row->>'atk')::int-(v_prev->>'atk')::int end,
      case when v_prev is null then 0 else (v_row->>'def')::int-(v_prev->>'def')::int end,case when v_prev is null then 0 else (v_row->>'spd')::int-(v_prev->>'spd')::int end,
      case when v_prev is null then 0 else (v_row->>'diceMin')::int-(v_prev->>'diceMin')::int end,case when v_prev is null then 0 else (v_row->>'diceMax')::int-(v_prev->>'diceMax')::int end,
      case when v_prev is null then 0 else (v_row->>'block')::int-(v_prev->>'block')::int end,case when v_prev is null then 0 else (v_row->>'swap')::int-(v_prev->>'swap')::int end,(v_row->>'slots')::int);
    v_prev:=v_row;
  end loop;
  select to_jsonb(c) into v_after from public.critters c where id=v_id;
  perform public.admin_write_audit('critter',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_rollcaster(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  select to_jsonb(r),version into v_before,v_version from public.rollcasters r where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.rollcasters(id,name,description,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=rollcasters.version+1,updated_at=now(),updated_by=v_user;
  delete from public.rollcaster_level_progression where rollcaster_id=v_id;
  insert into public.rollcaster_level_progression(rollcaster_id,level,total_required_xp,grant_ability_points,total_unlocked_ability_slots)
  select v_id,(l->>'level')::int,(l->>'xp')::int,(l->>'points')::int,(l->>'slots')::int from jsonb_array_elements(coalesce(payload->'levels','[]')) l;
  delete from public.rollcaster_ability_unlocks where rollcaster_id=v_id;
  insert into public.rollcaster_ability_unlocks(rollcaster_id,ability_id,unlock_level,unlock_cost,is_default,sort_order)
  select v_id,u->>'refId',(u->>'level')::int,(u->>'cost')::int,coalesce((u->>'isDefault')::boolean,false),ordinality-1 from jsonb_array_elements(coalesce(payload->'unlocks','[]')) with ordinality x(u,ordinality);
  select to_jsonb(r) into v_after from public.rollcasters r where id=v_id;
  perform public.admin_write_audit('rollcaster',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_dungeon(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int; v_op jsonb; v_op_id uuid; v_pair record;
begin
  select to_jsonb(d),version into v_before,v_version from public.dungeons d where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.dungeons(id,name,dungeon_type,difficulty,battle_format,player_active_count,opponent_active_count,encounter_count,next_dungeon_id,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->'fields'->>'type',(payload->'fields'->>'difficulty')::int,payload->'fields'->>'format',coalesce((payload->'fields'->>'playerCount')::int,1),coalesce((payload->'fields'->>'opponentCount')::int,1),(payload->'fields'->>'encounterCount')::int,nullif(payload->'fields'->>'nextDungeon',''),coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,dungeon_type=excluded.dungeon_type,difficulty=excluded.difficulty,battle_format=excluded.battle_format,player_active_count=excluded.player_active_count,opponent_active_count=excluded.opponent_active_count,encounter_count=excluded.encounter_count,next_dungeon_id=excluded.next_dungeon_id,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=dungeons.version+1,updated_at=now(),updated_by=v_user;
  delete from public.dungeon_opponents where dungeon_id=v_id;
  for v_op in select value from jsonb_array_elements(coalesce(payload->'opponents','[]')) loop
    insert into public.dungeon_opponents(dungeon_id,pool_type,sequence_index,probability,selection_weight,critter_id,critter_level,skill_ids,relic_ids,rollcaster_xp_reward,critter_xp_reward,currency_reward,drops)
    values(v_id,v_op->>'pool',1,nullif(v_op->>'weight','')::numeric,nullif(v_op->>'weight','')::numeric,v_op->>'critterId',(v_op->>'level')::int,array(select jsonb_array_elements_text(coalesce(v_op->'skills','[]'))),array(select jsonb_array_elements_text(coalesce(v_op->'relics','[]'))),coalesce((v_op->>'xp')::int,0),coalesce((v_op->>'xp')::int,0),coalesce((v_op->>'coins')::int,0),'[]') returning id into v_op_id;
    insert into public.dungeon_opponent_skills select v_op_id,value::text,ordinality-1 from jsonb_array_elements_text(coalesce(v_op->'skills','[]')) with ordinality;
    insert into public.dungeon_opponent_relics select v_op_id,value::text,ordinality-1 from jsonb_array_elements_text(coalesce(v_op->'relics','[]')) with ordinality;
    for v_pair in select * from jsonb_each_text(coalesce(v_op->'overrides','{}')) loop
      if v_pair.value is not null then insert into public.dungeon_opponent_stat_overrides values(v_op_id,case v_pair.key when 'diceMin' then 'dice_min' when 'diceMax' then 'dice_max' when 'block' then 'block_cost' when 'swap' then 'swap_cost' else v_pair.key end,v_pair.value::int); end if;
    end loop;
  end loop;
  select to_jsonb(d) into v_after from public.dungeons d where id=v_id;
  perform public.admin_write_audit('dungeon',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_publish_content(entity_type text, entity_id text, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_after jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' when 'effect' then 'effect_definitions' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','effect_definitions','statuses','elements','dungeons') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  execute format('select to_jsonb(t),version from public.%I t where id=$1 for update',v_table) into v_before,v_version using entity_id;
  if v_before is null then raise exception 'NOT_FOUND'; end if; if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('update public.%I set is_active=true,is_archived=false,version=version+1,updated_at=now(),updated_by=$1 where id=$2 returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_user,entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'publish',v_version,v_version+1,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_archive_content(entity_type text, entity_id text, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_after jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' when 'effect' then 'effect_definitions' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','effect_definitions','statuses','elements','dungeons') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  execute format('select to_jsonb(t),version from public.%I t where id=$1 for update',v_table) into v_before,v_version using entity_id;
  if v_before is null then raise exception 'NOT_FOUND'; end if; if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('update public.%I set is_active=false,is_archived=true,version=version+1,updated_at=now(),updated_by=$1 where id=$2 returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_user,entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'archive',v_version,v_version+1,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_content_usage(entity_type text, entity_id text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid:=public.assert_content_admin(); v_result jsonb:='[]';
begin
  if entity_type='effect' then select coalesce(jsonb_agg(x),'[]') into v_result from (select 'skill' entity_type,skill_id entity_id from public.skill_effect_attachments where effect_id=admin_content_usage.entity_id union all select 'relic',relic_id from public.relic_effect_attachments where effect_id=admin_content_usage.entity_id union all select 'ability',ability_id from public.ability_effect_attachments where effect_id=admin_content_usage.entity_id) x;
  elsif entity_type='skill' then select coalesce(jsonb_agg(x),'[]') into v_result from (select 'critter' entity_type,critter_id entity_id from public.critter_skill_unlocks where skill_id=admin_content_usage.entity_id union all select 'dungeon_opponent',opponent_id::text from public.dungeon_opponent_skills where skill_id=admin_content_usage.entity_id) x;
  elsif entity_type='element' then select coalesce(jsonb_agg(x),'[]') into v_result from (select 'critter' entity_type,id entity_id from public.critters where element_id=admin_content_usage.entity_id union all select 'skill',id from public.skills where element_id=admin_content_usage.entity_id) x;
  end if; return v_result;
end; $$;

create or replace function public.admin_validate_content(entity_type text, entity_id text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.assert_content_admin();
  return jsonb_build_object('valid',true,'entity_type',entity_type,'entity_id',entity_id,'errors','[]'::jsonb);
end; $$;

create or replace function public.admin_delete_content(entity_type text, entity_id text, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := public.assert_content_admin();
  v_table text;
  v_before jsonb;
  v_version integer;
begin
  v_table := case entity_type
    when 'ability' then 'rollcaster_abilities'
    when 'effect' then 'effect_definitions'
    when 'asset' then 'game_assets'
    else entity_type || 's'
  end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','effect_definitions','statuses','elements','dungeons','game_assets') then
    raise exception 'UNSUPPORTED_ENTITY_TYPE';
  end if;
  if v_table='game_assets' then
    execute 'select to_jsonb(t),1 from public.game_assets t where id::text=$1 for update'
      into v_before,v_version using entity_id;
  else
    execute format('select to_jsonb(t),version from public.%I t where id::text=$1 for update',v_table)
      into v_before,v_version using entity_id;
  end if;
  if v_before is null then raise exception 'NOT_FOUND'; end if;
  if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  -- Foreign-key restrictions remain authoritative. Referenced content fails atomically.
  execute format('delete from public.%I where id::text=$1',v_table) using entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'delete',v_version,null,v_before,null);
  return jsonb_build_object('deleted',true,'entity_type',entity_type,'entity_id',entity_id);
end; $$;

do $$ declare v_function record; begin
  for v_function in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'admin_%' loop
    execute format('revoke all on function %s from public',v_function.signature);
    execute format('grant execute on function %s to authenticated',v_function.signature);
  end loop;
end $$;

comment on function public.admin_save_critter(jsonb,integer) is 'Transactionally saves a critter root, progression, and skill unlock aggregate with optimistic locking.';
comment on function public.admin_save_dungeon(jsonb,integer) is 'Transactionally saves a dungeon and normalized opponent children with final-value overrides.';
