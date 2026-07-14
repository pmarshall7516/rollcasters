-- Replace reusable Effect definitions + attachment joins with inline effects
-- owned by one Skill, Ability, Relic, or Status. This migration intentionally
-- removes every existing effect instance so content can be rebuilt manually.

drop trigger if exists require_ability_effect_on_owner on public.rollcaster_abilities;
drop trigger if exists require_relic_effect_on_owner on public.relics;
drop table if exists public.skill_effect_attachments cascade;
drop table if exists public.ability_effect_attachments cascade;
drop table if exists public.relic_effect_attachments cascade;
drop table if exists public.status_effect_attachments cascade;
drop table if exists public.effect_definitions cascade;

drop function if exists public.admin_save_effect_definition(jsonb,integer);
drop function if exists public.validate_effect_definition_scope();
drop function if exists public.validate_effect_attachment_owner();
drop function if exists public.enforce_required_owner_effect();

alter table public.skills drop column if exists effect;
alter table public.rollcaster_abilities drop column if exists effect;
alter table public.relics drop column if exists effect;
alter table public.statuses drop column if exists effect;
alter table public.statuses add column if not exists asset_path text;

-- Effect Templates remain fixed runtime contracts, but are no longer exposed
-- as a standalone content catalog. v1 contains exactly the requested nine.
delete from public.effect_templates
where id not in (
  'skill-stat-modifier','skill-apply-status','skill-restore-hp',
  'ability-stat-modifier','ability-mana-dice-modifier',
  'relic-stat-modifier','relic-mana-dice-modifier',
  'status-damage-over-time','status-skip-action-chance'
);

insert into public.effect_templates(
  id,name,description,runtime_kind,runtime_version,allowed_owners,
  parameter_schema,ui_schema,description_template,is_runtime_supported,
  is_active,is_archived,version,sort_order,effect_category
) values
('skill-stat-modifier','Stat Modifier','Adjusts HP, ATK, DEF, or SPEED when the Skill resolves.','stat_modifier',1,array['skill'],
 '{"type":"object","required":["stat","value_mode","amount","chance","target"],"properties":{"stat":{"enum":["hp","atk","def","spd"]},"value_mode":{"enum":["flat","percentage"]},"amount":{"type":"number"},"chance":{"type":"number","minimum":0,"maximum":1},"target":{"enum":["self","all_allies","all_friendlies","all_enemies","target_enemies"]}}}'::jsonb,
 '{"order":["stat","value_mode","amount","chance","target"],"fractionFields":["amount","chance"]}'::jsonb,null,true,true,false,1,10,'skill'),
('skill-apply-status','Apply Status','Applies a created Status indefinitely or for a configured number of turns.','apply_status',1,array['skill'],
 '{"type":"object","required":["status_id","chance","target","indefinite"],"properties":{"status_id":{"type":"string"},"chance":{"type":"number","minimum":0,"maximum":1},"target":{"enum":["self","all_allies","all_friendlies","all_enemies","target_enemies"]},"indefinite":{"type":"boolean"},"turns":{"type":"integer","minimum":1}}}'::jsonb,
 '{"order":["status_id","chance","target","indefinite","turns"],"conditional":{"turns":{"when":{"indefinite":false}}}}'::jsonb,null,true,true,false,1,20,'skill'),
('skill-restore-hp','Restore HP','Restores flat HP, maximum-HP percentage, or a percentage of damage dealt.','restore_hp',1,array['skill'],
 '{"type":"object","required":["value_mode","amount","chance","target"],"properties":{"value_mode":{"enum":["flat","percent_max_hp","percent_damage_done"]},"amount":{"type":"number","minimum":0},"chance":{"type":"number","minimum":0,"maximum":1},"target":{"enum":["self","all_allies","all_friendlies","all_enemies","target_enemies"]}}}'::jsonb,
 '{"order":["value_mode","amount","chance","target"],"fractionFields":["amount","chance"]}'::jsonb,null,true,true,false,1,30,'skill'),
('ability-stat-modifier','Stat Modifier','Applies a persistent global stat modifier while the Ability is equipped.','stat_modifier',1,array['ability'],
 '{"type":"object","required":["stat","value_mode","amount","target"],"properties":{"stat":{"enum":["hp","atk","def","spd"]},"value_mode":{"enum":["flat","percentage"]},"amount":{"type":"number"},"target":{"enum":["all_friendlies","all_enemies","all_element_friendlies","all_element_enemies"]},"element_ids":{"type":"array","items":{"type":"string"}}}}'::jsonb,
 '{"order":["stat","value_mode","amount","target","element_ids"],"conditional":{"element_ids":{"when":{"target":["all_element_friendlies","all_element_enemies"]}}}}'::jsonb,null,true,true,false,1,10,'ability'),
('ability-mana-dice-modifier','Mana Dice Modifier','Changes Mana Dice minimum and maximum bounds while the Ability is equipped.','mana_dice_modifier',1,array['ability'],
 '{"type":"object","required":["minimum_delta","maximum_delta","target"],"properties":{"minimum_delta":{"type":"integer"},"maximum_delta":{"type":"integer"},"target":{"enum":["all_friendlies","all_enemies","all_element_friendlies","all_element_enemies"]},"element_ids":{"type":"array","items":{"type":"string"}}}}'::jsonb,
 '{"order":["minimum_delta","maximum_delta","target","element_ids"],"conditional":{"element_ids":{"when":{"target":["all_element_friendlies","all_element_enemies"]}}}}'::jsonb,null,true,true,false,1,20,'ability'),
('relic-stat-modifier','Stat Modifier','Applies a persistent stat modifier while the Relic bearer remains active.','stat_modifier',1,array['relic'],
 '{"type":"object","required":["stat","value_mode","amount","target"],"properties":{"stat":{"enum":["hp","atk","def","spd"]},"value_mode":{"enum":["flat","percentage"]},"amount":{"type":"number"},"target":{"enum":["equipped_critter","equipped_allies","equipped_friendlies","all_enemies"]}}}'::jsonb,
 '{"order":["stat","value_mode","amount","target"]}'::jsonb,null,true,true,false,1,10,'relic'),
('relic-mana-dice-modifier','Mana Dice Modifier','Changes Mana Dice bounds while the Relic bearer remains active.','mana_dice_modifier',1,array['relic'],
 '{"type":"object","required":["minimum_delta","maximum_delta","target"],"properties":{"minimum_delta":{"type":"integer"},"maximum_delta":{"type":"integer"},"target":{"enum":["equipped_critter","equipped_allies","equipped_friendlies","all_enemies"]}}}'::jsonb,
 '{"order":["minimum_delta","maximum_delta","target"]}'::jsonb,null,true,true,false,1,20,'relic'),
('status-damage-over-time','Damage Over Time','Deals flat or maximum-HP percentage damage at a configured turn timing.','damage_over_time',1,array['status'],
 '{"type":"object","required":["timing","value_mode","amount","chance","target"],"properties":{"timing":{"enum":["start_of_turn","end_of_turn"]},"value_mode":{"enum":["flat","percent_max_hp"]},"amount":{"type":"number","minimum":0},"chance":{"type":"number","minimum":0,"maximum":1},"target":{"enum":["status_holder","status_holder_allies","status_holder_friendlies","status_holder_enemies"]}}}'::jsonb,
 '{"order":["timing","value_mode","amount","chance","target"],"fractionFields":["amount","chance"]}'::jsonb,null,true,true,false,1,10,'status'),
('status-skip-action-chance','Skip Action Chance','May cancel Swap, Block, Skill, or any action without charging Mana.','skip_action_chance',1,array['status'],
 '{"type":"object","required":["chance","combat_action","target"],"properties":{"chance":{"type":"number","minimum":0,"maximum":1},"combat_action":{"enum":["swap","block","skill","all"]},"target":{"enum":["status_holder","status_holder_allies","status_holder_friendlies","status_holder_enemies"]}}}'::jsonb,
 '{"order":["chance","combat_action","target"],"fractionFields":["chance"]}'::jsonb,null,true,true,false,1,20,'status')
on conflict(id) do update set
  name=excluded.name,description=excluded.description,runtime_kind=excluded.runtime_kind,
  runtime_version=excluded.runtime_version,allowed_owners=excluded.allowed_owners,
  parameter_schema=excluded.parameter_schema,ui_schema=excluded.ui_schema,
  description_template=excluded.description_template,is_runtime_supported=true,
  is_active=true,is_archived=false,sort_order=excluded.sort_order,
  effect_category=excluded.effect_category;

create table if not exists public.skill_effects(
  skill_id text not null references public.skills(id) on update cascade on delete cascade,
  id text not null,
  name text not null check(btrim(name)<>''),
  description text not null check(btrim(description)<>''),
  template_id text not null,
  effect_category text generated always as ('skill'::text) stored,
  parameters jsonb not null default '{}'::jsonb check(jsonb_typeof(parameters)='object'),
  sort_order integer not null default 0 check(sort_order>=0),
  primary key(skill_id,id),
  foreign key(template_id,effect_category) references public.effect_templates(id,effect_category)
);
create table if not exists public.ability_effects(
  ability_id text not null references public.rollcaster_abilities(id) on update cascade on delete cascade,
  id text not null,
  name text not null check(btrim(name)<>''),
  description text not null check(btrim(description)<>''),
  template_id text not null,
  effect_category text generated always as ('ability'::text) stored,
  parameters jsonb not null default '{}'::jsonb check(jsonb_typeof(parameters)='object'),
  sort_order integer not null default 0 check(sort_order>=0),
  primary key(ability_id,id),
  foreign key(template_id,effect_category) references public.effect_templates(id,effect_category)
);
create table if not exists public.relic_effects(
  relic_id text not null references public.relics(id) on update cascade on delete cascade,
  id text not null,
  name text not null check(btrim(name)<>''),
  description text not null check(btrim(description)<>''),
  template_id text not null,
  effect_category text generated always as ('relic'::text) stored,
  parameters jsonb not null default '{}'::jsonb check(jsonb_typeof(parameters)='object'),
  sort_order integer not null default 0 check(sort_order>=0),
  primary key(relic_id,id),
  foreign key(template_id,effect_category) references public.effect_templates(id,effect_category)
);
create table if not exists public.status_effects(
  status_id text not null references public.statuses(id) on update cascade on delete cascade,
  id text not null,
  name text not null check(btrim(name)<>''),
  description text not null check(btrim(description)<>''),
  template_id text not null,
  effect_category text generated always as ('status'::text) stored,
  parameters jsonb not null default '{}'::jsonb check(jsonb_typeof(parameters)='object'),
  sort_order integer not null default 0 check(sort_order>=0),
  primary key(status_id,id),
  foreign key(template_id,effect_category) references public.effect_templates(id,effect_category)
);

create index if not exists skill_effects_runtime_idx on public.skill_effects(skill_id,sort_order,template_id);
create index if not exists ability_effects_runtime_idx on public.ability_effects(ability_id,sort_order,template_id);
create index if not exists relic_effects_runtime_idx on public.relic_effects(relic_id,sort_order,template_id);
create index if not exists status_effects_runtime_idx on public.status_effects(status_id,sort_order,template_id);

alter table public.skill_effects enable row level security;
alter table public.ability_effects enable row level security;
alter table public.relic_effects enable row level security;
alter table public.status_effects enable row level security;
drop policy if exists skill_effects_read_all on public.skill_effects;
drop policy if exists ability_effects_read_all on public.ability_effects;
drop policy if exists relic_effects_read_all on public.relic_effects;
drop policy if exists status_effects_read_all on public.status_effects;
create policy skill_effects_read_all on public.skill_effects for select using(true);
create policy ability_effects_read_all on public.ability_effects for select using(true);
create policy relic_effects_read_all on public.relic_effects for select using(true);
create policy status_effects_read_all on public.status_effects for select using(true);
grant select on public.skill_effects,public.ability_effects,public.relic_effects,public.status_effects to anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on public.skill_effects,public.ability_effects,public.relic_effects,public.status_effects from anon,authenticated;

create or replace function public.validate_inline_effect_parameters(p_template_id text,p_parameters jsonb,p_owner text)
returns void language plpgsql set search_path=public as $$
declare
  v_kind text;
  v_category text;
  v_target text := p_parameters->>'target';
  v_element_target boolean;
begin
  select runtime_kind,effect_category into v_kind,v_category
  from public.effect_templates
  where id=p_template_id and is_active and not is_archived and is_runtime_supported;
  if v_kind is null then raise exception 'VALIDATION: inactive, unsupported, or missing effect template %',p_template_id; end if;
  if v_category<>p_owner then raise exception 'VALIDATION: template % does not belong to % effects',p_template_id,p_owner; end if;
  if jsonb_typeof(p_parameters)<>'object' then raise exception 'VALIDATION: effect parameters must be an object'; end if;

  if p_owner='skill' and v_target not in ('self','all_allies','all_friendlies','all_enemies','target_enemies') then raise exception 'VALIDATION: invalid Skill effect target'; end if;
  if p_owner='ability' and v_target not in ('all_friendlies','all_enemies','all_element_friendlies','all_element_enemies') then raise exception 'VALIDATION: invalid Ability effect target'; end if;
  if p_owner='relic' and v_target not in ('equipped_critter','equipped_allies','equipped_friendlies','all_enemies') then raise exception 'VALIDATION: invalid Relic effect target'; end if;
  if p_owner='status' and v_target not in ('status_holder','status_holder_allies','status_holder_friendlies','status_holder_enemies') then raise exception 'VALIDATION: invalid Status effect target'; end if;

  if v_kind='stat_modifier' then
    if p_parameters->>'stat' not in ('hp','atk','def','spd') or p_parameters->>'value_mode' not in ('flat','percentage') or jsonb_typeof(p_parameters->'amount')<>'number' then raise exception 'VALIDATION: invalid Stat Modifier parameters'; end if;
    if p_owner='skill' and (jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1) then raise exception 'VALIDATION: Skill Stat Modifier chance must be between 0 and 1'; end if;
  elsif v_kind='mana_dice_modifier' then
    if jsonb_typeof(p_parameters->'minimum_delta')<>'number' or jsonb_typeof(p_parameters->'maximum_delta')<>'number'
      or (p_parameters->>'minimum_delta')::numeric<>trunc((p_parameters->>'minimum_delta')::numeric)
      or (p_parameters->>'maximum_delta')::numeric<>trunc((p_parameters->>'maximum_delta')::numeric)
      or ((p_parameters->>'minimum_delta')::numeric=0 and (p_parameters->>'maximum_delta')::numeric=0)
    then raise exception 'VALIDATION: Mana Dice deltas must be non-zero integer changes'; end if;
  elsif v_kind='apply_status' then
    if not exists(select 1 from public.statuses where id=p_parameters->>'status_id') then raise exception 'VALIDATION: Apply Status references an unknown Status'; end if;
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 then raise exception 'VALIDATION: Apply Status chance must be between 0 and 1'; end if;
    if jsonb_typeof(p_parameters->'indefinite')<>'boolean' then raise exception 'VALIDATION: Apply Status indefinite must be boolean'; end if;
    if not (p_parameters->>'indefinite')::boolean and (jsonb_typeof(p_parameters->'turns')<>'number' or (p_parameters->>'turns')::numeric<1 or (p_parameters->>'turns')::numeric<>trunc((p_parameters->>'turns')::numeric)) then raise exception 'VALIDATION: Apply Status turns must be a positive integer'; end if;
  elsif v_kind='restore_hp' then
    if p_parameters->>'value_mode' not in ('flat','percent_max_hp','percent_damage_done') or jsonb_typeof(p_parameters->'amount')<>'number' or (p_parameters->>'amount')::numeric<0 then raise exception 'VALIDATION: invalid Restore HP amount'; end if;
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 then raise exception 'VALIDATION: Restore HP chance must be between 0 and 1'; end if;
  elsif v_kind='damage_over_time' then
    if p_parameters->>'timing' not in ('start_of_turn','end_of_turn') or p_parameters->>'value_mode' not in ('flat','percent_max_hp') or jsonb_typeof(p_parameters->'amount')<>'number' or (p_parameters->>'amount')::numeric<0 then raise exception 'VALIDATION: invalid Damage Over Time parameters'; end if;
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 then raise exception 'VALIDATION: Damage Over Time chance must be between 0 and 1'; end if;
  elsif v_kind='skip_action_chance' then
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 or p_parameters->>'combat_action' not in ('swap','block','skill','all') then raise exception 'VALIDATION: invalid Skip Action Chance parameters'; end if;
  end if;

  v_element_target := p_owner='ability' and v_target in ('all_element_friendlies','all_element_enemies');
  if v_element_target then
    if jsonb_typeof(p_parameters->'element_ids')<>'array' or jsonb_array_length(p_parameters->'element_ids')=0 then raise exception 'VALIDATION: element target requires element_ids'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_parameters->'element_ids') id where not exists(select 1 from public.elements e where e.id=id.value)) then raise exception 'VALIDATION: element_ids contains an unknown Element'; end if;
  end if;
end; $$;

create or replace function public.validate_inline_effect_row()
returns trigger language plpgsql set search_path=public as $$
declare v_owner text;
begin
  v_owner:=case tg_table_name when 'skill_effects' then 'skill' when 'ability_effects' then 'ability' when 'relic_effects' then 'relic' when 'status_effects' then 'status' end;
  perform public.validate_inline_effect_parameters(new.template_id,new.parameters,v_owner);
  return new;
end; $$;
drop trigger if exists validate_skill_effect on public.skill_effects;
drop trigger if exists validate_ability_effect on public.ability_effects;
drop trigger if exists validate_relic_effect on public.relic_effects;
drop trigger if exists validate_status_effect on public.status_effects;
create trigger validate_skill_effect before insert or update on public.skill_effects for each row execute function public.validate_inline_effect_row();
create trigger validate_ability_effect before insert or update on public.ability_effects for each row execute function public.validate_inline_effect_row();
create trigger validate_relic_effect before insert or update on public.relic_effects for each row execute function public.validate_inline_effect_row();
create trigger validate_status_effect before insert or update on public.status_effects for each row execute function public.validate_inline_effect_row();

create or replace function public.replace_inline_effects(p_owner text,p_owner_id text,p_effects jsonb)
returns void language plpgsql set search_path=public as $$
declare
  v_table text;
  v_owner_column text;
  v_effect jsonb;
  v_order bigint;
begin
  v_table:=case p_owner when 'skill' then 'skill_effects' when 'ability' then 'ability_effects' when 'relic' then 'relic_effects' when 'status' then 'status_effects' end;
  v_owner_column:=case p_owner when 'skill' then 'skill_id' when 'ability' then 'ability_id' when 'relic' then 'relic_id' when 'status' then 'status_id' end;
  if v_table is null then raise exception 'VALIDATION: invalid inline effect owner'; end if;
  if jsonb_typeof(coalesce(p_effects,'[]'::jsonb))<>'array' then raise exception 'VALIDATION: effects must be an array'; end if;
  execute format('delete from public.%I where %I=$1',v_table,v_owner_column) using p_owner_id;
  for v_effect,v_order in select value,ordinality from jsonb_array_elements(coalesce(p_effects,'[]'::jsonb)) with ordinality loop
    if nullif(btrim(v_effect->>'id'),'') is null or nullif(btrim(v_effect->>'name'),'') is null or nullif(btrim(v_effect->>'description'),'') is null then raise exception 'VALIDATION: every effect needs id, name, and description'; end if;
    perform public.validate_inline_effect_parameters(v_effect->>'templateId',coalesce(v_effect->'parameters','{}'::jsonb),p_owner);
    execute format('insert into public.%I(%I,id,name,description,template_id,parameters,sort_order) values($1,$2,$3,$4,$5,$6,$7)',v_table,v_owner_column)
      using p_owner_id,v_effect->>'id',v_effect->>'name',v_effect->>'description',v_effect->>'templateId',coalesce(v_effect->'parameters','{}'::jsonb),(v_order-1)::integer;
  end loop;
end; $$;

create or replace function public.inline_effects_snapshot(p_owner text,p_owner_id text)
returns jsonb language plpgsql stable set search_path=public as $$
declare v_table text; v_owner_column text; v_result jsonb;
begin
  v_table:=case p_owner when 'skill' then 'skill_effects' when 'ability' then 'ability_effects' when 'relic' then 'relic_effects' when 'status' then 'status_effects' end;
  v_owner_column:=case p_owner when 'skill' then 'skill_id' when 'ability' then 'ability_id' when 'relic' then 'relic_id' when 'status' then 'status_id' end;
  execute format('select coalesce(jsonb_agg((to_jsonb(e)-%L-''effect_category'') order by sort_order),''[]''::jsonb) from public.%I e where %I=$1',v_owner_column,v_table,v_owner_column) into v_result using p_owner_id;
  return v_result;
end; $$;

create or replace function public.admin_save_skill(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int; v_type text:=payload->'fields'->>'type';
begin
  if nullif(v_id,'') is null or nullif(payload->>'name','') is null or v_type not in ('attack','support') then raise exception 'VALIDATION: invalid skill identity/type'; end if;
  if v_type='attack' and coalesce((payload->'fields'->>'power')::int,0)<=0 then raise exception 'VALIDATION: attack power must be positive'; end if;
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('skill',v_id)),version into v_before,v_version from public.skills s where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.skills(id,name,element_id,skill_type,power,mana_cost,description,targeting,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'elementId',v_type,case when v_type='support' then 0 else (payload->'fields'->>'power')::int end,coalesce((payload->'fields'->>'manaCost')::int,0),payload->>'description',coalesce(payload->'fields'->>'targeting','single_enemy'),coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,element_id=excluded.element_id,skill_type=excluded.skill_type,power=excluded.power,mana_cost=excluded.mana_cost,description=excluded.description,targeting=excluded.targeting,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=skills.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('skill',v_id,payload->'effects');
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('skill',v_id)) into v_after from public.skills s where id=v_id;
  perform public.admin_write_audit('skill',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_save_ability(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  select to_jsonb(a)||jsonb_build_object('effects',public.inline_effects_snapshot('ability',v_id)),version into v_before,v_version from public.rollcaster_abilities a where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.rollcaster_abilities(id,name,description,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=rollcaster_abilities.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('ability',v_id,payload->'effects');
  select to_jsonb(a)||jsonb_build_object('effects',public.inline_effects_snapshot('ability',v_id)) into v_after from public.rollcaster_abilities a where id=v_id;
  perform public.admin_write_audit('ability',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_save_relic(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  if coalesce((payload->'fields'->>'maxOwned')::int,0)<1 then raise exception 'VALIDATION: max owned must be positive'; end if;
  select to_jsonb(r)||jsonb_build_object('effects',public.inline_effects_snapshot('relic',v_id)),version into v_before,v_version from public.relics r where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.relics(id,name,description,max_owned,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',(payload->'fields'->>'maxOwned')::int,payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,max_owned=excluded.max_owned,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=relics.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('relic',v_id,payload->'effects');
  select to_jsonb(r)||jsonb_build_object('effects',public.inline_effects_snapshot('relic',v_id)) into v_after from public.relics r where id=v_id;
  perform public.admin_write_audit('relic',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_save_status(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  if nullif(v_id,'') is null or nullif(btrim(payload->>'name'),'') is null or nullif(btrim(payload->>'description'),'') is null then raise exception 'VALIDATION: id, name, and description are required'; end if;
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('status',v_id)),version into v_before,v_version from public.statuses s where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.statuses(id,name,description,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',nullif(payload->>'assetPath',''),coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,asset_path=excluded.asset_path,is_active=excluded.is_active,is_archived=excluded.is_archived,sort_order=excluded.sort_order,version=statuses.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('status',v_id,payload->'effects');
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('status',v_id)) into v_after from public.statuses s where id=v_id;
  perform public.admin_write_audit('status',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_delete_content(entity_type text,entity_id text,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' when 'asset' then 'game_assets' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','statuses','elements','dungeons','game_assets') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  if v_table='game_assets' then execute 'select to_jsonb(t),1 from public.game_assets t where id::text=$1 for update' into v_before,v_version using entity_id;
  else execute format('select to_jsonb(t),version from public.%I t where id::text=$1 for update',v_table) into v_before,v_version using entity_id; end if;
  if v_before is null then raise exception 'NOT_FOUND'; end if; if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('delete from public.%I where id::text=$1',v_table) using entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'delete',v_version,null,v_before,null); return jsonb_build_object('deleted',true,'entity_type',entity_type,'entity_id',entity_id);
end; $$;

create or replace function public.admin_content_usage(entity_type text,entity_id text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_result jsonb:='[]';
begin
  if entity_type='skill' then select coalesce(jsonb_agg(x),'[]') into v_result from (select 'critter' entity_type,critter_id entity_id from public.critter_skill_unlocks where skill_id=admin_content_usage.entity_id union all select 'dungeon_opponent',opponent_id::text from public.dungeon_opponent_skills where skill_id=admin_content_usage.entity_id) x;
  elsif entity_type='status' then select coalesce(jsonb_agg(x),'[]') into v_result from (select 'skill' entity_type,skill_id entity_id from public.skill_effects where parameters->>'status_id'=admin_content_usage.entity_id) x;
  elsif entity_type='element' then select coalesce(jsonb_agg(x),'[]') into v_result from (select 'critter' entity_type,id entity_id from public.critters where element_id=admin_content_usage.entity_id union all select 'skill',id from public.skills where element_id=admin_content_usage.entity_id union all select 'ability',ability_id from public.ability_effects where parameters->'element_ids' ? admin_content_usage.entity_id) x;
  end if; return v_result;
end; $$;

create or replace function public.admin_publish_content(entity_type text,entity_id text,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_after jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','statuses','elements','dungeons') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  execute format('select to_jsonb(t),version from public.%I t where id=$1 for update',v_table) into v_before,v_version using entity_id;
  if v_before is null then raise exception 'NOT_FOUND'; end if; if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('update public.%I set is_active=true,is_archived=false,version=version+1,updated_at=now(),updated_by=$1 where id=$2 returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_user,entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'publish',v_version,v_version+1,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_archive_content(entity_type text,entity_id text,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_after jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','statuses','elements','dungeons') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  execute format('select to_jsonb(t),version from public.%I t where id=$1 for update',v_table) into v_before,v_version using entity_id;
  if v_before is null then raise exception 'NOT_FOUND'; end if; if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('update public.%I set is_active=false,is_archived=true,version=version+1,updated_at=now(),updated_by=$1 where id=$2 returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_user,entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'archive',v_version,v_version+1,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_save_asset(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id uuid:=(payload->>'id')::uuid; v_path text:=btrim(payload->'fields'->>'path'); v_category text:=lower(btrim(payload->'fields'->>'category')); v_owner_id text:=nullif(btrim(payload->'fields'->>'owner'),''); v_variant text:=coalesce(nullif(btrim(payload->'fields'->>'variant'),''),'default'); v_existing_id uuid;
begin
  if v_path is null or v_path='' or v_path~'^/' or v_path~'(^|/)\.\.(/|$)' then raise exception 'VALIDATION: invalid Storage object path'; end if;
  if v_category is null or v_category!~'^[a-z0-9][a-z0-9_-]*$' then raise exception 'VALIDATION: invalid category'; end if;
  if not exists(select 1 from storage.objects where bucket_id='game-assets' and name=v_path) then raise exception 'VALIDATION: Storage object does not exist in game-assets'; end if;
  select id,to_jsonb(a) into v_existing_id,v_before from public.game_assets a where id=v_id or (bucket_id='game-assets' and path=v_path and variant=v_variant) order by (id=v_id) desc limit 1 for update;
  if v_before is null and expected_version<>0 then raise exception 'VERSION_CONFLICT'; end if; if v_before is not null and expected_version<>1 then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.game_assets(id,bucket_id,path,category,owner_table,owner_id,variant,display_name,alt_text,content_type,is_active,sort_order,updated_at)
  values(coalesce(v_existing_id,v_id),'game-assets',v_path,v_category,case when v_owner_id is null then null else case v_category when 'critter' then 'critters' when 'rollcaster' then 'rollcasters' when 'relic' then 'relics' when 'status' then 'statuses' when 'element' then 'elements' else v_category end end,v_owner_id,v_variant,payload->>'name',nullif(payload->>'description',''),nullif(payload->'fields'->>'contentType',''),true,coalesce((payload->>'sortOrder')::int,0),now())
  on conflict(id) do update set path=excluded.path,category=excluded.category,owner_table=excluded.owner_table,owner_id=excluded.owner_id,variant=excluded.variant,display_name=excluded.display_name,alt_text=excluded.alt_text,content_type=excluded.content_type,is_active=true,sort_order=excluded.sort_order,updated_at=now();
  select to_jsonb(a) into v_after from public.game_assets a where id=coalesce(v_existing_id,v_id); perform public.admin_write_audit('asset',coalesce(v_existing_id,v_id)::text,case when v_before is null then 'create' else 'update' end,case when v_before is null then null else 1 end,1,v_before,v_after); return v_after;
end; $$;

create or replace view public.combat_effects_v1 as
select 'skill'::text owner_type,e.skill_id owner_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id template_id,t.runtime_kind,t.runtime_version
from public.skill_effects e join public.effect_templates t on t.id=e.template_id
union all select 'ability',e.ability_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id,t.runtime_kind,t.runtime_version from public.ability_effects e join public.effect_templates t on t.id=e.template_id
union all select 'relic',e.relic_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id,t.runtime_kind,t.runtime_version from public.relic_effects e join public.effect_templates t on t.id=e.template_id
union all select 'status',e.status_id,e.id,e.name,e.description,e.sort_order,e.parameters,t.id,t.runtime_kind,t.runtime_version from public.status_effects e join public.effect_templates t on t.id=e.template_id;
grant select on public.combat_effects_v1 to anon,authenticated;

revoke all on function public.validate_inline_effect_parameters(text,jsonb,text) from public;
revoke all on function public.validate_inline_effect_row() from public;
revoke all on function public.replace_inline_effects(text,text,jsonb) from public;
revoke all on function public.inline_effects_snapshot(text,text) from public;
revoke all on function public.admin_save_skill(jsonb,integer) from public;
revoke all on function public.admin_save_ability(jsonb,integer) from public;
revoke all on function public.admin_save_relic(jsonb,integer) from public;
revoke all on function public.admin_save_status(jsonb,integer) from public;
grant execute on function public.admin_save_skill(jsonb,integer),public.admin_save_ability(jsonb,integer),public.admin_save_relic(jsonb,integer),public.admin_save_status(jsonb,integer) to authenticated;
