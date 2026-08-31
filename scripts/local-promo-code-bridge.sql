-- Local-player-only Promo Code claim bridge.
-- The Game fetches the definition from Production and sends that definition
-- here. This function intentionally preserves all local redemption state.
create or replace function public.redeem_promo_code_from_definition(p_definition jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_code text;
  v_infinite_use boolean;
  v_redemption_limit bigint;
  v_infinite_uses_per_player boolean;
  v_uses_per_player bigint;
  v_version integer;
  v_sort_order integer;
  v_reward jsonb;
  v_reward_id uuid;
  v_reward_ids uuid[] := '{}'::uuid[];
  v_reward_type text;
  v_target_category text;
  v_target_id text;
  v_quantity bigint;
  v_reward_sort_order integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_definition) <> 'object' then raise exception 'INVALID_PROMO_CODE_DEFINITION'; end if;

  begin
    v_id := nullif(p_definition->>'id', '')::uuid;
    v_infinite_use := (p_definition->>'infiniteUse')::boolean;
    v_infinite_uses_per_player := (p_definition->>'infiniteUsesPerPlayer')::boolean;
    v_redemption_limit := nullif(p_definition->>'redemptionLimit', '')::bigint;
    v_uses_per_player := nullif(p_definition->>'usesPerPlayer', '')::bigint;
    v_version := coalesce(nullif(p_definition->>'version', '')::integer, 1);
    v_sort_order := coalesce(nullif(p_definition->>'sortOrder', '')::integer, 0);
  exception when others then
    raise exception 'INVALID_PROMO_CODE_DEFINITION';
  end;

  v_code := btrim(coalesce(p_definition->>'code', ''));
  if v_id is null or v_code = '' then
    raise exception 'INVALID_PROMO_CODE_DEFINITION';
  end if;
  if v_infinite_use is null or v_infinite_uses_per_player is null then
    raise exception 'INVALID_PROMO_CODE_DEFINITION';
  end if;
  if (v_infinite_use and v_redemption_limit is not null)
    or (not v_infinite_use and (v_redemption_limit is null or v_redemption_limit <= 0))
    or (v_infinite_uses_per_player and v_uses_per_player is not null)
    or (not v_infinite_uses_per_player and (v_uses_per_player is null or v_uses_per_player <= 0))
    or v_version <= 0 or v_sort_order < 0
  then
    raise exception 'INVALID_PROMO_CODE_DEFINITION';
  end if;
  if jsonb_typeof(p_definition->'rewards') <> 'array'
    or jsonb_array_length(p_definition->'rewards') = 0
  then
    raise exception 'INVALID_PROMO_CODE_DEFINITION';
  end if;

  for v_reward in select value from jsonb_array_elements(p_definition->'rewards') loop
    begin
      v_reward_id := nullif(v_reward->>'id', '')::uuid;
      v_reward_type := v_reward->>'rewardType';
      v_target_category := nullif(v_reward->>'targetCategory', '');
      v_target_id := nullif(v_reward->>'targetId', '');
      v_quantity := (v_reward->>'quantity')::bigint;
      v_reward_sort_order := coalesce(nullif(v_reward->>'sortOrder', '')::integer, 0);
    exception when others then
      raise exception 'INVALID_PROMO_CODE_DEFINITION';
    end;
    if v_reward_id is null
      or v_reward_id = any(v_reward_ids)
      or v_reward_type not in ('currency', 'shard', 'critter', 'rollcaster', 'relic')
      or (v_target_category is not null and v_target_category not in ('critter', 'rollcaster', 'relic'))
      or v_target_id is null
      or v_quantity is null or v_quantity <= 0
      or v_reward_sort_order < 0
    then
      raise exception 'INVALID_PROMO_CODE_DEFINITION';
    end if;
    v_reward_ids := array_append(v_reward_ids, v_reward_id);
  end loop;

  insert into public.promo_codes(
    id, code, internal_notes, redemption_limit, infinite_use,
    infinite_uses_per_player, uses_per_player, sort_order,
    is_active, is_archived, version
  ) values (
    v_id, v_code, '', v_redemption_limit, v_infinite_use,
    v_infinite_uses_per_player, v_uses_per_player, v_sort_order,
    true, false, v_version
  )
  on conflict (id) do update set
    code = excluded.code,
    internal_notes = excluded.internal_notes,
    redemption_limit = excluded.redemption_limit,
    infinite_use = excluded.infinite_use,
    infinite_uses_per_player = excluded.infinite_uses_per_player,
    uses_per_player = excluded.uses_per_player,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    is_archived = excluded.is_archived,
    version = excluded.version,
    updated_at = now();

  delete from public.promo_code_rewards where promo_code_id = v_id;
  for v_reward in select value from jsonb_array_elements(p_definition->'rewards') loop
    insert into public.promo_code_rewards(
      id, promo_code_id, reward_type, target_category, target_id, quantity, sort_order
    ) values (
      (v_reward->>'id')::uuid,
      v_id,
      v_reward->>'rewardType',
      nullif(v_reward->>'targetCategory', ''),
      v_reward->>'targetId',
      (v_reward->>'quantity')::bigint,
      coalesce(nullif(v_reward->>'sortOrder', '')::integer, 0)
    );
  end loop;

  return public.redeem_promo_code(v_code);
end;
$$;

revoke all on function public.redeem_promo_code_from_definition(jsonb) from public;
grant execute on function public.redeem_promo_code_from_definition(jsonb) to authenticated, service_role;
