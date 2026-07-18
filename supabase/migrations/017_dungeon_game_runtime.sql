-- Player-game Dungeon runtime for immutable run snapshots, deterministic
-- encounter generation, per-battle reward journaling, participation-based XP,
-- first/repeat completion rewards, and retry-safe commands.

alter table public.dungeon_runs add column if not exists request_id uuid;
alter table public.dungeon_runs add column if not exists dungeon_version integer;
alter table public.dungeon_runs add column if not exists effective_mode text;
alter table public.dungeon_runs add column if not exists battle_count integer;
alter table public.dungeon_runs add column if not exists battle_index integer not null default 1;
alter table public.dungeon_runs add column if not exists random_seed bigint;
alter table public.dungeon_runs add column if not exists random_cursor integer not null default 0;
alter table public.dungeon_runs add column if not exists state_version integer not null default 1;
alter table public.dungeon_runs add column if not exists catalog_snapshot jsonb;
alter table public.dungeon_runs add column if not exists squad_snapshot jsonb;
alter table public.dungeon_runs add column if not exists battle_results jsonb not null default '[]'::jsonb;

update public.dungeon_runs run
set dungeon_version=coalesce(run.dungeon_version,dungeon.version,1),
    effective_mode=coalesce(run.effective_mode,dungeon.dungeon_type,'regular'),
    battle_count=coalesce(run.battle_count,dungeon.battle_count,dungeon.encounter_count,1),
    random_seed=coalesce(run.random_seed,hashtextextended(run.id::text,0)),
    catalog_snapshot=coalesce(run.catalog_snapshot,public.dungeon_snapshot(run.dungeon_id)),
    squad_snapshot=coalesce(run.squad_snapshot,'{}'::jsonb),
    rewards=case
      when jsonb_typeof(run.rewards)='object'
        and run.rewards ? 'entries'
        then run.rewards
      else jsonb_build_object(
        'entries','[]'::jsonb,
        'defeatedOpponentInstanceIds','[]'::jsonb,
        'critterXp','{}'::jsonb,
        'rollcasterXp',0
      )
    end
from public.dungeons dungeon
where dungeon.id=run.dungeon_id;

alter table public.dungeon_runs alter column dungeon_version set not null;
alter table public.dungeon_runs alter column effective_mode set not null;
alter table public.dungeon_runs alter column battle_count set not null;
alter table public.dungeon_runs alter column random_seed set not null;
alter table public.dungeon_runs alter column catalog_snapshot set not null;
alter table public.dungeon_runs alter column squad_snapshot set not null;
alter table public.dungeon_runs drop constraint if exists dungeon_runs_effective_mode_check;
alter table public.dungeon_runs add constraint dungeon_runs_effective_mode_check
  check(effective_mode in ('regular','boss'));
alter table public.dungeon_runs drop constraint if exists dungeon_runs_battle_count_check;
alter table public.dungeon_runs add constraint dungeon_runs_battle_count_check
  check(battle_count>0 and battle_index between 1 and battle_count);
alter table public.dungeon_runs drop constraint if exists dungeon_runs_state_version_check;
alter table public.dungeon_runs add constraint dungeon_runs_state_version_check
  check(state_version>0 and random_cursor>=0);
create unique index if not exists dungeon_runs_user_request_unique_idx
  on public.dungeon_runs(user_id,request_id) where request_id is not null;

-- The pre-rework seed Boss only had Boss Order rows. Clone those immutable
-- authored combatants into an equal-weight Regular pool once so an existing
-- first clear can immediately transition to the required replay mode.
do $$
declare
  v_dungeon record;
  v_source record;
  v_new_id uuid;
  v_count integer;
  v_index integer;
begin
  for v_dungeon in
    select dungeon.id
    from public.dungeons dungeon
    where dungeon.dungeon_type='boss'
      and exists(
        select 1 from public.dungeon_opponents
        where dungeon_id=dungeon.id and pool_type='boss_order'
      )
      and not exists(
        select 1 from public.dungeon_opponents
        where dungeon_id=dungeon.id and pool_type='regular_pool'
      )
  loop
    select count(*)::integer into v_count
    from public.dungeon_opponents
    where dungeon_id=v_dungeon.id and pool_type='boss_order';
    v_index:=0;
    for v_source in
      select * from public.dungeon_opponents
      where dungeon_id=v_dungeon.id and pool_type='boss_order'
      order by sequence_index,id
    loop
      v_new_id:=gen_random_uuid();
      insert into public.dungeon_opponents(
        id,dungeon_id,pool_type,sequence_index,probability,selection_weight,
        critter_id,critter_level,skill_ids,relic_ids,
        rollcaster_xp_reward,critter_xp_reward,currency_reward,drops
      ) values(
        v_new_id,v_dungeon.id,'regular_pool',v_index,1::numeric/v_count,1::numeric/v_count,
        v_source.critter_id,v_source.critter_level,v_source.skill_ids,v_source.relic_ids,
        v_source.rollcaster_xp_reward,v_source.critter_xp_reward,
        v_source.currency_reward,v_source.drops
      );
      insert into public.dungeon_opponent_skills(opponent_id,skill_id,slot_index)
      select v_new_id,skill_id,slot_index from public.dungeon_opponent_skills
      where opponent_id=v_source.id;
      insert into public.dungeon_opponent_relics(opponent_id,relic_id,slot_index)
      select v_new_id,relic_id,slot_index from public.dungeon_opponent_relics
      where opponent_id=v_source.id;
      insert into public.dungeon_opponent_stat_overrides(opponent_id,stat_key,value)
      select v_new_id,stat_key,value from public.dungeon_opponent_stat_overrides
      where opponent_id=v_source.id;
      insert into public.dungeon_opponent_currency_drops(
        opponent_id,currency_id,min_amount,max_amount,probability,sort_order
      )
      select v_new_id,currency_id,min_amount,max_amount,probability,sort_order
      from public.dungeon_opponent_currency_drops where opponent_id=v_source.id;
      insert into public.dungeon_opponent_item_drops(
        opponent_id,drop_type,target_category,target_id,min_amount,max_amount,
        probability,dupe_currency_id,dupe_currency_amount,sort_order
      )
      select v_new_id,drop_type,target_category,target_id,min_amount,max_amount,
        probability,dupe_currency_id,dupe_currency_amount,sort_order
      from public.dungeon_opponent_item_drops where opponent_id=v_source.id;
      v_index:=v_index+1;
    end loop;
  end loop;
end;
$$;

create table if not exists public.dungeon_run_commands(
  run_id uuid not null references public.dungeon_runs(id) on delete cascade,
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  command_type text not null check(command_type in ('battle_result','save_state')),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(run_id,request_id)
);
alter table public.dungeon_run_commands enable row level security;
drop policy if exists dungeon_run_commands_own_select on public.dungeon_run_commands;
create policy dungeon_run_commands_own_select on public.dungeon_run_commands
  for select using(user_id=auth.uid());
grant select on public.dungeon_run_commands to authenticated;

create or replace function public.dungeon_runtime_random(
  p_seed bigint,
  p_key text
) returns numeric
language sql immutable set search_path=public as $$
  select mod(abs(hashtextextended(p_seed::text||':'||p_key,0)::numeric),1000000)/1000000
$$;

create or replace function public.dungeon_runtime_amount(
  p_seed bigint,
  p_key text,
  p_min integer,
  p_max integer
) returns integer
language sql immutable set search_path=public as $$
  select p_min+floor(public.dungeon_runtime_random(p_seed,p_key)*(p_max-p_min+1))::integer
$$;

create or replace function public.dungeon_run_payload(p_run_id uuid)
returns jsonb
language sql stable set search_path=public as $$
  select jsonb_build_object(
    'id',run.id,
    'dungeonId',run.dungeon_id,
    'dungeonVersion',run.dungeon_version,
    'effectiveMode',run.effective_mode,
    'battleFormat',run.battle_format,
    'battleCount',run.battle_count,
    'battleIndex',run.battle_index,
    'selectedOpponents',run.selected_opponents,
    'randomSeed',run.random_seed::text,
    'randomCursor',run.random_cursor,
    'status',run.status,
    'version',run.state_version,
    'rewards',run.rewards
  )
  from public.dungeon_runs run
  where run.id=p_run_id
$$;

create or replace function public.grant_dungeon_currency_internal(
  p_user uuid,
  p_currency text,
  p_amount bigint
) returns void
language plpgsql security definer set search_path=public as $$
begin
  if p_amount<=0 then return; end if;
  if not exists(
    select 1 from public.currencies
    where id=p_currency and is_active and not is_archived
  ) then raise exception 'DUNGEON_SNAPSHOT_INVALID: unknown Currency %',p_currency; end if;

  insert into public.user_currencies(user_id,currency_id,balance,updated_at)
  values(p_user,p_currency,p_amount,now())
  on conflict(user_id,currency_id) do update
    set balance=public.user_currencies.balance+excluded.balance,updated_at=now();

  if p_currency='coins' then
    update public.profiles
    set coins=least(2147483647::bigint,coins::bigint+p_amount)::integer,updated_at=now()
    where user_id=p_user;
  end if;
end;
$$;

create or replace function public.grant_dungeon_drop_internal(
  p_user uuid,
  p_drop jsonb,
  p_seed bigint,
  p_key text,
  p_source text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_kind text:=coalesce(p_drop->>'drop_type',case when p_drop ? 'currency_id' then 'currency' end);
  v_target_category text:=p_drop->>'target_category';
  v_target_id text:=coalesce(p_drop->>'target_id',p_drop->>'currency_id');
  v_probability numeric:=coalesce((p_drop->>'probability')::numeric,0);
  v_min integer:=coalesce((p_drop->>'min_amount')::integer,0);
  v_max integer:=coalesce((p_drop->>'max_amount')::integer,v_min);
  v_amount integer;
  v_granted bigint:=0;
  v_rejected bigint:=0;
  v_current bigint:=0;
  v_capacity bigint:=0;
  v_required bigint:=0;
  v_max_owned integer:=0;
  v_dupe_currency text:=p_drop->>'dupe_currency_id';
  v_dupe_amount bigint:=coalesce((p_drop->>'dupe_currency_amount')::bigint,0);
  v_converted bigint:=0;
  v_entries jsonb:='[]'::jsonb;
begin
  if public.dungeon_runtime_random(p_seed,p_key||':chance')>=v_probability then
    return v_entries;
  end if;
  v_amount:=public.dungeon_runtime_amount(p_seed,p_key||':amount',v_min,v_max);
  if v_amount<=0 then return v_entries; end if;

  if v_kind='currency' then
    perform public.grant_dungeon_currency_internal(p_user,v_target_id,v_amount);
    return jsonb_build_array(jsonb_build_object(
      'id',p_key,'source',p_source,'kind','currency','targetId',v_target_id,'amount',v_amount
    ));
  elsif v_kind='shard' then
    if public.collectible_is_unlocked(p_user,v_target_category,v_target_id) then
      v_rejected:=v_amount;
    else
      select required_amount into v_required
      from public.collectible_unlock_challenges
      where collectible_type=v_target_category
        and collectible_id=v_target_id
        and challenge_type='shop_shards';
      if v_required is null then
        raise exception 'DUNGEON_SNAPSHOT_INVALID: Shard target has no Shard challenge';
      end if;
      select quantity into v_current
      from public.user_collectible_shards
      where user_id=p_user
        and collectible_type=v_target_category
        and collectible_id=v_target_id
      for update;
      v_current:=coalesce(v_current,0);
      v_capacity:=greatest(0,v_required-v_current);
      v_granted:=least(v_amount::bigint,v_capacity);
      v_rejected:=v_amount-v_granted;
      if v_granted>0 then
        insert into public.user_collectible_shards(
          user_id,collectible_type,collectible_id,quantity,updated_at
        ) values(
          p_user,v_target_category,v_target_id,v_current+v_granted,now()
        ) on conflict(user_id,collectible_type,collectible_id) do update
          set quantity=excluded.quantity,updated_at=now();
        v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
          'id',p_key,'source',p_source,'kind','shard',
          'targetCategory',v_target_category,'targetId',v_target_id,'amount',v_granted
        ));
      end if;
    end if;
  elsif v_kind='relic' then
    select max_owned into v_max_owned from public.relics where id=v_target_id for update;
    if v_max_owned is null then
      raise exception 'DUNGEON_SNAPSHOT_INVALID: unknown Relic %',v_target_id;
    end if;
    select quantity into v_current
    from public.user_relic_inventory
    where user_id=p_user and relic_id=v_target_id
    for update;
    v_current:=coalesce(v_current,0);
    v_capacity:=greatest(0,v_max_owned-v_current);
    v_granted:=least(v_amount::bigint,v_capacity);
    v_rejected:=v_amount-v_granted;
    if v_granted>0 then
      insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
      values(p_user,v_target_id,v_current+v_granted,now())
      on conflict(user_id,relic_id) do update
        set quantity=excluded.quantity,
            discovered_at=coalesce(public.user_relic_inventory.discovered_at,now());
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'id',p_key,'source',p_source,'kind','relic',
        'targetCategory','relic','targetId',v_target_id,'amount',v_granted
      ));
    end if;
  else
    raise exception 'DUNGEON_SNAPSHOT_INVALID: unsupported drop type %',v_kind;
  end if;

  if v_rejected>0 then
    if v_dupe_currency is null then
      raise exception 'DUNGEON_SNAPSHOT_INVALID: duplicate conversion Currency is missing';
    end if;
    v_converted:=v_rejected*v_dupe_amount;
    perform public.grant_dungeon_currency_internal(p_user,v_dupe_currency,v_converted);
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
      'id',p_key||':conversion','source','duplicate_conversion','kind','currency',
      'targetId',v_dupe_currency,'amount',v_converted,
      'convertedAmount',v_rejected,'convertedCurrencyId',v_dupe_currency
    ));
  end if;
  perform public.evaluate_all_collectible_unlocks_internal(p_user);
  return v_entries;
end;
$$;

create or replace function public.start_dungeon_run_v2(
  p_dungeon_id text,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=auth.uid();
  v_dungeon public.dungeons%rowtype;
  v_progress public.user_dungeon_progress%rowtype;
  v_run_id uuid:=gen_random_uuid();
  v_mode text;
  v_player_count integer;
  v_opponent_count integer;
  v_battle_count integer;
  v_catalog jsonb;
  v_pool jsonb;
  v_selected jsonb:='[]'::jsonb;
  v_squad jsonb;
  v_seed bigint;
  v_battle integer;
  v_slot integer;
  v_cursor integer:=0;
  v_random numeric;
  v_cumulative numeric;
  v_candidate jsonb;
  v_chosen jsonb;
  v_existing uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'VALIDATION: request id is required'; end if;

  select id into v_existing from public.dungeon_runs
  where user_id=v_user and request_id=p_request_id;
  if v_existing is not null then return public.dungeon_run_payload(v_existing); end if;
  perform id from auth.users where id=v_user for update;
  select id into v_existing from public.dungeon_runs
  where user_id=v_user and request_id=p_request_id;
  if v_existing is not null then return public.dungeon_run_payload(v_existing); end if;

  select * into v_dungeon from public.dungeons
  where id=p_dungeon_id and is_active and not is_archived;
  if not found then raise exception 'DUNGEON_UNAVAILABLE'; end if;
  select * into v_progress from public.user_dungeon_progress
  where user_id=v_user and dungeon_id=p_dungeon_id and is_unlocked
  for update;
  if not found then raise exception 'DUNGEON_LOCKED'; end if;
  if not exists(
    select 1 from public.profiles profile
    join public.user_rollcasters owned on owned.id=profile.active_rollcaster_id
    where profile.user_id=v_user and owned.user_id=v_user
  ) then raise exception 'DUNGEON_ROLLCASTER_REQUIRED'; end if;
  if not exists(
    select 1 from public.user_squad_slots slot
    join public.user_critters owned on owned.id=slot.user_critter_id
    where slot.user_id=v_user and owned.user_id=v_user
  ) then raise exception 'DUNGEON_SQUAD_REQUIRED'; end if;

  v_player_count:=split_part(v_dungeon.battle_format,'v',1)::integer;
  v_opponent_count:=split_part(v_dungeon.battle_format,'v',2)::integer;
  v_mode:=case
    when v_dungeon.dungeon_type='boss' and v_progress.clear_count=0 then 'boss'
    else 'regular'
  end;
  v_catalog:=public.dungeon_snapshot(v_dungeon.id);
  select coalesce(jsonb_agg(value order by (value->>'sequence_index')::integer),'[]'::jsonb)
  into v_pool
  from jsonb_array_elements(v_catalog->'opponents')
  where value->>'pool_type'=case when v_mode='boss' then 'boss_order' else 'regular_pool' end;
  if jsonb_array_length(v_pool)=0 then raise exception 'DUNGEON_ENCOUNTERS_MISSING'; end if;
  v_battle_count:=case
    when v_mode='boss' then jsonb_array_length(v_pool)/v_opponent_count
    else v_dungeon.battle_count
  end;
  if v_battle_count<1
    or (v_mode='boss' and jsonb_array_length(v_pool)<>v_battle_count*v_opponent_count)
  then raise exception 'DUNGEON_ENCOUNTERS_INVALID'; end if;

  v_seed:=hashtextextended(v_run_id::text,0);
  for v_battle in 1..v_battle_count loop
    for v_slot in 1..v_opponent_count loop
      if v_mode='boss' then
        v_chosen:=v_pool->((v_battle-1)*v_opponent_count+v_slot-1);
      else
        v_random:=public.dungeon_runtime_random(v_seed,'encounter:'||v_cursor);
        v_cursor:=v_cursor+1;
        v_cumulative:=0;
        v_chosen:=v_pool->(jsonb_array_length(v_pool)-1);
        for v_candidate in select value from jsonb_array_elements(v_pool) loop
          v_cumulative:=v_cumulative+coalesce((v_candidate->>'probability')::numeric,0);
          if v_random<v_cumulative then
            v_chosen:=v_candidate;
            exit;
          end if;
        end loop;
      end if;
      v_selected:=v_selected||jsonb_build_array(v_chosen||jsonb_build_object(
        'instanceId',v_run_id::text||':'||v_battle||':'||v_slot,
        'battleIndex',v_battle,
        'battlefieldSlot',v_slot-1
      ));
    end loop;
  end loop;

  select jsonb_build_object(
    'activeRollcasterId',profile.active_rollcaster_id,
    'squad',coalesce(jsonb_agg(jsonb_build_object(
      'slotIndex',slot.slot_index,
      'userCritterId',owned.id,
      'critterId',owned.critter_id,
      'level',owned.level,
      'xp',owned.xp,
      'skillIds',coalesce((
        select jsonb_agg(skill_slot.skill_id order by skill_slot.slot_index)
        from public.user_critter_skill_slots skill_slot
        where skill_slot.user_critter_id=owned.id and skill_slot.skill_id is not null
      ),'[]'::jsonb),
      'relicIds',coalesce((
        select jsonb_agg(relic_slot.relic_id order by relic_slot.slot_index)
        from public.user_critter_relic_slots relic_slot
        where relic_slot.user_critter_id=owned.id and relic_slot.relic_id is not null
      ),'[]'::jsonb)
    ) order by slot.slot_index),'[]'::jsonb)
  ) into v_squad
  from public.profiles profile
  join public.user_squad_slots slot on slot.user_id=profile.user_id
  join public.user_critters owned on owned.id=slot.user_critter_id and owned.user_id=profile.user_id
  where profile.user_id=v_user
  group by profile.active_rollcaster_id;

  insert into public.dungeon_runs(
    id,user_id,dungeon_id,status,selected_opponents,battle_format,
    player_active_count,opponent_active_count,turn_number,player_mana,opponent_mana,
    combat_state,battle_log,rewards,request_id,dungeon_version,effective_mode,
    battle_count,battle_index,random_seed,random_cursor,state_version,
    catalog_snapshot,squad_snapshot,battle_results
  ) values(
    v_run_id,v_user,v_dungeon.id,'started',v_selected,v_dungeon.battle_format,
    v_player_count,v_opponent_count,1,0,0,'{}'::jsonb,'[]'::jsonb,
    jsonb_build_object(
      'entries','[]'::jsonb,
      'defeatedOpponentInstanceIds','[]'::jsonb,
      'critterXp','{}'::jsonb,
      'rollcasterXp',0
    ),
    p_request_id,v_dungeon.version,v_mode,v_battle_count,1,v_seed,v_cursor,1,
    v_catalog,v_squad,'[]'::jsonb
  );
  return public.dungeon_run_payload(v_run_id);
end;
$$;

create or replace function public.start_dungeon_run(p_dungeon_id text)
returns uuid
language plpgsql security definer set search_path=public,auth as $$
declare v_payload jsonb;
begin
  v_payload:=public.start_dungeon_run_v2(p_dungeon_id,gen_random_uuid());
  return (v_payload->>'id')::uuid;
end;
$$;

create or replace function public.record_dungeon_battle_result(
  p_run_id uuid,
  p_expected_battle_index integer,
  p_outcome text,
  p_defeated_instance_ids text[],
  p_participant_user_critter_ids uuid[],
  p_squad_hp jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=auth.uid();
  v_run public.dungeon_runs%rowtype;
  v_existing jsonb;
  v_instance jsonb;
  v_drop jsonb;
  v_entries jsonb:='[]'::jsonb;
  v_completion_entries jsonb:='[]'::jsonb;
  v_new_defeated jsonb:='[]'::jsonb;
  v_reward jsonb;
  v_accum jsonb;
  v_battle_critter_xp integer:=0;
  v_battle_rollcaster_xp integer:=0;
  v_participant_count integer;
  v_base integer;
  v_remainder integer;
  v_award integer;
  v_participant uuid;
  v_index integer;
  v_phase text;
  v_next text;
  v_response jsonb;
  v_current_battle_count integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'VALIDATION: request id is required'; end if;
  if p_outcome not in ('won','lost') then raise exception 'VALIDATION: invalid battle outcome'; end if;
  if jsonb_typeof(p_squad_hp) is distinct from 'object' then raise exception 'VALIDATION: squad HP is required'; end if;

  select response into v_existing from public.dungeon_run_commands
  where run_id=p_run_id and request_id=p_request_id and user_id=v_user;
  if v_existing is not null then return v_existing; end if;

  select * into v_run from public.dungeon_runs
  where id=p_run_id and user_id=v_user for update;
  if not found then raise exception 'DUNGEON_RUN_NOT_FOUND'; end if;
  if v_run.status<>'started' then raise exception 'DUNGEON_RUN_RESOLVED'; end if;
  if v_run.battle_index<>p_expected_battle_index then raise exception 'DUNGEON_STATE_CONFLICT'; end if;

  if exists(
    select 1 from unnest(coalesce(p_defeated_instance_ids,'{}'::text[])) defeated
    where not exists(
      select 1 from jsonb_array_elements(v_run.selected_opponents) opponent
      where opponent->>'instanceId'=defeated
        and (opponent->>'battleIndex')::integer=v_run.battle_index
    )
  ) then raise exception 'VALIDATION: defeated opponent is not in this encounter'; end if;
  select count(*) into v_current_battle_count
  from jsonb_array_elements(v_run.selected_opponents) opponent
  where (opponent->>'battleIndex')::integer=v_run.battle_index;
  if cardinality(coalesce(p_defeated_instance_ids,'{}'::text[]))<>
    (select count(distinct defeated) from unnest(coalesce(p_defeated_instance_ids,'{}'::text[])) defeated)
  then
    raise exception 'VALIDATION: defeated opponent instance IDs must be unique';
  end if;
  if p_outcome='won' and cardinality(coalesce(p_defeated_instance_ids,'{}'::text[]))<>v_current_battle_count then
    raise exception 'VALIDATION: every opponent must be defeated to clear an encounter';
  end if;
  if exists(
    select 1 from unnest(coalesce(p_participant_user_critter_ids,'{}'::uuid[])) participant
    where not exists(
      select 1 from jsonb_array_elements(v_run.squad_snapshot->'squad') member
      where (member->>'userCritterId')::uuid=participant
    )
  ) then raise exception 'VALIDATION: participant is not in the run squad'; end if;

  v_accum:=coalesce(v_run.rewards,'{}'::jsonb);
  v_accum:=v_accum||jsonb_build_object(
    'entries',coalesce(v_accum->'entries','[]'::jsonb),
    'defeatedOpponentInstanceIds',coalesce(v_accum->'defeatedOpponentInstanceIds','[]'::jsonb),
    'critterXp',coalesce(v_accum->'critterXp','{}'::jsonb),
    'rollcasterXp',coalesce((v_accum->>'rollcasterXp')::integer,0)
  );

  for v_instance in
    select value from jsonb_array_elements(v_run.selected_opponents)
    where (value->>'battleIndex')::integer=v_run.battle_index
      and value->>'instanceId'=any(coalesce(p_defeated_instance_ids,'{}'::text[]))
      and not coalesce(v_accum->'defeatedOpponentInstanceIds','[]'::jsonb) ? (value->>'instanceId')
    order by (value->>'battlefieldSlot')::integer
  loop
    v_new_defeated:=v_new_defeated||jsonb_build_array(v_instance->>'instanceId');
    v_battle_critter_xp:=v_battle_critter_xp+coalesce((v_instance->>'critter_xp_reward')::integer,0);
    v_battle_rollcaster_xp:=v_battle_rollcaster_xp+coalesce((v_instance->>'rollcaster_xp_reward')::integer,0);
    insert into public.user_seen_critters(user_id,critter_id)
    values(v_user,v_instance->>'critter_id') on conflict do nothing;

    for v_drop in select value from jsonb_array_elements(coalesce(v_instance->'currencyDrops','[]'::jsonb)) loop
      v_reward:=public.grant_dungeon_drop_internal(
        v_user,v_drop,v_run.random_seed,
        'opponent:'||(v_instance->>'instanceId')||':'||(v_drop->>'id'),'opponent'
      );
      v_entries:=v_entries||v_reward;
    end loop;
    for v_drop in select value from jsonb_array_elements(coalesce(v_instance->'itemDrops','[]'::jsonb)) loop
      v_reward:=public.grant_dungeon_drop_internal(
        v_user,v_drop,v_run.random_seed,
        'opponent:'||(v_instance->>'instanceId')||':'||(v_drop->>'id'),'opponent'
      );
      v_entries:=v_entries||v_reward;
    end loop;
  end loop;

  select count(distinct participant) into v_participant_count
  from unnest(coalesce(p_participant_user_critter_ids,'{}'::uuid[])) participant;
  if v_battle_critter_xp>0 and v_participant_count=0 then
    raise exception 'VALIDATION: defeated opponents require at least one participant';
  end if;
  if v_battle_critter_xp>0 and v_participant_count>0 then
    v_base:=v_battle_critter_xp/v_participant_count;
    v_remainder:=mod(v_battle_critter_xp,v_participant_count);
    v_index:=0;
    for v_participant in
      select participant
      from unnest(p_participant_user_critter_ids) participant
      group by participant
      order by public.dungeon_runtime_random(v_run.random_seed,'xp:'||v_run.battle_index||':'||participant)
    loop
      v_index:=v_index+1;
      v_award:=v_base+case when v_index<=v_remainder then 1 else 0 end;
      update public.user_critters owned
      set xp=owned.xp+v_award,
          level=public.calc_critter_level(owned.critter_id,owned.xp+v_award)
      where owned.id=v_participant and owned.user_id=v_user;
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'id','battle:'||v_run.battle_index||':critter-xp:'||v_participant,
        'source','opponent','kind','critter_xp','targetId','xp',
        'recipientId',v_participant,'amount',v_award
      ));
      v_accum:=jsonb_set(
        v_accum,array['critterXp',v_participant::text],
        to_jsonb(coalesce((v_accum->'critterXp'->>v_participant::text)::integer,0)+v_award),true
      );
    end loop;
  end if;

  if v_battle_rollcaster_xp>0 then
    update public.user_rollcasters owned
    set xp=owned.xp+v_battle_rollcaster_xp,
        level=public.calc_rollcaster_level(owned.rollcaster_id,owned.xp+v_battle_rollcaster_xp)
    where owned.id=(v_run.squad_snapshot->>'activeRollcasterId')::uuid
      and owned.user_id=v_user;
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
      'id','battle:'||v_run.battle_index||':rollcaster-xp',
      'source','opponent','kind','rollcaster_xp','targetId','xp',
      'recipientId',v_run.squad_snapshot->>'activeRollcasterId',
      'amount',v_battle_rollcaster_xp
    ));
    v_accum:=jsonb_set(
      v_accum,'{rollcasterXp}',
      to_jsonb(coalesce((v_accum->>'rollcasterXp')::integer,0)+v_battle_rollcaster_xp),true
    );
  end if;

  v_accum:=jsonb_set(v_accum,'{entries}',coalesce(v_accum->'entries','[]'::jsonb)||v_entries,true);
  v_accum:=jsonb_set(
    v_accum,'{defeatedOpponentInstanceIds}',
    coalesce(v_accum->'defeatedOpponentInstanceIds','[]'::jsonb)||v_new_defeated,true
  );

  if p_outcome='lost' then
    update public.dungeon_runs set
      status='lost',rewards=v_accum,combat_state=jsonb_build_object('squadHp',p_squad_hp),
      battle_results=battle_results||jsonb_build_array(jsonb_build_object(
        'battleIndex',battle_index,'outcome','lost','rewards',v_entries,'recordedAt',now()
      )),
      state_version=state_version+1,resolved_at=now()
    where id=p_run_id;
  elsif v_run.battle_index<v_run.battle_count then
    update public.dungeon_runs set
      battle_index=battle_index+1,rewards=v_accum,
      combat_state=jsonb_build_object('squadHp',p_squad_hp),
      battle_results=battle_results||jsonb_build_array(jsonb_build_object(
        'battleIndex',battle_index,'outcome','won','rewards',v_entries,'recordedAt',now()
      )),
      turn_number=1,player_mana=0,opponent_mana=0,state_version=state_version+1
    where id=p_run_id;
  else
    select case when progress.clear_count=0 then 'first_time' else 'regular' end
    into v_phase
    from public.user_dungeon_progress progress
    where progress.user_id=v_user and progress.dungeon_id=v_run.dungeon_id
    for update;
    for v_drop in
      select value from jsonb_array_elements(coalesce(v_run.catalog_snapshot->'completionDrops','[]'::jsonb))
      where value->>'completion_phase'=v_phase
      order by (value->>'sort_order')::integer
    loop
      v_reward:=public.grant_dungeon_drop_internal(
        v_user,v_drop,v_run.random_seed,
        'completion:'||v_phase||':'||(v_drop->>'id'),'completion'
      );
      v_completion_entries:=v_completion_entries||v_reward;
    end loop;
    v_accum:=jsonb_set(
      v_accum,'{entries}',
      coalesce(v_accum->'entries','[]'::jsonb)||v_completion_entries,true
    );
    v_accum:=v_accum||jsonb_build_object('completionPhase',v_phase);

    update public.user_dungeon_progress
    set completed_at=coalesce(completed_at,now()),clear_count=clear_count+1
    where user_id=v_user and dungeon_id=v_run.dungeon_id;
    select dungeon.next_dungeon_id into v_next
    from public.dungeons dungeon where dungeon.id=v_run.dungeon_id;
    if v_next is not null and exists(
      select 1 from public.dungeons where id=v_next and is_active and not is_archived
    ) then
      insert into public.user_dungeon_progress(user_id,dungeon_id,is_unlocked)
      values(v_user,v_next,true)
      on conflict(user_id,dungeon_id) do update set is_unlocked=true;
    else
      v_next:=null;
    end if;

    update public.dungeon_runs set
      status='won',rewards=v_accum,combat_state=jsonb_build_object('squadHp',p_squad_hp),
      battle_results=battle_results||jsonb_build_array(jsonb_build_object(
        'battleIndex',battle_index,'outcome','won','rewards',v_entries,'recordedAt',now()
      )),
      state_version=state_version+1,resolved_at=now()
    where id=p_run_id;
  end if;

  v_response:=jsonb_build_object(
    'run',public.dungeon_run_payload(p_run_id),
    'battleRewards',jsonb_build_object(
      'entries',v_entries,
      'defeatedOpponentInstanceIds',v_new_defeated,
      'critterXp',(
        select coalesce(jsonb_object_agg(entry->>'recipientId',(entry->>'amount')::integer),'{}'::jsonb)
        from jsonb_array_elements(v_entries) entry where entry->>'kind'='critter_xp'
      ),
      'rollcasterXp',v_battle_rollcaster_xp
    ),
    'dungeonRewards',case when v_phase is not null then jsonb_build_object(
      'entries',v_completion_entries,
      'defeatedOpponentInstanceIds','[]'::jsonb,
      'critterXp','{}'::jsonb,
      'rollcasterXp',0,
      'completionPhase',v_phase
    ) else null end,
    'nextDungeonId',v_next
  );
  insert into public.dungeon_run_commands(run_id,request_id,user_id,command_type,response)
  values(p_run_id,p_request_id,v_user,'battle_result',v_response);
  return v_response;
end;
$$;

create or replace function public.save_dungeon_run_state(
  p_run_id uuid,
  p_expected_version integer,
  p_state jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=auth.uid();
  v_run public.dungeon_runs%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null or jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'VALIDATION: request id and state object are required';
  end if;
  if pg_column_size(p_state)>1048576 then raise exception 'VALIDATION: combat state is too large'; end if;
  select response into v_existing from public.dungeon_run_commands
  where run_id=p_run_id and request_id=p_request_id and user_id=v_user;
  if v_existing is not null then return v_existing; end if;
  select * into v_run from public.dungeon_runs
  where id=p_run_id and user_id=v_user for update;
  if not found then raise exception 'DUNGEON_RUN_NOT_FOUND'; end if;
  if v_run.status<>'started' then raise exception 'DUNGEON_RUN_RESOLVED'; end if;
  if v_run.state_version<>p_expected_version then raise exception 'DUNGEON_STATE_CONFLICT'; end if;
  update public.dungeon_runs
  set combat_state=p_state,state_version=state_version+1
  where id=p_run_id;
  v_response:=jsonb_build_object(
    'run',public.dungeon_run_payload(p_run_id),
    'combatState',p_state
  );
  insert into public.dungeon_run_commands(run_id,request_id,user_id,command_type,response)
  values(p_run_id,p_request_id,v_user,'save_state',v_response);
  return v_response;
end;
$$;

create or replace function public.get_active_dungeon_run_v2()
returns jsonb
language sql stable security definer set search_path=public,auth as $$
  select jsonb_build_object(
    'run',public.dungeon_run_payload(run.id),
    'combatState',run.combat_state,
    'effectSnapshot',run.effect_snapshot
  )
  from public.dungeon_runs run
  where run.user_id=auth.uid() and run.status='started'
  order by run.started_at desc,run.id desc
  limit 1
$$;

create or replace function public.resolve_dungeon_run(p_run_id uuid)
returns void
language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=auth.uid();
  v_status text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select status into v_status from public.dungeon_runs
  where id=p_run_id and user_id=v_user;
  if not found then raise exception 'DUNGEON_RUN_NOT_FOUND'; end if;
  if v_status='started' then
    raise exception 'DUNGEON_BATTLE_RESULT_REQUIRED';
  end if;
end;
$$;

revoke all on function public.start_dungeon_run_v2(text,uuid) from public,anon;
revoke all on function public.record_dungeon_battle_result(uuid,integer,text,text[],uuid[],jsonb,uuid) from public,anon;
revoke all on function public.save_dungeon_run_state(uuid,integer,jsonb,uuid) from public,anon;
revoke all on function public.get_active_dungeon_run_v2() from public,anon;
revoke all on function public.grant_dungeon_currency_internal(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.grant_dungeon_drop_internal(uuid,jsonb,bigint,text,text) from public,anon,authenticated;
revoke all on function public.dungeon_run_payload(uuid) from public,anon,authenticated;
grant execute on function public.start_dungeon_run_v2(text,uuid) to authenticated;
grant execute on function public.record_dungeon_battle_result(uuid,integer,text,text[],uuid[],jsonb,uuid) to authenticated;
grant execute on function public.save_dungeon_run_state(uuid,integer,jsonb,uuid) to authenticated;
grant execute on function public.get_active_dungeon_run_v2() to authenticated;
