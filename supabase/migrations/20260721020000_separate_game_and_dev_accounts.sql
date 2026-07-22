-- Player clients may authenticate only identities that are not reserved for
-- Content Studio / simulation tooling. The classification is derived from
-- server-controlled app metadata and the dev-tool allowlist.
create or replace function public.is_game_account()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and not public.is_dev_tool_identity(auth.uid());
$$;

revoke all on function public.is_game_account() from public;
grant execute on function public.is_game_account() to authenticated;
grant execute on function public.is_game_account() to service_role;

comment on function public.is_game_account() is
  'True only for authenticated identities that are not dedicated dev-tool accounts.';
