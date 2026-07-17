do $migration$
declare
  v_legacy_generated "char";
begin
  if to_regclass('public.critters') is null then
    raise exception 'MIGRATION: public.critters does not exist';
  end if;

  if not exists(
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='critters' and column_name='element_1_id'
  ) then
    if not exists(
      select 1
      from information_schema.columns
      where table_schema='public' and table_name='critters' and column_name='element_id'
    ) then
      raise exception 'MIGRATION: Critters have neither element_id nor element_1_id';
    end if;
    select attribute.attgenerated
    into v_legacy_generated
    from pg_attribute attribute
    where attribute.attrelid='public.critters'::regclass
      and attribute.attname='element_id'
      and not attribute.attisdropped;
    if v_legacy_generated<>'' then
      raise exception 'MIGRATION: element_id is generated before element_1_id exists';
    end if;
    alter table public.critters rename column element_id to element_1_id;
  end if;

  alter table public.critters add column if not exists element_2_id text;

  if exists(select 1 from public.critters where element_1_id is null) then
    raise exception 'MIGRATION: Every Critter requires Element 1';
  end if;
  if exists(
    select 1
    from public.critters critter
    where not exists(select 1 from public.elements element where element.id=critter.element_1_id)
  ) then
    raise exception 'MIGRATION: A Critter references an unknown Element 1';
  end if;
  if exists(
    select 1
    from public.critters critter
    where critter.element_2_id is not null
      and not exists(select 1 from public.elements element where element.id=critter.element_2_id)
  ) then
    raise exception 'MIGRATION: A Critter references an unknown Element 2';
  end if;
  if exists(select 1 from public.critters where element_2_id=element_1_id) then
    raise exception 'MIGRATION: Critter Element slots must be different';
  end if;

  alter table public.critters drop constraint if exists critters_element_id_fkey;
  alter table public.critters drop constraint if exists critters_element_1_id_fkey;
  alter table public.critters drop constraint if exists critters_element_2_id_fkey;
  alter table public.critters drop constraint if exists critters_element_slots_distinct_check;

  alter table public.critters alter column element_1_id set not null;
  alter table public.critters
    add constraint critters_element_1_id_fkey
    foreign key(element_1_id) references public.elements(id) on update cascade;
  alter table public.critters
    add constraint critters_element_2_id_fkey
    foreign key(element_2_id) references public.elements(id) on update cascade;
  alter table public.critters
    add constraint critters_element_slots_distinct_check
    check(element_2_id is null or element_2_id<>element_1_id);

  if not exists(
    select 1
    from information_schema.columns
    where table_schema='public' and table_name='critters' and column_name='element_id'
  ) then
    alter table public.critters
      add column element_id text generated always as (element_1_id) stored;
  end if;
  if exists(
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='critters'
      and column_name='element_id'
      and (
        is_generated<>'ALWAYS'
        or generation_expression is null
        or generation_expression not like '%element_1_id%'
      )
  ) then
    raise exception 'MIGRATION: element_id must be a generated alias of Element 1';
  end if;
end;
$migration$;

create index if not exists critters_element_1_id_idx
  on public.critters(element_1_id);
create index if not exists critters_element_2_id_idx
  on public.critters(element_2_id)
  where element_2_id is not null;

create or replace function public.admin_save_critter(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=public.assert_content_admin();
  v_before jsonb;
  v_after jsonb;
  v_id text:=payload->>'id';
  v_version int;
  v_row jsonb;
  v_prev jsonb;
  v_element_1_id text:=nullif(btrim(payload->>'element1Id'),'');
  v_element_2_id text:=nullif(btrim(payload->>'element2Id'),'');
begin
  if v_element_1_id is null then raise exception 'VALIDATION: Element 1 is required'; end if;
  if not exists(select 1 from public.elements where id=v_element_1_id) then raise exception 'VALIDATION: Element 1 is unknown'; end if;
  if v_element_2_id is not null and not exists(select 1 from public.elements where id=v_element_2_id) then raise exception 'VALIDATION: Element 2 is unknown'; end if;
  if v_element_2_id=v_element_1_id then raise exception 'VALIDATION: Element 1 and Element 2 must be different'; end if;
  if coalesce((payload->'fields'->>'baseHp')::int,0)<1
    or coalesce((payload->'fields'->>'diceMin')::int,0)<1
    or (payload->'fields'->>'diceMax')::int<(payload->'fields'->>'diceMin')::int
  then raise exception 'VALIDATION: invalid base stats'; end if;

  select to_jsonb(c)||jsonb_build_object('collect',public.collectible_unlock_snapshot('critter',v_id)),version
  into v_before,v_version from public.critters c where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.critters(
    id,name,description,element_1_id,element_2_id,
    base_hp,base_atk,base_def,base_spd,base_dice_min,base_dice_max,
    base_block_cost,base_swap_cost,asset_path,sort_order,
    is_active,is_archived,version,created_by,updated_by
  )
  values(
    v_id,payload->>'name',payload->>'description',v_element_1_id,v_element_2_id,
    (payload->'fields'->>'baseHp')::int,(payload->'fields'->>'baseAtk')::int,
    (payload->'fields'->>'baseDef')::int,(payload->'fields'->>'baseSpd')::int,
    (payload->'fields'->>'diceMin')::int,(payload->'fields'->>'diceMax')::int,
    (payload->'fields'->>'blockCost')::int,(payload->'fields'->>'swapCost')::int,
    payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),
    payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user
  )
  on conflict(id) do update set
    name=excluded.name,description=excluded.description,
    element_1_id=excluded.element_1_id,element_2_id=excluded.element_2_id,
    base_hp=excluded.base_hp,base_atk=excluded.base_atk,
    base_def=excluded.base_def,base_spd=excluded.base_spd,
    base_dice_min=excluded.base_dice_min,base_dice_max=excluded.base_dice_max,
    base_block_cost=excluded.base_block_cost,base_swap_cost=excluded.base_swap_cost,
    asset_path=excluded.asset_path,sort_order=excluded.sort_order,
    is_active=excluded.is_active,is_archived=excluded.is_archived,
    version=critters.version+1,updated_at=now(),updated_by=v_user;

  delete from public.critter_skill_unlocks where critter_id=v_id;
  insert into public.critter_skill_unlocks(critter_id,skill_id,unlock_level,unlock_cost,is_default,sort_order)
  select v_id,u->>'refId',(u->>'level')::int,(u->>'cost')::int,
    coalesce((u->>'isDefault')::boolean,false),ordinality-1
  from jsonb_array_elements(coalesce(payload->'unlocks','[]'::jsonb)) with ordinality x(u,ordinality);

  delete from public.critter_level_progression where critter_id=v_id;
  v_prev:=null;
  for v_row in select value from jsonb_array_elements(coalesce(payload->'levels','[]'::jsonb)) loop
    insert into public.critter_level_progression(
      critter_id,level,total_required_xp,grant_skill_points,
      hp_delta,atk_delta,def_delta,spd_delta,
      dice_min_delta,dice_max_delta,block_cost_delta,swap_cost_delta,
      total_unlocked_relic_slots
    )
    values(
      v_id,(v_row->>'level')::int,(v_row->>'xp')::int,(v_row->>'points')::int,
      case when v_prev is null then 0 else (v_row->>'hp')::int-(v_prev->>'hp')::int end,
      case when v_prev is null then 0 else (v_row->>'atk')::int-(v_prev->>'atk')::int end,
      case when v_prev is null then 0 else (v_row->>'def')::int-(v_prev->>'def')::int end,
      case when v_prev is null then 0 else (v_row->>'spd')::int-(v_prev->>'spd')::int end,
      case when v_prev is null then 0 else (v_row->>'diceMin')::int-(v_prev->>'diceMin')::int end,
      case when v_prev is null then 0 else (v_row->>'diceMax')::int-(v_prev->>'diceMax')::int end,
      case when v_prev is null then 0 else (v_row->>'block')::int-(v_prev->>'block')::int end,
      case when v_prev is null then 0 else (v_row->>'swap')::int-(v_prev->>'swap')::int end,
      (v_row->>'slots')::int
    );
    v_prev:=v_row;
  end loop;

  perform public.replace_collectible_unlocks('critter',v_id,coalesce(payload->'collect','{}'::jsonb));
  select to_jsonb(c)||jsonb_build_object('collect',public.collectible_unlock_snapshot('critter',v_id))
  into v_after from public.critters c where id=v_id;
  perform public.admin_write_audit(
    'critter',v_id,case when v_before is null then 'create' else 'update' end,
    v_version,(v_after->>'version')::int,v_before,v_after
  );
  return v_after;
end; $$;

create or replace function public.admin_content_usage(entity_type text,entity_id text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_result jsonb:='[]';
begin
  if entity_type='skill' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'critter' entity_type,critter_id entity_id
      from public.critter_skill_unlocks where skill_id=admin_content_usage.entity_id
      union all
      select 'dungeon_opponent',opponent_id::text
      from public.dungeon_opponent_skills where skill_id=admin_content_usage.entity_id
    ) x;
  elsif entity_type='status' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'skill' entity_type,skill_id entity_id
      from public.skill_effects where parameters->>'status_id'=admin_content_usage.entity_id
    ) x;
  elsif entity_type='element' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'critter' entity_type,id entity_id
      from public.critters
      where element_1_id=admin_content_usage.entity_id
         or element_2_id=admin_content_usage.entity_id
      union all
      select 'skill',id from public.skills
      where element_id=admin_content_usage.entity_id
      union all
      select 'ability',ability_id from public.ability_effects
      where parameters->'element_ids' ? admin_content_usage.entity_id
    ) x;
  end if;
  return v_result;
end; $$;
