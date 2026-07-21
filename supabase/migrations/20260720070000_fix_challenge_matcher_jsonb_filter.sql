begin;

-- 20260720060000 is already deployed in environments that have the new
-- runtime. Re-install its function after correcting the JSONB target filter
-- expression used by legacy tracked challenge instances.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.oid='public.submit_collectible_combat_events(uuid,integer,jsonb)'::regprocedure
  limit 1;

  if v_definition is null then
    raise exception 'submit_collectible_combat_events function is unavailable';
  end if;

  v_definition:=replace(
    v_definition,
    'coalesce(array_length(c.parameters->''target_ids'',1),0)',
    'coalesce(jsonb_array_length(c.parameters->''target_ids''),0)'
  );
  execute v_definition;
end;
$$;

commit;
