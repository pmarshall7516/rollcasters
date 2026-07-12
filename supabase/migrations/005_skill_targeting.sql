alter table public.skills
  add column if not exists targeting text not null default 'single_enemy';

alter table public.skills
  drop constraint if exists skills_targeting_check;

alter table public.skills
  add constraint skills_targeting_check check (
    targeting in ('single_enemy', 'all_enemies', 'all_others', 'single_any', 'all_friendlies')
  );

comment on column public.skills.targeting is
  'Targeting mode: one enemy, all enemies, all other fielded critters, one friendly/enemy, or all friendlies.';

update public.skills set targeting = 'single_enemy' where targeting is null;
