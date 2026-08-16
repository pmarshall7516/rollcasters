begin;

-- Challenge-gated unlocks are materialized atomically by the evaluator in
-- user_collectible_unlock_events. Reading challenge state again from this
-- predicate can recurse through Own Collectible dependencies while the
-- evaluator is already walking the challenge graph.
create or replace function public.collectible_is_unlocked(p_user uuid,p_type text,p_id text)
returns boolean
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_owned boolean:=false;
  v_required integer;
begin
  if p_type='critter' then
    select exists(select 1 from public.user_critters where user_id=p_user and critter_id=p_id) into v_owned;
  elsif p_type='rollcaster' then
    select exists(select 1 from public.user_rollcasters where user_id=p_user and rollcaster_id=p_id) into v_owned;
  elsif p_type='relic' then
    select exists(
      select 1 from public.user_relic_inventory
      where user_id=p_user and relic_id=p_id and discovered_at is not null and quantity>0
    ) into v_owned;
  else
    return false;
  end if;

  select required_challenges into v_required
  from public.collectible_unlock_requirements
  where collectible_type=p_type and collectible_id=p_id;
  if not found or coalesce(v_required,0)<=0 then return v_owned; end if;
  if not v_owned then return false; end if;

  return exists(
    select 1 from public.user_collectible_unlock_events
    where user_id=p_user and collectible_type=p_type and collectible_id=p_id
  );
end;
$$;

commit;
