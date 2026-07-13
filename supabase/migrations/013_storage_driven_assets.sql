-- Make Storage folders the source of truth for asset categories and allow the
-- Content Studio to register newly discovered images transactionally.

update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'
]
where id = 'game-assets';

alter table public.game_assets
  drop constraint if exists game_assets_category_check;

alter table public.game_assets
  add constraint game_assets_category_check
  check (category ~ '^[a-z0-9][a-z0-9_-]*$');

create or replace function public.admin_save_asset(payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_user uuid := public.assert_content_admin();
  v_before jsonb;
  v_after jsonb;
  v_id uuid := (payload->>'id')::uuid;
  v_path text := btrim(payload->'fields'->>'path');
  v_category text := lower(btrim(payload->'fields'->>'category'));
  v_owner_id text := nullif(btrim(payload->'fields'->>'owner'), '');
  v_existing_id uuid;
begin
  if v_path is null or v_path = '' or v_path ~ '^/' or v_path ~ '(^|/)\.\.(/|$)' then
    raise exception 'VALIDATION: invalid Storage object path';
  end if;
  if v_category is null or v_category !~ '^[a-z0-9][a-z0-9_-]*$' then
    raise exception 'VALIDATION: category must use lowercase letters, numbers, hyphens, or underscores';
  end if;
  if not exists (
    select 1 from storage.objects where bucket_id = 'game-assets' and name = v_path
  ) then
    raise exception 'VALIDATION: Storage object does not exist in game-assets';
  end if;

  select id, to_jsonb(a) into v_existing_id, v_before
  from public.game_assets a
  where id = v_id or (bucket_id = 'game-assets' and path = v_path)
  order by (id = v_id) desc
  limit 1
  for update;

  if v_before is null and expected_version <> 0 then raise exception 'VERSION_CONFLICT'; end if;
  if v_before is not null and expected_version <> 1 then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.game_assets (
    id, bucket_id, path, category, owner_table, owner_id, variant,
    display_name, alt_text, content_type, is_active, sort_order, updated_at
  ) values (
    coalesce(v_existing_id, v_id), 'game-assets', v_path, v_category,
    case when v_owner_id is null then null else case v_category
      when 'critter' then 'critters'
      when 'rollcaster' then 'rollcasters'
      when 'relic' then 'relics'
      when 'element' then 'elements'
      else v_category
    end end,
    v_owner_id, 'default', payload->>'name', nullif(payload->>'description', ''),
    nullif(payload->'fields'->>'contentType', ''), true,
    coalesce((payload->>'sortOrder')::int, 0), now()
  )
  on conflict (id) do update set
    path = excluded.path,
    category = excluded.category,
    owner_table = excluded.owner_table,
    owner_id = excluded.owner_id,
    display_name = excluded.display_name,
    alt_text = excluded.alt_text,
    content_type = excluded.content_type,
    is_active = true,
    sort_order = excluded.sort_order,
    updated_at = now();

  select to_jsonb(a) into v_after from public.game_assets a where id = coalesce(v_existing_id, v_id);
  perform public.admin_write_audit('asset', (coalesce(v_existing_id, v_id))::text,
    case when v_before is null then 'create' else 'update' end,
    case when v_before is null then null else 1 end, 1, v_before, v_after);
  return v_after;
end; $$;

revoke all on function public.admin_save_asset(jsonb, integer) from public;
grant execute on function public.admin_save_asset(jsonb, integer) to authenticated;

comment on function public.admin_save_asset(jsonb, integer) is
  'Registers or updates an existing game-assets Storage image with a folder-derived category.';
