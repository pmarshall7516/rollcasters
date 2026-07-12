-- Make effect definitions owner-specific and enforce attachment compatibility.
-- Skill, ability, relic, and status effects are intentionally separate records.

alter table public.effect_definitions
  add column if not exists owner_type text;

-- Stop rather than guessing if a legacy definition is already shared across owner systems.
do $$
declare v_conflict record;
begin
  select effect_id, array_agg(distinct owner_type order by owner_type) owner_types
  into v_conflict
  from (
    select effect_id, 'skill'::text owner_type from public.skill_effect_attachments
    union all select effect_id, 'ability' from public.ability_effect_attachments
    union all select effect_id, 'relic' from public.relic_effect_attachments
    union all select effect_id, 'status' from public.status_effect_attachments
  ) usage
  group by effect_id
  having count(distinct owner_type) > 1
  limit 1;

  if found then
    raise exception 'EFFECT_OWNER_CONFLICT: effect % is attached to owner systems %. Clone it into one definition per owner before applying migration 011.',
      v_conflict.effect_id, v_conflict.owner_types;
  end if;
end $$;

update public.effect_definitions effect
set owner_type = case
  when exists (select 1 from public.skill_effect_attachments a where a.effect_id=effect.id) then 'skill'
  when exists (select 1 from public.ability_effect_attachments a where a.effect_id=effect.id) then 'ability'
  when exists (select 1 from public.relic_effect_attachments a where a.effect_id=effect.id) then 'relic'
  when exists (select 1 from public.status_effect_attachments a where a.effect_id=effect.id) then 'status'
  when effect.parameters->>'target'='equipped_critter' then 'relic'
  when effect.parameters->>'target' in ('all_friendly_critters','active_friendly_critter') then 'ability'
  when effect.parameters->>'target'='status_holder' then 'status'
  else 'skill'
end
where owner_type is null;

alter table public.effect_definitions
  alter column owner_type set not null;

alter table public.effect_definitions
  drop constraint if exists effect_definitions_owner_type_check;
alter table public.effect_definitions
  add constraint effect_definitions_owner_type_check
  check (owner_type in ('skill','ability','relic','status'));

create or replace function public.validate_effect_definition_scope()
returns trigger language plpgsql set search_path = public as $$
declare
  v_allowed_owners text[];
  v_runtime_kind text;
  v_target text := new.parameters->>'target';
  v_allowed_targets text[];
begin
  select allowed_owners,runtime_kind into v_allowed_owners,v_runtime_kind
  from public.effect_templates where id=new.template_id;

  if v_allowed_owners is null then
    raise exception 'EFFECT_TEMPLATE_NOT_FOUND: %',new.template_id;
  end if;
  if not (new.owner_type = any(v_allowed_owners)) then
    raise exception 'EFFECT_OWNER_NOT_ALLOWED: template % does not support % effects',new.template_id,new.owner_type;
  end if;

  v_allowed_targets := case new.owner_type
    when 'skill' then array['skill_user','selected_target','all_enemies','all_friendlies']
    when 'ability' then array['all_friendly_critters','all_enemies','active_friendly_critter']
    when 'relic' then array['equipped_critter','all_friendly_critters']
    when 'status' then array['status_holder']
  end;
  if v_target is null or not (v_target = any(v_allowed_targets)) then
    raise exception 'EFFECT_TARGET_NOT_ALLOWED: target % is invalid for % effects',coalesce(v_target,'<missing>'),new.owner_type;
  end if;

  if v_runtime_kind='stat_modifier' then
    if new.parameters->>'stat' not in ('hp','atk','def','spd')
      or new.parameters->>'mode' not in ('flat','percentage')
      or coalesce(jsonb_typeof(new.parameters->'amount'),'')<>'number' then
      raise exception 'EFFECT_PARAMETERS_INVALID: stat_modifier';
    end if;
  elsif v_runtime_kind='mana_dice_modifier' then
    if coalesce((new.parameters->>'minimum_delta')::int,0)=0
      and coalesce((new.parameters->>'maximum_delta')::int,0)=0 then
      raise exception 'EFFECT_PARAMETERS_INVALID: mana_dice_modifier must change a bound';
    end if;
  elsif v_runtime_kind='apply_status' then
    if not (new.parameters ? 'chance')
      or not exists(select 1 from public.statuses where id=new.parameters->>'status_id')
      or (new.parameters->>'chance')::numeric not between 0 and 1 then
      raise exception 'EFFECT_PARAMETERS_INVALID: apply_status';
    end if;
  elsif v_runtime_kind='restore_hp' then
    if not (new.parameters ? 'amount') or new.parameters->>'mode' not in ('flat','percent_max_hp')
      or (new.parameters->>'amount')::numeric < 0
      or (new.parameters->>'mode'='percent_max_hp' and (new.parameters->>'amount')::numeric > 1) then
      raise exception 'EFFECT_PARAMETERS_INVALID: restore_hp';
    end if;
  elsif v_runtime_kind='damage_over_time' then
    if not (new.parameters ? 'amount') or new.parameters->>'timing' not in ('start_of_turn','end_of_turn')
      or new.parameters->>'mode' not in ('flat','percent_max_hp')
      or (new.parameters->>'amount')::numeric < 0
      or (new.parameters->>'mode'='percent_max_hp' and (new.parameters->>'amount')::numeric > 1)
      or (new.parameters ? 'duration' and (new.parameters->>'duration')::int < 1) then
      raise exception 'EFFECT_PARAMETERS_INVALID: damage_over_time';
    end if;
  elsif v_runtime_kind='skip_action_chance' then
    if not (new.parameters ? 'chance') or (new.parameters->>'chance')::numeric not between 0 and 1
      or (new.parameters ? 'duration' and (new.parameters->>'duration')::int < 1) then
      raise exception 'EFFECT_PARAMETERS_INVALID: skip_action_chance';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists effect_definition_scope_validation on public.effect_definitions;
create trigger effect_definition_scope_validation
  before insert or update of template_id,owner_type,parameters on public.effect_definitions
  for each row execute function public.validate_effect_definition_scope();

create or replace function public.validate_effect_attachment_owner()
returns trigger language plpgsql set search_path = public as $$
declare
  v_expected_owner text;
  v_effect_owner text;
  v_active boolean;
  v_supported boolean;
begin
  v_expected_owner := case tg_table_name
    when 'skill_effect_attachments' then 'skill'
    when 'ability_effect_attachments' then 'ability'
    when 'relic_effect_attachments' then 'relic'
    when 'status_effect_attachments' then 'status'
  end;

  select effect.owner_type,
         effect.is_active and not effect.is_archived,
         template.is_active and not template.is_archived and template.is_runtime_supported
  into v_effect_owner,v_active,v_supported
  from public.effect_definitions effect
  join public.effect_templates template on template.id=effect.template_id
  where effect.id=new.effect_id;

  if v_effect_owner is null then raise exception 'EFFECT_NOT_FOUND: %',new.effect_id; end if;
  if v_effect_owner<>v_expected_owner then
    raise exception 'EFFECT_ATTACHMENT_OWNER_MISMATCH: % is a % effect and cannot attach to %',new.effect_id,v_effect_owner,v_expected_owner;
  end if;
  if not v_active then raise exception 'EFFECT_NOT_ACTIVE: %',new.effect_id; end if;
  if not v_supported then raise exception 'EFFECT_RUNTIME_UNSUPPORTED: %',new.effect_id; end if;
  return new;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'skill_effect_attachments','ability_effect_attachments',
    'relic_effect_attachments','status_effect_attachments'
  ] loop
    execute format('drop trigger if exists effect_attachment_owner_validation on public.%I',v_table);
    execute format('create trigger effect_attachment_owner_validation before insert or update on public.%I for each row execute function public.validate_effect_attachment_owner()',v_table);
  end loop;
end $$;

-- Required owner-specific examples. They remain unattached until chosen in the admin tool.
insert into public.effect_definitions
  (id,name,description,template_id,owner_type,parameters,is_active,sort_order)
values
  ('harden','Harden','Grants all friendly critters +7 DEF.','stat-modifier','ability',
   '{"stat":"def","mode":"flat","amount":7,"target":"all_friendly_critters"}',true,100),
  ('boosted-roll','Boosted Roll','Increases the equipped critter Mana Dice minimum by 1 and maximum by 2.','mana-dice-modifier','relic',
   '{"minimum_delta":1,"maximum_delta":2,"target":"equipped_critter"}',true,110),
  ('poison-touch','Poison Touch','Has a 30% chance to apply Toxic to the selected target.','apply-status','skill',
   '{"status_id":"toxic","chance":0.30,"target":"selected_target"}',true,120)
on conflict (id) do update set
  name=excluded.name,description=excluded.description,template_id=excluded.template_id,
  parameters=excluded.parameters,updated_at=now()
where effect_definitions.owner_type=excluded.owner_type;

create index if not exists effect_definitions_owner_lifecycle_idx
  on public.effect_definitions(owner_type,is_active,is_archived,sort_order);

-- Replace the save RPC so owner type is validated and audited with the aggregate.
create or replace function public.admin_save_effect_definition(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid:=public.assert_content_admin();
  v_before jsonb;
  v_after jsonb;
  v_id text:=payload->>'id';
  v_version int;
  v_template text:=payload->'fields'->>'template';
  v_owner text:=payload->>'effectOwner';
begin
  if nullif(v_id,'') is null or nullif(payload->>'name','') is null or nullif(v_template,'') is null or v_owner not in ('skill','ability','relic','status') then
    raise exception 'VALIDATION: id, name, template, and one valid effect owner are required';
  end if;
  if not exists(select 1 from public.effect_templates where id=v_template and is_active and is_runtime_supported and v_owner=any(allowed_owners)) and payload->>'status'='active' then
    raise exception 'UNSUPPORTED_TEMPLATE_OR_OWNER';
  end if;
  select to_jsonb(effect),version into v_before,v_version
  from public.effect_definitions effect where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.effect_definitions
    (id,name,description,template_id,owner_type,parameters,is_active,is_archived,version,sort_order,created_by,updated_by)
  values
    (v_id,payload->>'name',payload->>'description',v_template,v_owner,
     coalesce(payload->'fields','{}')-'template'-'usage',
     payload->>'status'='active',payload->>'status'='archived',1,
     coalesce((payload->>'sortOrder')::int,0),v_user,v_user)
  on conflict(id) do update set
    name=excluded.name,description=excluded.description,template_id=excluded.template_id,
    owner_type=excluded.owner_type,parameters=excluded.parameters,
    is_active=excluded.is_active,is_archived=excluded.is_archived,
    sort_order=excluded.sort_order,version=effect_definitions.version+1,
    updated_at=now(),updated_by=v_user;

  select to_jsonb(effect) into v_after from public.effect_definitions effect where id=v_id;
  perform public.admin_write_audit('effect',v_id,
    case when payload->>'status'='active' then 'publish' when v_before is null then 'create' else 'update' end,
    v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end;
$$;

revoke all on function public.admin_save_effect_definition(jsonb,integer) from public;
grant execute on function public.admin_save_effect_definition(jsonb,integer) to authenticated;

comment on column public.effect_definitions.owner_type is
  'Exactly one of skill, ability, relic, or status. Definitions are never shared across owner timing systems.';
