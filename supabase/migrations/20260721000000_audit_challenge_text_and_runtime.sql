begin;

-- Keep the server-side event matcher aligned with the authored v2 parameters.
-- The original rollout persisted the richer payloads but only enforced the
-- legacy target filters, which could make a generic win/action complete a
-- specifically configured tracked Challenge.
create or replace function public.challenge_event_increment_v2(
  p_challenge_id uuid,
  p_event_type text,
  p_source text,
  p_target text,
  p_skill text,
  p_amount bigint,
  p_payload jsonb,
  p_source_elements text[],
  p_target_elements text[]
)
returns bigint
language plpgsql
stable
set search_path=public
as $$
declare
  p_challenge public.collectible_unlock_challenges%rowtype;
  v_parameters jsonb;
  v_ids text[];
  v_squad jsonb:=coalesce(p_payload->'squad','[]'::jsonb);
  v_matching integer;
  v_value numeric;
  v_min_order integer;
  v_max_order integer;
begin
  select * into p_challenge from public.collectible_unlock_challenges where id=p_challenge_id;
  if not found then return 0; end if;
  v_parameters:=coalesce(p_challenge.parameters,'{}'::jsonb);
  if p_challenge.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill') then
    if p_event_type<>(case p_challenge.challenge_type
      when 'knock_out_critters' then 'critter_knocked_out'
      when 'deal_damage' then 'hp_damage_dealt'
      when 'take_damage' then 'hp_damage_taken'
      else 'skill_resolved'
    end) and p_event_type<>p_challenge.challenge_type then return 0; end if;
    if coalesce((v_parameters->>'any_target')::boolean,p_challenge.any_target)=false then
      v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'target_ids','[]'::jsonb))),p_challenge.target_ids);
      if cardinality(v_ids)=0 then return 0; end if;
      if v_parameters->>'target_mode'='species' or (v_parameters->>'target_mode' is null and p_challenge.target_mode='species') then
        if coalesce(p_target,p_skill)<>all(v_ids) then return 0; end if;
      elsif v_parameters->>'target_mode'='skill' or (v_parameters->>'target_mode' is null and p_challenge.target_mode='skill') then
        if p_skill is null or p_skill<>all(v_ids) then return 0; end if;
      elsif v_parameters->>'target_mode'='element' or (v_parameters->>'target_mode' is null and p_challenge.target_mode='element') then
        if not (p_target_elements && v_ids) then return 0; end if;
      end if;
    end if;
    return case when p_challenge.challenge_type in ('knock_out_critters','use_skill') then 1 else greatest(p_amount,0) end;
  end if;

  if p_challenge.challenge_type='resource_spending' then
    if p_event_type<>'resource_spent' then return 0; end if;
    if v_parameters->>'spending_context' is distinct from coalesce(p_payload->>'spending_context',p_payload->>'context') then return 0; end if;
    if v_parameters->>'resource_type' is distinct from p_payload->>'resource_type' then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'dungeon_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_payload->>'dungeon_id','')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'ability_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_payload->>'ability_id','')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'critter_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_source,'')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'rollcaster_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_payload->>'rollcaster_id','')=any(v_ids)) then return 0; end if;
    return greatest(p_amount,0);
  end if;

  if p_challenge.challenge_type='squad_composition' then
    if p_event_type not in ('battle_completed','dungeon_completed') or coalesce((p_payload->>'won')::boolean,false)=false then return 0; end if;
    if v_parameters->>'completion_event'='battle_win' and p_event_type<>'battle_completed' then return 0; end if;
    if v_parameters->>'completion_event'='dungeon_clear' and p_event_type<>'dungeon_completed' then return 0; end if;
    if jsonb_array_length(v_squad)=0 then return 0; end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(v_parameters->'required_critter_ids','[]'::jsonb)) required_id where not exists(select 1 from jsonb_array_elements(v_squad) unit where unit->>'critter_id'=required_id)) then return 0; end if;
    if exists(select 1 from jsonb_array_elements_text(coalesce(v_parameters->'required_element_ids','[]'::jsonb)) required_id where not exists(select 1 from jsonb_array_elements(v_squad) unit where exists(select 1 from jsonb_array_elements_text(coalesce(unit->'element_ids','[]'::jsonb)) element_id where element_id=required_id))) then return 0; end if;
    select count(*) into v_matching
    from jsonb_array_elements(v_squad) unit
    where (unit->>'critter_id')=any(coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'required_critter_ids','[]'::jsonb))),'{}'))
      or exists(select 1 from jsonb_array_elements_text(coalesce(unit->'element_ids','[]'::jsonb)) element_id where element_id=any(coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'required_element_ids','[]'::jsonb))),'{}')));
    if v_parameters ? 'required_matching_critters' and v_matching<coalesce((v_parameters->>'required_matching_critters')::integer,0) then return 0; end if;
    if v_parameters ? 'required_distinct_elements' then
      select count(distinct element_id) into v_value from jsonb_array_elements(v_squad) unit, jsonb_array_elements_text(coalesce(unit->'element_ids','[]'::jsonb)) element_id;
      if v_value<coalesce((v_parameters->>'required_distinct_elements')::integer,0) then return 0; end if;
    end if;
    if v_parameters->>'all_squad_members_must_match'='true' and v_matching<>jsonb_array_length(v_squad) then return 0; end if;
    if v_parameters->>'require_survival'='true' and exists(select 1 from jsonb_array_elements(v_squad) unit where coalesce((unit->>'survived')::boolean,false)=false) then return 0; end if;
    return 1;
  end if;

  if p_challenge.challenge_type='dungeon_clear' then
    if p_event_type<>'dungeon_completed' or coalesce((p_payload->>'won')::boolean,false)=false then return 0; end if;
    if v_parameters->>'dungeon_selection'='specific_dungeon' and not (p_payload->>'dungeon_id'=any(coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'dungeon_ids','[]'::jsonb))),'{}'))) then return 0; end if;
    if v_parameters->>'dungeon_selection'='dungeon_id_range' then
      select sort_order into v_min_order from public.dungeons where id=(v_parameters->'minimum_dungeon_ids'->>0);
      select sort_order into v_max_order from public.dungeons where id=(v_parameters->'maximum_dungeon_ids'->>0);
      if (p_payload->>'dungeon_order')::integer<v_min_order or (p_payload->>'dungeon_order')::integer>v_max_order then return 0; end if;
    end if;
    if v_parameters->>'require_relic_activation'='true' and coalesce((p_payload->>'required_relics_activated')::boolean,false)=false then return 0; end if;
    return 1;
  end if;

  if p_challenge.challenge_type='swap_action' then
    if p_event_type<>'swap_completed' then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'dungeon_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_payload->>'dungeon_id','')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'critter_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_source,p_payload->>'incoming_critter_id')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'element_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not ((p_source_elements && v_ids) or exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'incoming_element_ids','[]'::jsonb)) element_id where element_id=any(v_ids))) then return 0; end if;
    if v_parameters->>'tracked_action'='unique_critters_swapped_in' then return case when (p_payload->>'unique')::boolean then 1 else 0 end; end if;
    if v_parameters->>'tracked_action'='damage_avoided_by_swap' then return greatest(coalesce((p_payload->>'damage_avoided')::bigint,p_amount),0); end if;
    if v_parameters->>'tracked_action'='knockout_after_swap' and coalesce((p_payload->>'knockout_after_swap')::boolean,false)=false then return 0; end if;
    return 1;
  end if;

  if p_challenge.challenge_type='block_action' then
    if p_event_type<>'block_completed' then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'dungeon_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_payload->>'dungeon_id','')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'critter_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_source,'')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'enemy_critter_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_target,'')=any(v_ids)) then return 0; end if;
    if v_parameters->>'tracked_action'='damage_prevented' then return greatest(coalesce((p_payload->>'damage_prevented')::bigint,p_amount),0); end if;
    if v_parameters->>'tracked_action'='attacks_fully_blocked' and coalesce((p_payload->>'fully_blocked')::boolean,false)=false then return 0; end if;
    if v_parameters->>'tracked_action'='survived_attack_after_block' and coalesce((p_payload->>'survived')::boolean,false)=false then return 0; end if;
    return 1;
  end if;

  if p_challenge.challenge_type='dice_roll' then
    if p_event_type<>'dice_resolved' then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'die_types','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_payload->>'die_type','')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'critter_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_source,'')=any(v_ids)) then return 0; end if;
    v_ids:=coalesce(array(select jsonb_array_elements_text(coalesce(v_parameters->'ability_ids','[]'::jsonb))),'{}');
    if cardinality(v_ids)>0 and not (coalesce(p_payload->>'ability_id','')=any(v_ids)) then return 0; end if;
    v_value:=case when v_parameters->>'tracked_result'='turn_mana_total' then coalesce((p_payload->>'turn_mana_total')::numeric,p_amount) else coalesce((p_payload->>'modified_value')::numeric,(p_payload->>'natural_value')::numeric,p_amount) end;
    if v_parameters->>'tracked_result'='matching_dice' and coalesce((p_payload->>'matching_count')::numeric,0)<coalesce((v_parameters->>'target_value')::numeric,0) then return 0; end if;
    if v_parameters->>'tracked_result'='maximum_die_result' and (p_payload->>'natural_value')::numeric<>(p_payload->>'natural_maximum')::numeric then return 0; end if;
    if v_parameters->>'comparison'='equal' and v_value<>(v_parameters->>'target_value')::numeric then return 0; end if;
    if v_parameters->>'comparison'='greater_than' and v_value<=(v_parameters->>'target_value')::numeric then return 0; end if;
    if v_parameters->>'comparison'='greater_than_or_equal' and v_value<(v_parameters->>'target_value')::numeric then return 0; end if;
    if v_parameters->>'comparison'='less_than' and v_value>=(v_parameters->>'target_value')::numeric then return 0; end if;
    if v_parameters->>'comparison'='less_than_or_equal' and v_value>(v_parameters->>'target_value')::numeric then return 0; end if;
    return 1;
  end if;
  return 0;
end;
$$;

-- This is the same idempotent receipt flow as the v2 runtime, with all
-- challenge-specific matching delegated to the audited helper above.
create or replace function public.submit_collectible_combat_events(p_run_id uuid,p_turn_number integer,p_events jsonb)
returns jsonb
language plpgsql security definer
set search_path to public
as $$
declare
  v_user uuid:=auth.uid();
  v_run public.dungeon_runs%rowtype;
  e jsonb;
  c record;
  v_key text;
  v_type text;
  v_challenge_type text;
  v_source text;
  v_target text;
  v_skill text;
  v_amount bigint;
  v_increment bigint;
  v_goal bigint;
  v_inserted integer;
  v_source_elements text[];
  v_target_elements text[];
  v_payload jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_turn_number<1 or jsonb_typeof(coalesce(p_events,'[]'::jsonb))<>'array' then raise exception 'VALIDATION: invalid combat events'; end if;
  select * into v_run from public.dungeon_runs where id=p_run_id and user_id=v_user for update;
  if not found or v_run.status not in ('started','won') then raise exception 'COMBAT_RUN_UNAVAILABLE'; end if;
  perform public.reconcile_user_gated_tracking_internal(v_user);
  for e in select value from jsonb_array_elements(p_events)
  loop
    v_key:=btrim(coalesce(e->>'event_key','')); v_type:=coalesce(e->>'event_type','');
    v_source:=nullif(e->>'source_critter_id',''); v_target:=nullif(e->>'target_critter_id',''); v_skill:=nullif(e->>'skill_id','');
    v_amount:=coalesce(nullif(e->>'amount','')::bigint,0);
    v_payload:=case when jsonb_typeof(e->'payload')='object' then e->'payload' else '{}'::jsonb end;
    if v_key='' or v_type not in ('knock_out_critters','deal_damage','take_damage','use_skill','critter_knocked_out','hp_damage_dealt','hp_damage_taken','skill_resolved','battle_completed','dungeon_completed','swap_completed','block_completed','dice_resolved','resource_spent') or v_amount<1 then raise exception 'VALIDATION: invalid combat event'; end if;
    if v_type in ('knock_out_critters','deal_damage','critter_knocked_out','hp_damage_dealt') and not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_target) then raise exception 'VALIDATION: invalid enemy target'; end if;
    if v_type in ('take_damage','hp_damage_taken') then
      if not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_source) then raise exception 'VALIDATION: invalid enemy source'; end if;
      if not exists(select 1 from public.user_critters where user_id=v_user and critter_id=v_target) then raise exception 'VALIDATION: invalid friendly target'; end if;
    elsif v_type in ('use_skill','skill_resolved') then
      if not exists(select 1 from public.user_critters uc join public.user_critter_skills us on us.user_critter_id=uc.id where uc.user_id=v_user and uc.critter_id=v_source and us.skill_id=v_skill) then raise exception 'VALIDATION: invalid skill source'; end if;
      v_amount:=1;
    end if;
    insert into public.collectible_combat_events(run_id,event_key,user_id,turn_number,event_type,source_critter_id,target_critter_id,skill_id,amount,payload)
    values(p_run_id,v_key,v_user,p_turn_number,v_type,v_source,v_target,v_skill,v_amount,e)
    on conflict(run_id,event_key) do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted=0 then continue; end if;
    v_challenge_type:=case v_type when 'critter_knocked_out' then 'knock_out_critters' when 'hp_damage_dealt' then 'deal_damage' when 'hp_damage_taken' then 'take_damage' when 'skill_resolved' then 'use_skill' when 'battle_completed' then 'squad_composition' when 'dungeon_completed' then 'dungeon_clear' when 'swap_completed' then 'swap_action' when 'block_completed' then 'block_action' when 'dice_resolved' then 'dice_roll' when 'resource_spent' then 'resource_spending' else v_type end;
    select array_agg(element_id order by element_id) into v_target_elements from (select element_1_id element_id from public.critters where id=v_target union select element_2_id from public.critters where id=v_target and element_2_id is not null) elements;
    select array_agg(element_id order by element_id) into v_source_elements from (select element_1_id element_id from public.critters where id=coalesce(v_source,v_payload->>'incoming_critter_id') union select element_2_id from public.critters where id=coalesce(v_source,v_payload->>'incoming_critter_id') and element_2_id is not null) elements;
    if v_target_elements is null then v_target_elements:=coalesce(array(select jsonb_array_elements_text(coalesce(v_payload->'target_element_ids','[]'::jsonb))),'{}'); end if;
    if v_source_elements is null then v_source_elements:=coalesce(array(select jsonb_array_elements_text(coalesce(v_payload->'source_element_ids','[]'::jsonb))),'{}'); end if;
    for c in
      select challenge.*
      from public.user_tracked_collectible_challenges tracked
      join public.collectible_unlock_challenges challenge on challenge.id=tracked.challenge_id
      join lateral public.collectible_challenge_states(v_user,challenge.collectible_type,challenge.collectible_id) state on state.challenge_id=challenge.id and state.eligible and not state.complete
      where tracked.user_id=v_user and (challenge.challenge_type=v_challenge_type or (v_type in ('battle_completed','dungeon_completed') and challenge.challenge_type='squad_composition'))
      order by tracked.slot_order
    loop
      v_increment:=public.challenge_event_increment_v2(c.id,v_type,v_source,v_target,v_skill,v_amount,v_payload,v_source_elements,v_target_elements);
      v_goal:=public.collectible_challenge_goal(c.id);
      if v_increment<1 then continue; end if;
      insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at,updated_at)
      values(v_user,c.id,least(v_goal,v_increment),case when v_increment>=v_goal then now() else null end,now())
      on conflict(user_id,challenge_id) do update set progress=least(v_goal,public.user_collectible_challenge_progress.progress+v_increment),completed_at=case when least(v_goal,public.user_collectible_challenge_progress.progress+v_increment)>=v_goal then coalesce(public.user_collectible_challenge_progress.completed_at,now()) else null end,updated_at=now();
    end loop;
  end loop;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  return public.get_collectible_player_snapshot();
end;
$$;

alter function public.submit_collectible_combat_events(uuid,integer,jsonb) owner to postgres;
grant execute on function public.challenge_event_increment_v2(uuid,text,text,text,text,bigint,jsonb,text[],text[]) to service_role;
commit;
