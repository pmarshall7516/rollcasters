begin;

-- The v2 player runtime emits normalized encounter events. Keep the existing
-- receipt table as the idempotency boundary and widen its authored event
-- vocabulary without changing the old four event payloads.
alter table public.collectible_combat_events
  drop constraint if exists collectible_combat_events_event_type_check,
  add constraint collectible_combat_events_event_type_check check (event_type in (
    'knock_out_critters','deal_damage','take_damage','use_skill',
    'critter_knocked_out','hp_damage_dealt','hp_damage_taken','skill_resolved',
    'battle_completed','dungeon_completed','swap_completed','block_completed','dice_resolved','resource_spent'
  ));

create table if not exists public.user_collectible_challenge_scope_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.collectible_unlock_challenges(id) on delete cascade,
  scope_type text not null check (scope_type in ('battle','dungeon','shop_purchase')),
  scope_id text not null,
  current bigint not null default 0 check (current >= 0),
  best bigint not null default 0 check (best >= 0),
  finalized boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, challenge_id, scope_type, scope_id)
);
alter table public.user_collectible_challenge_scope_progress enable row level security;
drop policy if exists user_collectible_challenge_scope_progress_read_own on public.user_collectible_challenge_scope_progress;
create policy user_collectible_challenge_scope_progress_read_own on public.user_collectible_challenge_scope_progress for select using (auth.uid()=user_id);
grant select on public.user_collectible_challenge_scope_progress to authenticated;
grant all on public.user_collectible_challenge_scope_progress to service_role;

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
    v_key:=btrim(coalesce(e->>'event_key',''));
    v_type:=coalesce(e->>'event_type','');
    v_source:=nullif(e->>'source_critter_id','');
    v_target:=nullif(e->>'target_critter_id','');
    v_skill:=nullif(e->>'skill_id','');
    v_amount:=coalesce(nullif(e->>'amount','')::bigint,0);
    v_payload:=case when jsonb_typeof(e->'payload')='object' then e->'payload' else '{}'::jsonb end;
    if v_key='' or v_type not in (
      'knock_out_critters','deal_damage','take_damage','use_skill',
      'critter_knocked_out','hp_damage_dealt','hp_damage_taken','skill_resolved',
      'battle_completed','dungeon_completed','swap_completed','block_completed','dice_resolved','resource_spent'
    ) or v_amount<1 then
      raise exception 'VALIDATION: invalid combat event';
    end if;

    if v_type in ('knock_out_critters','deal_damage','critter_knocked_out','hp_damage_dealt') then
      if not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_target) then raise exception 'VALIDATION: invalid enemy target'; end if;
    elsif v_type in ('take_damage','hp_damage_taken') then
      if not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_source) then raise exception 'VALIDATION: invalid enemy source'; end if;
      if not exists(select 1 from public.user_critters where user_id=v_user and critter_id=v_target) then raise exception 'VALIDATION: invalid friendly target'; end if;
    elsif v_type in ('use_skill','skill_resolved') then
      if not exists(select 1 from public.user_critters uc join public.user_critter_skills us on us.user_critter_id=uc.id where uc.user_id=v_user and uc.critter_id=v_source and us.skill_id=v_skill) then raise exception 'VALIDATION: invalid skill source'; end if;
      v_amount:=1;
    elsif v_type='resource_spent' and v_amount<1 then
      raise exception 'VALIDATION: invalid resource event';
    end if;

    insert into public.collectible_combat_events(run_id,event_key,user_id,turn_number,event_type,source_critter_id,target_critter_id,skill_id,amount,payload)
    values(p_run_id,v_key,v_user,p_turn_number,v_type,v_source,v_target,v_skill,v_amount,e)
    on conflict(run_id,event_key) do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted=0 then continue; end if;

    v_challenge_type:=case v_type
      when 'critter_knocked_out' then 'knock_out_critters'
      when 'hp_damage_dealt' then 'deal_damage'
      when 'hp_damage_taken' then 'take_damage'
      when 'skill_resolved' then 'use_skill'
      when 'battle_completed' then 'squad_composition'
      when 'dungeon_completed' then 'dungeon_clear'
      when 'swap_completed' then 'swap_action'
      when 'block_completed' then 'block_action'
      when 'dice_resolved' then 'dice_roll'
      when 'resource_spent' then 'resource_spending'
      else v_type
    end;

    if v_target is not null then
      select array_agg(element_id order by element_id) into v_target_elements from (
        select element_1_id element_id from public.critters where id=v_target
        union
        select element_2_id from public.critters where id=v_target and element_2_id is not null
      ) elements;
    else
      v_target_elements:=coalesce(array(select jsonb_array_elements_text(coalesce(v_payload->'target_element_ids','[]'::jsonb))),'{}');
    end if;

    for c in
      select challenge.*
      from public.user_tracked_collectible_challenges tracked
      join public.collectible_unlock_challenges challenge on challenge.id=tracked.challenge_id
      join lateral public.collectible_challenge_states(v_user,challenge.collectible_type,challenge.collectible_id) state
        on state.challenge_id=challenge.id and state.eligible and not state.complete
      where tracked.user_id=v_user and (
        challenge.challenge_type=v_challenge_type
        or (v_type in ('battle_completed','dungeon_completed') and challenge.challenge_type='squad_composition')
      )
      order by tracked.slot_order
    loop
      if v_challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill') then
        if c.parameters->>'any_target'='false' and coalesce(jsonb_array_length(c.parameters->'target_ids'),0)>0 then
          if c.parameters->>'target_mode' in ('species','skill') and not (coalesce(v_target,v_skill)=any(array(select jsonb_array_elements_text(c.parameters->'target_ids')))) then continue; end if;
          if c.parameters->>'target_mode'='element' and not (v_target_elements && array(select jsonb_array_elements_text(c.parameters->'target_ids'))) then continue; end if;
        elsif c.any_target=false and cardinality(c.target_ids)>0 then
          if c.target_mode in ('species','skill') and not (coalesce(v_target,v_skill)=any(c.target_ids)) then continue; end if;
          if c.target_mode='element' and not (v_target_elements && c.target_ids) then continue; end if;
        end if;
        v_increment:=case when v_challenge_type in ('knock_out_critters','use_skill') then 1 else v_amount end;
      elsif v_challenge_type='resource_spending' then
        if c.parameters->>'spending_context' is distinct from v_payload->>'spending_context' and c.parameters->>'spending_context' is distinct from v_payload->>'context' then continue; end if;
        if c.parameters->>'resource_type' is distinct from v_payload->>'resource_type' then continue; end if;
        v_increment:=v_amount;
      elsif v_challenge_type='squad_composition' then
        if v_type<>'battle_completed' or coalesce((v_payload->>'won')::boolean,false)=false then continue; end if;
        v_increment:=1;
      elsif c.challenge_type='squad_composition' then
        if v_type not in ('battle_completed','dungeon_completed') or coalesce((v_payload->>'won')::boolean,false)=false then continue; end if;
        if c.parameters->>'completion_event'='battle_win' and v_type<>'battle_completed' then continue; end if;
        if c.parameters->>'completion_event'='dungeon_clear' and v_type<>'dungeon_completed' then continue; end if;
        v_increment:=1;
      elsif v_challenge_type='dungeon_clear' then
        if v_type<>'dungeon_completed' or coalesce((v_payload->>'won')::boolean,false)=false then continue; end if;
        v_increment:=1;
      elsif v_challenge_type='swap_action' then
        if c.parameters->>'tracked_action'='damage_avoided_by_swap' then v_increment:=coalesce((v_payload->>'damage_avoided')::bigint,v_amount); else v_increment:=1; end if;
      elsif v_challenge_type='block_action' then
        if c.parameters->>'tracked_action'='damage_prevented' then v_increment:=coalesce((v_payload->>'damage_prevented')::bigint,v_amount); elsif c.parameters->>'tracked_action' in ('attacks_fully_blocked','survived_attack_after_block') and coalesce((v_payload->>'fully_blocked')::boolean,false)=false and c.parameters->>'tracked_action'='attacks_fully_blocked' then continue; else v_increment:=1; end if;
      elsif v_challenge_type='dice_roll' then
        v_increment:=1;
      else
        continue;
      end if;
      v_goal:=public.collectible_challenge_goal(c.id);
      if v_increment<1 then continue; end if;
      insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at,updated_at)
      values(v_user,c.id,least(v_goal,v_increment),case when v_increment>=v_goal then now() else null end,now())
      on conflict(user_id,challenge_id) do update set
        progress=least(v_goal,public.user_collectible_challenge_progress.progress+v_increment),
        completed_at=case when least(v_goal,public.user_collectible_challenge_progress.progress+v_increment)>=v_goal then coalesce(public.user_collectible_challenge_progress.completed_at,now()) else null end,
        updated_at=now();
    end loop;
  end loop;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  return public.get_collectible_player_snapshot();
end;
$$;

alter function public.submit_collectible_combat_events(uuid,integer,jsonb) owner to postgres;
commit;
