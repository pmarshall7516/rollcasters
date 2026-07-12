-- Add explicit self-only and teammate-only targeting without changing legacy modes.

alter table public.skills
  drop constraint if exists skills_targeting_check;

alter table public.skills
  add constraint skills_targeting_check check (
    targeting in (
      'single_enemy','all_enemies','all_others','single_any',
      'self_only','all_allies','all_friendlies'
    )
  );

comment on column public.skills.targeting is
  'Targeting mode. self_only selects only the acting critter; all_allies selects every friendly teammate except the acting critter; all_friendlies includes the acting critter.';

-- Keep configured Skill effects aligned with the expanded Skill target contract.
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
    when 'skill' then array['skill_user','selected_target','all_enemies','all_allies','all_friendlies']
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
