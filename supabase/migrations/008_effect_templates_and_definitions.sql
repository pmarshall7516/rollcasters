-- Typed, reusable effect templates and configured effect definitions.

create table if not exists public.effect_templates (
  id text primary key,
  name text not null,
  description text not null,
  runtime_kind text not null,
  runtime_version integer not null check (runtime_version > 0),
  allowed_owners text[] not null,
  parameter_schema jsonb not null default '{}'::jsonb,
  ui_schema jsonb not null default '{}'::jsonb,
  description_template text,
  is_runtime_supported boolean not null default false,
  is_active boolean not null default false,
  is_archived boolean not null default false,
  version integer not null default 1 check (version > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  check (allowed_owners <@ array['skill','relic','ability','status']::text[])
);

create table if not exists public.effect_definitions (
  id text primary key,
  name text not null,
  description text not null,
  template_id text not null references public.effect_templates(id) on update cascade,
  parameters jsonb not null default '{}'::jsonb check (jsonb_typeof(parameters) = 'object'),
  is_active boolean not null default false,
  is_archived boolean not null default false,
  version integer not null default 1 check (version > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists public.skill_effect_attachments (
  skill_id text not null references public.skills(id) on update cascade on delete cascade,
  effect_id text not null references public.effect_definitions(id) on update cascade on delete restrict,
  role text not null default 'secondary' check (role in ('primary','secondary')),
  sort_order integer not null default 0,
  primary key (skill_id, effect_id)
);
create table if not exists public.relic_effect_attachments (
  relic_id text not null references public.relics(id) on update cascade on delete cascade,
  effect_id text not null references public.effect_definitions(id) on update cascade on delete restrict,
  sort_order integer not null default 0,
  primary key (relic_id, effect_id)
);
create table if not exists public.ability_effect_attachments (
  ability_id text not null references public.rollcaster_abilities(id) on update cascade on delete cascade,
  effect_id text not null references public.effect_definitions(id) on update cascade on delete restrict,
  sort_order integer not null default 0,
  primary key (ability_id, effect_id)
);
create table if not exists public.status_effect_attachments (
  status_id text not null references public.statuses(id) on update cascade on delete cascade,
  effect_id text not null references public.effect_definitions(id) on update cascade on delete restrict,
  sort_order integer not null default 0,
  primary key (status_id, effect_id)
);

do $$
declare v_table text;
begin
  foreach v_table in array array['effect_templates','effect_definitions','skill_effect_attachments','relic_effect_attachments','ability_effect_attachments','status_effect_attachments'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_read_all', v_table);
    execute format('create policy %I on public.%I for select using (true)', v_table || '_read_all', v_table);
  end loop;
end $$;

insert into public.effect_templates
  (id, name, description, runtime_kind, runtime_version, allowed_owners, parameter_schema, ui_schema, description_template, is_runtime_supported, is_active, sort_order)
values
  ('stat-modifier','Stat Modifier','Adjusts HP, ATK, DEF, or SPEED.','stat_modifier',1,array['skill','relic','ability','status'],
   '{"required":["stat","mode","amount","target"],"properties":{"stat":{"enum":["hp","atk","def","spd"]},"mode":{"enum":["flat","percentage"]},"amount":{"type":"number"},"target":{"type":"string"}}}',
   '{"order":["stat","mode","amount","target"]}','Grants {{target}} {{amount}} {{stat}}.',true,true,10),
  ('mana-dice-modifier','Mana Dice Modifier','Adjusts inclusive Mana Dice bounds.','mana_dice_modifier',1,array['relic','ability'],
   '{"required":["target"],"properties":{"minimum_delta":{"type":"integer"},"maximum_delta":{"type":"integer"},"target":{"type":"string"}}}',
   '{"order":["minimum_delta","maximum_delta","target"]}',null,true,true,20),
  ('apply-status','Apply Status','Applies an existing status with an optional chance.','apply_status',1,array['skill','ability'],
   '{"required":["status_id","target","chance"],"properties":{"status_id":{"type":"string"},"target":{"type":"string"},"chance":{"type":"number","minimum":0,"maximum":1}}}',
   '{"order":["status_id","target","chance"],"controls":{"chance":"percent"}}',null,true,true,30),
  ('restore-hp','Restore HP','Restores a flat or percentage amount of HP.','restore_hp',1,array['skill','ability'],
   '{"required":["mode","amount","target"],"properties":{"mode":{"enum":["flat","percent_max_hp"]},"amount":{"type":"number","minimum":0},"target":{"type":"string"}}}',
   '{"order":["mode","amount","target"]}',null,true,true,40),
  ('damage-over-time','Damage Over Time','Deals configured damage over a duration.','damage_over_time',1,array['skill','status'],
   '{"required":["timing","mode","amount","target"],"properties":{"timing":{"type":"string"},"mode":{"type":"string"},"amount":{"type":"number","minimum":0},"target":{"type":"string"}}}',
   '{"order":["timing","mode","amount","duration","target"]}',null,true,true,50),
  ('skip-action-chance','Skip Action Chance','May prevent a target from acting.','skip_action_chance',1,array['skill','status'],
   '{"required":["chance","target"],"properties":{"chance":{"type":"number","minimum":0,"maximum":1},"target":{"type":"string"}}}',
   '{"order":["chance","duration","target"],"controls":{"chance":"percent"}}',null,true,true,60)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, runtime_kind = excluded.runtime_kind,
  runtime_version = excluded.runtime_version, allowed_owners = excluded.allowed_owners,
  parameter_schema = excluded.parameter_schema, ui_schema = excluded.ui_schema,
  description_template = excluded.description_template, is_runtime_supported = excluded.is_runtime_supported,
  is_active = excluded.is_active, sort_order = excluded.sort_order, updated_at = now();

-- Lossless compatibility backfill for the existing seed behaviors.
insert into public.effect_definitions (id,name,description,template_id,parameters,is_active,sort_order)
values
  ('sharpen-team','Sharpen Team','Grants all friendly critters +3 ATK.','stat-modifier','{"stat":"atk","mode":"flat","amount":3,"target":"all_friendly_critters"}',true,10),
  ('copper-shield-defense','Copper Shield Defense','Grants the equipped critter +5 DEF.','stat-modifier','{"stat":"def","mode":"flat","amount":5,"target":"equipped_critter"}',true,20),
  ('toxic-dot','Toxic','Deals 8% max HP damage at the end of each turn.','damage-over-time','{"timing":"end_of_turn","mode":"percent_max_hp","amount":0.08,"target":"status_holder"}',true,30),
  ('paralysis-skip','Paralysis','Has a 30% chance to prevent acting each turn.','skip-action-chance','{"chance":0.30,"target":"status_holder"}',true,40)
on conflict (id) do nothing;

insert into public.ability_effect_attachments (ability_id,effect_id,sort_order)
select 'sharpen','sharpen-team',0 where exists (select 1 from public.rollcaster_abilities where id='sharpen')
on conflict do nothing;
insert into public.relic_effect_attachments (relic_id,effect_id,sort_order)
select '001','copper-shield-defense',0 where exists (select 1 from public.relics where id='001')
on conflict do nothing;
insert into public.status_effect_attachments (status_id,effect_id,sort_order)
select 'toxic','toxic-dot',0 where exists (select 1 from public.statuses where id='toxic')
on conflict do nothing;
insert into public.status_effect_attachments (status_id,effect_id,sort_order)
select 'paralysis','paralysis-skip',0 where exists (select 1 from public.statuses where id='paralysis')
on conflict do nothing;

create index if not exists effect_definitions_template_idx on public.effect_definitions(template_id) where not is_archived;
