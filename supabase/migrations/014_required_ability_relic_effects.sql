-- Active Rollcaster abilities and relics are behavior-bearing content and must
-- finish every transaction with at least one compatible effect attachment.

create or replace function public.enforce_required_owner_effect()
returns trigger language plpgsql set search_path = public as $$
declare
  v_owner_id text;
  v_is_active boolean;
  v_is_archived boolean;
  v_has_effect boolean;
  v_owner_exists boolean;
  v_label text;
begin
  if tg_table_name = 'rollcaster_abilities' then
    v_owner_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_label := 'Rollcaster ability';
    select is_active, is_archived into v_is_active, v_is_archived
    from public.rollcaster_abilities where id = v_owner_id;
    v_owner_exists := found;
    select exists(select 1 from public.ability_effect_attachments where ability_id = v_owner_id) into v_has_effect;
  elsif tg_table_name = 'ability_effect_attachments' then
    v_owner_id := case when tg_op = 'DELETE' then old.ability_id else new.ability_id end;
    v_label := 'Rollcaster ability';
    select is_active, is_archived into v_is_active, v_is_archived
    from public.rollcaster_abilities where id = v_owner_id;
    v_owner_exists := found;
    select exists(select 1 from public.ability_effect_attachments where ability_id = v_owner_id) into v_has_effect;
  elsif tg_table_name = 'relics' then
    v_owner_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_label := 'Relic';
    select is_active, is_archived into v_is_active, v_is_archived
    from public.relics where id = v_owner_id;
    v_owner_exists := found;
    select exists(select 1 from public.relic_effect_attachments where relic_id = v_owner_id) into v_has_effect;
  else
    v_owner_id := case when tg_op = 'DELETE' then old.relic_id else new.relic_id end;
    v_label := 'Relic';
    select is_active, is_archived into v_is_active, v_is_archived
    from public.relics where id = v_owner_id;
    v_owner_exists := found;
    select exists(select 1 from public.relic_effect_attachments where relic_id = v_owner_id) into v_has_effect;
  end if;

  -- A deleted or inactive draft owner does not need a runtime behavior yet.
  if v_owner_exists and v_is_active and not v_is_archived and not v_has_effect then
    raise exception 'VALIDATION: % % requires at least one effect attachment', v_label, v_owner_id;
  end if;
  return null;
end; $$;

drop trigger if exists require_ability_effect_on_owner on public.rollcaster_abilities;
create constraint trigger require_ability_effect_on_owner
after insert or update on public.rollcaster_abilities
deferrable initially deferred for each row execute function public.enforce_required_owner_effect();

drop trigger if exists require_ability_effect_on_attachment on public.ability_effect_attachments;
create constraint trigger require_ability_effect_on_attachment
after insert or update or delete on public.ability_effect_attachments
deferrable initially deferred for each row execute function public.enforce_required_owner_effect();

drop trigger if exists require_relic_effect_on_owner on public.relics;
create constraint trigger require_relic_effect_on_owner
after insert or update on public.relics
deferrable initially deferred for each row execute function public.enforce_required_owner_effect();

drop trigger if exists require_relic_effect_on_attachment on public.relic_effect_attachments;
create constraint trigger require_relic_effect_on_attachment
after insert or update or delete on public.relic_effect_attachments
deferrable initially deferred for each row execute function public.enforce_required_owner_effect();

comment on function public.enforce_required_owner_effect() is
  'Deferred invariant: every active Rollcaster ability and relic has at least one effect attachment.';
