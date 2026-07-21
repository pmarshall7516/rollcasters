begin;

-- Combat and encounter events may only advance Challenges selected in the
-- player's existing three-slot tracker. The runtime bump prevents a v1 game
-- client from treating these rows as automatic achievements.
delete from public.user_collectible_challenge_progress progress
using public.collectible_unlock_challenges challenge
where progress.challenge_id=challenge.id
  and challenge.challenge_type in (
    'squad_composition','dungeon_clear','resource_spending',
    'swap_action','block_action','dice_roll'
  );

update public.unlock_challenge_templates
set challenge_category='tracked',
    progress_mode='tracked_event',
    runtime_version=2,
    version=case
      when challenge_category='tracked' and progress_mode='tracked_event' and runtime_version=2 then version
      else version+1
    end,
    updated_at=now()
where id in (
  'squad_composition','dungeon_clear','resource_spending',
  'swap_action','block_action','dice_roll'
);

alter table public.unlock_challenge_templates
  drop constraint unlock_challenge_templates_challenge_category_check,
  add constraint unlock_challenge_templates_challenge_category_check
    check (challenge_category in ('global','tracked','shop')),
  drop constraint unlock_challenge_templates_progress_mode_check,
  add constraint unlock_challenge_templates_progress_mode_check
    check (progress_mode in ('derived','tracked_event','shop'));

create or replace function public.collectible_challenge_states(p_user uuid,p_type text,p_id text)
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
language plpgsql stable security definer
set search_path to 'public'
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
    trackable:=v_challenge.challenge_type in (
      'knock_out_critters','deal_damage','take_damage','use_skill',
      'squad_composition','dungeon_clear','resource_spending',
      'swap_action','block_action','dice_roll'
    ) and eligible and not complete;
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
    trackable:=v_challenge.challenge_type in (
      'knock_out_critters','deal_damage','take_damage','use_skill',
      'squad_composition','dungeon_clear','resource_spending',
      'swap_action','block_action','dice_roll'
    ) and eligible and not complete;
    return next;
  end loop;
end;
$$;

create or replace function public.track_collectible_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
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
    and challenge_type in (
      'knock_out_critters','deal_damage','take_damage','use_skill',
      'squad_composition','dungeon_clear','resource_spending',
      'swap_action','block_action','dice_roll'
    );
  if v_type is null then raise exception 'VALIDATION: challenge is not trackable'; end if;

  select state.eligible into v_eligible
  from public.collectible_challenge_states(v_user,v_type,v_id) state
  where state.challenge_id=p_challenge_id;
  if not coalesce(v_eligible,false) then raise exception 'CHALLENGE_GATED'; end if;

  if exists(
    select 1 from public.user_tracked_collectible_challenges
    where user_id=v_user and challenge_id=p_challenge_id
  ) then
    select slot_order into v_slot
    from public.user_tracked_collectible_challenges
    where user_id=v_user and challenge_id=p_challenge_id;
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

commit;
