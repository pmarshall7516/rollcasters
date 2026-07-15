-- Ordered Gate Challenge prerequisites for player tracking, progress, and
-- effective collectible completion. Raw Global/Shop progress remains visible,
-- while Tracked challenges cannot be selected or advanced until eligible.

alter table public.collectible_unlock_challenges
  add column if not exists gate_order integer;

alter table public.collectible_unlock_challenges
  drop constraint if exists collectible_unlock_challenges_gate_order_check;
alter table public.collectible_unlock_challenges
  add constraint collectible_unlock_challenges_gate_order_check
  check (gate_order is null or gate_order > 0);

create unique index if not exists collectible_unlock_challenges_gate_order_unique
  on public.collectible_unlock_challenges(collectible_type,collectible_id,gate_order)
  where gate_order is not null;

create or replace function public.assert_collectible_gate_integrity(
  p_type text,
  p_id text
)
returns void
language plpgsql
stable
set search_path=public
as $$
declare
  v_required integer;
  v_challenge_count integer:=0;
  v_gate_count integer:=0;
  v_distinct_gate_count integer:=0;
  v_min_gate integer;
  v_max_gate integer;
begin
  select required_challenges into v_required
  from public.collectible_unlock_requirements
  where collectible_type=p_type and collectible_id=p_id;

  select
    count(*)::integer,
    count(gate_order)::integer,
    count(distinct gate_order)::integer,
    min(gate_order),
    max(gate_order)
  into v_challenge_count,v_gate_count,v_distinct_gate_count,v_min_gate,v_max_gate
  from public.collectible_unlock_challenges
  where collectible_type=p_type and collectible_id=p_id;

  if v_required is null then
    if v_challenge_count>0 then
      raise exception 'CONTENT_INTEGRITY: challenge owner % % has no unlock requirement',p_type,p_id;
    end if;
    return;
  end if;

  if v_gate_count>0 and (
    v_min_gate<>1 or
    v_max_gate<>v_gate_count or
    v_distinct_gate_count<>v_gate_count
  ) then
    raise exception 'CONTENT_INTEGRITY: Gate Orders for % % must be the exact sequence 1..%',p_type,p_id,v_gate_count;
  end if;

  if v_required>0 and v_required<v_gate_count then
    raise exception 'CONTENT_INTEGRITY: Required Challenges for % % cannot be lower than its % gates',p_type,p_id,v_gate_count;
  end if;

  if v_required>v_challenge_count then
    raise exception 'CONTENT_INTEGRITY: Required Challenges for % % exceeds its configured challenges',p_type,p_id;
  end if;
end;
$$;

create or replace function public.collectible_challenge_states(
  p_user uuid,
  p_type text,
  p_id text
)
returns table(
  challenge_id uuid,
  gate_order integer,
  raw_progress bigint,
  goal bigint,
  goal_reached boolean,
  eligible boolean,
  complete boolean,
  blocked_by_gate_order integer,
  trackable boolean
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_challenge record;
  v_prior_gates_complete boolean:=true;
  v_blocking_gate integer:=null;
begin
  perform public.assert_collectible_gate_integrity(p_type,p_id);

  for v_challenge in
    select c.id,c.gate_order,c.challenge_type
    from public.collectible_unlock_challenges c
    where c.collectible_type=p_type
      and c.collectible_id=p_id
      and c.gate_order is not null
    order by c.gate_order,c.id
  loop
    challenge_id:=v_challenge.id;
    gate_order:=v_challenge.gate_order;
    raw_progress:=public.collectible_challenge_current(p_user,v_challenge.id);
    goal:=public.collectible_challenge_goal(v_challenge.id);
    goal_reached:=raw_progress>=goal;
    eligible:=v_prior_gates_complete;
    complete:=eligible and goal_reached;
    blocked_by_gate_order:=case when eligible then null else v_blocking_gate end;
    trackable:=v_challenge.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill')
      and eligible and not complete;
    return next;

    if v_prior_gates_complete and not complete then
      v_prior_gates_complete:=false;
      v_blocking_gate:=v_challenge.gate_order;
    end if;
  end loop;

  for v_challenge in
    select c.id,c.challenge_type
    from public.collectible_unlock_challenges c
    where c.collectible_type=p_type
      and c.collectible_id=p_id
      and c.gate_order is null
    order by c.sort_order,c.id
  loop
    challenge_id:=v_challenge.id;
    gate_order:=null;
    raw_progress:=public.collectible_challenge_current(p_user,v_challenge.id);
    goal:=public.collectible_challenge_goal(v_challenge.id);
    goal_reached:=raw_progress>=goal;
    eligible:=v_prior_gates_complete;
    complete:=eligible and goal_reached;
    blocked_by_gate_order:=case when eligible then null else v_blocking_gate end;
    trackable:=v_challenge.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill')
      and eligible and not complete;
    return next;
  end loop;
end;
$$;

create or replace function public.reconcile_user_gated_tracking_internal(p_user uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare v_removed integer:=0;
begin
  delete from public.user_tracked_collectible_challenges tracked
  using public.collectible_unlock_challenges challenge
  where tracked.user_id=p_user
    and challenge.id=tracked.challenge_id
    and not exists(
      select 1
      from public.collectible_challenge_states(
        p_user,
        challenge.collectible_type,
        challenge.collectible_id
      ) state
      where state.challenge_id=challenge.id and state.eligible
    );
  get diagnostics v_removed=row_count;
  if v_removed>0 then
    perform public.compact_user_tracking_slots(p_user);
  end if;
  return v_removed;
end;
$$;

create or replace function public.evaluate_collectible_unlock_internal(
  p_user uuid,
  p_type text,
  p_id text
)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  v_required integer;
  v_completed integer:=0;
  v_state record;
  v_granted boolean:=false;
begin
  select required_challenges into v_required
  from public.collectible_unlock_requirements
  where collectible_type=p_type and collectible_id=p_id
  for update;
  if not found or v_required=0 or public.collectible_is_unlocked(p_user,p_type,p_id) then return false; end if;

  if p_type='critter' and not exists(select 1 from public.critters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='rollcaster' and not exists(select 1 from public.rollcasters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='relic' and not exists(select 1 from public.relics where id=p_id and is_active and not is_archived) then return false; end if;

  perform id from public.collectible_unlock_challenges
  where collectible_type=p_type and collectible_id=p_id
  for share;

  for v_state in
    select * from public.collectible_challenge_states(p_user,p_type,p_id)
  loop
    if v_state.complete then v_completed:=v_completed+1; end if;

    update public.user_collectible_challenge_progress progress
    set completed_at=case
      when v_state.complete then coalesce(progress.completed_at,now())
      else null
    end,
    updated_at=case
      when progress.completed_at is distinct from case when v_state.complete then coalesce(progress.completed_at,now()) else null end
        then now()
      else progress.updated_at
    end
    where progress.user_id=p_user
      and progress.challenge_id=v_state.challenge_id
      and progress.completed_at is distinct from case
        when v_state.complete then coalesce(progress.completed_at,now())
        else null
      end;
  end loop;

  if v_completed<v_required then return false; end if;

  v_granted:=public.grant_collectible_internal(p_user,p_type,p_id);
  if not v_granted then return false; end if;
  delete from public.user_tracked_collectible_challenges tracked
  using public.collectible_unlock_challenges challenge_row
  where tracked.user_id=p_user and tracked.challenge_id=challenge_row.id
    and challenge_row.collectible_type=p_type and challenge_row.collectible_id=p_id;
  perform public.compact_user_tracking_slots(p_user);
  insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id)
  values(p_user,p_type,p_id) on conflict(user_id,collectible_type,collectible_id) do nothing;
  return true;
end;
$$;

create or replace function public.get_collectible_player_snapshot()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.reconcile_user_gated_tracking_internal(v_user);
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  select jsonb_build_object(
    'currencies',coalesce((select jsonb_agg(jsonb_build_object(
      'currency_id',c.id,'balance',coalesce(u.balance,0)::text
    ) order by c.is_default desc,c.sort_order,c.name,c.id) from public.currencies c
      left join public.user_currencies u on u.currency_id=c.id and u.user_id=v_user
      where c.is_active and not c.is_archived),'[]'::jsonb),
    'shards',coalesce((select jsonb_agg(jsonb_build_object(
      'collectible_type',s.collectible_type,'collectible_id',s.collectible_id,'quantity',s.quantity::text
    ) order by s.collectible_type,s.collectible_id) from public.user_collectible_shards s
      where s.user_id=v_user),'[]'::jsonb),
    'progress',coalesce((select jsonb_agg(jsonb_build_object(
      'challenge_id',state.challenge_id,
      'current',state.raw_progress::text,
      'goal',state.goal::text,
      'goal_reached',state.goal_reached,
      'eligible',state.eligible,
      'completed',state.complete,
      'blocked_by_gate_order',state.blocked_by_gate_order,
      'trackable',state.trackable
    ) order by challenge.collectible_type,challenge.collectible_id,challenge.sort_order,challenge.id)
      from public.collectible_unlock_requirements requirement
      cross join lateral public.collectible_challenge_states(
        v_user,
        requirement.collectible_type,
        requirement.collectible_id
      ) state
      join public.collectible_unlock_challenges challenge on challenge.id=state.challenge_id
    ),'[]'::jsonb),
    'tracked',coalesce((select jsonb_agg(jsonb_build_object('challenge_id',t.challenge_id,'slot_order',t.slot_order) order by t.slot_order)
      from public.user_tracked_collectible_challenges t where t.user_id=v_user),'[]'::jsonb),
    'unlock_events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'collectible_type',e.collectible_type,'collectible_id',e.collectible_id,'created_at',e.created_at
    ) order by e.created_at,e.id) from public.user_collectible_unlock_events e
      where e.user_id=v_user and e.acknowledged_at is null),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.track_collectible_challenge(p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid();
  v_type text;
  v_id text;
  v_slot integer;
  v_eligible boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select collectible_type,collectible_id into v_type,v_id
  from public.collectible_unlock_challenges
  where id=p_challenge_id
    and challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill');
  if v_type is null then raise exception 'VALIDATION: challenge is not trackable'; end if;

  select state.eligible into v_eligible
  from public.collectible_challenge_states(v_user,v_type,v_id) state
  where state.challenge_id=p_challenge_id;
  if not coalesce(v_eligible,false) then raise exception 'CHALLENGE_GATED'; end if;

  if exists(select 1 from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id) then
    select slot_order into v_slot from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id;
    return jsonb_build_object('challenge_id',p_challenge_id,'slot_order',v_slot);
  end if;
  delete from public.user_tracked_collectible_challenges tracked
  using public.collectible_unlock_challenges challenge
  where tracked.user_id=v_user
    and tracked.challenge_id=challenge.id
    and challenge.collectible_type=v_type
    and challenge.collectible_id=v_id;
  select slot into v_slot
  from generate_series(1,3) slot
  where not exists(
    select 1 from public.user_tracked_collectible_challenges
    where user_id=v_user and slot_order=slot
  )
  order by slot limit 1;
  if v_slot is null then raise exception 'TRACKING_LIMIT_REACHED'; end if;
  insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order)
  values(v_user,p_challenge_id,v_slot);
  return jsonb_build_object('challenge_id',p_challenge_id,'slot_order',v_slot);
end;
$$;

create or replace function public.submit_collectible_combat_events(
  p_run_id uuid,
  p_turn_number integer,
  p_events jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_run public.dungeon_runs%rowtype; e jsonb; c record;
  v_key text; v_type text; v_source text; v_target text; v_skill text; v_amount bigint;
  v_match_id text; v_match_element text; v_goal bigint; v_increment bigint; v_inserted integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_turn_number<1 or jsonb_typeof(coalesce(p_events,'[]'::jsonb))<>'array' then raise exception 'VALIDATION: invalid combat events'; end if;
  select * into v_run from public.dungeon_runs where id=p_run_id and user_id=v_user for update;
  if not found or v_run.status not in ('started','won') then raise exception 'COMBAT_RUN_UNAVAILABLE'; end if;
  perform public.reconcile_user_gated_tracking_internal(v_user);

  for e in select value from jsonb_array_elements(p_events)
  loop
    v_key:=btrim(coalesce(e->>'event_key',''));
    v_type:=e->>'event_type'; v_source:=e->>'source_critter_id'; v_target:=e->>'target_critter_id';
    v_skill:=e->>'skill_id'; v_amount:=coalesce((e->>'amount')::bigint,0);
    if v_key='' or v_type not in ('knock_out_critters','deal_damage','take_damage','use_skill') or v_amount<1 then
      raise exception 'VALIDATION: invalid combat event';
    end if;
    if v_type in ('knock_out_critters','deal_damage') then
      if not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_target) then raise exception 'VALIDATION: invalid enemy target'; end if;
      v_match_id:=v_target;
      select element_id into v_match_element from public.critters where id=v_target;
    elsif v_type='take_damage' then
      if not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_source) then raise exception 'VALIDATION: invalid enemy source'; end if;
      if not exists(select 1 from public.user_critters where user_id=v_user and critter_id=v_target) then raise exception 'VALIDATION: invalid friendly target'; end if;
      v_match_id:=v_source;
      select element_id into v_match_element from public.critters where id=v_source;
    else
      if not exists(select 1 from public.user_critters uc join public.user_critter_skills us on us.user_critter_id=uc.id
        where uc.user_id=v_user and uc.critter_id=v_source and us.skill_id=v_skill) then raise exception 'VALIDATION: invalid skill source'; end if;
      v_match_id:=v_skill;
      select element_id into v_match_element from public.skills where id=v_skill;
      v_amount:=1;
    end if;

    insert into public.collectible_combat_events(run_id,event_key,user_id,turn_number,event_type,source_critter_id,target_critter_id,skill_id,amount,payload)
    values(p_run_id,v_key,v_user,p_turn_number,v_type,v_source,v_target,v_skill,v_amount,e)
    on conflict(run_id,event_key) do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted=0 then continue; end if;

    for c in
      select challenge.*
      from public.user_tracked_collectible_challenges tracked
      join public.collectible_unlock_challenges challenge on challenge.id=tracked.challenge_id
      join lateral public.collectible_challenge_states(
        v_user,
        challenge.collectible_type,
        challenge.collectible_id
      ) state on state.challenge_id=challenge.id and state.eligible
      where tracked.user_id=v_user and challenge.challenge_type=v_type
      order by tracked.slot_order
    loop
      if not c.any_target then
        if c.target_mode in ('species','skill') and not (v_match_id=any(c.target_ids)) then continue; end if;
        if c.target_mode='element' and not (v_match_element=any(c.target_ids)) then continue; end if;
      end if;
      v_goal:=c.required_amount;
      v_increment:=case when v_type in ('knock_out_critters','use_skill') then 1 else v_amount end;
      insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at,updated_at)
      values(v_user,c.id,least(v_goal,v_increment),case when v_increment>=v_goal then now() else null end,now())
      on conflict(user_id,challenge_id) do update set
        progress=least(v_goal,public.user_collectible_challenge_progress.progress+v_increment),
        completed_at=case when least(v_goal,public.user_collectible_challenge_progress.progress+v_increment)>=v_goal
          then coalesce(public.user_collectible_challenge_progress.completed_at,now()) else null end,
        updated_at=now();
    end loop;
  end loop;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  return public.get_collectible_player_snapshot();
end;
$$;

-- Keep gate metadata independent from semantic goal fields in the aggregate
-- authoring path so gate/sort edits preserve player progress and challenge IDs.
create or replace function public.replace_collectible_unlocks(p_type text,p_id text,p_collect jsonb)
returns void language plpgsql set search_path=public as $$
declare
  v_required integer:=coalesce((p_collect->>'requiredChallenges')::integer,0);
  v_challenge jsonb;
  v_order bigint;
  v_count integer;
  v_uuid uuid;
  v_ids uuid[]:='{}';
  v_existing_owner_type text;
  v_existing_owner_id text;
  v_before_definition jsonb;
  v_after_definition jsonb;
  v_affected_user uuid;
  v_affected_users uuid[]:='{}';
begin
  if p_type not in ('critter','rollcaster','relic') or not public.collectible_exists(p_type,p_id) then raise exception 'VALIDATION: invalid collectible owner'; end if;
  if p_collect is not null and jsonb_typeof(p_collect)<>'object' then raise exception 'VALIDATION: collect must be an object'; end if;
  if v_required<0 then raise exception 'VALIDATION: Required Challenges cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_collect->'challenges','[]'::jsonb))<>'array' then raise exception 'VALIDATION: challenges must be an array'; end if;

  select coalesce(array_agg(distinct tracked.user_id),'{}'::uuid[]) into v_affected_users
  from public.user_tracked_collectible_challenges tracked
  join public.collectible_unlock_challenges challenge on challenge.id=tracked.challenge_id
  where challenge.collectible_type=p_type and challenge.collectible_id=p_id;

  insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges,updated_at,updated_by)
  values(p_type,p_id,0,now(),auth.uid())
  on conflict(collectible_type,collectible_id) do update set required_challenges=0,updated_at=now(),updated_by=auth.uid();

  for v_challenge in select value from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) loop
    if nullif(v_challenge->>'id','') is null then raise exception 'VALIDATION: every challenge needs a stable ID'; end if;
    v_uuid:=(v_challenge->>'id')::uuid;
    if v_uuid=any(v_ids) then raise exception 'VALIDATION: challenge IDs must be unique'; end if;
    v_ids:=array_append(v_ids,v_uuid);
  end loop;
  delete from public.collectible_unlock_challenges
  where collectible_type=p_type and collectible_id=p_id and not (id=any(v_ids));

  -- Release existing positions before the per-row upserts so a valid swap such
  -- as 1 <-> 2 cannot collide with the partial unique index mid-transaction.
  update public.collectible_unlock_challenges
  set gate_order=null
  where collectible_type=p_type and collectible_id=p_id and gate_order is not null;

  for v_challenge,v_order in
    select value,ordinality from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) with ordinality
  loop
    v_uuid:=(v_challenge->>'id')::uuid;
    select collectible_type,collectible_id,
      to_jsonb(challenge)-'created_at'-'updated_at'-'sort_order'-'gate_order'
      into v_existing_owner_type,v_existing_owner_id,v_before_definition
    from public.collectible_unlock_challenges challenge where id=v_uuid for update;
    if v_existing_owner_type is not null and (v_existing_owner_type<>p_type or v_existing_owner_id<>p_id) then
      raise exception 'VALIDATION: a challenge ID cannot move to another collectible';
    end if;
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,target_category,target_id,target_mode,
      any_target,target_ids,required_amount,required_level,sort_order,gate_order
    ) values (
      v_uuid,p_type,p_id,v_challenge->>'type',nullif(v_challenge->>'targetCategory',''),nullif(v_challenge->>'targetId',''),nullif(v_challenge->>'targetMode',''),
      coalesce((v_challenge->>'anyTarget')::boolean,false),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_challenge->'targetIds','[]'::jsonb))),'{}'),
      nullif(v_challenge->>'requiredAmount','')::bigint,nullif(v_challenge->>'requiredLevel','')::integer,
      coalesce((v_challenge->>'sortOrder')::integer,(v_order-1)::integer),
      nullif(v_challenge->>'gateOrder','')::integer
    ) on conflict(id) do update set
      challenge_type=excluded.challenge_type,target_category=excluded.target_category,target_id=excluded.target_id,
      target_mode=excluded.target_mode,any_target=excluded.any_target,target_ids=excluded.target_ids,
      required_amount=excluded.required_amount,required_level=excluded.required_level,
      sort_order=excluded.sort_order,gate_order=excluded.gate_order,updated_at=now();
    select to_jsonb(challenge)-'created_at'-'updated_at'-'sort_order'-'gate_order' into v_after_definition
    from public.collectible_unlock_challenges challenge where id=v_uuid;
    if v_before_definition is not null and v_before_definition is distinct from v_after_definition then
      for v_affected_user in select user_id from public.user_tracked_collectible_challenges where challenge_id=v_uuid loop
        delete from public.user_tracked_collectible_challenges where user_id=v_affected_user and challenge_id=v_uuid;
        perform public.compact_user_tracking_slots(v_affected_user);
      end loop;
      delete from public.user_collectible_challenge_progress where challenge_id=v_uuid;
    end if;
    v_existing_owner_type:=null; v_existing_owner_id:=null; v_before_definition:=null; v_after_definition:=null;
  end loop;

  select count(*) into v_count from public.collectible_unlock_challenges where collectible_type=p_type and collectible_id=p_id;
  if v_required>v_count then raise exception 'VALIDATION: Required Challenges cannot exceed configured challenges'; end if;
  update public.collectible_unlock_requirements set required_challenges=v_required,updated_at=now(),updated_by=auth.uid()
  where collectible_type=p_type and collectible_id=p_id;
  perform public.assert_collectible_gate_integrity(p_type,p_id);

  foreach v_affected_user in array v_affected_users loop
    perform public.reconcile_user_gated_tracking_internal(v_affected_user);
    perform public.evaluate_collectible_unlock_internal(v_affected_user,p_type,p_id);
  end loop;
end;
$$;

create or replace function public.collectible_unlock_snapshot(p_type text,p_id text)
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object(
    'requiredChallenges',coalesce(requirement.required_challenges,0),
    'challenges',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',challenge.id,'type',challenge.challenge_type,
        'targetCategory',challenge.target_category,'targetId',challenge.target_id,
        'targetMode',challenge.target_mode,'anyTarget',challenge.any_target,'targetIds',challenge.target_ids,
        'requiredAmount',challenge.required_amount,'requiredLevel',challenge.required_level,
        'sortOrder',challenge.sort_order,'gateOrder',challenge.gate_order
      ) order by challenge.sort_order,challenge.id)
      from public.collectible_unlock_challenges challenge
      where challenge.collectible_type=p_type and challenge.collectible_id=p_id
    ),'[]'::jsonb)
  )
  from (select 1) seed
  left join public.collectible_unlock_requirements requirement
    on requirement.collectible_type=p_type and requirement.collectible_id=p_id;
$$;

create or replace function public.validate_collectible_gate_configuration_trigger()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and (old.collectible_type,old.collectible_id) is distinct from (new.collectible_type,new.collectible_id) then
    perform public.assert_collectible_gate_integrity(old.collectible_type,old.collectible_id);
  end if;
  if tg_op='DELETE' then
    perform public.assert_collectible_gate_integrity(old.collectible_type,old.collectible_id);
  else
    perform public.assert_collectible_gate_integrity(new.collectible_type,new.collectible_id);
  end if;
  return null;
end;
$$;

drop trigger if exists validate_collectible_gate_configuration_on_challenge on public.collectible_unlock_challenges;
create constraint trigger validate_collectible_gate_configuration_on_challenge
after insert or update or delete on public.collectible_unlock_challenges
deferrable initially deferred
for each row execute function public.validate_collectible_gate_configuration_trigger();

drop trigger if exists validate_collectible_gate_configuration_on_requirement on public.collectible_unlock_requirements;
create constraint trigger validate_collectible_gate_configuration_on_requirement
after insert or update on public.collectible_unlock_requirements
deferrable initially deferred
for each row execute function public.validate_collectible_gate_configuration_trigger();

revoke all on function public.assert_collectible_gate_integrity(text,text) from public;
revoke all on function public.collectible_challenge_states(uuid,text,text) from public;
revoke all on function public.reconcile_user_gated_tracking_internal(uuid) from public;
revoke all on function public.evaluate_collectible_unlock_internal(uuid,text,text) from public;
revoke all on function public.validate_collectible_gate_configuration_trigger() from public;
revoke all on function public.get_collectible_player_snapshot() from public;
revoke all on function public.track_collectible_challenge(uuid) from public;
revoke all on function public.submit_collectible_combat_events(uuid,integer,jsonb) from public;
grant execute on function public.get_collectible_player_snapshot() to authenticated;
grant execute on function public.track_collectible_challenge(uuid) to authenticated;
grant execute on function public.submit_collectible_combat_events(uuid,integer,jsonb) to authenticated;

-- If gate metadata was populated before this runtime migration, repair online
-- tracking state and effective unlocks immediately. With legacy NULL gates this
-- is behavior-preserving.
do $$
declare player record;
begin
  for player in select id from auth.users order by id loop
    perform public.reconcile_user_gated_tracking_internal(player.id);
    perform public.evaluate_all_collectible_unlocks_internal(player.id);
  end loop;
end;
$$;
