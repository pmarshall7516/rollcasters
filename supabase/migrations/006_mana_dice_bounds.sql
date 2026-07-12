-- Upgrade existing catalogs from a single 1..N Mana Die stat to explicit,
-- independently-progressing inclusive minimum and maximum bounds.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'critters' and column_name = 'base_dice'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'critters' and column_name = 'base_dice_max'
  ) then
    alter table public.critters rename column base_dice to base_dice_max;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'critter_level_progression' and column_name = 'dice_delta'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'critter_level_progression' and column_name = 'dice_max_delta'
  ) then
    alter table public.critter_level_progression rename column dice_delta to dice_max_delta;
  end if;
end $$;

alter table public.critters
  add column if not exists base_dice_min int not null default 1,
  add column if not exists base_dice_max int;

update public.critters set base_dice_max = base_dice_min where base_dice_max is null;
alter table public.critters alter column base_dice_max set not null;

alter table public.critter_level_progression
  add column if not exists dice_min_delta int not null default 0,
  add column if not exists dice_max_delta int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'critters_base_dice_min_check') then
    alter table public.critters
      add constraint critters_base_dice_min_check check (base_dice_min >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'critters_base_dice_bounds_check') then
    alter table public.critters
      add constraint critters_base_dice_bounds_check check (base_dice_max >= base_dice_min);
  end if;
end $$;
