-- Collectible unlock authoring, tracked progress, currencies, and shop entries.
-- This migration targets the established Rollcasters schema and intentionally
-- seeds only the required system Coins currency from the existing UI asset.

create table if not exists public.currencies (
  id text primary key check (id ~ '^[A-Za-z0-9_-]+$'),
  name text not null check (btrim(name) <> ''),
  description text not null check (btrim(description) <> ''),
  asset_path text,
  is_default boolean not null default false,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default false,
  is_archived boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create unique index if not exists currencies_one_default_idx
  on public.currencies (is_default) where is_default and is_active and not is_archived;
create index if not exists currencies_catalog_idx on public.currencies (sort_order,id);

insert into public.currencies (
  id,name,description,asset_path,is_default,is_system,sort_order,is_active,is_archived,version
) values (
  'coins','Coins','The standard currency earned and spent throughout Rollcasters.',
  'ui/coins.png',true,true,0,true,false,1
)
on conflict (id) do update set
  name=excluded.name,
  description=excluded.description,
  asset_path=excluded.asset_path,
  is_default=true,
  is_system=true,
  is_active=true,
  is_archived=false,
  updated_at=now();

create table if not exists public.collectible_unlock_requirements (
  collectible_type text not null check (collectible_type in ('critter','rollcaster','relic')),
  collectible_id text not null,
  required_challenges integer not null default 0 check (required_challenges >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (collectible_type,collectible_id)
);

create table if not exists public.collectible_unlock_challenges (
  id uuid primary key default gen_random_uuid(),
  collectible_type text not null check (collectible_type in ('critter','rollcaster','relic')),
  collectible_id text not null,
  challenge_type text not null check (challenge_type in (
    'own_collectible','level_up_critter','knock_out_critters','deal_damage',
    'take_damage','use_skill','shop_shards','shop_relic'
  )),
  target_category text check (target_category is null or target_category in ('critter','rollcaster','relic')),
  target_id text,
  target_mode text check (target_mode is null or target_mode in ('species','element','skill')),
  any_target boolean not null default false,
  target_ids text[] not null default '{}',
  required_amount bigint check (required_amount is null or required_amount > 0),
  required_level integer check (required_level is null or required_level > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (collectible_type,collectible_id)
    references public.collectible_unlock_requirements(collectible_type,collectible_id)
    on update cascade on delete cascade
);

create index if not exists collectible_unlock_challenges_owner_idx
  on public.collectible_unlock_challenges (collectible_type,collectible_id,sort_order,id);
create unique index if not exists collectible_unlock_one_shop_method_idx
  on public.collectible_unlock_challenges (collectible_type,collectible_id,challenge_type)
  where challenge_type in ('shop_shards','shop_relic');

create table if not exists public.shop_entries (
  id uuid primary key default gen_random_uuid(),
  shop_type text not null check (shop_type in ('shard','relic')),
  name text not null check (btrim(name) <> ''),
  description text not null check (btrim(description) <> ''),
  target_category text not null check (target_category in ('critter','rollcaster','relic')),
  target_id text not null,
  quantity integer not null check (quantity > 0),
  currency_id text not null references public.currencies(id) on update cascade,
  price bigint not null check (price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default false,
  is_archived boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists shop_entries_catalog_idx on public.shop_entries (shop_type,sort_order,id);
create index if not exists shop_entries_target_idx on public.shop_entries (target_category,target_id,shop_type);

create or replace function public.collectible_exists(p_type text,p_id text)
returns boolean language plpgsql stable set search_path=public as $$
begin
  if p_type='critter' then return exists(select 1 from public.critters where id=p_id); end if;
  if p_type='rollcaster' then return exists(select 1 from public.rollcasters where id=p_id); end if;
  if p_type='relic' then return exists(select 1 from public.relics where id=p_id); end if;
  return false;
end; $$;

create or replace function public.validate_collectible_unlock_challenge()
returns trigger language plpgsql set search_path=public as $$
declare
  v_id text;
  v_max_owned integer;
begin
  if not public.collectible_exists(new.collectible_type,new.collectible_id) then
    raise exception 'VALIDATION: unlock challenge owner does not exist';
  end if;

  if new.challenge_type='own_collectible' then
    if new.target_category is null or new.target_id is null or not public.collectible_exists(new.target_category,new.target_id) then
      raise exception 'VALIDATION: Own Collectible requires an existing collectible target';
    end if;
    if new.target_category=new.collectible_type and new.target_id=new.collectible_id then
      raise exception 'VALIDATION: a collectible cannot require itself';
    end if;
    new.required_amount:=case when new.target_category='relic' then coalesce(new.required_amount,1) else 1 end;
    if new.target_category='relic' then
      select max_owned into v_max_owned from public.relics where id=new.target_id;
      if new.required_amount>v_max_owned then raise exception 'VALIDATION: required Relic ownership exceeds max_owned'; end if;
    end if;
    new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_level:=null;
  elsif new.challenge_type='level_up_critter' then
    if new.target_id is null or not exists(select 1 from public.critters where id=new.target_id) then
      raise exception 'VALIDATION: Level Up Critter requires an existing Critter';
    end if;
    if new.collectible_type='critter' and new.target_id=new.collectible_id then
      raise exception 'VALIDATION: a locked Critter cannot require its own level';
    end if;
    if coalesce(new.required_level,0)<1 then raise exception 'VALIDATION: required level must be positive'; end if;
    new.target_category:=null; new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_amount:=null;
  elsif new.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill') then
    if new.challenge_type='use_skill' and new.target_mode not in ('skill','element') then
      raise exception 'VALIDATION: Use Skill mode must be Skill or Element';
    end if;
    if new.challenge_type<>'use_skill' and new.target_mode not in ('species','element') then
      raise exception 'VALIDATION: Critter tracking mode must be Species or Element';
    end if;
    if not new.any_target and cardinality(new.target_ids)=0 then
      raise exception 'VALIDATION: tracked challenge requires targets when Any is disabled';
    end if;
    if coalesce(new.required_amount,0)<1 then raise exception 'VALIDATION: tracked amount must be positive'; end if;
    foreach v_id in array new.target_ids loop
      if new.target_mode='species' and not exists(select 1 from public.critters where id=v_id) then raise exception 'VALIDATION: unknown Critter species %',v_id; end if;
      if new.target_mode='element' and not exists(select 1 from public.elements where id=v_id) then raise exception 'VALIDATION: unknown Element %',v_id; end if;
      if new.target_mode='skill' and not exists(select 1 from public.skills where id=v_id) then raise exception 'VALIDATION: unknown Skill %',v_id; end if;
    end loop;
    if new.any_target then new.target_ids:='{}'; end if;
    new.target_category:=null; new.target_id:=null; new.required_level:=null;
  elsif new.challenge_type='shop_shards' then
    if coalesce(new.required_amount,0)<1 then raise exception 'VALIDATION: Shop Shards amount must be positive'; end if;
    new.target_category:=null; new.target_id:=null; new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_level:=null;
  elsif new.challenge_type='shop_relic' then
    if new.collectible_type<>'relic' then raise exception 'VALIDATION: Shop Relic is valid only for Relics'; end if;
    select max_owned into v_max_owned from public.relics where id=new.collectible_id;
    if coalesce(new.required_amount,0)<1 or new.required_amount>v_max_owned then
      raise exception 'VALIDATION: Shop Relic amount must be between 1 and max_owned';
    end if;
    new.target_category:=null; new.target_id:=null; new.target_mode:=null; new.any_target:=false; new.target_ids:='{}'; new.required_level:=null;
  end if;
  new.updated_at:=now();
  return new;
end; $$;

drop trigger if exists validate_collectible_unlock_challenge on public.collectible_unlock_challenges;
create trigger validate_collectible_unlock_challenge
before insert or update on public.collectible_unlock_challenges
for each row execute function public.validate_collectible_unlock_challenge();

create or replace function public.validate_shop_entry()
returns trigger language plpgsql set search_path=public as $$
declare v_max_owned integer;
begin
  if not public.collectible_exists(new.target_category,new.target_id) then raise exception 'VALIDATION: shop product does not exist'; end if;
  if new.shop_type='relic' and new.target_category<>'relic' then raise exception 'VALIDATION: Relic Shop entries must target a Relic'; end if;
  if new.shop_type='relic' then
    select max_owned into v_max_owned from public.relics where id=new.target_id;
    if new.quantity>v_max_owned then raise exception 'VALIDATION: Relic Shop quantity exceeds max_owned'; end if;
  end if;
  new.updated_at:=now();
  return new;
end; $$;

drop trigger if exists validate_shop_entry on public.shop_entries;
create trigger validate_shop_entry before insert or update on public.shop_entries
for each row execute function public.validate_shop_entry();

create or replace function public.replace_collectible_unlocks(p_type text,p_id text,p_collect jsonb)
returns void language plpgsql set search_path=public as $$
declare
  v_required integer:=coalesce((p_collect->>'requiredChallenges')::integer,0);
  v_challenge jsonb;
  v_order bigint;
  v_count integer;
  v_uuid uuid;
  v_ids uuid[]:='{}';
  v_existing_owner_type text;
  v_existing_owner_id text;
  v_before_definition jsonb;
  v_after_definition jsonb;
  v_affected_user uuid;
  v_affected_users uuid[]:='{}';
begin
  if p_type not in ('critter','rollcaster','relic') or not public.collectible_exists(p_type,p_id) then raise exception 'VALIDATION: invalid collectible owner'; end if;
  if p_collect is not null and jsonb_typeof(p_collect)<>'object' then raise exception 'VALIDATION: collect must be an object'; end if;
  if v_required<0 then raise exception 'VALIDATION: Required Challenges cannot be negative'; end if;
  if jsonb_typeof(coalesce(p_collect->'challenges','[]'::jsonb))<>'array' then raise exception 'VALIDATION: challenges must be an array'; end if;

  insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges,updated_at,updated_by)
  values(p_type,p_id,0,now(),auth.uid())
  on conflict(collectible_type,collectible_id) do update set required_challenges=0,updated_at=now(),updated_by=auth.uid();

  for v_challenge in select value from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) loop
    if nullif(v_challenge->>'id','') is null then raise exception 'VALIDATION: every challenge needs a stable ID'; end if;
    v_uuid:=(v_challenge->>'id')::uuid;
    if v_uuid=any(v_ids) then raise exception 'VALIDATION: challenge IDs must be unique'; end if;
    v_ids:=array_append(v_ids,v_uuid);
  end loop;
  select coalesce(array_agg(distinct t.user_id),'{}'::uuid[]) into v_affected_users
  from public.user_tracked_collectible_challenges t
  join public.collectible_unlock_challenges c on c.id=t.challenge_id
  where c.collectible_type=p_type and c.collectible_id=p_id and not (c.id=any(v_ids));
  delete from public.collectible_unlock_challenges
  where collectible_type=p_type and collectible_id=p_id and not (id=any(v_ids));
  foreach v_affected_user in array v_affected_users loop
    perform public.compact_user_tracking_slots(v_affected_user);
  end loop;

  for v_challenge,v_order in
    select value,ordinality from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) with ordinality
  loop
    v_uuid:=(v_challenge->>'id')::uuid;
    select collectible_type,collectible_id,
      to_jsonb(c)-'created_at'-'updated_at'-'sort_order'
      into v_existing_owner_type,v_existing_owner_id,v_before_definition
    from public.collectible_unlock_challenges c where id=v_uuid for update;
    if v_existing_owner_type is not null and (v_existing_owner_type<>p_type or v_existing_owner_id<>p_id) then
      raise exception 'VALIDATION: a challenge ID cannot move to another collectible';
    end if;
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,target_category,target_id,target_mode,
      any_target,target_ids,required_amount,required_level,sort_order
    ) values (
      v_uuid,p_type,p_id,v_challenge->>'type',nullif(v_challenge->>'targetCategory',''),nullif(v_challenge->>'targetId',''),nullif(v_challenge->>'targetMode',''),
      coalesce((v_challenge->>'anyTarget')::boolean,false),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_challenge->'targetIds','[]'::jsonb))),'{}'),
      nullif(v_challenge->>'requiredAmount','')::bigint,nullif(v_challenge->>'requiredLevel','')::integer,(v_order-1)::integer
    ) on conflict(id) do update set
      challenge_type=excluded.challenge_type,target_category=excluded.target_category,target_id=excluded.target_id,
      target_mode=excluded.target_mode,any_target=excluded.any_target,target_ids=excluded.target_ids,
      required_amount=excluded.required_amount,required_level=excluded.required_level,sort_order=excluded.sort_order,updated_at=now();
    select to_jsonb(c)-'created_at'-'updated_at'-'sort_order' into v_after_definition
    from public.collectible_unlock_challenges c where id=v_uuid;
    if v_before_definition is not null and v_before_definition is distinct from v_after_definition then
      for v_affected_user in select user_id from public.user_tracked_collectible_challenges where challenge_id=v_uuid loop
        delete from public.user_tracked_collectible_challenges where user_id=v_affected_user and challenge_id=v_uuid;
        perform public.compact_user_tracking_slots(v_affected_user);
      end loop;
      delete from public.user_collectible_challenge_progress where challenge_id=v_uuid;
    end if;
    v_existing_owner_type:=null; v_existing_owner_id:=null; v_before_definition:=null; v_after_definition:=null;
  end loop;

  select count(*) into v_count from public.collectible_unlock_challenges where collectible_type=p_type and collectible_id=p_id;
  if v_required>v_count then raise exception 'VALIDATION: Required Challenges cannot exceed configured challenges'; end if;
  update public.collectible_unlock_requirements set required_challenges=v_required,updated_at=now(),updated_by=auth.uid()
  where collectible_type=p_type and collectible_id=p_id;
end; $$;

create or replace function public.collectible_unlock_snapshot(p_type text,p_id text)
returns jsonb language sql stable set search_path=public as $$
  select jsonb_build_object(
    'requiredChallenges',coalesce(r.required_challenges,0),
    'challenges',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'type',c.challenge_type,'targetCategory',c.target_category,'targetId',c.target_id,
        'targetMode',c.target_mode,'anyTarget',c.any_target,'targetIds',c.target_ids,
        'requiredAmount',c.required_amount,'requiredLevel',c.required_level,'sortOrder',c.sort_order
      ) order by c.sort_order,c.id)
      from public.collectible_unlock_challenges c
      where c.collectible_type=p_type and c.collectible_id=p_id
    ),'[]'::jsonb)
  )
  from (select 1) seed
  left join public.collectible_unlock_requirements r on r.collectible_type=p_type and r.collectible_id=p_id;
$$;

create or replace function public.admin_save_critter(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int; v_row jsonb; v_prev jsonb;
begin
  if coalesce((payload->'fields'->>'baseHp')::int,0)<1 or coalesce((payload->'fields'->>'diceMin')::int,0)<1 or (payload->'fields'->>'diceMax')::int<(payload->'fields'->>'diceMin')::int then raise exception 'VALIDATION: invalid base stats'; end if;
  select to_jsonb(c)||jsonb_build_object('collect',public.collectible_unlock_snapshot('critter',v_id)),version into v_before,v_version from public.critters c where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.critters(id,name,description,element_id,base_hp,base_atk,base_def,base_spd,base_dice_min,base_dice_max,base_block_cost,base_swap_cost,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',payload->>'elementId',(payload->'fields'->>'baseHp')::int,(payload->'fields'->>'baseAtk')::int,(payload->'fields'->>'baseDef')::int,(payload->'fields'->>'baseSpd')::int,(payload->'fields'->>'diceMin')::int,(payload->'fields'->>'diceMax')::int,(payload->'fields'->>'blockCost')::int,(payload->'fields'->>'swapCost')::int,payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,element_id=excluded.element_id,base_hp=excluded.base_hp,base_atk=excluded.base_atk,base_def=excluded.base_def,base_spd=excluded.base_spd,base_dice_min=excluded.base_dice_min,base_dice_max=excluded.base_dice_max,base_block_cost=excluded.base_block_cost,base_swap_cost=excluded.base_swap_cost,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=critters.version+1,updated_at=now(),updated_by=v_user;
  delete from public.critter_skill_unlocks where critter_id=v_id;
  insert into public.critter_skill_unlocks(critter_id,skill_id,unlock_level,unlock_cost,is_default,sort_order)
  select v_id,u->>'refId',(u->>'level')::int,(u->>'cost')::int,coalesce((u->>'isDefault')::boolean,false),ordinality-1 from jsonb_array_elements(coalesce(payload->'unlocks','[]'::jsonb)) with ordinality x(u,ordinality);
  delete from public.critter_level_progression where critter_id=v_id;
  v_prev:=null;
  for v_row in select value from jsonb_array_elements(coalesce(payload->'levels','[]'::jsonb)) loop
    insert into public.critter_level_progression(critter_id,level,total_required_xp,grant_skill_points,hp_delta,atk_delta,def_delta,spd_delta,dice_min_delta,dice_max_delta,block_cost_delta,swap_cost_delta,total_unlocked_relic_slots)
    values(v_id,(v_row->>'level')::int,(v_row->>'xp')::int,(v_row->>'points')::int,
      case when v_prev is null then 0 else (v_row->>'hp')::int-(v_prev->>'hp')::int end,case when v_prev is null then 0 else (v_row->>'atk')::int-(v_prev->>'atk')::int end,
      case when v_prev is null then 0 else (v_row->>'def')::int-(v_prev->>'def')::int end,case when v_prev is null then 0 else (v_row->>'spd')::int-(v_prev->>'spd')::int end,
      case when v_prev is null then 0 else (v_row->>'diceMin')::int-(v_prev->>'diceMin')::int end,case when v_prev is null then 0 else (v_row->>'diceMax')::int-(v_prev->>'diceMax')::int end,
      case when v_prev is null then 0 else (v_row->>'block')::int-(v_prev->>'block')::int end,case when v_prev is null then 0 else (v_row->>'swap')::int-(v_prev->>'swap')::int end,(v_row->>'slots')::int);
    v_prev:=v_row;
  end loop;
  perform public.replace_collectible_unlocks('critter',v_id,coalesce(payload->'collect','{}'::jsonb));
  select to_jsonb(c)||jsonb_build_object('collect',public.collectible_unlock_snapshot('critter',v_id)) into v_after from public.critters c where id=v_id;
  perform public.admin_write_audit('critter',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_rollcaster(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  select to_jsonb(r)||jsonb_build_object('collect',public.collectible_unlock_snapshot('rollcaster',v_id)),version into v_before,v_version from public.rollcasters r where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.rollcasters(id,name,description,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=rollcasters.version+1,updated_at=now(),updated_by=v_user;
  delete from public.rollcaster_level_progression where rollcaster_id=v_id;
  insert into public.rollcaster_level_progression(rollcaster_id,level,total_required_xp,grant_ability_points,total_unlocked_ability_slots)
  select v_id,(l->>'level')::int,(l->>'xp')::int,(l->>'points')::int,(l->>'slots')::int from jsonb_array_elements(coalesce(payload->'levels','[]'::jsonb)) l;
  delete from public.rollcaster_ability_unlocks where rollcaster_id=v_id;
  insert into public.rollcaster_ability_unlocks(rollcaster_id,ability_id,unlock_level,unlock_cost,is_default,sort_order)
  select v_id,u->>'refId',(u->>'level')::int,(u->>'cost')::int,coalesce((u->>'isDefault')::boolean,false),ordinality-1 from jsonb_array_elements(coalesce(payload->'unlocks','[]'::jsonb)) with ordinality x(u,ordinality);
  perform public.replace_collectible_unlocks('rollcaster',v_id,coalesce(payload->'collect','{}'::jsonb));
  select to_jsonb(r)||jsonb_build_object('collect',public.collectible_unlock_snapshot('rollcaster',v_id)) into v_after from public.rollcasters r where id=v_id;
  perform public.admin_write_audit('rollcaster',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $$;

create or replace function public.admin_save_relic(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  if coalesce((payload->'fields'->>'maxOwned')::int,0)<1 then raise exception 'VALIDATION: max owned must be positive'; end if;
  select to_jsonb(r)||jsonb_build_object('effects',public.inline_effects_snapshot('relic',v_id),'collect',public.collectible_unlock_snapshot('relic',v_id)),version into v_before,v_version from public.relics r where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.relics(id,name,description,max_owned,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',(payload->'fields'->>'maxOwned')::int,payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,max_owned=excluded.max_owned,asset_path=excluded.asset_path,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=relics.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('relic',v_id,payload->'effects');
  perform public.replace_collectible_unlocks('relic',v_id,coalesce(payload->'collect','{}'::jsonb));
  select to_jsonb(r)||jsonb_build_object('effects',public.inline_effects_snapshot('relic',v_id),'collect',public.collectible_unlock_snapshot('relic',v_id)) into v_after from public.relics r where id=v_id;
  perform public.admin_write_audit('relic',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_save_currency(payload jsonb,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version integer;
begin
  if v_id is null or v_id!~'^[A-Za-z0-9_-]+$' or nullif(btrim(payload->>'name'),'') is null or nullif(btrim(payload->>'description'),'') is null then raise exception 'VALIDATION: invalid Currency identity'; end if;
  select to_jsonb(c),version into v_before,v_version from public.currencies c where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.currencies(id,name,description,asset_path,is_default,is_system,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',nullif(payload->>'assetPath',''),coalesce((payload->'fields'->>'isDefault')::boolean,false),v_id='coins',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,asset_path=excluded.asset_path,is_default=case when currencies.id='coins' then true else excluded.is_default end,is_system=currencies.is_system or excluded.is_system,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=currencies.version+1,updated_at=now(),updated_by=v_user;
  select to_jsonb(c) into v_after from public.currencies c where id=v_id;
  perform public.admin_write_audit('currency',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_save_shop_entry(payload jsonb,expected_version integer,p_shop_type text)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id uuid:=(payload->>'id')::uuid; v_version integer; v_existing_type text; v_category text:=payload->'fields'->>'targetCategory';
begin
  if p_shop_type not in ('shard','relic') then raise exception 'VALIDATION: invalid shop type'; end if;
  if p_shop_type='relic' then v_category:='relic'; end if;
  select to_jsonb(s),version,shop_type into v_before,v_version,v_existing_type from public.shop_entries s where id=v_id for update;
  if found and v_existing_type<>p_shop_type then raise exception 'VALIDATION: shop entry type cannot change'; end if;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.shop_entries(id,shop_type,name,description,target_category,target_id,quantity,currency_id,price,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,p_shop_type,payload->>'name',payload->>'description',v_category,payload->'fields'->>'targetId',(payload->'fields'->>'quantity')::integer,payload->'fields'->>'currencyId',(payload->'fields'->>'price')::bigint,coalesce((payload->>'sortOrder')::integer,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,target_category=excluded.target_category,target_id=excluded.target_id,quantity=excluded.quantity,currency_id=excluded.currency_id,price=excluded.price,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=shop_entries.version+1,updated_at=now(),updated_by=v_user;
  select to_jsonb(s) into v_after from public.shop_entries s where id=v_id;
  perform public.admin_write_audit(p_shop_type||'_shop_entry',v_id::text,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;

create or replace function public.admin_save_relic_shop_entry(payload jsonb,expected_version integer)
returns jsonb language sql security definer set search_path=public,auth as $$ select public.admin_save_shop_entry(payload,expected_version,'relic') $$;
create or replace function public.admin_save_shard_shop_entry(payload jsonb,expected_version integer)
returns jsonb language sql security definer set search_path=public,auth as $$ select public.admin_save_shop_entry(payload,expected_version,'shard') $$;

create or replace function public.admin_delete_content(entity_type text,entity_id text,expected_version integer)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' when 'asset' then 'game_assets' when 'currency' then 'currencies' when 'relic_shop_entry' then 'shop_entries' when 'shard_shop_entry' then 'shop_entries' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','statuses','elements','dungeons','game_assets','currencies','shop_entries') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  if entity_type='currency' and entity_id='coins' then raise exception 'VALIDATION: the system Coins currency cannot be deleted'; end if;
  if v_table='game_assets' then execute 'select to_jsonb(t),1 from public.game_assets t where id::text=$1 for update' into v_before,v_version using entity_id;
  else execute format('select to_jsonb(t),version from public.%I t where id::text=$1 for update',v_table) into v_before,v_version using entity_id; end if;
  if v_before is null then raise exception 'NOT_FOUND'; end if;
  if entity_type='relic_shop_entry' and v_before->>'shop_type'<>'relic' then raise exception 'NOT_FOUND'; end if;
  if entity_type='shard_shop_entry' and v_before->>'shop_type'<>'shard' then raise exception 'NOT_FOUND'; end if;
  if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('delete from public.%I where id::text=$1',v_table) using entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'delete',v_version,null,v_before,null); return jsonb_build_object('deleted',true,'entity_type',entity_type,'entity_id',entity_id);
end; $$;

create or replace function public.cascade_collectible_catalog_id()
returns trigger language plpgsql set search_path=public as $$
declare v_type text:=tg_argv[0];
begin
  if new.id=old.id then return new; end if;
  update public.collectible_unlock_requirements set collectible_id=new.id where collectible_type=v_type and collectible_id=old.id;
  update public.collectible_unlock_challenges set target_id=new.id where challenge_type='own_collectible' and target_category=v_type and target_id=old.id;
  if v_type='critter' then
    update public.collectible_unlock_challenges set target_id=new.id where challenge_type='level_up_critter' and target_id=old.id;
    update public.collectible_unlock_challenges set target_ids=array_replace(target_ids,old.id,new.id) where target_mode='species' and old.id=any(target_ids);
  end if;
  update public.shop_entries set target_id=new.id where target_category=v_type and target_id=old.id;
  update public.user_collectible_shards set collectible_id=new.id where collectible_type=v_type and collectible_id=old.id;
  return new;
end; $$;

-- Player-owned normalized balances. Coins remain synchronized with profiles.coins
-- during the player-client transition; new currencies live only in this ledger.
create table if not exists public.user_currencies (
  user_id uuid not null references auth.users(id) on delete cascade,
  currency_id text not null references public.currencies(id) on update cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,currency_id)
);

create table if not exists public.user_collectible_shards (
  user_id uuid not null references auth.users(id) on delete cascade,
  collectible_type text not null check (collectible_type in ('critter','rollcaster','relic')),
  collectible_id text not null,
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,collectible_type,collectible_id)
);

create table if not exists public.user_collectible_challenge_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.collectible_unlock_challenges(id) on delete cascade,
  progress bigint not null default 0 check (progress >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(user_id,challenge_id)
);

create table if not exists public.user_tracked_collectible_challenges (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.collectible_unlock_challenges(id) on delete cascade,
  slot_order smallint not null check (slot_order between 1 and 3),
  tracked_at timestamptz not null default now(),
  primary key(user_id,challenge_id),
  unique(user_id,slot_order)
);

create or replace function public.cleanup_collectible_catalog_delete()
returns trigger language plpgsql set search_path=public as $$
declare v_type text:=tg_argv[0];
begin
  if exists(select 1 from public.collectible_unlock_challenges where challenge_type='own_collectible' and target_category=v_type and target_id=old.id)
    or (v_type='critter' and exists(select 1 from public.collectible_unlock_challenges where challenge_type='level_up_critter' and target_id=old.id))
    or (v_type='critter' and exists(select 1 from public.collectible_unlock_challenges where target_mode='species' and old.id=any(target_ids)))
    or exists(select 1 from public.shop_entries where target_category=v_type and target_id=old.id)
  then raise exception 'CONTENT_IN_USE: collectible is referenced by an unlock challenge or shop entry'; end if;
  delete from public.collectible_unlock_requirements where collectible_type=v_type and collectible_id=old.id;
  delete from public.user_collectible_shards where collectible_type=v_type and collectible_id=old.id;
  return old;
end; $$;

drop trigger if exists cleanup_critter_catalog_delete on public.critters;
drop trigger if exists cleanup_rollcaster_catalog_delete on public.rollcasters;
drop trigger if exists cleanup_relic_catalog_delete on public.relics;
create trigger cleanup_critter_catalog_delete before delete on public.critters for each row execute function public.cleanup_collectible_catalog_delete('critter');
create trigger cleanup_rollcaster_catalog_delete before delete on public.rollcasters for each row execute function public.cleanup_collectible_catalog_delete('rollcaster');
create trigger cleanup_relic_catalog_delete before delete on public.relics for each row execute function public.cleanup_collectible_catalog_delete('relic');

create or replace function public.validate_user_collectible_shards()
returns trigger language plpgsql set search_path=public as $$
begin
  if not public.collectible_exists(new.collectible_type,new.collectible_id) then raise exception 'VALIDATION: shard collectible does not exist'; end if;
  new.updated_at:=now(); return new;
end; $$;
drop trigger if exists validate_user_collectible_shards on public.user_collectible_shards;
create trigger validate_user_collectible_shards before insert or update on public.user_collectible_shards
for each row execute function public.validate_user_collectible_shards();

create or replace function public.validate_tracked_collectible_challenge()
returns trigger language plpgsql set search_path=public as $$
declare v_owner_type text; v_owner_id text; v_type text;
begin
  select collectible_type,collectible_id,challenge_type into v_owner_type,v_owner_id,v_type from public.collectible_unlock_challenges where id=new.challenge_id;
  if v_type not in ('knock_out_critters','deal_damage','take_damage','use_skill') then raise exception 'VALIDATION: only tracked challenge types can occupy a tracking slot'; end if;
  if exists(
    select 1 from public.user_tracked_collectible_challenges t
    join public.collectible_unlock_challenges c on c.id=t.challenge_id
    where t.user_id=new.user_id and c.collectible_type=v_owner_type and c.collectible_id=v_owner_id and t.challenge_id<>new.challenge_id
  ) then raise exception 'VALIDATION: only one tracked challenge is allowed per collectible'; end if;
  return new;
end; $$;
drop trigger if exists validate_tracked_collectible_challenge on public.user_tracked_collectible_challenges;
create trigger validate_tracked_collectible_challenge before insert or update on public.user_tracked_collectible_challenges
for each row execute function public.validate_tracked_collectible_challenge();

insert into public.user_currencies(user_id,currency_id,balance)
select user_id,'coins',greatest(coins,0)::bigint from public.profiles
on conflict(user_id,currency_id) do update set balance=excluded.balance,updated_at=now();

create or replace function public.sync_profile_coins_to_currency()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if pg_trigger_depth()>1 then return new; end if;
  insert into public.user_currencies(user_id,currency_id,balance,updated_at)
  values(new.user_id,'coins',greatest(new.coins,0),now())
  on conflict(user_id,currency_id) do update set balance=excluded.balance,updated_at=now();
  return new;
end; $$;
drop trigger if exists sync_profile_coins_to_currency on public.profiles;
create trigger sync_profile_coins_to_currency after insert or update of coins on public.profiles
for each row execute function public.sync_profile_coins_to_currency();

create or replace function public.sync_currency_coins_to_profile()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if pg_trigger_depth()>1 or new.currency_id<>'coins' then return new; end if;
  if new.balance>2147483647 then raise exception 'VALIDATION: Coins balance exceeds the legacy profiles.coins range'; end if;
  update public.profiles set coins=new.balance::integer,updated_at=now() where user_id=new.user_id and coins<>new.balance::integer;
  return new;
end; $$;
drop trigger if exists sync_currency_coins_to_profile on public.user_currencies;
create trigger sync_currency_coins_to_profile after insert or update of balance on public.user_currencies
for each row execute function public.sync_currency_coins_to_profile();

drop trigger if exists cascade_critter_catalog_id on public.critters;
drop trigger if exists cascade_rollcaster_catalog_id on public.rollcasters;
drop trigger if exists cascade_relic_catalog_id on public.relics;
create trigger cascade_critter_catalog_id after update of id on public.critters for each row execute function public.cascade_collectible_catalog_id('critter');
create trigger cascade_rollcaster_catalog_id after update of id on public.rollcasters for each row execute function public.cascade_collectible_catalog_id('rollcaster');
create trigger cascade_relic_catalog_id after update of id on public.relics for each row execute function public.cascade_collectible_catalog_id('relic');

create or replace function public.compact_user_tracking_slots(p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_entries jsonb;
begin
  select coalesce(
    jsonb_agg(jsonb_build_object('challenge_id',challenge_id,'tracked_at',tracked_at) order by slot_order,tracked_at),
    '[]'::jsonb
  ) into v_entries
  from public.user_tracked_collectible_challenges
  where user_id=p_user;

  delete from public.user_tracked_collectible_challenges where user_id=p_user;
  insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order,tracked_at)
  select p_user,(entry->>'challenge_id')::uuid,ordinality::smallint,(entry->>'tracked_at')::timestamptz
  from jsonb_array_elements(v_entries) with ordinality rows(entry,ordinality);
end; $$;

create or replace function public.track_collectible_challenge(p_challenge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_type text; v_id text; v_slot integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select collectible_type,collectible_id into v_type,v_id from public.collectible_unlock_challenges
  where id=p_challenge_id and challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill');
  if v_type is null then raise exception 'VALIDATION: challenge is not trackable'; end if;
  if exists(select 1 from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id) then
    select slot_order into v_slot from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id;
    return jsonb_build_object('challenge_id',p_challenge_id,'slot_order',v_slot);
  end if;
  delete from public.user_tracked_collectible_challenges t using public.collectible_unlock_challenges c
  where t.user_id=v_user and t.challenge_id=c.id and c.collectible_type=v_type and c.collectible_id=v_id;
  select slot into v_slot from generate_series(1,3) slot where not exists(select 1 from public.user_tracked_collectible_challenges where user_id=v_user and slot_order=slot) order by slot limit 1;
  if v_slot is null then raise exception 'TRACKING_LIMIT_REACHED'; end if;
  insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order) values(v_user,p_challenge_id,v_slot);
  return jsonb_build_object('challenge_id',p_challenge_id,'slot_order',v_slot);
end; $$;

create or replace function public.untrack_collectible_challenge(p_challenge_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id;
  perform public.compact_user_tracking_slots(v_user);
end;
$$;

create or replace function public.purchase_shop_entry(p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_entry public.shop_entries%rowtype; v_balance bigint; v_current bigint:=0;
  v_required bigint; v_granted bigint; v_discarded bigint:=0; v_max_owned integer; v_unlocked boolean:=false;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.ensure_user_game_state();
  select * into v_entry from public.shop_entries where id=p_entry_id and is_active and not is_archived for update;
  if not found then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  select balance into v_balance from public.user_currencies where user_id=v_user and currency_id=v_entry.currency_id for update;
  v_balance:=coalesce(v_balance,0);
  if v_balance<v_entry.price then raise exception 'INSUFFICIENT_FUNDS'; end if;

  if v_entry.shop_type='shard' then
    if v_entry.target_category='critter' then select exists(select 1 from public.user_critters where user_id=v_user and critter_id=v_entry.target_id) into v_unlocked;
    elsif v_entry.target_category='rollcaster' then select exists(select 1 from public.user_rollcasters where user_id=v_user and rollcaster_id=v_entry.target_id) into v_unlocked;
    else select exists(select 1 from public.user_relic_inventory where user_id=v_user and relic_id=v_entry.target_id and discovered_at is not null) into v_unlocked; end if;
    if v_unlocked then raise exception 'COLLECTIBLE_ALREADY_UNLOCKED'; end if;
    select required_amount into v_required from public.collectible_unlock_challenges where collectible_type=v_entry.target_category and collectible_id=v_entry.target_id and challenge_type='shop_shards';
    if v_required is null then raise exception 'SHOP_SHARDS_CHALLENGE_MISSING'; end if;
    select quantity into v_current from public.user_collectible_shards where user_id=v_user and collectible_type=v_entry.target_category and collectible_id=v_entry.target_id for update;
    v_current:=coalesce(v_current,0);
    if v_current>=v_required then raise exception 'SHOP_SHARDS_CHALLENGE_COMPLETE'; end if;
    v_granted:=least(v_entry.quantity::bigint,v_required-v_current); v_discarded:=v_entry.quantity-v_granted;
    insert into public.user_collectible_shards(user_id,collectible_type,collectible_id,quantity,updated_at)
    values(v_user,v_entry.target_category,v_entry.target_id,v_current+v_granted,now())
    on conflict(user_id,collectible_type,collectible_id) do update set quantity=excluded.quantity,updated_at=now();
  else
    select max_owned into v_max_owned from public.relics where id=v_entry.target_id for update;
    select quantity,discovered_at is not null into v_current,v_unlocked from public.user_relic_inventory where user_id=v_user and relic_id=v_entry.target_id for update;
    v_current:=coalesce(v_current,0);
    if not coalesce(v_unlocked,false) and not exists(select 1 from public.collectible_unlock_challenges where collectible_type='relic' and collectible_id=v_entry.target_id and challenge_type='shop_relic') then raise exception 'SHOP_RELIC_CHALLENGE_MISSING'; end if;
    if v_current+v_entry.quantity>v_max_owned then raise exception 'RELIC_MAX_OWNED_REACHED'; end if;
    v_granted:=v_entry.quantity;
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values(v_user,v_entry.target_id,v_current+v_granted,case when v_unlocked then now() else null end)
    on conflict(user_id,relic_id) do update set quantity=excluded.quantity,discovered_at=coalesce(public.user_relic_inventory.discovered_at,excluded.discovered_at);
  end if;

  insert into public.user_currencies(user_id,currency_id,balance,updated_at)
  values(v_user,v_entry.currency_id,v_balance-v_entry.price,now())
  on conflict(user_id,currency_id) do update set balance=excluded.balance,updated_at=now();
  return jsonb_build_object('entry_id',p_entry_id,'currency_id',v_entry.currency_id,'balance',v_balance-v_entry.price,'granted',v_granted,'discarded',v_discarded);
end; $$;

alter table public.currencies enable row level security;
alter table public.collectible_unlock_requirements enable row level security;
alter table public.collectible_unlock_challenges enable row level security;
alter table public.shop_entries enable row level security;
alter table public.user_currencies enable row level security;
alter table public.user_collectible_shards enable row level security;
alter table public.user_collectible_challenge_progress enable row level security;
alter table public.user_tracked_collectible_challenges enable row level security;

drop policy if exists currencies_read_all on public.currencies;
drop policy if exists collectible_unlock_requirements_read_all on public.collectible_unlock_requirements;
drop policy if exists collectible_unlock_challenges_read_all on public.collectible_unlock_challenges;
drop policy if exists shop_entries_read_all on public.shop_entries;
drop policy if exists user_currencies_read_own on public.user_currencies;
drop policy if exists user_collectible_shards_read_own on public.user_collectible_shards;
drop policy if exists user_collectible_challenge_progress_read_own on public.user_collectible_challenge_progress;
drop policy if exists user_tracked_collectible_challenges_read_own on public.user_tracked_collectible_challenges;
create policy currencies_read_all on public.currencies for select using(true);
create policy collectible_unlock_requirements_read_all on public.collectible_unlock_requirements for select using(true);
create policy collectible_unlock_challenges_read_all on public.collectible_unlock_challenges for select using(true);
create policy shop_entries_read_all on public.shop_entries for select using(true);
create policy user_currencies_read_own on public.user_currencies for select using(auth.uid()=user_id);
create policy user_collectible_shards_read_own on public.user_collectible_shards for select using(auth.uid()=user_id);
create policy user_collectible_challenge_progress_read_own on public.user_collectible_challenge_progress for select using(auth.uid()=user_id);
create policy user_tracked_collectible_challenges_read_own on public.user_tracked_collectible_challenges for select using(auth.uid()=user_id);

grant select on public.currencies,public.collectible_unlock_requirements,public.collectible_unlock_challenges,public.shop_entries to anon,authenticated;
grant select on public.user_currencies,public.user_collectible_shards,public.user_collectible_challenge_progress,public.user_tracked_collectible_challenges to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.currencies,public.collectible_unlock_requirements,public.collectible_unlock_challenges,public.shop_entries from anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on public.user_currencies,public.user_collectible_shards,public.user_collectible_challenge_progress,public.user_tracked_collectible_challenges from anon,authenticated;

revoke all on function public.collectible_exists(text,text) from public;
revoke all on function public.validate_collectible_unlock_challenge() from public;
revoke all on function public.validate_shop_entry() from public;
revoke all on function public.cleanup_collectible_catalog_delete() from public;
revoke all on function public.replace_collectible_unlocks(text,text,jsonb) from public;
revoke all on function public.collectible_unlock_snapshot(text,text) from public;
revoke all on function public.admin_save_currency(jsonb,integer) from public;
revoke all on function public.admin_save_shop_entry(jsonb,integer,text) from public;
revoke all on function public.admin_save_relic_shop_entry(jsonb,integer) from public;
revoke all on function public.admin_save_shard_shop_entry(jsonb,integer) from public;
revoke all on function public.compact_user_tracking_slots(uuid) from public;
revoke all on function public.track_collectible_challenge(uuid) from public;
revoke all on function public.untrack_collectible_challenge(uuid) from public;
revoke all on function public.purchase_shop_entry(uuid) from public;
grant execute on function public.admin_save_critter(jsonb,integer),public.admin_save_rollcaster(jsonb,integer),public.admin_save_relic(jsonb,integer),public.admin_save_currency(jsonb,integer),public.admin_save_relic_shop_entry(jsonb,integer),public.admin_save_shard_shop_entry(jsonb,integer) to authenticated;
grant execute on function public.track_collectible_challenge(uuid),public.untrack_collectible_challenge(uuid),public.purchase_shop_entry(uuid) to authenticated;
