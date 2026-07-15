-- Data-driven currency header presentation.
-- Every active currency is returned for every player (with a zero balance when
-- no ledger row exists yet), and authors may configure a matching text color.

alter table public.currencies
  add column if not exists text_color text;

alter table public.currencies
  drop constraint if exists currencies_text_color_check;
alter table public.currencies
  add constraint currencies_text_color_check
  check (text_color is null or text_color ~ '^#[0-9A-Fa-f]{6}$');

update public.currencies
set text_color=case id
  when 'coins' then '#FFD65A'
  when 'prismite' then '#7DE8FF'
end,
updated_at=now()
where id in ('coins','prismite') and text_color is null;

create or replace function public.admin_save_currency(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_user uuid:=public.assert_content_admin();
  v_before jsonb;
  v_after jsonb;
  v_id text:=payload->>'id';
  v_version integer;
  v_text_color text:=nullif(btrim(payload->'fields'->>'textColor'),'');
  v_has_text_color boolean:=coalesce(payload->'fields','{}'::jsonb) ? 'textColor';
begin
  if v_id is null or v_id!~'^[A-Za-z0-9_-]+$' or nullif(btrim(payload->>'name'),'') is null or nullif(btrim(payload->>'description'),'') is null then
    raise exception 'VALIDATION: invalid Currency identity';
  end if;
  if v_text_color is not null and v_text_color!~'^#[0-9A-Fa-f]{6}$' then
    raise exception 'VALIDATION: Currency text color must use #RRGGBB format';
  end if;
  select to_jsonb(c),version into v_before,v_version from public.currencies c where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.currencies(
    id,name,description,asset_path,text_color,is_default,is_system,sort_order,is_active,is_archived,version,created_by,updated_by
  ) values(
    v_id,payload->>'name',payload->>'description',nullif(payload->>'assetPath',''),v_text_color,
    coalesce((payload->'fields'->>'isDefault')::boolean,false),v_id='coins',coalesce((payload->>'sortOrder')::int,0),
    payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user
  )
  on conflict(id) do update set
    name=excluded.name,
    description=excluded.description,
    asset_path=excluded.asset_path,
    text_color=case when v_has_text_color then excluded.text_color else currencies.text_color end,
    is_default=case when currencies.id='coins' then true else excluded.is_default end,
    is_system=currencies.is_system or excluded.is_system,
    sort_order=excluded.sort_order,
    is_active=excluded.is_active,
    is_archived=excluded.is_archived,
    version=currencies.version+1,
    updated_at=now(),
    updated_by=v_user;
  select to_jsonb(c) into v_after from public.currencies c where id=v_id;
  perform public.admin_write_audit('currency',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.get_collectible_shop_catalog()
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  select jsonb_build_object(
    'currencies', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.is_default desc,c.sort_order,c.name,c.id)
      from public.currencies c
      where c.is_active and not c.is_archived
    ),'[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.collectible_type,r.collectible_id)
      from public.collectible_unlock_requirements r
    ),'[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(
        to_jsonb(ch) || jsonb_build_object('required_amount',case when ch.required_amount is null then null else ch.required_amount::text end)
        order by ch.collectible_type,ch.collectible_id,ch.sort_order,ch.id
      )
      from public.collectible_unlock_challenges ch
    ),'[]'::jsonb),
    'shop_entries', coalesce((
      select jsonb_agg(
        to_jsonb(s) || jsonb_build_object('price',s.price::text)
        order by s.shop_type,s.sort_order,s.name,s.id
      )
      from public.shop_entries s
      where s.is_active and not s.is_archived
    ),'[]'::jsonb)
  );
$$;

create or replace function public.get_collectible_player_snapshot()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  select jsonb_build_object(
    'currencies',coalesce((select jsonb_agg(jsonb_build_object(
      'currency_id',c.id,'balance',coalesce(u.balance,0)::text
    ) order by c.is_default desc,c.sort_order,c.name,c.id) from public.currencies c
      left join public.user_currencies u on u.currency_id=c.id and u.user_id=v_user
      where c.is_active and not c.is_archived),'[]'::jsonb),
    'shards',coalesce((select jsonb_agg(jsonb_build_object(
      'collectible_type',s.collectible_type,'collectible_id',s.collectible_id,'quantity',s.quantity::text
    ) order by s.collectible_type,s.collectible_id) from public.user_collectible_shards s
      where s.user_id=v_user),'[]'::jsonb),
    'progress',coalesce((select jsonb_agg(jsonb_build_object(
      'challenge_id',c.id,
      'current',public.collectible_challenge_current(v_user,c.id)::text,
      'goal',public.collectible_challenge_goal(c.id)::text,
      'completed',public.collectible_challenge_current(v_user,c.id)>=public.collectible_challenge_goal(c.id)
    ) order by c.collectible_type,c.collectible_id,c.sort_order,c.id) from public.collectible_unlock_challenges c),'[]'::jsonb),
    'tracked',coalesce((select jsonb_agg(jsonb_build_object('challenge_id',t.challenge_id,'slot_order',t.slot_order) order by t.slot_order)
      from public.user_tracked_collectible_challenges t where t.user_id=v_user),'[]'::jsonb),
    'unlock_events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'collectible_type',e.collectible_type,'collectible_id',e.collectible_id,'created_at',e.created_at
    ) order by e.created_at,e.id) from public.user_collectible_unlock_events e
      where e.user_id=v_user and e.acknowledged_at is null),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

revoke all on function public.get_collectible_shop_catalog() from public;
grant execute on function public.get_collectible_shop_catalog() to anon,authenticated;
revoke all on function public.get_collectible_player_snapshot() from public;
grant execute on function public.get_collectible_player_snapshot() to authenticated;
