insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'game-assets',
  'game-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists game_assets_public_read on storage.objects;
create policy game_assets_public_read on storage.objects
  for select using (bucket_id = 'game-assets');

alter table public.elements
  add column if not exists asset_path text;

alter table public.skills
  drop column if exists asset_path;

alter table public.rollcaster_abilities
  drop column if exists asset_path;

create table if not exists public.game_assets (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null default 'game-assets' references storage.buckets(id),
  path text not null,
  category text not null check (
    category in ('critter', 'rollcaster', 'relic', 'element', 'currency', 'mana', 'ui', 'other')
  ),
  owner_table text,
  owner_id text,
  variant text not null default 'default',
  display_name text,
  alt_text text,
  content_type text,
  width int,
  height int,
  checksum text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, path),
  unique (category, owner_table, owner_id, variant),
  check (path <> '' and path !~ '^/'),
  check (variant <> '')
);

delete from public.game_assets
where category in ('skill', 'ability');

alter table public.game_assets
  drop constraint if exists game_assets_category_check;

alter table public.game_assets
  add constraint game_assets_category_check
  check (category in ('critter', 'rollcaster', 'relic', 'element', 'currency', 'mana', 'ui', 'other'));

comment on table public.game_assets is
  'Registry for public game art stored in the Supabase Storage game-assets bucket.';
comment on column public.game_assets.path is
  'Object path inside game-assets, for example critters/001-toxichick.png or logos/elements/aqua.svg.';
comment on column public.game_assets.variant is
  'Asset variant such as default, icon, portrait, sprite-front, sprite-back, shiny, or thumbnail.';

alter table public.game_assets enable row level security;

drop policy if exists game_assets_read_all on public.game_assets;
create policy game_assets_read_all on public.game_assets
  for select using (true);

create index if not exists game_assets_category_sort_idx
  on public.game_assets (category, sort_order, path)
  where is_active;

create index if not exists game_assets_owner_idx
  on public.game_assets (owner_table, owner_id, variant)
  where is_active;

create index if not exists user_rollcasters_user_unlocked_idx
  on public.user_rollcasters (user_id, unlocked_at);

create index if not exists user_critters_user_unlocked_idx
  on public.user_critters (user_id, unlocked_at);

create index if not exists user_seen_critters_critter_idx
  on public.user_seen_critters (critter_id);

create index if not exists user_dungeon_progress_user_unlocked_idx
  on public.user_dungeon_progress (user_id, is_unlocked, dungeon_id);

create index if not exists dungeon_runs_user_started_idx
  on public.dungeon_runs (user_id, started_at desc);

create index if not exists dungeon_opponents_dungeon_pool_sequence_idx
  on public.dungeon_opponents (dungeon_id, pool_type, sequence_index);

insert into public.game_assets (
  path, category, owner_table, owner_id, variant, display_name, alt_text, content_type, sort_order
) values
  ('logos/elements/basic.svg', 'element', 'elements', 'basic', 'icon', 'Basic element logo', 'Basic element logo', 'image/svg+xml', 1),
  ('logos/elements/vile.svg', 'element', 'elements', 'vile', 'icon', 'Vile element logo', 'Vile element logo', 'image/svg+xml', 2),
  ('logos/elements/bloom.svg', 'element', 'elements', 'bloom', 'icon', 'Bloom element logo', 'Bloom element logo', 'image/svg+xml', 3),
  ('logos/elements/aqua.svg', 'element', 'elements', 'aqua', 'icon', 'Aqua element logo', 'Aqua element logo', 'image/svg+xml', 4),
  ('ui/currency/coins.svg', 'currency', 'global', 'coins', 'icon', 'Coin logo', 'Coin currency logo', 'image/svg+xml', 10),
  ('ui/mana/mana.svg', 'mana', 'global', 'mana', 'icon', 'Mana logo', 'Mana resource logo', 'image/svg+xml', 11),
  ('rollcasters/001-shanks.png', 'rollcaster', 'rollcasters', '001', 'default', 'Shanks sprite', 'Shanks Rollcaster sprite', 'image/png', 100),
  ('critters/001-toxichick.png', 'critter', 'critters', '001', 'default', 'Toxichick sprite', 'Toxichick sprite', 'image/png', 201),
  ('critters/002-spreagle.png', 'critter', 'critters', '002', 'default', 'Spreagle sprite', 'Spreagle sprite', 'image/png', 202),
  ('critters/003-congua.png', 'critter', 'critters', '003', 'default', 'Congua sprite', 'Congua sprite', 'image/png', 203),
  ('relics/001-copper-shield.png', 'relic', 'relics', '001', 'default', 'Copper Shield sprite', 'Copper Shield relic sprite', 'image/png', 301)
on conflict (category, owner_table, owner_id, variant) do update set
  path = excluded.path,
  bucket_id = excluded.bucket_id,
  display_name = excluded.display_name,
  alt_text = excluded.alt_text,
  content_type = excluded.content_type,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

update public.elements
set asset_path = case id
  when 'basic' then 'logos/elements/basic.svg'
  when 'vile' then 'logos/elements/vile.svg'
  when 'bloom' then 'logos/elements/bloom.svg'
  when 'aqua' then 'logos/elements/aqua.svg'
  else asset_path
end
where id in ('basic', 'vile', 'bloom', 'aqua');

update public.critters
set asset_path = case id
  when '001' then 'critters/001-toxichick.png'
  when '002' then 'critters/002-spreagle.png'
  when '003' then 'critters/003-congua.png'
  else asset_path
end
where id in ('001', '002', '003');

update public.rollcasters
set asset_path = 'rollcasters/001-shanks.png'
where id = '001';

update public.relics
set asset_path = 'relics/001-copper-shield.png'
where id = '001';

create or replace function public.select_starter_critter(p_critter_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_user_critter_id uuid;
  v_skill_id text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_user_game_state();

  if not exists (select 1 from public.starter_options where critter_id = p_critter_id and is_active) then
    raise exception 'Invalid starter critter';
  end if;

  if exists (select 1 from public.profiles where user_id = v_user_id and starter_selected_at is not null) then
    return;
  end if;

  insert into public.user_critters (user_id, critter_id)
  values (v_user_id, p_critter_id)
  on conflict (user_id, critter_id) do update set critter_id = excluded.critter_id
  returning id into v_user_critter_id;

  insert into public.user_seen_critters (user_id, critter_id)
  select v_user_id, critter_id
  from public.starter_options
  where is_active
  on conflict do nothing;

  for v_skill_id in
    select skill_id from public.critter_skill_unlocks
    where critter_id = p_critter_id and unlock_level = 1 and unlock_cost = 0
    order by sort_order
  loop
    insert into public.user_critter_skills (user_critter_id, skill_id)
    values (v_user_critter_id, v_skill_id)
    on conflict do nothing;
  end loop;

  select skill_id into v_skill_id
  from public.critter_skill_unlocks
  where critter_id = p_critter_id and unlock_level = 1 and unlock_cost = 0
  order by sort_order
  limit 1;

  insert into public.user_critter_skill_slots (user_critter_id, slot_index, skill_id)
  values
    (v_user_critter_id, 1, v_skill_id),
    (v_user_critter_id, 2, null),
    (v_user_critter_id, 3, null),
    (v_user_critter_id, 4, null)
  on conflict (user_critter_id, slot_index) do update set skill_id = excluded.skill_id;

  update public.user_squad_slots
  set user_critter_id = v_user_critter_id
  where user_id = v_user_id and slot_index = 1;

  update public.profiles
  set starter_selected_at = now(), updated_at = now()
  where user_id = v_user_id;
end;
$$;
