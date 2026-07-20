-- Avoid resolving Critter-only and Rollcaster-only transition fields in the
-- same CASE expression. PostgreSQL validates both CASE branches against the
-- current trigger row type, even when only one branch can run.
create or replace function public.bump_player_state_revision_indirect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned_id uuid;
  v_user uuid;
begin
  if tg_table_name like 'user_rollcaster_%' then
    if tg_op = 'DELETE' then
      v_owned_id := old.user_rollcaster_id;
    else
      v_owned_id := new.user_rollcaster_id;
    end if;
    select user_id into v_user from public.user_rollcasters where id = v_owned_id;
  else
    if tg_op = 'DELETE' then
      v_owned_id := old.user_critter_id;
    else
      v_owned_id := new.user_critter_id;
    end if;
    select user_id into v_user from public.user_critters where id = v_owned_id;
  end if;

  if v_user is not null then
    update public.profiles
    set player_state_revision = player_state_revision + 1
    where user_id = v_user;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.bump_player_state_revision_indirect() from public, anon, authenticated;
