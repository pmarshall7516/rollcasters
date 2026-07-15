-- Player runtime for collectible challenges, unlock events, retry-safe shop
-- purchases, and idempotent combat challenge progress.

create table if not exists public.user_collectible_unlock_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collectible_type text not null check (collectible_type in ('critter','rollcaster','relic')),
  collectible_id text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique(user_id,collectible_type,collectible_id)
);

create table if not exists public.shop_purchase_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  entry_id uuid not null,
  shop_type text not null check (shop_type in ('shard','relic')),
  target_category text not null check (target_category in ('critter','rollcaster','relic')),
  target_id text not null,
  currency_id text not null,
  price bigint not null check (price >= 0),
  balance_after bigint not null check (balance_after >= 0),
  granted bigint not null check (granted >= 0),
  discarded bigint not null default 0 check (discarded >= 0),
  unlock_event_id uuid references public.user_collectible_unlock_events(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);

create table if not exists public.collectible_combat_events (
  run_id uuid not null references public.dungeon_runs(id) on delete cascade,
  event_key text not null check (btrim(event_key) <> ''),
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_number integer not null check (turn_number > 0),
  event_type text not null check (event_type in ('knock_out_critters','deal_damage','take_damage','use_skill')),
  source_critter_id text,
  target_critter_id text,
  skill_id text,
  amount bigint not null check (amount > 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(run_id,event_key)
);

create index if not exists user_collectible_unlock_events_pending_idx
  on public.user_collectible_unlock_events(user_id,created_at,id)
  where acknowledged_at is null;
create index if not exists collectible_combat_events_user_idx
  on public.collectible_combat_events(user_id,created_at);

create or replace function public.collectible_is_unlocked(
  p_user uuid,
  p_type text,
  p_id text
)
returns boolean language plpgsql stable set search_path=public as $$
begin
  if p_type='critter' then
    return exists(select 1 from public.user_critters where user_id=p_user and critter_id=p_id);
  elsif p_type='rollcaster' then
    return exists(select 1 from public.user_rollcasters where user_id=p_user and rollcaster_id=p_id);
  elsif p_type='relic' then
    return exists(select 1 from public.user_relic_inventory where user_id=p_user and relic_id=p_id and discovered_at is not null and quantity>0);
  end if;
  return false;
end; $$;

create or replace function public.collectible_challenge_goal(p_challenge uuid)
returns bigint language sql stable set search_path=public as $$
  select case
    when challenge_type='level_up_critter' then required_level::bigint
    else required_amount
  end
  from public.collectible_unlock_challenges
  where id=p_challenge;
$$;

create or replace function public.collectible_challenge_current(
  p_user uuid,
  p_challenge uuid
)
returns bigint language plpgsql stable set search_path=public as $$
declare c public.collectible_unlock_challenges%rowtype; v_value bigint:=0;
begin
  select * into c from public.collectible_unlock_challenges where id=p_challenge;
  if not found then return 0; end if;

  if c.challenge_type='own_collectible' then
    if c.target_category='critter' then
      select case when exists(select 1 from public.user_critters where user_id=p_user and critter_id=c.target_id) then 1 else 0 end into v_value;
    elsif c.target_category='rollcaster' then
      select case when exists(select 1 from public.user_rollcasters where user_id=p_user and rollcaster_id=c.target_id) then 1 else 0 end into v_value;
    else
      select coalesce(quantity,0)::bigint into v_value
      from public.user_relic_inventory
      where user_id=p_user and relic_id=c.target_id and discovered_at is not null;
      v_value:=coalesce(v_value,0);
    end if;
  elsif c.challenge_type='level_up_critter' then
    select coalesce(level,0)::bigint into v_value
    from public.user_critters where user_id=p_user and critter_id=c.target_id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill') then
    select coalesce(progress,0) into v_value
    from public.user_collectible_challenge_progress
    where user_id=p_user and challenge_id=c.id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type='shop_shards' then
    select coalesce(quantity,0) into v_value
    from public.user_collectible_shards
    where user_id=p_user and collectible_type=c.collectible_type and collectible_id=c.collectible_id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type='shop_relic' then
    select coalesce(quantity,0)::bigint into v_value
    from public.user_relic_inventory
    where user_id=p_user and relic_id=c.collectible_id;
    v_value:=coalesce(v_value,0);
  end if;

  return least(v_value,coalesce(public.collectible_challenge_goal(c.id),v_value));
end; $$;

create or replace function public.grant_collectible_internal(
  p_user uuid,
  p_type text,
  p_id text
)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_owned uuid; v_default text; v_slots integer:=1; v_was_unlocked boolean:=false;
begin
  if p_type='critter' then
    select id into v_owned from public.user_critters where user_id=p_user and critter_id=p_id;
    if v_owned is not null then return false; end if;
    insert into public.user_critters(user_id,critter_id) values(p_user,p_id) returning id into v_owned;
    insert into public.user_seen_critters(user_id,critter_id) values(p_user,p_id) on conflict do nothing;
    insert into public.user_critter_skills(user_critter_id,skill_id)
    select v_owned,skill_id from public.critter_skill_unlocks
    where critter_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order
    on conflict do nothing;
    select skill_id into v_default from public.critter_skill_unlocks
    where critter_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order limit 1;
    insert into public.user_critter_skill_slots(user_critter_id,slot_index,skill_id)
    select v_owned,slot,case when slot=1 then v_default else null end from generate_series(1,4) slot
    on conflict(user_critter_id,slot_index) do nothing;
    return true;
  elsif p_type='rollcaster' then
    select id into v_owned from public.user_rollcasters where user_id=p_user and rollcaster_id=p_id;
    if v_owned is not null then return false; end if;
    insert into public.user_rollcasters(user_id,rollcaster_id) values(p_user,p_id) returning id into v_owned;
    insert into public.user_rollcaster_abilities(user_id,user_rollcaster_id,ability_id)
    select p_user,v_owned,ability_id from public.rollcaster_ability_unlocks
    where rollcaster_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order
    on conflict do nothing;
    select ability_id into v_default from public.rollcaster_ability_unlocks
    where rollcaster_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order limit 1;
    select greatest(coalesce(max(total_unlocked_ability_slots),1),1) into v_slots
    from public.rollcaster_level_progression where rollcaster_id=p_id and level<=1;
    insert into public.user_rollcaster_ability_slots(user_rollcaster_id,slot_index,ability_id)
    select v_owned,slot,case when slot=1 then v_default else null end from generate_series(1,v_slots) slot
    on conflict(user_rollcaster_id,slot_index) do nothing;
    update public.profiles set active_rollcaster_id=coalesce(active_rollcaster_id,v_owned),updated_at=now()
    where user_id=p_user;
    return true;
  elsif p_type='relic' then
    select discovered_at is not null into v_was_unlocked
    from public.user_relic_inventory where user_id=p_user and relic_id=p_id for update;
    if coalesce(v_was_unlocked,false) then return false; end if;
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values(p_user,p_id,1,now())
    on conflict(user_id,relic_id) do update
      set quantity=greatest(public.user_relic_inventory.quantity,1),discovered_at=now();
    return true;
  end if;
  raise exception 'VALIDATION: unsupported collectible type';
end; $$;

create or replace function public.evaluate_collectible_unlock_internal(
  p_user uuid,
  p_type text,
  p_id text
)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_required integer; v_completed integer:=0; v_challenge record; v_granted boolean:=false;
begin
  select required_challenges into v_required
  from public.collectible_unlock_requirements
  where collectible_type=p_type and collectible_id=p_id
  for update;
  if not found or v_required=0 or public.collectible_is_unlocked(p_user,p_type,p_id) then return false; end if;

  if p_type='critter' and not exists(select 1 from public.critters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='rollcaster' and not exists(select 1 from public.rollcasters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='relic' and not exists(select 1 from public.relics where id=p_id and is_active and not is_archived) then return false; end if;

  for v_challenge in select id from public.collectible_unlock_challenges
    where collectible_type=p_type and collectible_id=p_id order by sort_order,id
  loop
    if public.collectible_challenge_current(p_user,v_challenge.id)>=public.collectible_challenge_goal(v_challenge.id) then
      v_completed:=v_completed+1;
    end if;
  end loop;
  if v_completed<v_required then return false; end if;

  v_granted:=public.grant_collectible_internal(p_user,p_type,p_id);
  if not v_granted then return false; end if;
  delete from public.user_tracked_collectible_challenges t
  using public.collectible_unlock_challenges challenge_row
  where t.user_id=p_user and t.challenge_id=challenge_row.id
    and challenge_row.collectible_type=p_type and challenge_row.collectible_id=p_id;
  perform public.compact_user_tracking_slots(p_user);
  insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id)
  values(p_user,p_type,p_id) on conflict(user_id,collectible_type,collectible_id) do nothing;
  return true;
end; $$;

create or replace function public.evaluate_all_collectible_unlocks_internal(p_user uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare r record; v_pass integer:=0; v_total integer:=0; v_changed integer;
begin
  loop
    v_changed:=0;
    for r in select collectible_type,collectible_id from public.collectible_unlock_requirements
      where required_challenges>0 order by collectible_type,collectible_id
    loop
      if public.evaluate_collectible_unlock_internal(p_user,r.collectible_type,r.collectible_id) then
        v_changed:=v_changed+1; v_total:=v_total+1;
      end if;
    end loop;
    v_pass:=v_pass+1;
    exit when v_changed=0 or v_pass>100;
  end loop;
  return v_total;
end; $$;

create or replace function public.get_collectible_player_snapshot()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  select jsonb_build_object(
    'currencies',coalesce((select jsonb_agg(jsonb_build_object(
      'currency_id',u.currency_id,'balance',u.balance::text
    ) order by c.sort_order,c.name,c.id) from public.user_currencies u
      join public.currencies c on c.id=u.currency_id
      where u.user_id=v_user and c.is_active and not c.is_archived),'[]'::jsonb),
    'shards',coalesce((select jsonb_agg(jsonb_build_object(
      'collectible_type',s.collectible_type,'collectible_id',s.collectible_id,'quantity',s.quantity::text
    ) order by s.collectible_type,s.collectible_id) from public.user_collectible_shards s
      where s.user_id=v_user),'[]'::jsonb),
    'progress',coalesce((select jsonb_agg(jsonb_build_object(
      'challenge_id',c.id,
      'current',public.collectible_challenge_current(v_user,c.id)::text,
      'goal',public.collectible_challenge_goal(c.id)::text,
      'completed',public.collectible_challenge_current(v_user,c.id)>=public.collectible_challenge_goal(c.id)
    ) order by c.collectible_type,c.collectible_id,c.sort_order,c.id) from public.collectible_unlock_challenges c),'[]'::jsonb),
    'tracked',coalesce((select jsonb_agg(jsonb_build_object('challenge_id',t.challenge_id,'slot_order',t.slot_order) order by t.slot_order)
      from public.user_tracked_collectible_challenges t where t.user_id=v_user),'[]'::jsonb),
    'unlock_events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'collectible_type',e.collectible_type,'collectible_id',e.collectible_id,'created_at',e.created_at
    ) order by e.created_at,e.id) from public.user_collectible_unlock_events e
      where e.user_id=v_user and e.acknowledged_at is null),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

create or replace function public.acknowledge_collectible_unlock_event(p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.user_collectible_unlock_events set acknowledged_at=coalesce(acknowledged_at,now())
  where id=p_event_id and user_id=v_user;
end; $$;

create or replace function public.shop_purchase_receipt_json(p_user uuid,p_request uuid)
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object(
    'request_id',request_id,'entry_id',entry_id,'shop_type',shop_type,
    'target_category',target_category,'target_id',target_id,'currency_id',currency_id,
    'price',price::text,'balance',balance_after::text,'granted',granted::text,
    'discarded',discarded::text,'unlock_event_id',unlock_event_id,'created_at',created_at
  ) from public.shop_purchase_receipts where user_id=p_user and request_id=p_request;
$$;

create or replace function public.purchase_shop_entry(p_entry_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_entry public.shop_entries%rowtype; v_balance bigint:=0; v_current bigint:=0;
  v_required bigint; v_granted bigint:=0; v_discarded bigint:=0; v_max_owned integer; v_unlocked boolean:=false;
  v_event uuid; v_existing jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'VALIDATION: request id is required'; end if;
  select public.shop_purchase_receipt_json(v_user,p_request_id) into v_existing;
  if v_existing is not null then return v_existing; end if;
  perform public.ensure_user_game_state();
  perform id from auth.users where id=v_user for update;
  select public.shop_purchase_receipt_json(v_user,p_request_id) into v_existing;
  if v_existing is not null then return v_existing; end if;

  select * into v_entry from public.shop_entries
  where id=p_entry_id and is_active and not is_archived for update;
  if not found then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if not exists(select 1 from public.currencies where id=v_entry.currency_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if v_entry.target_category='critter' and not exists(select 1 from public.critters where id=v_entry.target_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if v_entry.target_category='rollcaster' and not exists(select 1 from public.rollcasters where id=v_entry.target_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if v_entry.target_category='relic' and not exists(select 1 from public.relics where id=v_entry.target_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;

  select balance into v_balance from public.user_currencies
  where user_id=v_user and currency_id=v_entry.currency_id for update;
  v_balance:=coalesce(v_balance,0);
  if v_balance<v_entry.price then raise exception 'INSUFFICIENT_FUNDS'; end if;

  if v_entry.shop_type='shard' then
    v_unlocked:=public.collectible_is_unlocked(v_user,v_entry.target_category,v_entry.target_id);
    if v_unlocked then raise exception 'COLLECTIBLE_ALREADY_UNLOCKED'; end if;
    select required_amount into v_required from public.collectible_unlock_challenges
    where collectible_type=v_entry.target_category and collectible_id=v_entry.target_id and challenge_type='shop_shards';
    if v_required is null then raise exception 'SHOP_SHARDS_CHALLENGE_MISSING'; end if;
    select quantity into v_current from public.user_collectible_shards
    where user_id=v_user and collectible_type=v_entry.target_category and collectible_id=v_entry.target_id for update;
    v_current:=coalesce(v_current,0);
    if v_current>=v_required then raise exception 'SHOP_SHARDS_CHALLENGE_COMPLETE'; end if;
    v_granted:=least(v_entry.quantity::bigint,v_required-v_current);
    v_discarded:=v_entry.quantity-v_granted;
    insert into public.user_collectible_shards(user_id,collectible_type,collectible_id,quantity,updated_at)
    values(v_user,v_entry.target_category,v_entry.target_id,v_current+v_granted,now())
    on conflict(user_id,collectible_type,collectible_id) do update set quantity=excluded.quantity,updated_at=now();
  else
    select max_owned into v_max_owned from public.relics where id=v_entry.target_id for update;
    select quantity,discovered_at is not null into v_current,v_unlocked from public.user_relic_inventory
    where user_id=v_user and relic_id=v_entry.target_id for update;
    v_current:=coalesce(v_current,0); v_unlocked:=coalesce(v_unlocked,false);
    if not v_unlocked and not exists(select 1 from public.collectible_unlock_challenges
      where collectible_type='relic' and collectible_id=v_entry.target_id and challenge_type='shop_relic') then
      raise exception 'SHOP_RELIC_CHALLENGE_MISSING';
    end if;
    if v_current+v_entry.quantity>v_max_owned then raise exception 'RELIC_MAX_OWNED_REACHED'; end if;
    v_granted:=v_entry.quantity;
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values(v_user,v_entry.target_id,v_current+v_granted,case when v_unlocked then now() else null end)
    on conflict(user_id,relic_id) do update set quantity=excluded.quantity,
      discovered_at=coalesce(public.user_relic_inventory.discovered_at,excluded.discovered_at);
  end if;

  insert into public.user_currencies(user_id,currency_id,balance,updated_at)
  values(v_user,v_entry.currency_id,v_balance-v_entry.price,now())
  on conflict(user_id,currency_id) do update set balance=excluded.balance,updated_at=now();
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  select id into v_event from public.user_collectible_unlock_events
  where user_id=v_user and collectible_type=v_entry.target_category and collectible_id=v_entry.target_id;
  insert into public.shop_purchase_receipts(
    user_id,request_id,entry_id,shop_type,target_category,target_id,currency_id,price,balance_after,granted,discarded,unlock_event_id
  ) values(
    v_user,p_request_id,p_entry_id,v_entry.shop_type,v_entry.target_category,v_entry.target_id,
    v_entry.currency_id,v_entry.price,v_balance-v_entry.price,v_granted,v_discarded,v_event
  );
  return public.shop_purchase_receipt_json(v_user,p_request_id);
end; $$;

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
      select ch.* from public.user_tracked_collectible_challenges t
      join public.collectible_unlock_challenges ch on ch.id=t.challenge_id
      where t.user_id=v_user and ch.challenge_type=v_type order by t.slot_order
    loop
      if not c.any_target then
        if c.target_mode in ('species','skill') and not (v_match_id=any(c.target_ids)) then continue; end if;
        if c.target_mode='element' and not (v_match_element=any(c.target_ids)) then continue; end if;
      end if;
      v_goal:=c.required_amount; v_increment:=case when v_type in ('knock_out_critters','use_skill') then 1 else v_amount end;
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
end; $$;

create or replace function public.evaluate_collectible_after_player_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
  if pg_trigger_depth()>1 then return new; end if;
  v_user:=new.user_id;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  return new;
end; $$;

drop trigger if exists evaluate_collectibles_after_critter_change on public.user_critters;
create trigger evaluate_collectibles_after_critter_change after insert or update of xp,level on public.user_critters
for each row execute function public.evaluate_collectible_after_player_change();
drop trigger if exists evaluate_collectibles_after_rollcaster_change on public.user_rollcasters;
create trigger evaluate_collectibles_after_rollcaster_change after insert or update of xp,level on public.user_rollcasters
for each row execute function public.evaluate_collectible_after_player_change();
drop trigger if exists evaluate_collectibles_after_relic_change on public.user_relic_inventory;
create trigger evaluate_collectibles_after_relic_change after insert or update of quantity,discovered_at on public.user_relic_inventory
for each row execute function public.evaluate_collectible_after_player_change();
drop trigger if exists evaluate_collectibles_after_shard_change on public.user_collectible_shards;
create trigger evaluate_collectibles_after_shard_change after insert or update of quantity on public.user_collectible_shards
for each row execute function public.evaluate_collectible_after_player_change();
drop trigger if exists evaluate_collectibles_after_progress_change on public.user_collectible_challenge_progress;
create trigger evaluate_collectibles_after_progress_change after insert or update of progress on public.user_collectible_challenge_progress
for each row execute function public.evaluate_collectible_after_player_change();

alter table public.user_collectible_unlock_events enable row level security;
alter table public.shop_purchase_receipts enable row level security;
alter table public.collectible_combat_events enable row level security;
drop policy if exists user_collectible_unlock_events_read_own on public.user_collectible_unlock_events;
drop policy if exists shop_purchase_receipts_read_own on public.shop_purchase_receipts;
drop policy if exists collectible_combat_events_read_own on public.collectible_combat_events;
create policy user_collectible_unlock_events_read_own on public.user_collectible_unlock_events for select using(auth.uid()=user_id);
create policy shop_purchase_receipts_read_own on public.shop_purchase_receipts for select using(auth.uid()=user_id);
create policy collectible_combat_events_read_own on public.collectible_combat_events for select using(auth.uid()=user_id);
grant select on public.user_collectible_unlock_events,public.shop_purchase_receipts,public.collectible_combat_events to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.user_collectible_unlock_events,public.shop_purchase_receipts,public.collectible_combat_events from anon,authenticated;

revoke all on function public.collectible_is_unlocked(uuid,text,text) from public;
revoke all on function public.collectible_challenge_goal(uuid) from public;
revoke all on function public.collectible_challenge_current(uuid,uuid) from public;
revoke all on function public.grant_collectible_internal(uuid,text,text) from public;
revoke all on function public.evaluate_collectible_unlock_internal(uuid,text,text) from public;
revoke all on function public.evaluate_all_collectible_unlocks_internal(uuid) from public;
revoke all on function public.shop_purchase_receipt_json(uuid,uuid) from public;
revoke all on function public.evaluate_collectible_after_player_change() from public;
revoke execute on function public.purchase_shop_entry(uuid) from authenticated;
grant execute on function public.get_collectible_player_snapshot() to authenticated;
grant execute on function public.acknowledge_collectible_unlock_event(uuid) to authenticated;
grant execute on function public.purchase_shop_entry(uuid,uuid) to authenticated;
grant execute on function public.submit_collectible_combat_events(uuid,integer,jsonb) to authenticated;
