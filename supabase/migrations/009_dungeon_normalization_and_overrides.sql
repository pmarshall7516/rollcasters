-- Normalized dungeon loadouts, weighted pools, rewards, and independent final-value overrides.

alter table public.dungeon_opponents add column if not exists selection_weight numeric;
update public.dungeon_opponents set selection_weight = coalesce(selection_weight, probability, 1) where pool_type = 'regular_pool';

create table if not exists public.dungeon_opponent_skills (
  opponent_id uuid not null references public.dungeon_opponents(id) on delete cascade,
  skill_id text not null references public.skills(id) on update cascade on delete restrict,
  slot_index integer not null check (slot_index between 0 and 3),
  primary key (opponent_id, slot_index),
  unique (opponent_id, skill_id)
);
create table if not exists public.dungeon_opponent_relics (
  opponent_id uuid not null references public.dungeon_opponents(id) on delete cascade,
  relic_id text not null references public.relics(id) on update cascade on delete restrict,
  slot_index integer not null check (slot_index >= 0),
  primary key (opponent_id, slot_index)
);
create table if not exists public.dungeon_opponent_stat_overrides (
  opponent_id uuid not null references public.dungeon_opponents(id) on delete cascade,
  stat_key text not null check (stat_key in ('hp','atk','def','spd','dice_min','dice_max','block_cost','swap_cost')),
  value integer not null,
  primary key (opponent_id, stat_key),
  check ((stat_key in ('hp','atk','def','spd','dice_min','dice_max') and value > 0) or (stat_key in ('block_cost','swap_cost') and value >= 0))
);
create table if not exists public.dungeon_opponent_rewards (
  id uuid primary key default gen_random_uuid(),
  opponent_id uuid not null references public.dungeon_opponents(id) on delete cascade,
  reward_type text not null check (reward_type in ('relic','critter_unlock','rollcaster_unlock','coins')),
  reward_ref_id text,
  chance numeric not null check (chance between 0 and 1),
  quantity integer not null default 1 check (quantity > 0),
  sort_order integer not null default 0,
  check ((reward_type = 'coins' and reward_ref_id is null) or (reward_type <> 'coins' and reward_ref_id is not null))
);

insert into public.dungeon_opponent_skills (opponent_id,skill_id,slot_index)
select o.id, skill_id, ordinality - 1
from public.dungeon_opponents o
cross join lateral unnest(o.skill_ids) with ordinality as s(skill_id, ordinality)
where ordinality <= 4
on conflict do nothing;

insert into public.dungeon_opponent_relics (opponent_id,relic_id,slot_index)
select o.id, relic_id, ordinality - 1
from public.dungeon_opponents o
cross join lateral unnest(o.relic_ids) with ordinality as r(relic_id, ordinality)
on conflict do nothing;

insert into public.dungeon_opponent_rewards (opponent_id,reward_type,reward_ref_id,chance,quantity,sort_order)
select o.id,
  case when d->>'kind' = 'relic' then 'relic' else d->>'kind' end,
  coalesce(d->>'relic_id', d->>'ref_id'),
  coalesce((d->>'chance')::numeric,1), coalesce((d->>'quantity')::integer,1), ordinality - 1
from public.dungeon_opponents o
cross join lateral jsonb_array_elements(case when jsonb_typeof(o.drops)='array' then o.drops else '[]'::jsonb end) with ordinality as drops(d,ordinality)
where d->>'kind' in ('relic','critter_unlock','rollcaster_unlock','coins')
  and not exists (select 1 from public.dungeon_opponent_rewards existing where existing.opponent_id=o.id and existing.sort_order=ordinality-1);

do $$ declare v_table text; begin
  foreach v_table in array array['dungeon_opponent_skills','dungeon_opponent_relics','dungeon_opponent_stat_overrides','dungeon_opponent_rewards'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('drop policy if exists %I on public.%I',v_table||'_read_all',v_table);
    execute format('create policy %I on public.%I for select using (true)',v_table||'_read_all',v_table);
  end loop;
end $$;

alter table public.dungeon_opponents drop constraint if exists dungeon_opponents_selection_weight_check;
alter table public.dungeon_opponents add constraint dungeon_opponents_selection_weight_check
  check ((pool_type='boss_order' and selection_weight is null) or (pool_type='regular_pool' and selection_weight >= 0));

create index if not exists dungeon_opponent_skills_opponent_idx on public.dungeon_opponent_skills(opponent_id,slot_index);
create index if not exists dungeon_opponent_rewards_opponent_idx on public.dungeon_opponent_rewards(opponent_id,sort_order);
