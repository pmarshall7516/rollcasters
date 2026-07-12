create extension if not exists pgcrypto;

create table if not exists public.elements (
  id text primary key,
  name text not null,
  description text,
  sort_order int not null
);

create table if not exists public.statuses (
  id text primary key,
  name text not null,
  description text not null,
  effect jsonb not null default '{}'::jsonb
);

create table if not exists public.skills (
  id text primary key,
  name text not null,
  element_id text not null references public.elements(id),
  skill_type text not null check (skill_type in ('attack', 'support')),
  power int not null default 0,
  mana_cost int not null default 0,
  description text not null,
  effect jsonb not null default '{}'::jsonb,
  sort_order int not null
);

create table if not exists public.critters (
  id text primary key,
  name text not null,
  element_id text not null references public.elements(id),
  base_hp int not null,
  base_atk int not null,
  base_def int not null,
  base_spd int not null,
  base_dice_min int not null check (base_dice_min >= 1),
  base_dice_max int not null check (base_dice_max >= base_dice_min),
  base_block_cost int not null,
  base_swap_cost int not null,
  asset_path text,
  description text,
  sort_order int not null
);

create table if not exists public.critter_level_progression (
  critter_id text not null references public.critters(id) on delete cascade,
  level int not null,
  total_required_xp int not null,
  grant_skill_points int not null default 0,
  hp_delta int not null default 0,
  atk_delta int not null default 0,
  def_delta int not null default 0,
  spd_delta int not null default 0,
  dice_min_delta int not null default 0,
  dice_max_delta int not null default 0,
  block_cost_delta int not null default 0,
  swap_cost_delta int not null default 0,
  total_unlocked_relic_slots int not null default 1,
  primary key (critter_id, level)
);

create table if not exists public.critter_skill_unlocks (
  critter_id text not null references public.critters(id) on delete cascade,
  skill_id text not null references public.skills(id),
  unlock_level int not null,
  unlock_cost int not null default 0,
  is_default boolean not null default false,
  sort_order int not null,
  primary key (critter_id, skill_id)
);

create table if not exists public.rollcasters (
  id text primary key,
  name text not null,
  asset_path text,
  description text,
  sort_order int not null
);

create table if not exists public.rollcaster_level_progression (
  rollcaster_id text not null references public.rollcasters(id) on delete cascade,
  level int not null,
  total_required_xp int not null,
  grant_ability_points int not null default 0,
  total_unlocked_ability_slots int not null default 1,
  primary key (rollcaster_id, level)
);

create table if not exists public.rollcaster_abilities (
  id text primary key,
  name text not null,
  description text not null,
  effect jsonb not null default '{}'::jsonb,
  sort_order int not null
);

create table if not exists public.rollcaster_ability_unlocks (
  rollcaster_id text not null references public.rollcasters(id) on delete cascade,
  ability_id text not null references public.rollcaster_abilities(id),
  unlock_level int not null,
  unlock_cost int not null default 0,
  is_default boolean not null default false,
  sort_order int not null,
  primary key (rollcaster_id, ability_id)
);

create table if not exists public.relics (
  id text primary key,
  name text not null,
  description text not null,
  max_owned int not null,
  effect jsonb not null default '{}'::jsonb,
  asset_path text,
  sort_order int not null
);

create table if not exists public.dungeons (
  id text primary key,
  name text not null,
  dungeon_type text not null check (dungeon_type in ('regular', 'boss')),
  difficulty int not null,
  battle_format text not null check (battle_format in ('1v1', '2v1', '3v1', '2v2', '3v3')),
  player_active_count int not null check (player_active_count between 1 and 3),
  opponent_active_count int not null check (opponent_active_count between 1 and 3),
  encounter_count int not null default 1,
  next_dungeon_id text references public.dungeons(id),
  sort_order int not null
);

create table if not exists public.dungeon_opponents (
  id uuid primary key default gen_random_uuid(),
  dungeon_id text not null references public.dungeons(id) on delete cascade,
  pool_type text not null check (pool_type in ('regular_pool', 'boss_order')),
  sequence_index int,
  probability numeric,
  critter_id text not null references public.critters(id),
  critter_level int not null,
  skill_ids text[] not null,
  relic_ids text[] not null default '{}'::text[],
  rollcaster_xp_reward int not null,
  critter_xp_reward int not null,
  currency_reward int not null default 0,
  drops jsonb not null default '[]'::jsonb
);

create table if not exists public.starter_options (
  critter_id text primary key references public.critters(id) on delete cascade,
  sort_order int not null,
  is_active boolean not null default true
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  coins int not null default 0,
  starter_selected_at timestamptz,
  active_rollcaster_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_rollcasters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rollcaster_id text not null references public.rollcasters(id),
  level int not null default 1,
  xp int not null default 0,
  ability_points int not null default 0,
  highest_processed_level int not null default 1,
  unlocked_at timestamptz not null default now(),
  unique (user_id, rollcaster_id)
);

alter table public.profiles
  drop constraint if exists profiles_active_rollcaster_id_fkey;
alter table public.profiles
  add constraint profiles_active_rollcaster_id_fkey
  foreign key (active_rollcaster_id) references public.user_rollcasters(id);

create table if not exists public.user_rollcaster_abilities (
  user_id uuid not null references auth.users(id) on delete cascade,
  user_rollcaster_id uuid not null references public.user_rollcasters(id) on delete cascade,
  ability_id text not null references public.rollcaster_abilities(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_rollcaster_id, ability_id)
);

create table if not exists public.user_rollcaster_ability_slots (
  user_rollcaster_id uuid not null references public.user_rollcasters(id) on delete cascade,
  slot_index int not null,
  ability_id text references public.rollcaster_abilities(id),
  primary key (user_rollcaster_id, slot_index)
);

create table if not exists public.user_critters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  critter_id text not null references public.critters(id),
  level int not null default 1,
  xp int not null default 0,
  skill_points int not null default 0,
  highest_processed_level int not null default 1,
  unlocked_at timestamptz not null default now(),
  unique (user_id, critter_id)
);

create table if not exists public.user_seen_critters (
  user_id uuid not null references auth.users(id) on delete cascade,
  critter_id text not null references public.critters(id),
  first_seen_at timestamptz not null default now(),
  primary key (user_id, critter_id)
);

create table if not exists public.user_critter_skills (
  user_critter_id uuid not null references public.user_critters(id) on delete cascade,
  skill_id text not null references public.skills(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_critter_id, skill_id)
);

create table if not exists public.user_critter_skill_slots (
  user_critter_id uuid not null references public.user_critters(id) on delete cascade,
  slot_index int not null check (slot_index between 1 and 4),
  skill_id text references public.skills(id),
  primary key (user_critter_id, slot_index)
);

create table if not exists public.user_relic_inventory (
  user_id uuid not null references auth.users(id) on delete cascade,
  relic_id text not null references public.relics(id),
  quantity int not null default 0,
  discovered_at timestamptz,
  primary key (user_id, relic_id)
);

create table if not exists public.user_critter_relic_slots (
  user_critter_id uuid not null references public.user_critters(id) on delete cascade,
  slot_index int not null,
  relic_id text references public.relics(id),
  primary key (user_critter_id, slot_index)
);

create table if not exists public.user_squad_slots (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_index int not null check (slot_index between 1 and 3),
  user_critter_id uuid references public.user_critters(id) on delete set null,
  primary key (user_id, slot_index)
);

create table if not exists public.user_dungeon_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  dungeon_id text not null references public.dungeons(id),
  is_unlocked boolean not null default false,
  completed_at timestamptz,
  clear_count int not null default 0,
  primary key (user_id, dungeon_id)
);

create table if not exists public.dungeon_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dungeon_id text not null references public.dungeons(id),
  status text not null check (status in ('started', 'won', 'lost', 'abandoned')),
  selected_opponents jsonb not null,
  battle_format text not null,
  player_active_count int not null,
  opponent_active_count int not null,
  turn_number int not null default 1,
  player_mana int not null default 0,
  opponent_mana int not null default 0,
  combat_state jsonb not null default '{}'::jsonb,
  battle_log jsonb not null default '[]'::jsonb,
  rewards jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.combat_turn_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dungeon_runs(id) on delete cascade,
  turn_number int not null,
  side text not null check (side in ('player', 'opponent')),
  actor_slot int not null,
  action_type text not null check (action_type in ('swap', 'block', 'skill', 'skip')),
  skill_id text references public.skills(id),
  target_side text check (target_side in ('player', 'opponent')),
  target_slot int,
  swap_in_user_critter_id uuid references public.user_critters(id),
  mana_cost int not null default 0,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.elements enable row level security;
alter table public.statuses enable row level security;
alter table public.skills enable row level security;
alter table public.critters enable row level security;
alter table public.critter_level_progression enable row level security;
alter table public.critter_skill_unlocks enable row level security;
alter table public.rollcasters enable row level security;
alter table public.rollcaster_level_progression enable row level security;
alter table public.rollcaster_abilities enable row level security;
alter table public.rollcaster_ability_unlocks enable row level security;
alter table public.relics enable row level security;
alter table public.dungeons enable row level security;
alter table public.dungeon_opponents enable row level security;
alter table public.starter_options enable row level security;
alter table public.profiles enable row level security;
alter table public.user_rollcasters enable row level security;
alter table public.user_rollcaster_abilities enable row level security;
alter table public.user_rollcaster_ability_slots enable row level security;
alter table public.user_critters enable row level security;
alter table public.user_seen_critters enable row level security;
alter table public.user_critter_skills enable row level security;
alter table public.user_critter_skill_slots enable row level security;
alter table public.user_relic_inventory enable row level security;
alter table public.user_critter_relic_slots enable row level security;
alter table public.user_squad_slots enable row level security;
alter table public.user_dungeon_progress enable row level security;
alter table public.dungeon_runs enable row level security;
alter table public.combat_turn_actions enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'elements','statuses','skills','critters','critter_level_progression','critter_skill_unlocks',
    'rollcasters','rollcaster_level_progression','rollcaster_abilities','rollcaster_ability_unlocks',
    'relics','dungeons','dungeon_opponents','starter_options'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_read_all', table_name);
    execute format('create policy %I on public.%I for select using (true)', table_name || '_read_all', table_name);
  end loop;
end $$;

create or replace function public.owns_user_critter(p_user_critter_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_critters
    where id = p_user_critter_id and user_id = auth.uid()
  );
$$;

create or replace function public.owns_user_rollcaster(p_user_rollcaster_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_rollcasters
    where id = p_user_rollcaster_id and user_id = auth.uid()
  );
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles','user_rollcasters','user_critters','user_seen_critters','user_relic_inventory',
    'user_squad_slots','user_dungeon_progress','dungeon_runs'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_own_select', table_name);
    execute format('create policy %I on public.%I for select using (user_id = auth.uid())', table_name || '_own_select', table_name);
  end loop;
end $$;

drop policy if exists user_critter_skills_own_select on public.user_critter_skills;
create policy user_critter_skills_own_select on public.user_critter_skills
  for select using (public.owns_user_critter(user_critter_id));

drop policy if exists user_critter_skill_slots_own_select on public.user_critter_skill_slots;
create policy user_critter_skill_slots_own_select on public.user_critter_skill_slots
  for select using (public.owns_user_critter(user_critter_id));

drop policy if exists user_critter_relic_slots_own_select on public.user_critter_relic_slots;
create policy user_critter_relic_slots_own_select on public.user_critter_relic_slots
  for select using (public.owns_user_critter(user_critter_id));

drop policy if exists user_rollcaster_abilities_own_select on public.user_rollcaster_abilities;
create policy user_rollcaster_abilities_own_select on public.user_rollcaster_abilities
  for select using (public.owns_user_rollcaster(user_rollcaster_id));

drop policy if exists user_rollcaster_ability_slots_own_select on public.user_rollcaster_ability_slots;
create policy user_rollcaster_ability_slots_own_select on public.user_rollcaster_ability_slots
  for select using (public.owns_user_rollcaster(user_rollcaster_id));

drop policy if exists combat_turn_actions_own_select on public.combat_turn_actions;
create policy combat_turn_actions_own_select on public.combat_turn_actions
  for select using (exists (
    select 1 from public.dungeon_runs
    where dungeon_runs.id = combat_turn_actions.run_id
      and dungeon_runs.user_id = auth.uid()
  ));

create or replace function public.calc_critter_level(p_critter_id text, p_xp int)
returns int language sql stable set search_path = public as $$
  select coalesce(max(level), 1)
  from public.critter_level_progression
  where critter_id = p_critter_id and total_required_xp <= p_xp;
$$;

create or replace function public.calc_rollcaster_level(p_rollcaster_id text, p_xp int)
returns int language sql stable set search_path = public as $$
  select coalesce(max(level), 1)
  from public.rollcaster_level_progression
  where rollcaster_id = p_rollcaster_id and total_required_xp <= p_xp;
$$;

create or replace function public.ensure_user_game_state()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', 'player');
  v_username text := coalesce(auth.jwt() -> 'user_metadata' ->> 'username', split_part(v_email, '@', 1), 'player');
  v_rollcaster_id uuid;
  v_ability_id text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles (user_id, username)
  values (v_user_id, v_username)
  on conflict (user_id) do nothing;

  insert into public.user_rollcasters (user_id, rollcaster_id)
  values (v_user_id, '001')
  on conflict (user_id, rollcaster_id) do nothing;

  select id into v_rollcaster_id
  from public.user_rollcasters
  where user_id = v_user_id and rollcaster_id = '001';

  update public.profiles
  set active_rollcaster_id = coalesce(active_rollcaster_id, v_rollcaster_id),
      updated_at = now()
  where user_id = v_user_id;

  for v_ability_id in
    select ability_id from public.rollcaster_ability_unlocks
    where rollcaster_id = '001' and unlock_level = 1 and unlock_cost = 0
  loop
    insert into public.user_rollcaster_abilities (user_id, user_rollcaster_id, ability_id)
    values (v_user_id, v_rollcaster_id, v_ability_id)
    on conflict do nothing;

    insert into public.user_rollcaster_ability_slots (user_rollcaster_id, slot_index, ability_id)
    values (v_rollcaster_id, 1, v_ability_id)
    on conflict (user_rollcaster_id, slot_index) do nothing;
  end loop;

  insert into public.user_squad_slots (user_id, slot_index)
  values (v_user_id, 1), (v_user_id, 2), (v_user_id, 3)
  on conflict do nothing;

  insert into public.user_dungeon_progress (user_id, dungeon_id, is_unlocked)
  values (v_user_id, '001', true)
  on conflict (user_id, dungeon_id) do update set is_unlocked = true;
end;
$$;

create or replace function public.select_starter_critter(p_critter_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_user_critter_id uuid;
  v_skill_id text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_user_game_state();

  if not exists (select 1 from public.starter_options where critter_id = p_critter_id and is_active) then
    raise exception 'Invalid starter critter';
  end if;

  if exists (select 1 from public.profiles where user_id = v_user_id and starter_selected_at is not null) then
    return;
  end if;

  insert into public.user_critters (user_id, critter_id)
  values (v_user_id, p_critter_id)
  on conflict (user_id, critter_id) do update set critter_id = excluded.critter_id
  returning id into v_user_critter_id;

  insert into public.user_seen_critters (user_id, critter_id)
  values (v_user_id, p_critter_id)
  on conflict do nothing;

  for v_skill_id in
    select skill_id from public.critter_skill_unlocks
    where critter_id = p_critter_id and unlock_level = 1 and unlock_cost = 0
    order by sort_order
  loop
    insert into public.user_critter_skills (user_critter_id, skill_id)
    values (v_user_critter_id, v_skill_id)
    on conflict do nothing;
  end loop;

  select skill_id into v_skill_id
  from public.critter_skill_unlocks
  where critter_id = p_critter_id and unlock_level = 1 and unlock_cost = 0
  order by sort_order
  limit 1;

  insert into public.user_critter_skill_slots (user_critter_id, slot_index, skill_id)
  values
    (v_user_critter_id, 1, v_skill_id),
    (v_user_critter_id, 2, null),
    (v_user_critter_id, 3, null),
    (v_user_critter_id, 4, null)
  on conflict (user_critter_id, slot_index) do update set skill_id = excluded.skill_id;

  update public.user_squad_slots
  set user_critter_id = v_user_critter_id
  where user_id = v_user_id and slot_index = 1;

  update public.profiles
  set starter_selected_at = now(), updated_at = now()
  where user_id = v_user_id;
end;
$$;

create or replace function public.start_dungeon_run(p_dungeon_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_dungeon public.dungeons%rowtype;
  v_target_count int;
  v_selected jsonb;
  v_run_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_dungeon from public.dungeons where id = p_dungeon_id;
  if not found then raise exception 'Dungeon not found'; end if;

  if not exists (
    select 1 from public.user_dungeon_progress
    where user_id = v_user_id and dungeon_id = p_dungeon_id and is_unlocked
  ) then
    raise exception 'Dungeon locked';
  end if;

  v_target_count := greatest(1, v_dungeon.encounter_count * v_dungeon.opponent_active_count);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_selected
  from (
    select *
    from public.dungeon_opponents
    where dungeon_id = p_dungeon_id
      and (
        pool_type = 'regular_pool'
        or (
          pool_type = 'boss_order'
          and not exists (
            select 1 from public.user_dungeon_progress
            where user_id = v_user_id and dungeon_id = p_dungeon_id and clear_count > 0
          )
        )
      )
    order by case when pool_type = 'boss_order' then 0 else 1 end,
             sequence_index nulls last,
             probability desc nulls last
    limit v_target_count
  ) x;

  insert into public.dungeon_runs (
    user_id, dungeon_id, status, selected_opponents, battle_format,
    player_active_count, opponent_active_count, combat_state
  )
  values (
    v_user_id, p_dungeon_id, 'started', v_selected, v_dungeon.battle_format,
    v_dungeon.player_active_count, v_dungeon.opponent_active_count, '{}'::jsonb
  )
  returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.resolve_dungeon_run(p_run_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_run public.dungeon_runs%rowtype;
  v_rollcaster_xp int := 0;
  v_critter_xp int := 0;
  v_currency int := 0;
  v_next_dungeon text;
  v_drop jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_run
  from public.dungeon_runs
  where id = p_run_id and user_id = v_user_id
  for update;

  if not found then raise exception 'Run not found'; end if;
  if v_run.status <> 'started' then return; end if;

  select
    coalesce(sum((opponent ->> 'rollcaster_xp_reward')::int), 0),
    coalesce(sum((opponent ->> 'critter_xp_reward')::int), 0),
    coalesce(sum((opponent ->> 'currency_reward')::int), 0)
  into v_rollcaster_xp, v_critter_xp, v_currency
  from jsonb_array_elements(v_run.selected_opponents) opponent;

  update public.profiles
  set coins = coins + v_currency,
      updated_at = now()
  where user_id = v_user_id;

  update public.user_rollcasters ur
  set xp = ur.xp + v_rollcaster_xp,
      level = public.calc_rollcaster_level(ur.rollcaster_id, ur.xp + v_rollcaster_xp)
  from public.profiles p
  where p.user_id = v_user_id and p.active_rollcaster_id = ur.id;

  update public.user_critters uc
  set xp = uc.xp + v_critter_xp,
      level = public.calc_critter_level(uc.critter_id, uc.xp + v_critter_xp)
  where uc.id in (
    select user_critter_id from public.user_squad_slots
    where user_id = v_user_id and user_critter_id is not null
  );

  insert into public.user_seen_critters (user_id, critter_id)
  select distinct v_user_id, opponent ->> 'critter_id'
  from jsonb_array_elements(v_run.selected_opponents) opponent
  on conflict do nothing;

  for v_drop in
    select jsonb_array_elements(opponent -> 'drops')
    from jsonb_array_elements(v_run.selected_opponents) opponent
    where jsonb_typeof(opponent -> 'drops') = 'array'
  loop
    if v_drop ->> 'kind' = 'relic' and random() <= coalesce((v_drop ->> 'chance')::numeric, 0) then
      insert into public.user_relic_inventory (user_id, relic_id, quantity, discovered_at)
      values (v_user_id, v_drop ->> 'relic_id', coalesce((v_drop ->> 'quantity')::int, 1), now())
      on conflict (user_id, relic_id) do update
      set quantity = least(
            (select max_owned from public.relics where relics.id = excluded.relic_id),
            public.user_relic_inventory.quantity + excluded.quantity
          ),
          discovered_at = coalesce(public.user_relic_inventory.discovered_at, now());
    end if;
  end loop;

  select next_dungeon_id into v_next_dungeon
  from public.dungeons
  where id = v_run.dungeon_id;

  update public.user_dungeon_progress
  set completed_at = coalesce(completed_at, now()),
      clear_count = clear_count + 1
  where user_id = v_user_id and dungeon_id = v_run.dungeon_id;

  if v_next_dungeon is not null then
    insert into public.user_dungeon_progress (user_id, dungeon_id, is_unlocked)
    values (v_user_id, v_next_dungeon, true)
    on conflict (user_id, dungeon_id) do update set is_unlocked = true;
  end if;

  update public.dungeon_runs
  set status = 'won',
      rewards = jsonb_build_object(
        'rollcaster_xp', v_rollcaster_xp,
        'critter_xp', v_critter_xp,
        'coins', v_currency
      ),
      resolved_at = now()
  where id = p_run_id;
end;
$$;
