-- Immutable catalog release metadata and an indexed authoring-asset inventory.
-- Runtime bytes live on the configured static host; Supabase remains the
-- authoring source of truth and records release/audit metadata only.

create table if not exists public.content_releases (
  id text primary key,
  schema_version integer not null default 1 check (schema_version > 0),
  minimum_game_version text not null,
  status text not null default 'draft' check (status in ('draft', 'validated', 'published', 'retired')),
  manifest_hash text,
  manifest_path text,
  previous_release_id text references public.content_releases(id),
  validation_report jsonb not null default '{}'::jsonb,
  release_diff jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  published_at timestamptz,
  check (id ~ '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$'),
  check (manifest_hash is null or manifest_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists public.content_release_artifacts (
  release_id text not null references public.content_releases(id) on delete cascade,
  artifact_key text not null,
  artifact_kind text not null check (artifact_kind in ('catalog_pack', 'asset_manifest', 'release_manifest', 'asset')),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  integrity_hash text not null check (integrity_hash ~ '^sha256-[A-Za-z0-9+/]+={0,2}$'),
  byte_size bigint not null check (byte_size >= 0),
  object_path text not null check (object_path <> '' and object_path !~ '^/'),
  content_type text not null,
  source_asset_id uuid references public.game_assets(id),
  variant text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  primary key (release_id, artifact_key),
  unique (release_id, object_path)
);

create table if not exists public.content_release_channels (
  channel text primary key check (channel ~ '^[a-z][a-z0-9_-]*$'),
  current_release_id text references public.content_releases(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.content_release_channels(channel)
values ('production')
on conflict (channel) do nothing;

create index if not exists content_releases_status_published_idx
  on public.content_releases(status, published_at desc, id desc);
create index if not exists content_release_artifacts_hash_idx
  on public.content_release_artifacts(content_hash);
create index if not exists content_release_artifacts_source_idx
  on public.content_release_artifacts(source_asset_id, variant)
  where source_asset_id is not null;

alter table public.content_releases enable row level security;
alter table public.content_release_artifacts enable row level security;
alter table public.content_release_channels enable row level security;

drop policy if exists content_releases_admin_read on public.content_releases;
create policy content_releases_admin_read on public.content_releases
  for select to authenticated using (public.is_content_admin());
drop policy if exists content_release_artifacts_admin_read on public.content_release_artifacts;
create policy content_release_artifacts_admin_read on public.content_release_artifacts
  for select to authenticated using (public.is_content_admin());
drop policy if exists content_release_channels_admin_read on public.content_release_channels;
create policy content_release_channels_admin_read on public.content_release_channels
  for select to authenticated using (public.is_content_admin());

grant select on public.content_releases to authenticated, service_role;
grant select on public.content_release_artifacts to authenticated, service_role;
grant select on public.content_release_channels to authenticated, service_role;

create or replace function public.admin_list_storage_asset_index()
returns table (
  path text,
  content_type text,
  byte_size bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
begin
  if not public.is_content_admin() then
    raise exception 'CONTENT_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select
    objects.name::text,
    nullif(objects.metadata ->> 'mimetype', '')::text,
    case
      when coalesce(objects.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (objects.metadata ->> 'size')::bigint
      else null
    end,
    objects.updated_at
  from storage.objects
  where objects.bucket_id = 'game-assets'
    and objects.name ~* '\.(png|jpe?g|webp|gif|svg)$'
  order by objects.name;
end;
$$;

revoke all on function public.admin_list_storage_asset_index() from public, anon;
grant execute on function public.admin_list_storage_asset_index() to authenticated, service_role;

create or replace function public.admin_content_change_log_page(
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 100
)
returns table (
  id uuid,
  admin_user_id uuid,
  entity_type text,
  entity_id text,
  operation text,
  previous_version integer,
  next_version integer,
  changed_at timestamptz,
  change_note text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_content_admin() then
    raise exception 'CONTENT_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 250 then
    raise exception 'AUDIT_PAGE_LIMIT_INVALID' using errcode = '22023';
  end if;

  return query
  select log.id,log.admin_user_id,log.entity_type,log.entity_id,log.operation,
    log.previous_version,log.next_version,log.changed_at,log.change_note
  from public.content_change_log log
  where p_before_at is null
    or (log.changed_at,log.id) < (p_before_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by log.changed_at desc,log.id desc
  limit p_limit;
end;
$$;

revoke all on function public.admin_content_change_log_page(timestamptz,uuid,integer) from public, anon;
grant execute on function public.admin_content_change_log_page(timestamptz,uuid,integer) to authenticated, service_role;

comment on table public.content_releases is
  'Review and lifecycle metadata for deterministic immutable public catalog releases.';
comment on table public.content_release_artifacts is
  'Hashes, sizes, paths, and optional asset-variant metadata for every immutable release artifact.';
comment on table public.content_release_channels is
  'Server-side accepted release pointers. Static latest.json is updated only after immutable upload verification.';
comment on function public.admin_list_storage_asset_index() is
  'Returns one indexed Storage object inventory query for Content Studio asset sync; replaces recursive bucket listing.';
comment on function public.admin_content_change_log_page(timestamptz,uuid,integer) is
  'Stable keyset-paginated Content Studio audit history.';
