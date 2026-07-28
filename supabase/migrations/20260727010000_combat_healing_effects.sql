begin;

-- Spiky Shield's Thorns is an independent attack reaction. It was authored as
-- child-only without a parent, so no runtime could ever install it.
update public.relic_effects
set execution='root'
where relic_id='005'
  and id='dff0d433-ec80-41ee-92de-bd8e8c130716'
  and execution<>'root';

-- Battle Medic healing is eligible for universal received-healing modifiers
-- such as Stim Shot.
update public.ability_effects
set parameters=jsonb_set(parameters,'{affected_by_healing_modifiers}','true'::jsonb,true)
where ability_id='battle-medic-1'
  and id='955a0772-9d12-4ab2-b776-b147a81a691a';

insert into public.unlock_challenge_templates(
  id,name,description,challenge_category,progress_mode,runtime_version,
  allowed_collectible_types,parameter_schema,ui_schema,sort_order
)
values (
  'heal_hp',
  'Heal HP',
  'Track actual HP restored after healing amplifiers and the missing-HP cap.',
  'tracked',
  'tracked_event',
  1,
  array['critter','rollcaster','relic'],
  '{
    "type":"object",
    "required":["required_amount","recipient_side","target_mode","target_ids","tracking_scope"],
    "properties":{
      "required_amount":{"type":"integer","minimum":1},
      "recipient_side":{"type":"string","enum":["any","friendly","enemy"]},
      "target_mode":{"type":"string","enum":["any","species","element"]},
      "target_ids":{"type":"array","items":{"type":"string"}},
      "tracking_scope":{"type":"string","enum":["lifetime","single_battle","single_dungeon"]}
    }
  }'::jsonb,
  '{"registry":"unlock-v2"}'::jsonb,
  75
)
on conflict(id) do update set
  name=excluded.name,
  description=excluded.description,
  challenge_category=excluded.challenge_category,
  progress_mode=excluded.progress_mode,
  runtime_version=excluded.runtime_version,
  allowed_collectible_types=excluded.allowed_collectible_types,
  parameter_schema=excluded.parameter_schema,
  ui_schema=excluded.ui_schema,
  sort_order=excluded.sort_order,
  is_active=true,
  is_archived=false,
  version=case
    when public.unlock_challenge_templates.parameter_schema=excluded.parameter_schema then public.unlock_challenge_templates.version
    else public.unlock_challenge_templates.version+1
  end,
  updated_at=now();

alter table public.collectible_combat_events
  drop constraint if exists collectible_combat_events_event_type_check,
  add constraint collectible_combat_events_event_type_check check (event_type in (
    'knock_out_critters','deal_damage','take_damage','use_skill',
    'critter_knocked_out','hp_damage_dealt','hp_damage_taken','skill_resolved',
    'battle_completed','dungeon_completed','swap_completed','block_completed',
    'dice_resolved','resource_spent','hp_healed'
  ));

-- Keep all three server-side trackability checks on the same vocabulary.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.collectible_challenge_states(uuid,text,text)'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,
    '''swap_action'',''block_action'',''dice_roll''',
    '''swap_action'',''block_action'',''dice_roll'',''heal_hp''');
  execute v_definition;

  select pg_get_functiondef('public.track_collectible_challenge(uuid)'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,
    '''swap_action'',''block_action'',''dice_roll''',
    '''swap_action'',''block_action'',''dice_roll'',''heal_hp''');
  execute v_definition;

  select pg_get_functiondef('public.validate_tracked_collectible_challenge()'::regprocedure) into v_definition;
  v_definition:=replace(v_definition,
    '''knock_out_critters'',''deal_damage'',''take_damage'',''use_skill''',
    '''knock_out_critters'',''deal_damage'',''take_damage'',''use_skill'',''squad_composition'',''dungeon_clear'',''resource_spending'',''swap_action'',''block_action'',''dice_roll'',''heal_hp''');
  execute v_definition;
end;
$$;

-- Extend the aggregate unlock validator with Heal HP goal projection and
-- species/Element reference validation.
do $$
declare
  v_definition text;
  v_marker text:='    elsif new.challenge_type=''dice_roll'' then';
  v_branch text:=$branch$    elsif new.challenge_type='heal_hp' then
      v_goal:=(new.parameters->>'required_amount')::bigint;
      if new.parameters->>'target_mode' in ('species','element') then
        if jsonb_array_length(coalesce(new.parameters->'target_ids','[]'::jsonb))=0 then
          raise exception 'VALIDATION: Heal HP requires at least one selected target';
        end if;
        for v_id in select jsonb_array_elements_text(new.parameters->'target_ids') loop
          v_kind:=case when new.parameters->>'target_mode'='species' then 'critter' else 'element' end;
          if not public.challenge_catalog_reference_exists(v_kind,v_id) then
            raise exception 'VALIDATION: Heal HP references missing % %',v_kind,v_id;
          end if;
        end loop;
      elsif new.parameters->>'target_mode'<>'any' then
        raise exception 'VALIDATION: unsupported Heal HP target mode';
      end if;
$branch$;
begin
  select pg_get_functiondef('public.validate_collectible_unlock_challenge()'::regprocedure)
  into v_definition;
  if position('challenge_type=''heal_hp''' in v_definition)=0 then
    if position(v_marker in v_definition)=0 then raise exception 'Heal HP validator insertion point is unavailable'; end if;
    v_definition:=replace(v_definition,v_marker,v_branch||v_marker);
    execute v_definition;
  end if;
end;
$$;

-- Add Heal HP matching to the audited v2 event matcher while preserving every
-- existing challenge branch verbatim.
do $$
declare
  v_definition text;
  v_marker text:='  if p_challenge.challenge_type=''resource_spending'' then';
  v_branch text:=$branch$  if p_challenge.challenge_type='heal_hp' then
    if p_event_type<>'hp_healed' or coalesce(p_payload->>'source_side','')<>'player' then return 0; end if;
    if coalesce(v_parameters->>'recipient_side','any')<>'any'
      and v_parameters->>'recipient_side' is distinct from p_payload->>'recipient_side' then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'target_ids','[]'::jsonb))),'{}');
    if v_parameters->>'target_mode'='species' and cardinality(v_ids)>0 and not (coalesce(p_target,'')=any(v_ids)) then return 0; end if;
    if v_parameters->>'target_mode'='element' and cardinality(v_ids)>0 and not (p_target_elements && v_ids) then return 0; end if;
    return greatest(p_amount,0);
  end if;

$branch$;
begin
  select pg_get_functiondef('public.challenge_event_increment_v2(uuid,text,text,text,text,bigint,jsonb,text[],text[])'::regprocedure)
  into v_definition;
  if position('challenge_type=''heal_hp''' in v_definition)=0 then
    if position(v_marker in v_definition)=0 then raise exception 'Heal HP matcher insertion point is unavailable'; end if;
    v_definition:=replace(v_definition,v_marker,v_branch||v_marker);
    execute v_definition;
  end if;
end;
$$;

-- Extend the idempotent combat receipt with the new event, validation, and
-- challenge mapping. The runtime records actual restored HP, never base or
-- overheal values.
do $$
declare
  v_definition text;
  v_insert_marker text:='    insert into public.collectible_combat_events';
  v_validation text:=$branch$    if v_type='hp_healed' then
      if coalesce(v_payload->>'source_side','')<>'player'
        or coalesce(v_payload->>'recipient_side','') not in ('friendly','enemy') then
        raise exception 'VALIDATION: invalid healing event';
      end if;
      if v_payload->>'recipient_side'='friendly'
        and not exists(select 1 from public.user_critters where user_id=v_user and critter_id=v_target) then
        raise exception 'VALIDATION: invalid friendly healing target';
      end if;
      if v_payload->>'recipient_side'='enemy'
        and not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_target) then
        raise exception 'VALIDATION: invalid enemy healing target';
      end if;
    end if;

$branch$;
begin
  select pg_get_functiondef('public.submit_collectible_combat_events(uuid,integer,jsonb)'::regprocedure)
  into v_definition;
  if position('''hp_healed''' in v_definition)=0 then
    v_definition:=replace(v_definition,
      '''dice_resolved'',''resource_spent''',
      '''dice_resolved'',''resource_spent'',''hp_healed''');
    v_definition:=replace(v_definition,
      'when ''resource_spent'' then ''resource_spending''',
      'when ''resource_spent'' then ''resource_spending'' when ''hp_healed'' then ''heal_hp''');
    if position(v_insert_marker in v_definition)=0 then raise exception 'Healing receipt validation insertion point is unavailable'; end if;
    v_definition:=replace(v_definition,v_insert_marker,v_validation||v_insert_marker);
    execute v_definition;
  end if;
end;
$$;

commit;
