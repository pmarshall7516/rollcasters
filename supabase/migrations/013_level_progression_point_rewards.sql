-- Award authored Skill/Ability points exactly once when owned characters cross
-- level milestones. The highest_processed_level columns are the durable cursor
-- that makes multi-level jumps and retried reward resolution idempotent.

create or replace function public.award_user_critter_level_progression()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_processed_level int;
  v_skill_points int;
begin
  v_processed_level := case
    when tg_op = 'UPDATE' then greatest(coalesce(old.highest_processed_level, 1), coalesce(new.highest_processed_level, 1), 1)
    else greatest(coalesce(new.highest_processed_level, 1), 1)
  end;

  if new.level <= v_processed_level then
    new.highest_processed_level := v_processed_level;
    return new;
  end if;

  select coalesce(sum(progression.grant_skill_points), 0)::int
  into v_skill_points
  from public.critter_level_progression progression
  where progression.critter_id = new.critter_id
    and progression.level > v_processed_level
    and progression.level <= new.level;

  new.skill_points := coalesce(new.skill_points, 0) + v_skill_points;
  new.highest_processed_level := new.level;
  return new;
end;
$$;

drop trigger if exists award_user_critter_level_progression on public.user_critters;
create trigger award_user_critter_level_progression
before insert or update of level on public.user_critters
for each row execute function public.award_user_critter_level_progression();

create or replace function public.award_user_rollcaster_level_progression()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_processed_level int;
  v_ability_points int;
begin
  v_processed_level := case
    when tg_op = 'UPDATE' then greatest(coalesce(old.highest_processed_level, 1), coalesce(new.highest_processed_level, 1), 1)
    else greatest(coalesce(new.highest_processed_level, 1), 1)
  end;

  if new.level <= v_processed_level then
    new.highest_processed_level := v_processed_level;
    return new;
  end if;

  select coalesce(sum(progression.grant_ability_points), 0)::int
  into v_ability_points
  from public.rollcaster_level_progression progression
  where progression.rollcaster_id = new.rollcaster_id
    and progression.level > v_processed_level
    and progression.level <= new.level;

  new.ability_points := coalesce(new.ability_points, 0) + v_ability_points;
  new.highest_processed_level := new.level;
  return new;
end;
$$;

drop trigger if exists award_user_rollcaster_level_progression on public.user_rollcasters;
create trigger award_user_rollcaster_level_progression
before insert or update of level on public.user_rollcasters
for each row execute function public.award_user_rollcaster_level_progression();

-- Repair characters that reached levels before progression rewards were wired
-- into the runtime. Add only milestones above their durable processed cursor so
-- existing point spending is preserved and rerunning this migration is safe.
update public.user_critters owned
set skill_points = owned.skill_points + coalesce((
      select sum(progression.grant_skill_points)::int
      from public.critter_level_progression progression
      where progression.critter_id = owned.critter_id
        and progression.level > greatest(coalesce(owned.highest_processed_level, 1), 1)
        and progression.level <= owned.level
    ), 0),
    highest_processed_level = owned.level
where owned.level > greatest(coalesce(owned.highest_processed_level, 1), 1);

update public.user_rollcasters owned
set ability_points = owned.ability_points + coalesce((
      select sum(progression.grant_ability_points)::int
      from public.rollcaster_level_progression progression
      where progression.rollcaster_id = owned.rollcaster_id
        and progression.level > greatest(coalesce(owned.highest_processed_level, 1), 1)
        and progression.level <= owned.level
    ), 0),
    highest_processed_level = owned.level
where owned.level > greatest(coalesce(owned.highest_processed_level, 1), 1);
