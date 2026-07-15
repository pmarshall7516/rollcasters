-- Forward fix for databases that already applied 006: avoid a PL/pgSQL record
-- variable shadowing the challenge table alias during post-unlock cleanup.

create or replace function public.evaluate_collectible_unlock_internal(
  p_user uuid,
  p_type text,
  p_id text
)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_required integer; v_completed integer:=0; v_challenge record; v_granted boolean:=false;
begin
  select required_challenges into v_required
  from public.collectible_unlock_requirements
  where collectible_type=p_type and collectible_id=p_id
  for update;
  if not found or v_required=0 or public.collectible_is_unlocked(p_user,p_type,p_id) then return false; end if;

  if p_type='critter' and not exists(select 1 from public.critters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='rollcaster' and not exists(select 1 from public.rollcasters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='relic' and not exists(select 1 from public.relics where id=p_id and is_active and not is_archived) then return false; end if;

  for v_challenge in select id from public.collectible_unlock_challenges
    where collectible_type=p_type and collectible_id=p_id order by sort_order,id
  loop
    if public.collectible_challenge_current(p_user,v_challenge.id)>=public.collectible_challenge_goal(v_challenge.id) then
      v_completed:=v_completed+1;
    end if;
  end loop;
  if v_completed<v_required then return false; end if;

  v_granted:=public.grant_collectible_internal(p_user,p_type,p_id);
  if not v_granted then return false; end if;
  delete from public.user_tracked_collectible_challenges tracked
  using public.collectible_unlock_challenges challenge_row
  where tracked.user_id=p_user and tracked.challenge_id=challenge_row.id
    and challenge_row.collectible_type=p_type and challenge_row.collectible_id=p_id;
  perform public.compact_user_tracking_slots(p_user);
  insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id)
  values(p_user,p_type,p_id) on conflict(user_id,collectible_type,collectible_id) do nothing;
  return true;
end; $$;

revoke all on function public.evaluate_collectible_unlock_internal(uuid,text,text) from public;
