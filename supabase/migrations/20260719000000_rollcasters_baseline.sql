-- Rollcasters Supabase baseline.
--
-- Generated from the live public schema on 2026-07-19. This is the source of
-- truth for fresh environments; it is not intended to be run over an existing
-- Rollcasters schema.
--
-- The data section contains reusable game catalog/configuration rows only.
-- Auth users, player-owned state, audit history, runtime journals, receipts,
-- redemptions, and operational promo-code definitions are intentionally absent.

create extension if not exists pgcrypto with schema extensions;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'game-assets',
  'game-assets',
  true,
  5242880,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml'
  ]::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists game_assets_public_read on storage.objects;
create policy game_assets_public_read
on storage.objects
for select
using (bucket_id = 'game-assets');

-- Fresh Supabase projects may preconfigure partial table privileges for API
-- roles. Clear those defaults before creating public tables so the explicit
-- live-database ACLs later in this file are restored exactly.
alter default privileges for role postgres in schema public
revoke all on tables from anon, authenticated;

--
-- PostgreSQL database dump
--

-- \restrict ZE8OqG8hm7LSTHjZNRxM2WVpUx9dhafRIVZywcucQpkL9FA8mCaGrUYdQweBHIV

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: acknowledge_collectible_unlock_event("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."acknowledge_collectible_unlock_event"("p_event_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.user_collectible_unlock_events set acknowledged_at=coalesce(acknowledged_at,now())
  where id=p_event_id and user_id=v_user;
end; $$;


ALTER FUNCTION "public"."acknowledge_collectible_unlock_event"("p_event_id" "uuid") OWNER TO "postgres";

--
-- Name: admin_archive_content("text", "text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_archive_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_after jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','statuses','elements','dungeons') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  execute format('select to_jsonb(t),version from public.%I t where id=$1 for update',v_table) into v_before,v_version using entity_id;
  if v_before is null then raise exception 'NOT_FOUND'; end if; if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('update public.%I set is_active=false,is_archived=true,version=version+1,updated_at=now(),updated_by=$1 where id=$2 returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_user,entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'archive',v_version,v_version+1,v_before,v_after); return v_after;
end; $_$;


ALTER FUNCTION "public"."admin_archive_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_content_usage("text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_content_usage"("entity_type" "text", "entity_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_user uuid:=public.assert_content_admin(); v_result jsonb:='[]'::jsonb;
begin
  if entity_type='skill' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'critter' entity_type,critter_id entity_id from public.critter_skill_unlocks where skill_id=admin_content_usage.entity_id
      union all select 'dungeon_opponent',opponent_id::text from public.dungeon_opponent_skills where skill_id=admin_content_usage.entity_id
    ) x;
  elsif entity_type='status' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'skill' entity_type,skill_id entity_id from public.skill_effects where parameters->>'status_id'=admin_content_usage.entity_id
    ) x;
  elsif entity_type='element' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'critter' entity_type,id entity_id from public.critters where element_1_id=admin_content_usage.entity_id or element_2_id=admin_content_usage.entity_id
      union all select 'skill',id from public.skills where element_id=admin_content_usage.entity_id
      union all select 'ability',ability_id from public.ability_effects where parameters->'element_ids' ? admin_content_usage.entity_id
    ) x;
  elsif entity_type='critter' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'dungeon_opponent' entity_type,id::text entity_id from public.dungeon_opponents where critter_id=admin_content_usage.entity_id
      union all select 'dungeon_shard_drop',id::text from public.dungeon_opponent_item_drops where drop_type='shard' and target_category='critter' and target_id=admin_content_usage.entity_id
      union all select 'dungeon_completion_drop',id::text from public.dungeon_completion_drops where drop_type='shard' and target_category='critter' and target_id=admin_content_usage.entity_id
    ) x;
  elsif entity_type='rollcaster' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'dungeon_shard_drop' entity_type,id::text entity_id from public.dungeon_opponent_item_drops where drop_type='shard' and target_category='rollcaster' and target_id=admin_content_usage.entity_id
      union all select 'dungeon_completion_drop',id::text from public.dungeon_completion_drops where drop_type='shard' and target_category='rollcaster' and target_id=admin_content_usage.entity_id
    ) x;
  elsif entity_type='relic' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'dungeon_opponent' entity_type,opponent_id::text entity_id from public.dungeon_opponent_relics where relic_id=admin_content_usage.entity_id
      union all select 'dungeon_item_drop',id::text from public.dungeon_opponent_item_drops where target_category='relic' and target_id=admin_content_usage.entity_id
      union all select 'dungeon_completion_drop',id::text from public.dungeon_completion_drops where target_category='relic' and target_id=admin_content_usage.entity_id
    ) x;
  elsif entity_type='currency' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'dungeon_currency_drop' entity_type,id::text entity_id from public.dungeon_opponent_currency_drops where currency_id=admin_content_usage.entity_id
      union all select 'dungeon_item_dupe',id::text from public.dungeon_opponent_item_drops where dupe_currency_id=admin_content_usage.entity_id
      union all select 'dungeon_completion_drop',id::text from public.dungeon_completion_drops where target_id=admin_content_usage.entity_id or dupe_currency_id=admin_content_usage.entity_id
      union all select 'shop_entry',id::text from public.shop_entries where currency_id=admin_content_usage.entity_id
    ) x;
  elsif entity_type='dungeon' then
    select coalesce(jsonb_agg(x),'[]') into v_result from (
      select 'dungeon' entity_type,id entity_id from public.dungeons where next_dungeon_id=admin_content_usage.entity_id
    ) x;
  end if;
  return v_result;
end; $$;


ALTER FUNCTION "public"."admin_content_usage"("entity_type" "text", "entity_id" "text") OWNER TO "postgres";

--
-- Name: admin_delete_content("text", "text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_delete_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  v_user uuid:=public.assert_content_admin();
  v_table text;
  v_before jsonb;
  v_version integer;
  v_usage jsonb;
begin
  v_table:=case entity_type
    when 'ability' then 'rollcaster_abilities'
    when 'asset' then 'game_assets'
    when 'currency' then 'currencies'
    when 'relic_shop_entry' then 'shop_entries'
    when 'shard_shop_entry' then 'shop_entries'
    when 'promo_code' then 'promo_codes'
    else entity_type||'s'
  end;
  if v_table not in (
    'critters','rollcasters','relics','skills','rollcaster_abilities','statuses',
    'elements','dungeons','game_assets','currencies','shop_entries','promo_codes'
  ) then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  if entity_type='currency' and entity_id='coins' then
    raise exception 'VALIDATION: the system Coins currency cannot be deleted';
  end if;
  if v_table='game_assets' then
    execute 'select to_jsonb(t),1 from public.game_assets t where id::text=$1 for update'
    into v_before,v_version using entity_id;
  elsif v_table='promo_codes' then
    select public.promo_code_snapshot(id),version into v_before,v_version
    from public.promo_codes where id::text=entity_id for update;
  else
    execute format('select to_jsonb(t),version from public.%I t where id::text=$1 for update',v_table)
    into v_before,v_version using entity_id;
  end if;
  if v_before is null then raise exception 'NOT_FOUND'; end if;
  if entity_type='relic_shop_entry' and v_before->>'shop_type'<>'relic' then raise exception 'NOT_FOUND'; end if;
  if entity_type='shard_shop_entry' and v_before->>'shop_type'<>'shard' then raise exception 'NOT_FOUND'; end if;
  if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if entity_type='promo_code' and exists(
    select 1 from public.promo_code_redemptions where promo_code_id=entity_id::uuid
  ) then raise exception 'CONTENT_IN_USE: redeemed Promo Codes must be archived instead of deleted'; end if;
  if entity_type in ('critter','rollcaster','relic','skill','status','element','currency','dungeon') then
    v_usage:=public.admin_content_usage(entity_type,entity_id);
    if jsonb_array_length(v_usage)>0 then raise exception 'CONTENT_IN_USE: %',v_usage; end if;
  end if;
  execute format('delete from public.%I where id::text=$1',v_table) using entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'delete',v_version,null,v_before,null);
  return jsonb_build_object('deleted',true,'entity_type',entity_type,'entity_id',entity_id);
end;
$_$;


ALTER FUNCTION "public"."admin_delete_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_publish_content("text", "text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_publish_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare v_user uuid:=public.assert_content_admin(); v_table text; v_before jsonb; v_after jsonb; v_version int;
begin
  v_table:=case entity_type when 'ability' then 'rollcaster_abilities' else entity_type||'s' end;
  if v_table not in ('critters','rollcasters','relics','skills','rollcaster_abilities','statuses','elements','dungeons') then raise exception 'UNSUPPORTED_ENTITY_TYPE'; end if;
  execute format('select to_jsonb(t),version from public.%I t where id=$1 for update',v_table) into v_before,v_version using entity_id;
  if v_before is null then raise exception 'NOT_FOUND'; end if; if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  execute format('update public.%I set is_active=true,is_archived=false,version=version+1,updated_at=now(),updated_by=$1 where id=$2 returning to_jsonb(%I.*)',v_table,v_table) into v_after using v_user,entity_id;
  perform public.admin_write_audit(entity_type,entity_id,'publish',v_version,v_version+1,v_before,v_after); return v_after;
end; $_$;


ALTER FUNCTION "public"."admin_publish_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_reorder_catalog_ids("text", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  v_user uuid := public.assert_content_admin();
  v_table text;
  v_singular text;
  v_is_string_catalog boolean;
  v_actual_ids text[];
  v_requested_ids text[];
  v_temporary_ids text[] := '{}'::text[];
  v_before_snapshots jsonb[] := '{}'::jsonb[];
  v_total integer;
  v_requested_total integer;
  v_old_distinct integer;
  v_new_distinct integer;
  v_index integer;
  v_change jsonb;
  v_old_id text;
  v_new_id text;
  v_temporary_id text;
  v_requested_sort_order integer;
  v_before jsonb;
  v_after jsonb;
  v_id_changed boolean;
  v_sort_changed boolean;
  v_changed integer := 0;
  v_renamed integer := 0;
  v_reordered integer := 0;
begin
  v_table := case entity_type
    when 'critters' then 'critters'
    when 'rollcasters' then 'rollcasters'
    when 'relics' then 'relics'
    when 'abilities' then 'rollcaster_abilities'
    when 'skills' then 'skills'
    when 'statuses' then 'statuses'
    when 'elements' then 'elements'
    else null
  end;
  v_singular := case entity_type
    when 'critters' then 'critter'
    when 'rollcasters' then 'rollcaster'
    when 'relics' then 'relic'
    when 'abilities' then 'ability'
    when 'skills' then 'skill'
    when 'statuses' then 'status'
    when 'elements' then 'element'
    else null
  end;
  v_is_string_catalog := entity_type in ('abilities', 'skills', 'statuses', 'elements');

  if v_table is null then raise exception 'UNSUPPORTED_ID_EDITABLE_CATALOG'; end if;
  if jsonb_typeof(id_changes) is distinct from 'array' or jsonb_array_length(id_changes) = 0 then
    raise exception 'VALIDATION: ID changes are required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(id_changes) as item(value)
    where jsonb_typeof(value) is distinct from 'object'
  ) then
    raise exception 'VALIDATION: every ID change must be an object';
  end if;

  execute format(
    'select array_agg(id order by id), count(*) from (select id from public.%I for update) locked_rows',
    v_table
  ) into v_actual_ids, v_total;

  select
    array_agg(value->>'oldId' order by value->>'oldId'),
    count(*),
    count(distinct value->>'oldId'),
    count(distinct btrim(value->>'newId'))
  into v_requested_ids, v_requested_total, v_old_distinct, v_new_distinct
  from jsonb_array_elements(id_changes);

  if v_requested_total <> v_total or v_old_distinct <> v_total or v_requested_ids is distinct from v_actual_ids then
    raise exception 'VERSION_CONFLICT: the catalog changed; reload before editing IDs';
  end if;
  if v_new_distinct <> v_total then
    raise exception 'VALIDATION: duplicate new IDs are not allowed';
  end if;
  if exists (
    select 1 from jsonb_array_elements(id_changes) as item(value)
    where coalesce(btrim(value->>'newId'), '') = ''
       or btrim(value->>'newId') !~ '^[A-Za-z0-9_-]+$'
  ) then
    raise exception 'VALIDATION: IDs may use letters, numbers, hyphens, and underscores only';
  end if;
  if v_is_string_catalog and exists (
    select 1 from jsonb_array_elements(id_changes) as item(value)
    where coalesce(jsonb_typeof(value->'sortOrder'), '') <> 'number'
       or coalesce(value->>'sortOrder', '') !~ '^[0-9]+$'
  ) then
    raise exception 'VALIDATION: every string-ID record needs a non-negative whole-number sort order';
  end if;
  -- First move changed roots and non-FK live references into collision-free
  -- temporary IDs so swaps never overwrite one another.
  for v_change, v_index in
    select value, ordinality::integer
    from jsonb_array_elements(id_changes) with ordinality
  loop
    v_old_id := v_change->>'oldId';
    v_new_id := btrim(v_change->>'newId');
    execute format('select to_jsonb(t) from public.%I t where id=$1', v_table)
      into v_before using v_old_id;
    v_before_snapshots := array_append(v_before_snapshots, v_before);
    if v_old_id = v_new_id then
      v_temporary_ids := array_append(v_temporary_ids, v_old_id);
      continue;
    end if;

    v_temporary_id := '__id_reorder_' || replace(gen_random_uuid()::text, '-', '') || '_' || v_index::text;
    v_temporary_ids := array_append(v_temporary_ids, v_temporary_id);
    execute format('update public.%I set id=$1 where id=$2', v_table) using v_temporary_id, v_old_id;
    update public.game_assets
      set owner_id = v_temporary_id
      where owner_table = v_table and owner_id = v_old_id;

    if entity_type = 'relics' then
      update public.dungeon_opponents
        set relic_ids = array_replace(relic_ids, v_old_id, v_temporary_id)
        where v_old_id = any(relic_ids);
      update public.dungeon_opponents opponent
        set drops = (
          select jsonb_agg(case
            when item->>'relic_id' = v_old_id then jsonb_set(item, '{relic_id}', to_jsonb(v_temporary_id))
            else item
          end)
          from jsonb_array_elements(opponent.drops) item
        )
        where jsonb_typeof(opponent.drops) = 'array'
          and exists (select 1 from jsonb_array_elements(opponent.drops) item where item->>'relic_id' = v_old_id);
    elsif entity_type = 'skills' then
      update public.dungeon_opponents
        set skill_ids = array_replace(skill_ids, v_old_id, v_temporary_id)
        where v_old_id = any(skill_ids);
      update public.collectible_unlock_challenges
        set target_ids = array_replace(target_ids, v_old_id, v_temporary_id)
        where target_mode = 'skill' and v_old_id = any(target_ids);
    elsif entity_type = 'statuses' then
      update public.skill_effects
        set parameters = jsonb_set(parameters, '{status_id}', to_jsonb(v_temporary_id), false)
        where parameters->>'status_id' = v_old_id;
    elsif entity_type = 'elements' then
      update public.collectible_unlock_challenges
        set target_ids = array_replace(target_ids, v_old_id, v_temporary_id)
        where target_mode = 'element' and v_old_id = any(target_ids);
      update public.ability_effects effect
        set parameters = jsonb_set(
          effect.parameters,
          '{element_ids}',
          (
            select jsonb_agg(to_jsonb(case when item.value = v_old_id then v_temporary_id else item.value end) order by item.ordinality)
            from jsonb_array_elements_text(effect.parameters->'element_ids') with ordinality as item(value, ordinality)
          ),
          false
        )
        where jsonb_typeof(effect.parameters->'element_ids') = 'array'
          and effect.parameters->'element_ids' ? v_old_id;
    end if;
  end loop;

  -- Then assign requested IDs and string-catalog sort orders, incrementing and
  -- auditing every root record whose identity or order changed.
  for v_change, v_index in
    select value, ordinality::integer
    from jsonb_array_elements(id_changes) with ordinality
  loop
    v_old_id := v_change->>'oldId';
    v_new_id := btrim(v_change->>'newId');
    v_temporary_id := v_temporary_ids[v_index];
    v_before := v_before_snapshots[v_index];
    v_id_changed := v_old_id <> v_new_id;
    v_requested_sort_order := case
      when v_is_string_catalog then (v_change->>'sortOrder')::integer
      else v_index - 1
    end;
    v_sort_changed := v_is_string_catalog
      and (v_before->>'sort_order')::integer is distinct from v_requested_sort_order;

    if not v_id_changed and not v_sort_changed then continue; end if;

    execute format(
      'update public.%I t set id=$1,sort_order=$2,version=version+1,updated_at=now(),updated_by=$3 where id=$4 returning to_jsonb(t)',
      v_table
    ) into v_after using v_new_id, v_requested_sort_order, v_user, v_temporary_id;

    if v_id_changed then
      v_renamed := v_renamed + 1;
      update public.game_assets
        set owner_id = v_new_id
        where owner_table = v_table and owner_id = v_temporary_id;

      if entity_type = 'relics' then
        update public.dungeon_opponents
          set relic_ids = array_replace(relic_ids, v_temporary_id, v_new_id)
          where v_temporary_id = any(relic_ids);
        update public.dungeon_opponents opponent
          set drops = (
            select jsonb_agg(case
              when item->>'relic_id' = v_temporary_id then jsonb_set(item, '{relic_id}', to_jsonb(v_new_id))
              else item
            end)
            from jsonb_array_elements(opponent.drops) item
          )
          where jsonb_typeof(opponent.drops) = 'array'
            and exists (select 1 from jsonb_array_elements(opponent.drops) item where item->>'relic_id' = v_temporary_id);
      elsif entity_type = 'skills' then
        update public.dungeon_opponents
          set skill_ids = array_replace(skill_ids, v_temporary_id, v_new_id)
          where v_temporary_id = any(skill_ids);
        update public.collectible_unlock_challenges
          set target_ids = array_replace(target_ids, v_temporary_id, v_new_id)
          where target_mode = 'skill' and v_temporary_id = any(target_ids);
      elsif entity_type = 'statuses' then
        update public.skill_effects
          set parameters = jsonb_set(parameters, '{status_id}', to_jsonb(v_new_id), false)
          where parameters->>'status_id' = v_temporary_id;
      elsif entity_type = 'elements' then
        update public.collectible_unlock_challenges
          set target_ids = array_replace(target_ids, v_temporary_id, v_new_id)
          where target_mode = 'element' and v_temporary_id = any(target_ids);
        update public.ability_effects effect
          set parameters = jsonb_set(
            effect.parameters,
            '{element_ids}',
            (
              select jsonb_agg(to_jsonb(case when item.value = v_temporary_id then v_new_id else item.value end) order by item.ordinality)
              from jsonb_array_elements_text(effect.parameters->'element_ids') with ordinality as item(value, ordinality)
            ),
            false
          )
          where jsonb_typeof(effect.parameters->'element_ids') = 'array'
            and effect.parameters->'element_ids' ? v_temporary_id;
      end if;
    end if;

    if v_sort_changed then v_reordered := v_reordered + 1; end if;
    v_changed := v_changed + 1;
    perform public.admin_write_audit(
      v_singular,
      v_new_id,
      case when v_id_changed then 'rename' else 'update' end,
      (v_before->>'version')::integer,
      (v_after->>'version')::integer,
      v_before,
      v_after,
      case
        when v_id_changed and v_sort_changed then format('Changed ID from #%s to #%s and sort order from %s to %s', v_old_id, v_new_id, v_before->>'sort_order', v_requested_sort_order)
        when v_id_changed then format('Changed ID from #%s to #%s', v_old_id, v_new_id)
        else format('Changed sort order from %s to %s', v_before->>'sort_order', v_requested_sort_order)
      end
    );
  end loop;

  return jsonb_build_object(
    'entityType', entity_type,
    'changed', v_changed,
    'renamed', v_renamed,
    'reordered', v_reordered,
    'ids', (select jsonb_agg(btrim(value->>'newId') order by ordinality) from jsonb_array_elements(id_changes) with ordinality)
  );
end; $_$;


ALTER FUNCTION "public"."admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb") OWNER TO "postgres";

--
-- Name: FUNCTION "admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb") IS 'Atomically edits IDs for seven gameplay catalogs; string-ID catalog mappings also persist explicit unique sort orders while cascading live references.';


--
-- Name: admin_reorder_dungeon_ids("jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_reorder_dungeon_ids"("id_changes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  v_user uuid:=public.assert_content_admin();
  v_actual_ids text[];
  v_requested_ids text[];
  v_temporary_ids text[]:='{}'::text[];
  v_before_snapshots jsonb[]:='{}'::jsonb[];
  v_change jsonb;
  v_index integer;
  v_old_id text;
  v_new_id text;
  v_temp_id text;
  v_before jsonb;
  v_after jsonb;
  v_width integer;
  v_changed integer:=0;
begin
  if jsonb_typeof(id_changes) is distinct from 'array' or jsonb_array_length(id_changes)=0 then
    raise exception 'VALIDATION: Dungeon ID changes are required';
  end if;
  select array_agg(id order by id) into v_actual_ids from (select id from public.dungeons for update) rows;
  select array_agg(value->>'oldId' order by value->>'oldId') into v_requested_ids from jsonb_array_elements(id_changes);
  if v_requested_ids is distinct from v_actual_ids
    or (select count(*)<>count(distinct value->>'oldId') from jsonb_array_elements(id_changes))
    or (select count(*)<>count(distinct btrim(value->>'newId')) from jsonb_array_elements(id_changes))
  then raise exception 'VERSION_CONFLICT: Dungeon catalog changed or contains duplicate IDs'; end if;
  if exists(
    select 1 from jsonb_array_elements(id_changes)
    where btrim(value->>'newId')!~'^[0-9]+$'
  ) then raise exception 'VALIDATION: Dungeon IDs must be integers'; end if;

  for v_change,v_index in
    select value,ordinality::integer from jsonb_array_elements(id_changes) with ordinality
  loop
    v_old_id:=v_change->>'oldId';
    v_new_id:=btrim(v_change->>'newId');
    v_before_snapshots:=array_append(v_before_snapshots,public.dungeon_snapshot(v_old_id));
    if v_old_id=v_new_id then
      v_temporary_ids:=array_append(v_temporary_ids,v_old_id);
    else
      v_temp_id:='999999999999999999999999'||lpad(v_index::text,6,'0');
      while exists(select 1 from public.dungeons where id=v_temp_id) loop
        v_temp_id:=v_temp_id||'9';
      end loop;
      v_temporary_ids:=array_append(v_temporary_ids,v_temp_id);
      update public.dungeons set id=v_temp_id where id=v_old_id;
      update public.dungeons set next_dungeon_id=v_temp_id where next_dungeon_id=v_old_id;
      update public.game_assets set owner_id=v_temp_id where owner_table='dungeons' and owner_id=v_old_id;
    end if;
  end loop;

  for v_change,v_index in
    select value,ordinality::integer from jsonb_array_elements(id_changes) with ordinality
  loop
    v_old_id:=v_change->>'oldId';
    v_new_id:=btrim(v_change->>'newId');
    v_temp_id:=v_temporary_ids[v_index];
    if v_old_id=v_new_id then continue; end if;
    v_width:=greatest(3,length(v_new_id));
    update public.dungeons set
      id=v_new_id,
      next_dungeon_id=lpad((v_new_id::integer+1)::text,v_width,'0'),
      sort_order=v_index-1,
      version=version+1,updated_at=now(),updated_by=v_user
    where id=v_temp_id;
    update public.dungeons set next_dungeon_id=v_new_id where next_dungeon_id=v_temp_id;
    update public.game_assets set owner_id=v_new_id where owner_table='dungeons' and owner_id=v_temp_id;
    v_before:=v_before_snapshots[v_index];
    v_after:=public.dungeon_snapshot(v_new_id);
    perform public.admin_write_audit(
      'dungeon',v_new_id,'rename',(v_before->>'version')::integer,
      (v_after->>'version')::integer,v_before,v_after,
      format('Changed Dungeon ID from #%s to #%s and defaulted Next Dungeon to #%s',v_old_id,v_new_id,v_after->>'next_dungeon_id')
    );
    v_changed:=v_changed+1;
  end loop;
  return jsonb_build_object(
    'entityType','dungeons','changed',v_changed,
    'ids',(select jsonb_agg(btrim(value->>'newId') order by ordinality) from jsonb_array_elements(id_changes) with ordinality)
  );
end; $_$;


ALTER FUNCTION "public"."admin_reorder_dungeon_ids"("id_changes" "jsonb") OWNER TO "postgres";

--
-- Name: admin_save_ability("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_ability"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  select to_jsonb(a)||jsonb_build_object('effects',public.inline_effects_snapshot('ability',v_id)),version into v_before,v_version from public.rollcaster_abilities a where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.rollcaster_abilities(id,name,description,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=rollcaster_abilities.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('ability',v_id,payload->'effects');
  select to_jsonb(a)||jsonb_build_object('effects',public.inline_effects_snapshot('ability',v_id)) into v_after from public.rollcaster_abilities a where id=v_id;
  perform public.admin_write_audit('ability',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;


ALTER FUNCTION "public"."admin_save_ability"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_asset("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_asset"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id uuid:=(payload->>'id')::uuid; v_path text:=btrim(payload->'fields'->>'path'); v_category text:=lower(btrim(payload->'fields'->>'category')); v_owner_id text:=nullif(btrim(payload->'fields'->>'owner'),''); v_variant text:=coalesce(nullif(btrim(payload->'fields'->>'variant'),''),'default'); v_existing_id uuid;
begin
  if v_path is null or v_path='' or v_path~'^/' or v_path~'(^|/)\.\.(/|$)' then raise exception 'VALIDATION: invalid Storage object path'; end if;
  if v_category is null or v_category!~'^[a-z0-9][a-z0-9_-]*$' then raise exception 'VALIDATION: invalid category'; end if;
  if not exists(select 1 from storage.objects where bucket_id='game-assets' and name=v_path) then raise exception 'VALIDATION: Storage object does not exist in game-assets'; end if;
  select id,to_jsonb(a) into v_existing_id,v_before from public.game_assets a where id=v_id or (bucket_id='game-assets' and path=v_path and variant=v_variant) order by (id=v_id) desc limit 1 for update;
  if v_before is null and expected_version<>0 then raise exception 'VERSION_CONFLICT'; end if; if v_before is not null and expected_version<>1 then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.game_assets(id,bucket_id,path,category,owner_table,owner_id,variant,display_name,alt_text,content_type,is_active,sort_order,updated_at)
  values(coalesce(v_existing_id,v_id),'game-assets',v_path,v_category,case when v_owner_id is null then null else case v_category when 'critter' then 'critters' when 'rollcaster' then 'rollcasters' when 'relic' then 'relics' when 'status' then 'statuses' when 'element' then 'elements' else v_category end end,v_owner_id,v_variant,payload->>'name',nullif(payload->>'description',''),nullif(payload->'fields'->>'contentType',''),true,coalesce((payload->>'sortOrder')::int,0),now())
  on conflict(id) do update set path=excluded.path,category=excluded.category,owner_table=excluded.owner_table,owner_id=excluded.owner_id,variant=excluded.variant,display_name=excluded.display_name,alt_text=excluded.alt_text,content_type=excluded.content_type,is_active=true,sort_order=excluded.sort_order,updated_at=now();
  select to_jsonb(a) into v_after from public.game_assets a where id=coalesce(v_existing_id,v_id); perform public.admin_write_audit('asset',coalesce(v_existing_id,v_id)::text,case when v_before is null then 'create' else 'update' end,case when v_before is null then null else 1 end,1,v_before,v_after); return v_after;
end; $_$;


ALTER FUNCTION "public"."admin_save_asset"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: FUNCTION "admin_save_asset"("payload" "jsonb", "expected_version" integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."admin_save_asset"("payload" "jsonb", "expected_version" integer) IS 'Registers or updates an existing game-assets Storage image with a folder-derived category.';


--
-- Name: admin_save_critter("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_critter"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user uuid:=public.assert_content_admin();
  v_before jsonb;
  v_after jsonb;
  v_id text:=payload->>'id';
  v_version int;
  v_row jsonb;
  v_prev jsonb;
  v_element_1_id text:=nullif(btrim(payload->>'element1Id'),'');
  v_element_2_id text:=nullif(btrim(payload->>'element2Id'),'');
begin
  if v_element_1_id is null then raise exception 'VALIDATION: Element 1 is required'; end if;
  if not exists(select 1 from public.elements where id=v_element_1_id) then raise exception 'VALIDATION: Element 1 is unknown'; end if;
  if v_element_2_id is not null and not exists(select 1 from public.elements where id=v_element_2_id) then raise exception 'VALIDATION: Element 2 is unknown'; end if;
  if v_element_2_id=v_element_1_id then raise exception 'VALIDATION: Element 1 and Element 2 must be different'; end if;
  if coalesce((payload->'fields'->>'baseHp')::int,0)<1
    or coalesce((payload->'fields'->>'diceMin')::int,0)<1
    or (payload->'fields'->>'diceMax')::int<(payload->'fields'->>'diceMin')::int
  then raise exception 'VALIDATION: invalid base stats'; end if;

  select to_jsonb(c)||jsonb_build_object('collect',public.collectible_unlock_snapshot('critter',v_id)),version
  into v_before,v_version from public.critters c where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.critters(
    id,name,description,element_1_id,element_2_id,
    base_hp,base_atk,base_def,base_spd,base_dice_min,base_dice_max,
    base_block_cost,base_swap_cost,asset_path,sort_order,
    is_active,is_archived,version,created_by,updated_by
  )
  values(
    v_id,payload->>'name',payload->>'description',v_element_1_id,v_element_2_id,
    (payload->'fields'->>'baseHp')::int,(payload->'fields'->>'baseAtk')::int,
    (payload->'fields'->>'baseDef')::int,(payload->'fields'->>'baseSpd')::int,
    (payload->'fields'->>'diceMin')::int,(payload->'fields'->>'diceMax')::int,
    (payload->'fields'->>'blockCost')::int,(payload->'fields'->>'swapCost')::int,
    payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),
    payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user
  )
  on conflict(id) do update set
    name=excluded.name,description=excluded.description,
    element_1_id=excluded.element_1_id,element_2_id=excluded.element_2_id,
    base_hp=excluded.base_hp,base_atk=excluded.base_atk,
    base_def=excluded.base_def,base_spd=excluded.base_spd,
    base_dice_min=excluded.base_dice_min,base_dice_max=excluded.base_dice_max,
    base_block_cost=excluded.base_block_cost,base_swap_cost=excluded.base_swap_cost,
    asset_path=excluded.asset_path,sort_order=excluded.sort_order,
    is_active=excluded.is_active,is_archived=excluded.is_archived,
    version=critters.version+1,updated_at=now(),updated_by=v_user;

  delete from public.critter_skill_unlocks where critter_id=v_id;
  insert into public.critter_skill_unlocks(critter_id,skill_id,unlock_level,unlock_cost,is_default,sort_order)
  select v_id,u->>'refId',(u->>'level')::int,(u->>'cost')::int,
    coalesce((u->>'isDefault')::boolean,false),ordinality-1
  from jsonb_array_elements(coalesce(payload->'unlocks','[]'::jsonb)) with ordinality x(u,ordinality);

  delete from public.critter_level_progression where critter_id=v_id;
  v_prev:=null;
  for v_row in select value from jsonb_array_elements(coalesce(payload->'levels','[]'::jsonb)) loop
    insert into public.critter_level_progression(
      critter_id,level,total_required_xp,grant_skill_points,
      hp_delta,atk_delta,def_delta,spd_delta,
      dice_min_delta,dice_max_delta,block_cost_delta,swap_cost_delta,
      total_unlocked_relic_slots
    )
    values(
      v_id,(v_row->>'level')::int,(v_row->>'xp')::int,(v_row->>'points')::int,
      case when v_prev is null then 0 else (v_row->>'hp')::int-(v_prev->>'hp')::int end,
      case when v_prev is null then 0 else (v_row->>'atk')::int-(v_prev->>'atk')::int end,
      case when v_prev is null then 0 else (v_row->>'def')::int-(v_prev->>'def')::int end,
      case when v_prev is null then 0 else (v_row->>'spd')::int-(v_prev->>'spd')::int end,
      case when v_prev is null then 0 else (v_row->>'diceMin')::int-(v_prev->>'diceMin')::int end,
      case when v_prev is null then 0 else (v_row->>'diceMax')::int-(v_prev->>'diceMax')::int end,
      case when v_prev is null then 0 else (v_row->>'block')::int-(v_prev->>'block')::int end,
      case when v_prev is null then 0 else (v_row->>'swap')::int-(v_prev->>'swap')::int end,
      (v_row->>'slots')::int
    );
    v_prev:=v_row;
  end loop;

  perform public.replace_collectible_unlocks('critter',v_id,coalesce(payload->'collect','{}'::jsonb));
  select to_jsonb(c)||jsonb_build_object('collect',public.collectible_unlock_snapshot('critter',v_id))
  into v_after from public.critters c where id=v_id;
  perform public.admin_write_audit(
    'critter',v_id,case when v_before is null then 'create' else 'update' end,
    v_version,(v_after->>'version')::int,v_before,v_after
  );
  return v_after;
end; $$;


ALTER FUNCTION "public"."admin_save_critter"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: FUNCTION "admin_save_critter"("payload" "jsonb", "expected_version" integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."admin_save_critter"("payload" "jsonb", "expected_version" integer) IS 'Transactionally saves a critter root, progression, and skill unlock aggregate with optimistic locking.';


--
-- Name: admin_save_currency("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_currency"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
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
end; $_$;


ALTER FUNCTION "public"."admin_save_currency"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_dungeon("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_dungeon"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  v_user uuid:=public.assert_content_admin();
  v_before jsonb;
  v_after jsonb;
  v_id text:=btrim(payload->>'id');
  v_version integer;
  v_type text:=payload->'fields'->>'type';
  v_format text:=payload->'fields'->>'format';
  v_battle_count integer;
  v_next_id text:=nullif(btrim(payload->'fields'->>'nextDungeon'),'');
  v_opponents jsonb:=coalesce(payload->'opponents','[]'::jsonb);
  v_completion jsonb:=coalesce(payload->'completionDrops','[]'::jsonb);
  v_op jsonb;
  v_drop jsonb;
  v_pair record;
  v_op_id uuid;
  v_index bigint;
  v_drop_index bigint;
  v_player_count integer;
  v_opponent_count integer;
  v_difficulty integer;
  v_regular_count integer;
  v_boss_count integer;
  v_probability_total numeric;
  v_critter_id text;
  v_level integer;
  v_relic_slots integer;
begin
  if v_id !~ '^[0-9]+$' then raise exception 'VALIDATION: Dungeon ID must be an integer'; end if;
  if v_type not in ('regular','boss') then raise exception 'VALIDATION: invalid Dungeon type'; end if;
  if v_format not in ('1v1','1v2','1v3','2v1','2v2','2v3','3v1','3v2','3v3') then raise exception 'VALIDATION: invalid battle format'; end if;
  v_battle_count:=(payload->'fields'->>'battleCount')::integer;
  if v_battle_count<1 then raise exception 'VALIDATION: Battle Count must be positive'; end if;
  if v_next_id is not null and (v_next_id!~'^[0-9]+$' or v_next_id=v_id) then raise exception 'VALIDATION: Next Dungeon must be another integer ID or blank'; end if;
  if jsonb_typeof(v_opponents) is distinct from 'array' or jsonb_typeof(v_completion) is distinct from 'array' then
    raise exception 'VALIDATION: Dungeon opponents and completion drops must be arrays';
  end if;

  select count(*) filter(where value->>'pool'='regular_pool'),
         count(*) filter(where value->>'pool'='boss_order'),
         coalesce(sum((value->>'probability')::numeric) filter(where value->>'pool'='regular_pool'),0)
  into v_regular_count,v_boss_count,v_probability_total
  from jsonb_array_elements(v_opponents);
  if v_regular_count<1 then raise exception 'VALIDATION: Dungeon needs at least one Encounter Pool entry'; end if;
  if abs(v_probability_total-1)>0.000001 then raise exception 'VALIDATION: Encounter Pool probabilities must total 1'; end if;
  if v_type='boss' and v_boss_count<1 then raise exception 'VALIDATION: Boss Dungeon needs a Boss Order'; end if;
  if exists(
    select 1
    from (
      select (value->>'order')::integer authored_order,
             row_number() over(order by (value->>'order')::integer) expected_order
      from jsonb_array_elements(v_opponents)
      where value->>'pool'='boss_order'
    ) orders
    where authored_order<>expected_order
  ) then raise exception 'VALIDATION: Boss Order must be unique and contiguous from 1'; end if;
  v_opponent_count:=split_part(v_format,'v',2)::integer;
  if v_type='boss' and mod(v_boss_count,v_opponent_count)<>0 then
    raise exception 'VALIDATION: Boss Order must contain complete battle-format groups';
  end if;

  for v_op in select value from jsonb_array_elements(v_opponents) loop
    v_critter_id:=v_op->>'critterId';
    v_level:=(v_op->>'level')::integer;
    if not exists(select 1 from public.critters where id=v_critter_id) then raise exception 'VALIDATION: unknown opponent Critter'; end if;
    if not exists(select 1 from public.critter_level_progression where critter_id=v_critter_id and level=v_level) then raise exception 'VALIDATION: opponent level is not authored for this Critter'; end if;
    if coalesce((v_op->>'critterXp')::integer,-1)<0 or coalesce((v_op->>'rollcasterXp')::integer,-1)<0 then raise exception 'VALIDATION: opponent XP rewards must be non-negative'; end if;
    if v_op->>'pool'='regular_pool' and ((v_op->>'probability')::numeric<0 or (v_op->>'probability')::numeric>1) then raise exception 'VALIDATION: opponent probability must be from 0 to 1'; end if;
    if jsonb_array_length(coalesce(v_op->'skills','[]'::jsonb))>4
      or (select count(*)<>count(distinct value) from jsonb_array_elements_text(coalesce(v_op->'skills','[]'::jsonb)))
      or exists(
        select 1 from jsonb_array_elements_text(coalesce(v_op->'skills','[]'::jsonb)) skill_id
        where not exists(
          select 1 from public.critter_skill_unlocks unlock_row
          where unlock_row.critter_id=v_critter_id and unlock_row.skill_id=skill_id and unlock_row.unlock_level<=v_level
        )
      )
    then raise exception 'VALIDATION: opponent Skills must be unique and unlocked at its level'; end if;
    select coalesce(
      nullif(v_op->'overrides'->>'relicSlots','')::integer,
      progression.total_unlocked_relic_slots
    ) into v_relic_slots
    from public.critter_level_progression progression
    where progression.critter_id=v_critter_id and progression.level=v_level;
    if v_relic_slots not between 0 and 10
      or jsonb_array_length(coalesce(v_op->'relics','[]'::jsonb))>v_relic_slots
      or (select count(*)<>count(distinct value) from jsonb_array_elements_text(coalesce(v_op->'relics','[]'::jsonb)))
      or exists(
        select 1 from jsonb_array_elements_text(coalesce(v_op->'relics','[]'::jsonb)) relic_id
        where not exists(select 1 from public.relics where id=relic_id)
      )
    then raise exception 'VALIDATION: opponent Relics must be unique and fit its available slots'; end if;
  end loop;

  select version into v_version from public.dungeons where id=v_id for update;
  if found then
    if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
    v_before:=public.dungeon_snapshot(v_id);
  elsif expected_version<>0 then raise exception 'VERSION_CONFLICT';
  end if;

  v_player_count:=split_part(v_format,'v',1)::integer;
  select coalesce(round(avg((value->>'level')::numeric)),0)::integer into v_difficulty
  from jsonb_array_elements(v_opponents)
  where value->>'pool'=case when v_type='boss' then 'boss_order' else 'regular_pool' end;

  insert into public.dungeons(
    id,name,description,dungeon_type,difficulty,battle_format,
    player_active_count,opponent_active_count,encounter_count,battle_count,
    next_dungeon_id,regular_logo_path,boss_logo_path,sort_order,
    is_active,is_archived,version,created_by,updated_by
  ) values (
    v_id,payload->>'name',coalesce(payload->>'description',''),v_type,v_difficulty,v_format,
    v_player_count,v_opponent_count,v_battle_count,v_battle_count,
    v_next_id,nullif(payload->'fields'->>'regularLogoPath',''),nullif(payload->'fields'->>'bossLogoPath',''),
    coalesce((select sort_order from public.dungeons where id=v_id),0),
    payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user
  ) on conflict(id) do update set
    name=excluded.name,description=excluded.description,dungeon_type=excluded.dungeon_type,
    difficulty=excluded.difficulty,battle_format=excluded.battle_format,
    player_active_count=excluded.player_active_count,opponent_active_count=excluded.opponent_active_count,
    encounter_count=excluded.encounter_count,battle_count=excluded.battle_count,
    next_dungeon_id=excluded.next_dungeon_id,regular_logo_path=excluded.regular_logo_path,
    boss_logo_path=excluded.boss_logo_path,sort_order=excluded.sort_order,
    is_active=excluded.is_active,is_archived=excluded.is_archived,
    version=dungeons.version+1,updated_at=now(),updated_by=v_user;

  delete from public.dungeon_opponents where dungeon_id=v_id;
  for v_op,v_index in
    select value,ordinality from jsonb_array_elements(v_opponents) with ordinality
  loop
    v_op_id:=coalesce(nullif(v_op->>'id','')::uuid,gen_random_uuid());
    insert into public.dungeon_opponents(
      id,dungeon_id,pool_type,sequence_index,probability,selection_weight,
      critter_id,critter_level,skill_ids,relic_ids,
      rollcaster_xp_reward,critter_xp_reward,currency_reward,drops
    ) values (
      v_op_id,v_id,v_op->>'pool',
      case when v_op->>'pool'='boss_order' then (v_op->>'order')::integer-1 else v_index-1 end,
      case when v_op->>'pool'='regular_pool' then (v_op->>'probability')::numeric else null end,
      case when v_op->>'pool'='regular_pool' then (v_op->>'probability')::numeric else null end,
      v_op->>'critterId',(v_op->>'level')::integer,
      array(select jsonb_array_elements_text(coalesce(v_op->'skills','[]'::jsonb))),
      array(select jsonb_array_elements_text(coalesce(v_op->'relics','[]'::jsonb))),
      (v_op->>'rollcasterXp')::integer,(v_op->>'critterXp')::integer,0,'[]'::jsonb
    );
    insert into public.dungeon_opponent_skills(opponent_id,skill_id,slot_index)
    select v_op_id,value,ordinality-1
    from jsonb_array_elements_text(coalesce(v_op->'skills','[]'::jsonb)) with ordinality;
    insert into public.dungeon_opponent_relics(opponent_id,relic_id,slot_index)
    select v_op_id,value,ordinality-1
    from jsonb_array_elements_text(coalesce(v_op->'relics','[]'::jsonb)) with ordinality;
    for v_pair in select * from jsonb_each_text(coalesce(v_op->'overrides','{}'::jsonb)) loop
      if v_pair.value is not null then
        insert into public.dungeon_opponent_stat_overrides(opponent_id,stat_key,value)
        values(v_op_id,case v_pair.key
          when 'diceMin' then 'dice_min' when 'diceMax' then 'dice_max'
          when 'block' then 'block_cost' when 'swap' then 'swap_cost'
          when 'relicSlots' then 'relic_slots' else v_pair.key end,v_pair.value::integer);
      end if;
    end loop;
    for v_drop,v_drop_index in
      select value,ordinality from jsonb_array_elements(coalesce(v_op->'currencyDrops','[]'::jsonb)) with ordinality
    loop
      perform public.validate_dungeon_drop_target('currency',null,v_drop->>'targetId');
      insert into public.dungeon_opponent_currency_drops(
        id,opponent_id,currency_id,min_amount,max_amount,probability,sort_order
      ) values (
        coalesce(nullif(v_drop->>'id','')::uuid,gen_random_uuid()),v_op_id,v_drop->>'targetId',
        (v_drop->>'minAmount')::integer,(v_drop->>'maxAmount')::integer,
        (v_drop->>'probability')::numeric,v_drop_index-1
      );
    end loop;
    for v_drop,v_drop_index in
      select value,ordinality from jsonb_array_elements(coalesce(v_op->'itemDrops','[]'::jsonb)) with ordinality
    loop
      insert into public.dungeon_opponent_item_drops(
        id,opponent_id,drop_type,target_category,target_id,min_amount,max_amount,
        probability,dupe_currency_id,dupe_currency_amount,sort_order
      ) values (
        coalesce(nullif(v_drop->>'id','')::uuid,gen_random_uuid()),v_op_id,
        v_drop->>'kind',v_drop->>'targetCategory',v_drop->>'targetId',
        (v_drop->>'minAmount')::integer,(v_drop->>'maxAmount')::integer,
        (v_drop->>'probability')::numeric,v_drop->>'dupeCurrencyId',
        (v_drop->>'dupeCurrencyAmount')::integer,v_drop_index-1
      );
    end loop;
  end loop;

  delete from public.dungeon_completion_drops where dungeon_id=v_id;
  for v_drop,v_drop_index in
    select value,ordinality from jsonb_array_elements(v_completion) with ordinality
  loop
    insert into public.dungeon_completion_drops(
      id,dungeon_id,completion_phase,drop_type,target_category,target_id,
      min_amount,max_amount,probability,dupe_currency_id,dupe_currency_amount,sort_order
    ) values (
      coalesce(nullif(v_drop->>'id','')::uuid,gen_random_uuid()),v_id,v_drop->>'phase',
      v_drop->>'kind',nullif(v_drop->>'targetCategory',''),v_drop->>'targetId',
      (v_drop->>'minAmount')::integer,(v_drop->>'maxAmount')::integer,
      (v_drop->>'probability')::numeric,nullif(v_drop->>'dupeCurrencyId',''),
      nullif(v_drop->>'dupeCurrencyAmount','')::integer,v_drop_index-1
    );
  end loop;

  v_after:=public.dungeon_snapshot(v_id);
  perform public.admin_write_audit(
    'dungeon',v_id,case when v_before is null then 'create' else 'update' end,
    v_version,(v_after->>'version')::integer,v_before,v_after
  );
  return v_after;
end; $_$;


ALTER FUNCTION "public"."admin_save_dungeon"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: FUNCTION "admin_save_dungeon"("payload" "jsonb", "expected_version" integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."admin_save_dungeon"("payload" "jsonb", "expected_version" integer) IS 'Transactionally saves a dungeon and normalized opponent children with final-value overrides.';


--
-- Name: admin_save_element("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_element"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare v_user uuid := public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text := payload->>'id'; v_version integer;
begin
  if v_id is null or v_id !~ '^[a-z0-9_-]+$' or nullif(btrim(payload->>'name'),'') is null then raise exception 'VALIDATION: id and name are required'; end if;
  select to_jsonb(e),version into v_before,v_version from public.elements e where id=v_id for update;
  if found and v_version <> expected_version then raise exception 'VERSION_CONFLICT: expected %, current %',expected_version,v_version; end if;
  insert into public.elements(id,name,description,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',payload->>'assetPath',coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,asset_path=excluded.asset_path,sort_order=excluded.sort_order,
    is_active=excluded.is_active,is_archived=excluded.is_archived,version=elements.version+1,updated_at=now(),updated_by=v_user;
  select to_jsonb(e) into v_after from public.elements e where id=v_id;
  perform public.admin_write_audit('element',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after);
  return v_after;
end; $_$;


ALTER FUNCTION "public"."admin_save_element"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_element_chart("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_element_chart"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $_$
declare
  v_user uuid:=public.assert_content_admin();
  v_version integer;
  v_before jsonb;
  v_after jsonb;
  v_expected integer;
  v_actual integer;
begin
  select version,jsonb_build_object(
    'version',version,
    'effectiveness',coalesce((
      select jsonb_agg(jsonb_build_object(
        'attackingElementId',attacking_element_id,
        'defendingElementId',defending_element_id,
        'multiplier',multiplier
      ) order by attacking_element_id,defending_element_id)
      from public.element_effectiveness
    ),'[]'::jsonb)
  ) into v_version,v_before
  from public.element_chart_config where id=true for update;
  if v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if jsonb_typeof(payload->'effectiveness') is distinct from 'array' then
    raise exception 'VALIDATION: Element Chart effectiveness array is required';
  end if;
  select count(*)*count(*) into v_expected from public.elements;
  select count(*),count(distinct (cell->>'attackingElementId',cell->>'defendingElementId'))
  into v_actual,v_version
  from jsonb_array_elements(payload->'effectiveness') cell;
  if v_actual<>v_expected or v_version<>v_expected then
    raise exception 'VALIDATION: Element Chart must contain every unique attack/defense pairing';
  end if;
  if exists(
    select 1 from jsonb_array_elements(payload->'effectiveness') cell
    where not exists(select 1 from public.elements where id=cell->>'attackingElementId')
       or not exists(select 1 from public.elements where id=cell->>'defendingElementId')
       or coalesce(cell->>'multiplier','') !~ '^[0-9]+([.][0-9]+)?$'
       or (cell->>'multiplier')::numeric<0
  ) then raise exception 'VALIDATION: Element Chart contains an unknown Element or invalid multiplier'; end if;

  delete from public.element_effectiveness;
  insert into public.element_effectiveness(attacking_element_id,defending_element_id,multiplier)
  select cell->>'attackingElementId',cell->>'defendingElementId',(cell->>'multiplier')::numeric
  from jsonb_array_elements(payload->'effectiveness') cell;
  update public.element_chart_config
  set version=element_chart_config.version+1,updated_at=now(),updated_by=v_user
  where id=true returning version into v_version;
  select jsonb_build_object(
    'id','main','version',v_version,
    'effectiveness',coalesce((
      select jsonb_agg(jsonb_build_object(
        'attackingElementId',attacking_element_id,
        'defendingElementId',defending_element_id,
        'multiplier',multiplier
      ) order by attacking_element_id,defending_element_id)
      from public.element_effectiveness
    ),'[]'::jsonb)
  ) into v_after;
  perform public.admin_write_audit('element_chart','main','update',expected_version,v_version,v_before,v_after);
  return v_after;
end; $_$;


ALTER FUNCTION "public"."admin_save_element_chart"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_promo_code("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_promo_code"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user uuid:=public.assert_content_admin();
  v_id uuid:=(payload->>'id')::uuid;
  v_before jsonb;
  v_after jsonb;
  v_version integer;
  v_reward jsonb;
  v_reward_id uuid;
  v_reward_owner uuid;
  v_reward_ids uuid[]:='{}';
  v_reward_keys text[]:='{}';
  v_reward_key text;
  v_infinite boolean:=coalesce((payload->'fields'->>'infiniteUse')::boolean,false);
  v_limit bigint:=nullif(payload->'fields'->>'redemptionLimit','')::bigint;
  v_infinite_per_player boolean:=coalesce(
    (payload->'fields'->>'infiniteUsesPerPlayer')::boolean,
    false
  );
  v_uses_per_player bigint:=coalesce(
    nullif(payload->'fields'->>'usesPerPlayer','')::bigint,
    1
  );
begin
  if jsonb_typeof(coalesce(payload->'promoRewards','[]'::jsonb))<>'array'
    or jsonb_array_length(coalesce(payload->'promoRewards','[]'::jsonb))=0
  then raise exception 'VALIDATION: Add at least one Promo Code reward'; end if;

  select public.promo_code_snapshot(v_id),version
  into v_before,v_version
  from public.promo_codes where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;

  for v_reward in select value from jsonb_array_elements(payload->'promoRewards') loop
    if nullif(v_reward->>'id','') is null then raise exception 'VALIDATION: every Promo Code reward needs a stable ID'; end if;
    v_reward_id:=(v_reward->>'id')::uuid;
    if v_reward_id=any(v_reward_ids) then raise exception 'VALIDATION: Promo Code reward IDs must be unique'; end if;
    v_reward_ids:=array_append(v_reward_ids,v_reward_id);
    v_reward_key:=(v_reward->>'type')||':'||coalesce(v_reward->>'targetCategory','')||':'||coalesce(v_reward->>'targetId','');
    if v_reward_key=any(v_reward_keys) then raise exception 'VALIDATION: combine duplicate Promo Code reward targets'; end if;
    v_reward_keys:=array_append(v_reward_keys,v_reward_key);
    select promo_code_id into v_reward_owner from public.promo_code_rewards where id=v_reward_id;
    if v_reward_owner is not null and v_reward_owner<>v_id then
      raise exception 'VALIDATION: a Promo Code reward ID cannot move to another code';
    end if;
    v_reward_owner:=null;
  end loop;

  insert into public.promo_codes(
    id,code,internal_notes,redemption_limit,infinite_use,
    infinite_uses_per_player,uses_per_player,sort_order,
    is_active,is_archived,version,created_by,updated_by
  ) values (
    v_id,payload->'fields'->>'code',coalesce(payload->>'description',''),
    case when v_infinite then null else v_limit end,v_infinite,
    v_infinite_per_player,
    case when v_infinite_per_player then null else v_uses_per_player end,
    coalesce((payload->>'sortOrder')::integer,0),
    payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user
  )
  on conflict(id) do update set
    code=excluded.code,
    internal_notes=excluded.internal_notes,
    redemption_limit=excluded.redemption_limit,
    infinite_use=excluded.infinite_use,
    infinite_uses_per_player=excluded.infinite_uses_per_player,
    uses_per_player=excluded.uses_per_player,
    sort_order=excluded.sort_order,
    is_active=excluded.is_active,
    is_archived=excluded.is_archived,
    version=promo_codes.version+1,
    updated_at=now(),
    updated_by=v_user;

  delete from public.promo_code_rewards where promo_code_id=v_id;
  insert into public.promo_code_rewards(
    id,promo_code_id,reward_type,target_category,target_id,quantity,sort_order
  )
  select
    (reward->>'id')::uuid,
    v_id,
    reward->>'type',
    nullif(reward->>'targetCategory',''),
    reward->>'targetId',
    (reward->>'quantity')::bigint,
    (ordinality-1)::integer
  from jsonb_array_elements(payload->'promoRewards') with ordinality rows(reward,ordinality);

  select public.promo_code_snapshot(v_id) into v_after;
  perform public.admin_write_audit(
    'promo_code',v_id::text,
    case when v_before is null then 'create' else 'update' end,
    v_version,(v_after->>'version')::integer,v_before,v_after
  );
  return v_after;
end;
$$;


ALTER FUNCTION "public"."admin_save_promo_code"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_relic("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_relic"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
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


ALTER FUNCTION "public"."admin_save_relic"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_relic_shop_entry("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_relic_shop_entry"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$ select public.admin_save_shop_entry(payload,expected_version,'relic') $$;


ALTER FUNCTION "public"."admin_save_relic_shop_entry"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_rollcaster("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_rollcaster"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
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


ALTER FUNCTION "public"."admin_save_rollcaster"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_shard_shop_entry("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_shard_shop_entry"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$ select public.admin_save_shop_entry(payload,expected_version,'shard') $$;


ALTER FUNCTION "public"."admin_save_shard_shop_entry"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_shop_entry("jsonb", integer, "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_shop_entry"("payload" "jsonb", "expected_version" integer, "p_shop_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
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


ALTER FUNCTION "public"."admin_save_shop_entry"("payload" "jsonb", "expected_version" integer, "p_shop_type" "text") OWNER TO "postgres";

--
-- Name: admin_save_skill("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_skill"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int; v_type text:=payload->'fields'->>'type';
begin
  if nullif(v_id,'') is null or nullif(payload->>'name','') is null or v_type not in ('attack','support') then raise exception 'VALIDATION: invalid skill identity/type'; end if;
  if v_type='attack' and coalesce((payload->'fields'->>'power')::int,0)<=0 then raise exception 'VALIDATION: attack power must be positive'; end if;
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('skill',v_id)),version into v_before,v_version from public.skills s where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.skills(id,name,element_id,skill_type,power,mana_cost,description,targeting,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'elementId',v_type,case when v_type='support' then 0 else (payload->'fields'->>'power')::int end,coalesce((payload->'fields'->>'manaCost')::int,0),payload->>'description',coalesce(payload->'fields'->>'targeting','single_enemy'),coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,element_id=excluded.element_id,skill_type=excluded.skill_type,power=excluded.power,mana_cost=excluded.mana_cost,description=excluded.description,targeting=excluded.targeting,sort_order=excluded.sort_order,is_active=excluded.is_active,is_archived=excluded.is_archived,version=skills.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('skill',v_id,payload->'effects');
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('skill',v_id)) into v_after from public.skills s where id=v_id;
  perform public.admin_write_audit('skill',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;


ALTER FUNCTION "public"."admin_save_skill"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_save_status("jsonb", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_save_status"("payload" "jsonb", "expected_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_user uuid:=public.assert_content_admin(); v_before jsonb; v_after jsonb; v_id text:=payload->>'id'; v_version int;
begin
  if nullif(v_id,'') is null or nullif(btrim(payload->>'name'),'') is null or nullif(btrim(payload->>'description'),'') is null then raise exception 'VALIDATION: id, name, and description are required'; end if;
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('status',v_id)),version into v_before,v_version from public.statuses s where id=v_id for update;
  if found and v_version<>expected_version then raise exception 'VERSION_CONFLICT'; end if;
  insert into public.statuses(id,name,description,asset_path,sort_order,is_active,is_archived,version,created_by,updated_by)
  values(v_id,payload->>'name',payload->>'description',nullif(payload->>'assetPath',''),coalesce((payload->>'sortOrder')::int,0),payload->>'status'='active',payload->>'status'='archived',1,v_user,v_user)
  on conflict(id) do update set name=excluded.name,description=excluded.description,asset_path=excluded.asset_path,is_active=excluded.is_active,is_archived=excluded.is_archived,sort_order=excluded.sort_order,version=statuses.version+1,updated_at=now(),updated_by=v_user;
  perform public.replace_inline_effects('status',v_id,payload->'effects');
  select to_jsonb(s)||jsonb_build_object('effects',public.inline_effects_snapshot('status',v_id)) into v_after from public.statuses s where id=v_id;
  perform public.admin_write_audit('status',v_id,case when v_before is null then 'create' else 'update' end,v_version,(v_after->>'version')::int,v_before,v_after); return v_after;
end; $$;


ALTER FUNCTION "public"."admin_save_status"("payload" "jsonb", "expected_version" integer) OWNER TO "postgres";

--
-- Name: admin_validate_content("text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_validate_content"("entity_type" "text", "entity_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  perform public.assert_content_admin();
  return jsonb_build_object('valid',true,'entity_type',entity_type,'entity_id',entity_id,'errors','[]'::jsonb);
end; $$;


ALTER FUNCTION "public"."admin_validate_content"("entity_type" "text", "entity_id" "text") OWNER TO "postgres";

--
-- Name: admin_write_audit("text", "text", "text", integer, integer, "jsonb", "jsonb", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."admin_write_audit"("p_entity_type" "text", "p_entity_id" "text", "p_operation" "text", "p_previous_version" integer, "p_next_version" integer, "p_before" "jsonb", "p_after" "jsonb", "p_note" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  insert into public.content_change_log
    (admin_user_id,entity_type,entity_id,operation,previous_version,next_version,before_snapshot,after_snapshot,change_note)
  values
    (public.assert_content_admin(),p_entity_type,p_entity_id,p_operation,p_previous_version,p_next_version,p_before,p_after,p_note);
end;
$$;


ALTER FUNCTION "public"."admin_write_audit"("p_entity_type" "text", "p_entity_id" "text", "p_operation" "text", "p_previous_version" integer, "p_next_version" integer, "p_before" "jsonb", "p_after" "jsonb", "p_note" "text") OWNER TO "postgres";

--
-- Name: assert_collectible_gate_integrity("text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."assert_collectible_gate_integrity"("p_type" "text", "p_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  v_required integer;
  v_challenge_count integer:=0;
  v_gate_count integer:=0;
  v_distinct_gate_count integer:=0;
  v_min_gate integer;
  v_max_gate integer;
begin
  select required_challenges into v_required
  from public.collectible_unlock_requirements
  where collectible_type=p_type and collectible_id=p_id;

  select
    count(*)::integer,
    count(gate_order)::integer,
    count(distinct gate_order)::integer,
    min(gate_order),
    max(gate_order)
  into v_challenge_count,v_gate_count,v_distinct_gate_count,v_min_gate,v_max_gate
  from public.collectible_unlock_challenges
  where collectible_type=p_type and collectible_id=p_id;

  if v_required is null then
    if v_challenge_count>0 then
      raise exception 'CONTENT_INTEGRITY: challenge owner % % has no unlock requirement',p_type,p_id;
    end if;
    return;
  end if;

  if v_gate_count>0 and (
    v_min_gate<>1 or
    v_max_gate<>v_gate_count or
    v_distinct_gate_count<>v_gate_count
  ) then
    raise exception 'CONTENT_INTEGRITY: Gate Orders for % % must be the exact sequence 1..%',p_type,p_id,v_gate_count;
  end if;

  if v_required>0 and v_required<v_gate_count then
    raise exception 'CONTENT_INTEGRITY: Required Challenges for % % cannot be lower than its % gates',p_type,p_id,v_gate_count;
  end if;

  if v_required>v_challenge_count then
    raise exception 'CONTENT_INTEGRITY: Required Challenges for % % exceeds its configured challenges',p_type,p_id;
  end if;
end;
$$;


ALTER FUNCTION "public"."assert_collectible_gate_integrity"("p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: assert_content_admin(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."assert_content_admin"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  if not public.is_content_admin() then
    raise exception using errcode = '42501', message = 'DEV_TOOL_ADMIN_REQUIRED';
  end if;
  return v_user_id;
end;
$$;


ALTER FUNCTION "public"."assert_content_admin"() OWNER TO "postgres";

--
-- Name: award_user_critter_level_progression(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."award_user_critter_level_progression"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_processed_level int;
  v_skill_points int;
begin
  v_processed_level := case
    when tg_op = 'UPDATE' then greatest(coalesce(old.highest_processed_level, 1), coalesce(new.highest_processed_level, 1), 1)
    else greatest(coalesce(new.highest_processed_level, 1), 1)
  end;

  if new.level <= v_processed_level then
    new.highest_processed_level := v_processed_level;
    return new;
  end if;

  select coalesce(sum(progression.grant_skill_points), 0)::int
  into v_skill_points
  from public.critter_level_progression progression
  where progression.critter_id = new.critter_id
    and progression.level > v_processed_level
    and progression.level <= new.level;

  new.skill_points := coalesce(new.skill_points, 0) + v_skill_points;
  new.highest_processed_level := new.level;
  return new;
end;
$$;


ALTER FUNCTION "public"."award_user_critter_level_progression"() OWNER TO "postgres";

--
-- Name: award_user_rollcaster_level_progression(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."award_user_rollcaster_level_progression"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_processed_level int;
  v_ability_points int;
begin
  v_processed_level := case
    when tg_op = 'UPDATE' then greatest(coalesce(old.highest_processed_level, 1), coalesce(new.highest_processed_level, 1), 1)
    else greatest(coalesce(new.highest_processed_level, 1), 1)
  end;

  if new.level <= v_processed_level then
    new.highest_processed_level := v_processed_level;
    return new;
  end if;

  select coalesce(sum(progression.grant_ability_points), 0)::int
  into v_ability_points
  from public.rollcaster_level_progression progression
  where progression.rollcaster_id = new.rollcaster_id
    and progression.level > v_processed_level
    and progression.level <= new.level;

  new.ability_points := coalesce(new.ability_points, 0) + v_ability_points;
  new.highest_processed_level := new.level;
  return new;
end;
$$;


ALTER FUNCTION "public"."award_user_rollcaster_level_progression"() OWNER TO "postgres";

--
-- Name: calc_critter_level("text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."calc_critter_level"("p_critter_id" "text", "p_xp" integer) RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select coalesce(max(level), 1)
  from public.critter_level_progression
  where critter_id = p_critter_id and total_required_xp <= p_xp;
$$;


ALTER FUNCTION "public"."calc_critter_level"("p_critter_id" "text", "p_xp" integer) OWNER TO "postgres";

--
-- Name: calc_rollcaster_level("text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."calc_rollcaster_level"("p_rollcaster_id" "text", "p_xp" integer) RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select coalesce(max(level), 1)
  from public.rollcaster_level_progression
  where rollcaster_id = p_rollcaster_id and total_required_xp <= p_xp;
$$;


ALTER FUNCTION "public"."calc_rollcaster_level"("p_rollcaster_id" "text", "p_xp" integer) OWNER TO "postgres";

--
-- Name: cascade_collectible_catalog_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."cascade_collectible_catalog_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."cascade_collectible_catalog_id"() OWNER TO "postgres";

--
-- Name: cascade_promo_reward_target_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."cascade_promo_reward_target_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_type text:=tg_argv[0];
begin
  if new.id=old.id then return new; end if;
  if v_type='currency' then
    update public.promo_code_rewards
    set target_id=new.id
    where reward_type='currency' and target_id=old.id;
  else
    update public.promo_code_rewards
    set target_id=new.id
    where (reward_type=v_type or (reward_type='shard' and target_category=v_type))
      and target_id=old.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."cascade_promo_reward_target_id"() OWNER TO "postgres";

--
-- Name: cleanup_collectible_catalog_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."cleanup_collectible_catalog_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."cleanup_collectible_catalog_delete"() OWNER TO "postgres";

--
-- Name: collectible_challenge_current("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."collectible_challenge_current"("p_user" "uuid", "p_challenge" "uuid") RETURNS bigint
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare c public.collectible_unlock_challenges%rowtype; v_value bigint:=0;
begin
  select * into c from public.collectible_unlock_challenges where id=p_challenge;
  if not found then return 0; end if;

  if c.challenge_type='own_collectible' then
    if c.target_category='critter' then
      select case when exists(select 1 from public.user_critters where user_id=p_user and critter_id=c.target_id) then 1 else 0 end into v_value;
    elsif c.target_category='rollcaster' then
      select case when exists(select 1 from public.user_rollcasters where user_id=p_user and rollcaster_id=c.target_id) then 1 else 0 end into v_value;
    else
      select coalesce(quantity,0)::bigint into v_value
      from public.user_relic_inventory
      where user_id=p_user and relic_id=c.target_id and discovered_at is not null;
      v_value:=coalesce(v_value,0);
    end if;
  elsif c.challenge_type='level_up_critter' then
    select coalesce(level,0)::bigint into v_value
    from public.user_critters where user_id=p_user and critter_id=c.target_id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill') then
    select coalesce(progress,0) into v_value
    from public.user_collectible_challenge_progress
    where user_id=p_user and challenge_id=c.id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type='shop_shards' then
    select coalesce(quantity,0) into v_value
    from public.user_collectible_shards
    where user_id=p_user and collectible_type=c.collectible_type and collectible_id=c.collectible_id;
    v_value:=coalesce(v_value,0);
  elsif c.challenge_type='shop_relic' then
    select coalesce(quantity,0)::bigint into v_value
    from public.user_relic_inventory
    where user_id=p_user and relic_id=c.collectible_id;
    v_value:=coalesce(v_value,0);
  end if;

  return least(v_value,coalesce(public.collectible_challenge_goal(c.id),v_value));
end; $$;


ALTER FUNCTION "public"."collectible_challenge_current"("p_user" "uuid", "p_challenge" "uuid") OWNER TO "postgres";

--
-- Name: collectible_challenge_goal("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."collectible_challenge_goal"("p_challenge" "uuid") RETURNS bigint
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when challenge_type='level_up_critter' then required_level::bigint
    else required_amount
  end
  from public.collectible_unlock_challenges
  where id=p_challenge;
$$;


ALTER FUNCTION "public"."collectible_challenge_goal"("p_challenge" "uuid") OWNER TO "postgres";

--
-- Name: collectible_challenge_states("uuid", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."collectible_challenge_states"("p_user" "uuid", "p_type" "text", "p_id" "text") RETURNS TABLE("challenge_id" "uuid", "gate_order" integer, "raw_progress" bigint, "goal" bigint, "goal_reached" boolean, "eligible" boolean, "complete" boolean, "blocked_by_gate_order" integer, "trackable" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_challenge record;
  v_prior_gates_complete boolean:=true;
  v_blocking_gate integer:=null;
begin
  perform public.assert_collectible_gate_integrity(p_type,p_id);

  for v_challenge in
    select c.id,c.gate_order,c.challenge_type
    from public.collectible_unlock_challenges c
    where c.collectible_type=p_type
      and c.collectible_id=p_id
      and c.gate_order is not null
    order by c.gate_order,c.id
  loop
    challenge_id:=v_challenge.id;
    gate_order:=v_challenge.gate_order;
    raw_progress:=public.collectible_challenge_current(p_user,v_challenge.id);
    goal:=public.collectible_challenge_goal(v_challenge.id);
    goal_reached:=raw_progress>=goal;
    eligible:=v_prior_gates_complete;
    complete:=eligible and goal_reached;
    blocked_by_gate_order:=case when eligible then null else v_blocking_gate end;
    trackable:=v_challenge.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill')
      and eligible and not complete;
    return next;

    if v_prior_gates_complete and not complete then
      v_prior_gates_complete:=false;
      v_blocking_gate:=v_challenge.gate_order;
    end if;
  end loop;

  for v_challenge in
    select c.id,c.challenge_type
    from public.collectible_unlock_challenges c
    where c.collectible_type=p_type
      and c.collectible_id=p_id
      and c.gate_order is null
    order by c.sort_order,c.id
  loop
    challenge_id:=v_challenge.id;
    gate_order:=null;
    raw_progress:=public.collectible_challenge_current(p_user,v_challenge.id);
    goal:=public.collectible_challenge_goal(v_challenge.id);
    goal_reached:=raw_progress>=goal;
    eligible:=v_prior_gates_complete;
    complete:=eligible and goal_reached;
    blocked_by_gate_order:=case when eligible then null else v_blocking_gate end;
    trackable:=v_challenge.challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill')
      and eligible and not complete;
    return next;
  end loop;
end;
$$;


ALTER FUNCTION "public"."collectible_challenge_states"("p_user" "uuid", "p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: collectible_exists("text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."collectible_exists"("p_type" "text", "p_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
begin
  if p_type='critter' then return exists(select 1 from public.critters where id=p_id); end if;
  if p_type='rollcaster' then return exists(select 1 from public.rollcasters where id=p_id); end if;
  if p_type='relic' then return exists(select 1 from public.relics where id=p_id); end if;
  return false;
end; $$;


ALTER FUNCTION "public"."collectible_exists"("p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: collectible_is_unlocked("uuid", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."collectible_is_unlocked"("p_user" "uuid", "p_type" "text", "p_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
begin
  if p_type='critter' then
    return exists(select 1 from public.user_critters where user_id=p_user and critter_id=p_id);
  elsif p_type='rollcaster' then
    return exists(select 1 from public.user_rollcasters where user_id=p_user and rollcaster_id=p_id);
  elsif p_type='relic' then
    return exists(select 1 from public.user_relic_inventory where user_id=p_user and relic_id=p_id and discovered_at is not null and quantity>0);
  end if;
  return false;
end; $$;


ALTER FUNCTION "public"."collectible_is_unlocked"("p_user" "uuid", "p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: collectible_unlock_snapshot("text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."collectible_unlock_snapshot"("p_type" "text", "p_id" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'requiredChallenges',coalesce(requirement.required_challenges,0),
    'challenges',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',challenge.id,'type',challenge.challenge_type,
        'targetCategory',challenge.target_category,'targetId',challenge.target_id,
        'targetMode',challenge.target_mode,'anyTarget',challenge.any_target,'targetIds',challenge.target_ids,
        'requiredAmount',challenge.required_amount,'requiredLevel',challenge.required_level,
        'sortOrder',challenge.sort_order,'gateOrder',challenge.gate_order
      ) order by challenge.sort_order,challenge.id)
      from public.collectible_unlock_challenges challenge
      where challenge.collectible_type=p_type and challenge.collectible_id=p_id
    ),'[]'::jsonb)
  )
  from (select 1) seed
  left join public.collectible_unlock_requirements requirement
    on requirement.collectible_type=p_type and requirement.collectible_id=p_id;
$$;


ALTER FUNCTION "public"."collectible_unlock_snapshot"("p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: compact_user_tracking_slots("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."compact_user_tracking_slots"("p_user" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."compact_user_tracking_slots"("p_user" "uuid") OWNER TO "postgres";

--
-- Name: complete_promo_collectible_challenges("uuid", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."complete_promo_collectible_challenges"("p_user" "uuid", "p_type" "text", "p_id" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_completed integer;
begin
  insert into public.user_collectible_challenge_progress(
    user_id,challenge_id,progress,completed_at,updated_at
  )
  select
    p_user,
    c.id,
    greatest(1,coalesce(
      case
        when c.challenge_type='level_up_critter' then c.required_level::bigint
        when c.challenge_type='own_collectible' and c.target_category<>'relic' then 1
        else c.required_amount
      end,
      1
    )),
    now(),
    now()
  from public.collectible_unlock_challenges c
  where c.collectible_type=p_type and c.collectible_id=p_id
  on conflict(user_id,challenge_id) do update set
    progress=greatest(public.user_collectible_challenge_progress.progress,excluded.progress),
    completed_at=coalesce(public.user_collectible_challenge_progress.completed_at,excluded.completed_at),
    updated_at=now();
  get diagnostics v_completed=row_count;

  delete from public.user_tracked_collectible_challenges t
  using public.collectible_unlock_challenges c
  where t.user_id=p_user
    and t.challenge_id=c.id
    and c.collectible_type=p_type
    and c.collectible_id=p_id;
  perform public.compact_user_tracking_slots(p_user);
  return v_completed;
end;
$$;


ALTER FUNCTION "public"."complete_promo_collectible_challenges"("p_user" "uuid", "p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: dev_manage_user_collectible("text", "text", "text", "text", integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."dev_manage_user_collectible"("p_action" "text", "p_collectible_type" "text", "p_user_email" "text", "p_collectible_id" "text", "p_count" integer DEFAULT 1) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_type text := lower(btrim(coalesce(p_collectible_type, '')));
  v_email text := lower(btrim(coalesce(p_user_email, '')));
  v_collectible_id text := btrim(coalesce(p_collectible_id, ''));
  v_user_id uuid;
  v_user_matches integer;
  v_collectible_name text;
  v_owned_id uuid;
  v_default_unlock_id text;
  v_replacement_rollcaster_id uuid;
  v_previous_count integer := 0;
  v_new_count integer := 0;
  v_max_count integer;
  v_equipped_count integer := 0;
  v_slot_count integer := 1;
begin
  if v_action not in ('grant', 'revoke') then
    raise exception 'Action must be grant or revoke';
  end if;
  if v_type not in ('relic', 'critter', 'rollcaster') then
    raise exception 'Collectible type must be relic, critter, or rollcaster';
  end if;
  if v_email = '' then
    raise exception 'User email is required';
  end if;
  if v_collectible_id = '' then
    raise exception 'Collectible ID is required';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'Count must be a positive integer';
  end if;
  if v_type <> 'relic' and p_count <> 1 then
    raise exception 'Count is only supported for relics';
  end if;

  select count(*)
  into v_user_matches
  from auth.users
  where lower(email) = v_email;

  if v_user_matches = 0 then
    raise exception 'No user exists with email %', v_email;
  elsif v_user_matches > 1 then
    raise exception 'Multiple users unexpectedly match email %', v_email;
  end if;

  select id
  into v_user_id
  from auth.users
  where lower(email) = v_email;

  -- Serialize collectible changes for a user so concurrent grants cannot
  -- bypass unique ownership or relic maximum checks.
  perform id
  from auth.users
  where id = v_user_id
  for update;

  if v_type = 'relic' then
    select name, max_owned
    into v_collectible_name, v_max_count
    from public.relics
    where id = v_collectible_id;

    if not found then
      raise exception 'Relic % does not exist in the catalog', v_collectible_id;
    end if;

    select quantity
    into v_previous_count
    from public.user_relic_inventory
    where user_id = v_user_id and relic_id = v_collectible_id
    for update;
    v_previous_count := coalesce(v_previous_count, 0);

    if v_action = 'grant' then
      v_new_count := v_previous_count + p_count;
      if v_new_count > v_max_count then
        raise exception 'Cannot grant % copies of Relic % (%): user owns %, maximum is %',
          p_count, v_collectible_id, v_collectible_name, v_previous_count, v_max_count;
      end if;

      insert into public.user_relic_inventory (user_id, relic_id, quantity, discovered_at)
      values (v_user_id, v_collectible_id, v_new_count, now())
      on conflict (user_id, relic_id) do update
      set quantity = excluded.quantity,
          discovered_at = coalesce(user_relic_inventory.discovered_at, excluded.discovered_at);
    else
      if v_previous_count = 0 then
        raise exception 'User % does not have Relic % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;
      if p_count > v_previous_count then
        raise exception 'Cannot revoke % copies of Relic % (%): user only owns %',
          p_count, v_collectible_id, v_collectible_name, v_previous_count;
      end if;

      v_new_count := v_previous_count - p_count;
      select count(*)
      into v_equipped_count
      from public.user_critter_relic_slots relic_slot
      join public.user_critters owned_critter on owned_critter.id = relic_slot.user_critter_id
      where owned_critter.user_id = v_user_id
        and relic_slot.relic_id = v_collectible_id;

      if v_new_count < v_equipped_count then
        raise exception 'Cannot reduce Relic % (%) to %: % copies are equipped; unequip copies first',
          v_collectible_id, v_collectible_name, v_new_count, v_equipped_count;
      end if;

      if v_new_count = 0 then
        delete from public.user_relic_inventory
        where user_id = v_user_id and relic_id = v_collectible_id;
      else
        update public.user_relic_inventory
        set quantity = v_new_count
        where user_id = v_user_id and relic_id = v_collectible_id;
      end if;
    end if;

    return jsonb_build_object(
      'action', v_action,
      'collectible_type', v_type,
      'collectible_id', v_collectible_id,
      'collectible_name', v_collectible_name,
      'user_email', v_email,
      'user_id', v_user_id,
      'changed_count', p_count,
      'previous_count', v_previous_count,
      'new_count', v_new_count,
      'max_count', v_max_count
    );
  end if;

  if v_type = 'critter' then
    select name
    into v_collectible_name
    from public.critters
    where id = v_collectible_id;

    if not found then
      raise exception 'Critter % does not exist in the catalog', v_collectible_id;
    end if;

    select id
    into v_owned_id
    from public.user_critters
    where user_id = v_user_id and critter_id = v_collectible_id;

    if v_action = 'grant' then
      if v_owned_id is not null then
        raise exception 'User % already has Critter % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      insert into public.user_critters (user_id, critter_id)
      values (v_user_id, v_collectible_id)
      returning id into v_owned_id;

      insert into public.user_seen_critters (user_id, critter_id)
      values (v_user_id, v_collectible_id)
      on conflict do nothing;

      insert into public.user_critter_skills (user_critter_id, skill_id)
      select v_owned_id, unlock.skill_id
      from public.critter_skill_unlocks unlock
      where unlock.critter_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      on conflict do nothing;

      select unlock.skill_id
      into v_default_unlock_id
      from public.critter_skill_unlocks unlock
      where unlock.critter_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      limit 1;

      insert into public.user_critter_skill_slots (user_critter_id, slot_index, skill_id)
      select v_owned_id, slot_index,
        case when slot_index = 1 then v_default_unlock_id else null end
      from generate_series(1, 4) slot_index;
    else
      if v_owned_id is null then
        raise exception 'User % does not have Critter % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      -- Preserve combat history rows while releasing their live ownership FK.
      update public.combat_turn_actions
      set swap_in_user_critter_id = null
      where swap_in_user_critter_id = v_owned_id;

      delete from public.user_critters where id = v_owned_id;
    end if;
  else
    select name
    into v_collectible_name
    from public.rollcasters
    where id = v_collectible_id;

    if not found then
      raise exception 'Rollcaster % does not exist in the catalog', v_collectible_id;
    end if;

    select id
    into v_owned_id
    from public.user_rollcasters
    where user_id = v_user_id and rollcaster_id = v_collectible_id;

    if v_action = 'grant' then
      if v_owned_id is not null then
        raise exception 'User % already has Rollcaster % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      insert into public.user_rollcasters (user_id, rollcaster_id)
      values (v_user_id, v_collectible_id)
      returning id into v_owned_id;

      insert into public.user_rollcaster_abilities (user_id, user_rollcaster_id, ability_id)
      select v_user_id, v_owned_id, unlock.ability_id
      from public.rollcaster_ability_unlocks unlock
      where unlock.rollcaster_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      on conflict do nothing;

      select unlock.ability_id
      into v_default_unlock_id
      from public.rollcaster_ability_unlocks unlock
      where unlock.rollcaster_id = v_collectible_id
        and unlock.unlock_level = 1
        and unlock.unlock_cost = 0
      order by unlock.sort_order
      limit 1;

      select coalesce(max(progression.total_unlocked_ability_slots), 1)
      into v_slot_count
      from public.rollcaster_level_progression progression
      where progression.rollcaster_id = v_collectible_id
        and progression.level <= 1;
      v_slot_count := greatest(coalesce(v_slot_count, 1), 1);

      insert into public.user_rollcaster_ability_slots (user_rollcaster_id, slot_index, ability_id)
      select v_owned_id, slot_index,
        case when slot_index = 1 then v_default_unlock_id else null end
      from generate_series(1, v_slot_count) slot_index;

      update public.profiles
      set active_rollcaster_id = v_owned_id,
          updated_at = now()
      where user_id = v_user_id
        and active_rollcaster_id is null;
    else
      if v_owned_id is null then
        raise exception 'User % does not have Rollcaster % (%) unlocked',
          v_email, v_collectible_id, v_collectible_name;
      end if;

      select id
      into v_replacement_rollcaster_id
      from public.user_rollcasters
      where user_id = v_user_id and id <> v_owned_id
      order by unlocked_at, id
      limit 1;

      update public.profiles
      set active_rollcaster_id = v_replacement_rollcaster_id,
          updated_at = now()
      where user_id = v_user_id
        and active_rollcaster_id = v_owned_id;

      delete from public.user_rollcasters where id = v_owned_id;
    end if;
  end if;

  return jsonb_build_object(
    'action', v_action,
    'collectible_type', v_type,
    'collectible_id', v_collectible_id,
    'collectible_name', v_collectible_name,
    'user_email', v_email,
    'user_id', v_user_id,
    'changed_count', 1,
    'previous_count', case when v_action = 'grant' then 0 else 1 end,
    'new_count', case when v_action = 'grant' then 1 else 0 end,
    'max_count', 1
  );
end;
$$;


ALTER FUNCTION "public"."dev_manage_user_collectible"("p_action" "text", "p_collectible_type" "text", "p_user_email" "text", "p_collectible_id" "text", "p_count" integer) OWNER TO "postgres";

--
-- Name: dungeon_run_payload("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."dungeon_run_payload"("p_run_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'id',run.id,
    'dungeonId',run.dungeon_id,
    'dungeonVersion',run.dungeon_version,
    'effectiveMode',run.effective_mode,
    'battleFormat',run.battle_format,
    'battleCount',run.battle_count,
    'battleIndex',run.battle_index,
    'selectedOpponents',run.selected_opponents,
    'randomSeed',run.random_seed::text,
    'randomCursor',run.random_cursor,
    'status',run.status,
    'version',run.state_version,
    'rewards',run.rewards
  )
  from public.dungeon_runs run
  where run.id=p_run_id
$$;


ALTER FUNCTION "public"."dungeon_run_payload"("p_run_id" "uuid") OWNER TO "postgres";

--
-- Name: dungeon_runtime_amount(bigint, "text", integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."dungeon_runtime_amount"("p_seed" bigint, "p_key" "text", "p_min" integer, "p_max" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select p_min+floor(public.dungeon_runtime_random(p_seed,p_key)*(p_max-p_min+1))::integer
$$;


ALTER FUNCTION "public"."dungeon_runtime_amount"("p_seed" bigint, "p_key" "text", "p_min" integer, "p_max" integer) OWNER TO "postgres";

--
-- Name: dungeon_runtime_random(bigint, "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."dungeon_runtime_random"("p_seed" bigint, "p_key" "text") RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select mod(abs(hashtextextended(p_seed::text||':'||p_key,0)::numeric),1000000)/1000000
$$;


ALTER FUNCTION "public"."dungeon_runtime_random"("p_seed" bigint, "p_key" "text") OWNER TO "postgres";

--
-- Name: dungeon_snapshot("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."dungeon_snapshot"("p_dungeon_id" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select to_jsonb(dungeon_row)||jsonb_build_object(
    'opponents',coalesce((
      select jsonb_agg(
        to_jsonb(opponent_row)||jsonb_build_object(
          'skills',coalesce((select jsonb_agg(skill_id order by slot_index) from public.dungeon_opponent_skills where opponent_id=opponent_row.id),'[]'::jsonb),
          'relics',coalesce((select jsonb_agg(relic_id order by slot_index) from public.dungeon_opponent_relics where opponent_id=opponent_row.id),'[]'::jsonb),
          'overrides',coalesce((select jsonb_object_agg(stat_key,value) from public.dungeon_opponent_stat_overrides where opponent_id=opponent_row.id),'{}'::jsonb),
          'currencyDrops',coalesce((select jsonb_agg(to_jsonb(currency_drop) order by sort_order) from public.dungeon_opponent_currency_drops currency_drop where opponent_id=opponent_row.id),'[]'::jsonb),
          'itemDrops',coalesce((select jsonb_agg(to_jsonb(item_drop) order by sort_order) from public.dungeon_opponent_item_drops item_drop where opponent_id=opponent_row.id),'[]'::jsonb)
        )
        order by pool_type,sequence_index
      )
      from public.dungeon_opponents opponent_row
      where opponent_row.dungeon_id=p_dungeon_id
    ),'[]'::jsonb),
    'completionDrops',coalesce((
      select jsonb_agg(to_jsonb(completion_drop) order by completion_phase,sort_order)
      from public.dungeon_completion_drops completion_drop
      where completion_drop.dungeon_id=p_dungeon_id
    ),'[]'::jsonb)
  )
  from public.dungeons dungeon_row
  where dungeon_row.id=p_dungeon_id
$$;


ALTER FUNCTION "public"."dungeon_snapshot"("p_dungeon_id" "text") OWNER TO "postgres";

--
-- Name: ensure_promo_shard_challenge(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."ensure_promo_shard_challenge"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_type text:=coalesce(new.collectible_type,old.collectible_type);
  v_id text:=coalesce(new.collectible_id,old.collectible_id);
begin
  if exists(
    select 1 from public.promo_code_rewards
    where reward_type='shard' and target_category=v_type and target_id=v_id
  ) and not exists(
    select 1 from public.collectible_unlock_challenges
    where collectible_type=v_type and collectible_id=v_id and challenge_type='shop_shards'
  ) then
    raise exception 'CONTENT_IN_USE: a Promo Code Shard reward requires this collectible to retain a Shop Shards challenge';
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."ensure_promo_shard_challenge"() OWNER TO "postgres";

--
-- Name: ensure_referenced_shard_challenge(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."ensure_referenced_shard_challenge"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_type text:=coalesce(new.collectible_type,old.collectible_type);
  v_id text:=coalesce(new.collectible_id,old.collectible_id);
begin
  if exists(
    select 1 from public.dungeon_opponent_item_drops
    where drop_type='shard' and target_category=v_type and target_id=v_id
    union all
    select 1 from public.dungeon_completion_drops
    where drop_type='shard' and target_category=v_type and target_id=v_id
  ) and not exists(
    select 1 from public.collectible_unlock_challenges
    where collectible_type=v_type and collectible_id=v_id and challenge_type='shop_shards'
  ) then
    raise exception 'CONTENT_IN_USE: a Dungeon Shard drop requires this collectible to retain a Shard Shop unlock challenge';
  end if;
  return null;
end; $$;


ALTER FUNCTION "public"."ensure_referenced_shard_challenge"() OWNER TO "postgres";

--
-- Name: ensure_user_game_state(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."ensure_user_game_state"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid:=auth.uid();
  v_email text:=coalesce(auth.jwt()->>'email','player');
  v_username text:=coalesce(
    auth.jwt()->'user_metadata'->>'username',
    split_part(v_email,'@',1),
    'player'
  );
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.profiles(user_id,username)
  values(v_user_id,v_username)
  on conflict(user_id) do nothing;

  insert into public.user_squad_slots(user_id,slot_index)
  values(v_user_id,1),(v_user_id,2),(v_user_id,3)
  on conflict do nothing;

  insert into public.user_dungeon_progress(user_id,dungeon_id,is_unlocked)
  values(v_user_id,'001',true)
  on conflict(user_id,dungeon_id) do update
  set is_unlocked=true;
end;
$$;


ALTER FUNCTION "public"."ensure_user_game_state"() OWNER TO "postgres";

--
-- Name: evaluate_all_collectible_unlocks_internal("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."evaluate_all_collectible_unlocks_internal"("p_user" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record; v_pass integer:=0; v_total integer:=0; v_changed integer;
begin
  loop
    v_changed:=0;
    for r in select collectible_type,collectible_id from public.collectible_unlock_requirements
      where required_challenges>0 order by collectible_type,collectible_id
    loop
      if public.evaluate_collectible_unlock_internal(p_user,r.collectible_type,r.collectible_id) then
        v_changed:=v_changed+1; v_total:=v_total+1;
      end if;
    end loop;
    v_pass:=v_pass+1;
    exit when v_changed=0 or v_pass>100;
  end loop;
  return v_total;
end; $$;


ALTER FUNCTION "public"."evaluate_all_collectible_unlocks_internal"("p_user" "uuid") OWNER TO "postgres";

--
-- Name: evaluate_collectible_after_player_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."evaluate_collectible_after_player_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user uuid;
begin
  if pg_trigger_depth()>1 then return new; end if;
  v_user:=new.user_id;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  return new;
end; $$;


ALTER FUNCTION "public"."evaluate_collectible_after_player_change"() OWNER TO "postgres";

--
-- Name: evaluate_collectible_unlock_internal("uuid", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."evaluate_collectible_unlock_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_required integer;
  v_completed integer:=0;
  v_state record;
  v_granted boolean:=false;
begin
  select required_challenges into v_required
  from public.collectible_unlock_requirements
  where collectible_type=p_type and collectible_id=p_id
  for update;
  if not found or v_required=0 or public.collectible_is_unlocked(p_user,p_type,p_id) then return false; end if;

  if p_type='critter' and not exists(select 1 from public.critters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='rollcaster' and not exists(select 1 from public.rollcasters where id=p_id and is_active and not is_archived) then return false; end if;
  if p_type='relic' and not exists(select 1 from public.relics where id=p_id and is_active and not is_archived) then return false; end if;

  perform id from public.collectible_unlock_challenges
  where collectible_type=p_type and collectible_id=p_id
  for share;

  for v_state in
    select * from public.collectible_challenge_states(p_user,p_type,p_id)
  loop
    if v_state.complete then v_completed:=v_completed+1; end if;

    update public.user_collectible_challenge_progress progress
    set completed_at=case
      when v_state.complete then coalesce(progress.completed_at,now())
      else null
    end,
    updated_at=case
      when progress.completed_at is distinct from case when v_state.complete then coalesce(progress.completed_at,now()) else null end
        then now()
      else progress.updated_at
    end
    where progress.user_id=p_user
      and progress.challenge_id=v_state.challenge_id
      and progress.completed_at is distinct from case
        when v_state.complete then coalesce(progress.completed_at,now())
        else null
      end;
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
end;
$$;


ALTER FUNCTION "public"."evaluate_collectible_unlock_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: get_active_dungeon_run_v2(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."get_active_dungeon_run_v2"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select jsonb_build_object(
    'run',public.dungeon_run_payload(run.id),
    'combatState',run.combat_state,
    'effectSnapshot',run.effect_snapshot
  )
  from public.dungeon_runs run
  where run.user_id=auth.uid() and run.status='started'
  order by run.started_at desc,run.id desc
  limit 1
$$;


ALTER FUNCTION "public"."get_active_dungeon_run_v2"() OWNER TO "postgres";

--
-- Name: get_collectible_player_snapshot(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."get_collectible_player_snapshot"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user uuid:=auth.uid(); v_result jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.reconcile_user_gated_tracking_internal(v_user);
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
      'challenge_id',state.challenge_id,
      'current',state.raw_progress::text,
      'goal',state.goal::text,
      'goal_reached',state.goal_reached,
      'eligible',state.eligible,
      'completed',state.complete,
      'blocked_by_gate_order',state.blocked_by_gate_order,
      'trackable',state.trackable
    ) order by challenge.collectible_type,challenge.collectible_id,challenge.sort_order,challenge.id)
      from public.collectible_unlock_requirements requirement
      cross join lateral public.collectible_challenge_states(
        v_user,
        requirement.collectible_type,
        requirement.collectible_id
      ) state
      join public.collectible_unlock_challenges challenge on challenge.id=state.challenge_id
    ),'[]'::jsonb),
    'tracked',coalesce((select jsonb_agg(jsonb_build_object('challenge_id',t.challenge_id,'slot_order',t.slot_order) order by t.slot_order)
      from public.user_tracked_collectible_challenges t where t.user_id=v_user),'[]'::jsonb),
    'unlock_events',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'collectible_type',e.collectible_type,'collectible_id',e.collectible_id,'created_at',e.created_at
    ) order by e.created_at,e.id) from public.user_collectible_unlock_events e
      where e.user_id=v_user and e.acknowledged_at is null),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_collectible_player_snapshot"() OWNER TO "postgres";

--
-- Name: get_collectible_shop_catalog(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."get_collectible_shop_catalog"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_collectible_shop_catalog"() OWNER TO "postgres";

--
-- Name: grant_collectible_internal("uuid", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."grant_collectible_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_owned uuid; v_default text; v_slots integer:=1; v_was_unlocked boolean:=false;
begin
  if p_type='critter' then
    select id into v_owned from public.user_critters where user_id=p_user and critter_id=p_id;
    if v_owned is not null then return false; end if;
    insert into public.user_critters(user_id,critter_id) values(p_user,p_id) returning id into v_owned;
    insert into public.user_seen_critters(user_id,critter_id) values(p_user,p_id) on conflict do nothing;
    insert into public.user_critter_skills(user_critter_id,skill_id)
    select v_owned,skill_id from public.critter_skill_unlocks
    where critter_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order
    on conflict do nothing;
    select skill_id into v_default from public.critter_skill_unlocks
    where critter_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order limit 1;
    insert into public.user_critter_skill_slots(user_critter_id,slot_index,skill_id)
    select v_owned,slot,case when slot=1 then v_default else null end from generate_series(1,4) slot
    on conflict(user_critter_id,slot_index) do nothing;
    return true;
  elsif p_type='rollcaster' then
    select id into v_owned from public.user_rollcasters where user_id=p_user and rollcaster_id=p_id;
    if v_owned is not null then return false; end if;
    insert into public.user_rollcasters(user_id,rollcaster_id) values(p_user,p_id) returning id into v_owned;
    insert into public.user_rollcaster_abilities(user_id,user_rollcaster_id,ability_id)
    select p_user,v_owned,ability_id from public.rollcaster_ability_unlocks
    where rollcaster_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order
    on conflict do nothing;
    select ability_id into v_default from public.rollcaster_ability_unlocks
    where rollcaster_id=p_id and unlock_level=1 and unlock_cost=0 order by sort_order limit 1;
    select greatest(coalesce(max(total_unlocked_ability_slots),1),1) into v_slots
    from public.rollcaster_level_progression where rollcaster_id=p_id and level<=1;
    insert into public.user_rollcaster_ability_slots(user_rollcaster_id,slot_index,ability_id)
    select v_owned,slot,case when slot=1 then v_default else null end from generate_series(1,v_slots) slot
    on conflict(user_rollcaster_id,slot_index) do nothing;
    update public.profiles set active_rollcaster_id=coalesce(active_rollcaster_id,v_owned),updated_at=now()
    where user_id=p_user;
    return true;
  elsif p_type='relic' then
    select discovered_at is not null into v_was_unlocked
    from public.user_relic_inventory where user_id=p_user and relic_id=p_id for update;
    if coalesce(v_was_unlocked,false) then return false; end if;
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values(p_user,p_id,1,now())
    on conflict(user_id,relic_id) do update
      set quantity=greatest(public.user_relic_inventory.quantity,1),discovered_at=now();
    return true;
  end if;
  raise exception 'VALIDATION: unsupported collectible type';
end; $$;


ALTER FUNCTION "public"."grant_collectible_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") OWNER TO "postgres";

--
-- Name: grant_dungeon_currency_internal("uuid", "text", bigint); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."grant_dungeon_currency_internal"("p_user" "uuid", "p_currency" "text", "p_amount" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_amount<=0 then return; end if;
  if not exists(
    select 1 from public.currencies
    where id=p_currency and is_active and not is_archived
  ) then raise exception 'DUNGEON_SNAPSHOT_INVALID: unknown Currency %',p_currency; end if;

  insert into public.user_currencies(user_id,currency_id,balance,updated_at)
  values(p_user,p_currency,p_amount,now())
  on conflict(user_id,currency_id) do update
    set balance=public.user_currencies.balance+excluded.balance,updated_at=now();

  if p_currency='coins' then
    update public.profiles
    set coins=least(2147483647::bigint,coins::bigint+p_amount)::integer,updated_at=now()
    where user_id=p_user;
  end if;
end;
$$;


ALTER FUNCTION "public"."grant_dungeon_currency_internal"("p_user" "uuid", "p_currency" "text", "p_amount" bigint) OWNER TO "postgres";

--
-- Name: grant_dungeon_drop_internal("uuid", "jsonb", bigint, "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."grant_dungeon_drop_internal"("p_user" "uuid", "p_drop" "jsonb", "p_seed" bigint, "p_key" "text", "p_source" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text:=coalesce(p_drop->>'drop_type',case when p_drop ? 'currency_id' then 'currency' end);
  v_target_category text:=p_drop->>'target_category';
  v_target_id text:=coalesce(p_drop->>'target_id',p_drop->>'currency_id');
  v_probability numeric:=coalesce((p_drop->>'probability')::numeric,0);
  v_min integer:=coalesce((p_drop->>'min_amount')::integer,0);
  v_max integer:=coalesce((p_drop->>'max_amount')::integer,v_min);
  v_amount integer;
  v_granted bigint:=0;
  v_rejected bigint:=0;
  v_current bigint:=0;
  v_capacity bigint:=0;
  v_required bigint:=0;
  v_max_owned integer:=0;
  v_dupe_currency text:=p_drop->>'dupe_currency_id';
  v_dupe_amount bigint:=coalesce((p_drop->>'dupe_currency_amount')::bigint,0);
  v_converted bigint:=0;
  v_entries jsonb:='[]'::jsonb;
begin
  if public.dungeon_runtime_random(p_seed,p_key||':chance')>=v_probability then
    return v_entries;
  end if;
  v_amount:=public.dungeon_runtime_amount(p_seed,p_key||':amount',v_min,v_max);
  if v_amount<=0 then return v_entries; end if;

  if v_kind='currency' then
    perform public.grant_dungeon_currency_internal(p_user,v_target_id,v_amount);
    return jsonb_build_array(jsonb_build_object(
      'id',p_key,'source',p_source,'kind','currency','targetId',v_target_id,'amount',v_amount
    ));
  elsif v_kind='shard' then
    if public.collectible_is_unlocked(p_user,v_target_category,v_target_id) then
      v_rejected:=v_amount;
    else
      select required_amount into v_required
      from public.collectible_unlock_challenges
      where collectible_type=v_target_category
        and collectible_id=v_target_id
        and challenge_type='shop_shards';
      if v_required is null then
        raise exception 'DUNGEON_SNAPSHOT_INVALID: Shard target has no Shard challenge';
      end if;
      select quantity into v_current
      from public.user_collectible_shards
      where user_id=p_user
        and collectible_type=v_target_category
        and collectible_id=v_target_id
      for update;
      v_current:=coalesce(v_current,0);
      v_capacity:=greatest(0,v_required-v_current);
      v_granted:=least(v_amount::bigint,v_capacity);
      v_rejected:=v_amount-v_granted;
      if v_granted>0 then
        insert into public.user_collectible_shards(
          user_id,collectible_type,collectible_id,quantity,updated_at
        ) values(
          p_user,v_target_category,v_target_id,v_current+v_granted,now()
        ) on conflict(user_id,collectible_type,collectible_id) do update
          set quantity=excluded.quantity,updated_at=now();
        v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
          'id',p_key,'source',p_source,'kind','shard',
          'targetCategory',v_target_category,'targetId',v_target_id,'amount',v_granted
        ));
      end if;
    end if;
  elsif v_kind='relic' then
    select max_owned into v_max_owned from public.relics where id=v_target_id for update;
    if v_max_owned is null then
      raise exception 'DUNGEON_SNAPSHOT_INVALID: unknown Relic %',v_target_id;
    end if;
    select quantity into v_current
    from public.user_relic_inventory
    where user_id=p_user and relic_id=v_target_id
    for update;
    v_current:=coalesce(v_current,0);
    v_capacity:=greatest(0,v_max_owned-v_current);
    v_granted:=least(v_amount::bigint,v_capacity);
    v_rejected:=v_amount-v_granted;
    if v_granted>0 then
      insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
      values(p_user,v_target_id,v_current+v_granted,now())
      on conflict(user_id,relic_id) do update
        set quantity=excluded.quantity,
            discovered_at=coalesce(public.user_relic_inventory.discovered_at,now());
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'id',p_key,'source',p_source,'kind','relic',
        'targetCategory','relic','targetId',v_target_id,'amount',v_granted
      ));
    end if;
  else
    raise exception 'DUNGEON_SNAPSHOT_INVALID: unsupported drop type %',v_kind;
  end if;

  if v_rejected>0 then
    if v_dupe_currency is null then
      raise exception 'DUNGEON_SNAPSHOT_INVALID: duplicate conversion Currency is missing';
    end if;
    v_converted:=v_rejected*v_dupe_amount;
    perform public.grant_dungeon_currency_internal(p_user,v_dupe_currency,v_converted);
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
      'id',p_key||':conversion','source','duplicate_conversion','kind','currency',
      'targetId',v_dupe_currency,'amount',v_converted,
      'convertedAmount',v_rejected,'convertedCurrencyId',v_dupe_currency
    ));
  end if;
  perform public.evaluate_all_collectible_unlocks_internal(p_user);
  return v_entries;
end;
$$;


ALTER FUNCTION "public"."grant_dungeon_drop_internal"("p_user" "uuid", "p_drop" "jsonb", "p_seed" bigint, "p_key" "text", "p_source" "text") OWNER TO "postgres";

--
-- Name: initialize_element_effectiveness(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."initialize_element_effectiveness"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.element_effectiveness(attacking_element_id,defending_element_id,multiplier)
  select new.id,element.id,1 from public.elements element
  on conflict(attacking_element_id,defending_element_id) do nothing;
  insert into public.element_effectiveness(attacking_element_id,defending_element_id,multiplier)
  select element.id,new.id,1 from public.elements element
  on conflict(attacking_element_id,defending_element_id) do nothing;
  return new;
end; $$;


ALTER FUNCTION "public"."initialize_element_effectiveness"() OWNER TO "postgres";

--
-- Name: inline_effects_snapshot("text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."inline_effects_snapshot"("p_owner" "text", "p_owner_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $_$
declare v_table text; v_owner_column text; v_result jsonb;
begin
  v_table:=case p_owner when 'skill' then 'skill_effects' when 'ability' then 'ability_effects' when 'relic' then 'relic_effects' when 'status' then 'status_effects' end;
  v_owner_column:=case p_owner when 'skill' then 'skill_id' when 'ability' then 'ability_id' when 'relic' then 'relic_id' when 'status' then 'status_id' end;
  execute format('select coalesce(jsonb_agg((to_jsonb(e)-%L-''effect_category'') order by sort_order),''[]''::jsonb) from public.%I e where %I=$1',v_owner_column,v_table,v_owner_column) into v_result using p_owner_id;
  return v_result;
end; $_$;


ALTER FUNCTION "public"."inline_effects_snapshot"("p_owner" "text", "p_owner_id" "text") OWNER TO "postgres";

--
-- Name: is_content_admin(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."is_content_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select auth.uid() is not null
    and exists(
      select 1
      from public.dev_tool_users d
      join auth.users u on u.id = d.user_id
      where d.user_id = auth.uid()
        and d.is_active
        and coalesce((u.raw_app_meta_data ->> 'content_admin')::boolean, false)
        and coalesce((u.raw_app_meta_data ->> 'dev_tool_only')::boolean, false)
        and u.raw_app_meta_data ->> 'account_type' = 'dev_tool'
    );
$$;


ALTER FUNCTION "public"."is_content_admin"() OWNER TO "postgres";

--
-- Name: FUNCTION "is_content_admin"(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."is_content_admin"() IS 'True only when the authenticated user has server-controlled app_metadata.content_admin=true.';


--
-- Name: is_dev_tool_identity("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."is_dev_tool_identity"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select p_user_id is not null and (
    exists(select 1 from public.dev_tool_users d where d.user_id = p_user_id)
    or exists(
      select 1
      from auth.users u
      where u.id = p_user_id
        and u.raw_app_meta_data ->> 'account_type' = 'dev_tool'
    )
  );
$$;


ALTER FUNCTION "public"."is_dev_tool_identity"("p_user_id" "uuid") OWNER TO "postgres";

--
-- Name: normalize_promo_code(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."normalize_promo_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
begin
  new.code:=upper(btrim(new.code));
  if new.code !~ '^[A-Z0-9_-]{3,32}$' then
    raise exception 'VALIDATION: Code must be 3-32 uppercase letters, numbers, hyphens, or underscores';
  end if;
  if new.infinite_use then
    new.redemption_limit:=null;
  elsif coalesce(new.redemption_limit,0)<1 then
    raise exception 'VALIDATION: Redemption Limit must be positive unless Infinite Use is enabled';
  end if;
  if not new.infinite_use and new.redemption_limit<new.redemption_count then
    raise exception 'VALIDATION: Redemption Limit cannot be below completed redemptions';
  end if;
  if new.infinite_uses_per_player then
    new.uses_per_player:=null;
  elsif coalesce(new.uses_per_player,0)<1 then
    raise exception 'VALIDATION: Uses per Player must be positive unless Infinite Uses per Player is enabled';
  end if;
  if new.is_archived then new.is_active:=false; end if;
  new.updated_at:=now();
  return new;
end;
$_$;


ALTER FUNCTION "public"."normalize_promo_code"() OWNER TO "postgres";

--
-- Name: owns_user_critter("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."owns_user_critter"("p_user_critter_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.user_critters
    where id = p_user_critter_id and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."owns_user_critter"("p_user_critter_id" "uuid") OWNER TO "postgres";

--
-- Name: owns_user_rollcaster("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."owns_user_rollcaster"("p_user_rollcaster_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.user_rollcasters
    where id = p_user_rollcaster_id and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."owns_user_rollcaster"("p_user_rollcaster_id" "uuid") OWNER TO "postgres";

--
-- Name: prevent_content_change_log_mutation(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."prevent_content_change_log_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  raise exception using errcode = '42501', message = 'content_change_log is append-only';
end;
$$;


ALTER FUNCTION "public"."prevent_content_change_log_mutation"() OWNER TO "postgres";

--
-- Name: prevent_promo_reward_target_delete(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."prevent_promo_reward_target_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_type text:=tg_argv[0];
begin
  if exists(
    select 1 from public.promo_code_rewards
    where target_id=old.id
      and (
        (v_type='currency' and reward_type='currency')
        or (v_type<>'currency' and (reward_type=v_type or (reward_type='shard' and target_category=v_type)))
      )
  ) then raise exception 'CONTENT_IN_USE: catalog record is referenced by a Promo Code reward'; end if;
  return old;
end;
$$;


ALTER FUNCTION "public"."prevent_promo_reward_target_delete"() OWNER TO "postgres";

--
-- Name: promo_code_redemption_history(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."promo_code_redemption_history"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'redemptionId',r.id,
    'code',r.code_snapshot,
    'redeemedAt',r.redeemed_at,
    'rewards',coalesce((
      select jsonb_agg(jsonb_build_object(
        'type',rr.reward_type,
        'targetCategory',rr.target_category,
        'targetId',rr.target_id,
        'name',rr.reward_name,
        'assetPath',rr.reward_asset_path,
        'quantity',rr.quantity_granted,
        'configuredQuantity',rr.quantity_configured,
        'discardedQuantity',rr.quantity_discarded,
        'didUnlock',rr.did_unlock
      ) order by rr.sort_order,rr.id)
      from public.promo_code_redemption_rewards rr
      where rr.redemption_id=r.id
    ),'[]'::jsonb)
  ) order by r.redeemed_at desc,r.id desc),'[]'::jsonb)
  from public.promo_code_redemptions r
  where r.user_id=auth.uid();
$$;


ALTER FUNCTION "public"."promo_code_redemption_history"() OWNER TO "postgres";

--
-- Name: promo_code_snapshot("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."promo_code_snapshot"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select to_jsonb(p)||jsonb_build_object(
    'promoRewards',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,
        'type',r.reward_type,
        'targetCategory',r.target_category,
        'targetId',r.target_id,
        'quantity',r.quantity,
        'sortOrder',r.sort_order
      ) order by r.sort_order,r.id)
      from public.promo_code_rewards r
      where r.promo_code_id=p.id
    ),'[]'::jsonb)
  )
  from public.promo_codes p
  where p.id=p_id;
$$;


ALTER FUNCTION "public"."promo_code_snapshot"("p_id" "uuid") OWNER TO "postgres";

--
-- Name: purchase_shop_entry("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid") OWNER TO "postgres";

--
-- Name: purchase_shop_entry("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid:=auth.uid(); v_entry public.shop_entries%rowtype; v_balance bigint:=0; v_current bigint:=0;
  v_required bigint; v_granted bigint:=0; v_discarded bigint:=0; v_max_owned integer; v_unlocked boolean:=false;
  v_event uuid; v_existing jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'VALIDATION: request id is required'; end if;
  select public.shop_purchase_receipt_json(v_user,p_request_id) into v_existing;
  if v_existing is not null then return v_existing; end if;
  perform public.ensure_user_game_state();
  perform id from auth.users where id=v_user for update;
  select public.shop_purchase_receipt_json(v_user,p_request_id) into v_existing;
  if v_existing is not null then return v_existing; end if;

  select * into v_entry from public.shop_entries
  where id=p_entry_id and is_active and not is_archived for update;
  if not found then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if not exists(select 1 from public.currencies where id=v_entry.currency_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if v_entry.target_category='critter' and not exists(select 1 from public.critters where id=v_entry.target_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if v_entry.target_category='rollcaster' and not exists(select 1 from public.rollcasters where id=v_entry.target_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;
  if v_entry.target_category='relic' and not exists(select 1 from public.relics where id=v_entry.target_id and is_active and not is_archived) then raise exception 'SHOP_ENTRY_UNAVAILABLE'; end if;

  select balance into v_balance from public.user_currencies
  where user_id=v_user and currency_id=v_entry.currency_id for update;
  v_balance:=coalesce(v_balance,0);
  if v_balance<v_entry.price then raise exception 'INSUFFICIENT_FUNDS'; end if;

  if v_entry.shop_type='shard' then
    v_unlocked:=public.collectible_is_unlocked(v_user,v_entry.target_category,v_entry.target_id);
    if v_unlocked then raise exception 'COLLECTIBLE_ALREADY_UNLOCKED'; end if;
    select required_amount into v_required from public.collectible_unlock_challenges
    where collectible_type=v_entry.target_category and collectible_id=v_entry.target_id and challenge_type='shop_shards';
    if v_required is null then raise exception 'SHOP_SHARDS_CHALLENGE_MISSING'; end if;
    select quantity into v_current from public.user_collectible_shards
    where user_id=v_user and collectible_type=v_entry.target_category and collectible_id=v_entry.target_id for update;
    v_current:=coalesce(v_current,0);
    if v_current>=v_required then raise exception 'SHOP_SHARDS_CHALLENGE_COMPLETE'; end if;
    v_granted:=least(v_entry.quantity::bigint,v_required-v_current);
    v_discarded:=v_entry.quantity-v_granted;
    insert into public.user_collectible_shards(user_id,collectible_type,collectible_id,quantity,updated_at)
    values(v_user,v_entry.target_category,v_entry.target_id,v_current+v_granted,now())
    on conflict(user_id,collectible_type,collectible_id) do update set quantity=excluded.quantity,updated_at=now();
  else
    select max_owned into v_max_owned from public.relics where id=v_entry.target_id for update;
    select quantity,discovered_at is not null into v_current,v_unlocked from public.user_relic_inventory
    where user_id=v_user and relic_id=v_entry.target_id for update;
    v_current:=coalesce(v_current,0); v_unlocked:=coalesce(v_unlocked,false);
    if not v_unlocked and not exists(select 1 from public.collectible_unlock_challenges
      where collectible_type='relic' and collectible_id=v_entry.target_id and challenge_type='shop_relic') then
      raise exception 'SHOP_RELIC_CHALLENGE_MISSING';
    end if;
    if v_current+v_entry.quantity>v_max_owned then raise exception 'RELIC_MAX_OWNED_REACHED'; end if;
    v_granted:=v_entry.quantity;
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values(v_user,v_entry.target_id,v_current+v_granted,case when v_unlocked then now() else null end)
    on conflict(user_id,relic_id) do update set quantity=excluded.quantity,
      discovered_at=coalesce(public.user_relic_inventory.discovered_at,excluded.discovered_at);
  end if;

  insert into public.user_currencies(user_id,currency_id,balance,updated_at)
  values(v_user,v_entry.currency_id,v_balance-v_entry.price,now())
  on conflict(user_id,currency_id) do update set balance=excluded.balance,updated_at=now();
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  select id into v_event from public.user_collectible_unlock_events
  where user_id=v_user and collectible_type=v_entry.target_category and collectible_id=v_entry.target_id;
  insert into public.shop_purchase_receipts(
    user_id,request_id,entry_id,shop_type,target_category,target_id,currency_id,price,balance_after,granted,discarded,unlock_event_id
  ) values(
    v_user,p_request_id,p_entry_id,v_entry.shop_type,v_entry.target_category,v_entry.target_id,
    v_entry.currency_id,v_entry.price,v_balance-v_entry.price,v_granted,v_discarded,v_event
  );
  return public.shop_purchase_receipt_json(v_user,p_request_id);
end; $$;


ALTER FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid", "p_request_id" "uuid") OWNER TO "postgres";

--
-- Name: reconcile_user_gated_tracking_internal("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."reconcile_user_gated_tracking_internal"("p_user" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_removed integer:=0;
begin
  delete from public.user_tracked_collectible_challenges tracked
  using public.collectible_unlock_challenges challenge
  where tracked.user_id=p_user
    and challenge.id=tracked.challenge_id
    and not exists(
      select 1
      from public.collectible_challenge_states(
        p_user,
        challenge.collectible_type,
        challenge.collectible_id
      ) state
      where state.challenge_id=challenge.id and state.eligible
    );
  get diagnostics v_removed=row_count;
  if v_removed>0 then
    perform public.compact_user_tracking_slots(p_user);
  end if;
  return v_removed;
end;
$$;


ALTER FUNCTION "public"."reconcile_user_gated_tracking_internal"("p_user" "uuid") OWNER TO "postgres";

--
-- Name: record_dungeon_battle_result("uuid", integer, "text", "text"[], "uuid"[], "jsonb", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."record_dungeon_battle_result"("p_run_id" "uuid", "p_expected_battle_index" integer, "p_outcome" "text", "p_defeated_instance_ids" "text"[], "p_participant_user_critter_ids" "uuid"[], "p_squad_hp" "jsonb", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user uuid:=auth.uid();
  v_run public.dungeon_runs%rowtype;
  v_existing jsonb;
  v_instance jsonb;
  v_drop jsonb;
  v_entries jsonb:='[]'::jsonb;
  v_completion_entries jsonb:='[]'::jsonb;
  v_new_defeated jsonb:='[]'::jsonb;
  v_reward jsonb;
  v_accum jsonb;
  v_battle_critter_xp integer:=0;
  v_battle_rollcaster_xp integer:=0;
  v_participant_count integer;
  v_base integer;
  v_remainder integer;
  v_award integer;
  v_participant uuid;
  v_index integer;
  v_phase text;
  v_next text;
  v_response jsonb;
  v_current_battle_count integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'VALIDATION: request id is required'; end if;
  if p_outcome not in ('won','lost') then raise exception 'VALIDATION: invalid battle outcome'; end if;
  if jsonb_typeof(p_squad_hp) is distinct from 'object' then raise exception 'VALIDATION: squad HP is required'; end if;

  select response into v_existing from public.dungeon_run_commands
  where run_id=p_run_id and request_id=p_request_id and user_id=v_user;
  if v_existing is not null then return v_existing; end if;

  select * into v_run from public.dungeon_runs
  where id=p_run_id and user_id=v_user for update;
  if not found then raise exception 'DUNGEON_RUN_NOT_FOUND'; end if;
  if v_run.status<>'started' then raise exception 'DUNGEON_RUN_RESOLVED'; end if;
  if v_run.battle_index<>p_expected_battle_index then raise exception 'DUNGEON_STATE_CONFLICT'; end if;

  if exists(
    select 1 from unnest(coalesce(p_defeated_instance_ids,'{}'::text[])) defeated
    where not exists(
      select 1 from jsonb_array_elements(v_run.selected_opponents) opponent
      where opponent->>'instanceId'=defeated
        and (opponent->>'battleIndex')::integer=v_run.battle_index
    )
  ) then raise exception 'VALIDATION: defeated opponent is not in this encounter'; end if;
  select count(*) into v_current_battle_count
  from jsonb_array_elements(v_run.selected_opponents) opponent
  where (opponent->>'battleIndex')::integer=v_run.battle_index;
  if cardinality(coalesce(p_defeated_instance_ids,'{}'::text[]))<>
    (select count(distinct defeated) from unnest(coalesce(p_defeated_instance_ids,'{}'::text[])) defeated)
  then
    raise exception 'VALIDATION: defeated opponent instance IDs must be unique';
  end if;
  if p_outcome='won' and cardinality(coalesce(p_defeated_instance_ids,'{}'::text[]))<>v_current_battle_count then
    raise exception 'VALIDATION: every opponent must be defeated to clear an encounter';
  end if;
  if exists(
    select 1 from unnest(coalesce(p_participant_user_critter_ids,'{}'::uuid[])) participant
    where not exists(
      select 1 from jsonb_array_elements(v_run.squad_snapshot->'squad') member
      where (member->>'userCritterId')::uuid=participant
    )
  ) then raise exception 'VALIDATION: participant is not in the run squad'; end if;

  v_accum:=coalesce(v_run.rewards,'{}'::jsonb);
  v_accum:=v_accum||jsonb_build_object(
    'entries',coalesce(v_accum->'entries','[]'::jsonb),
    'defeatedOpponentInstanceIds',coalesce(v_accum->'defeatedOpponentInstanceIds','[]'::jsonb),
    'critterXp',coalesce(v_accum->'critterXp','{}'::jsonb),
    'rollcasterXp',coalesce((v_accum->>'rollcasterXp')::integer,0)
  );

  for v_instance in
    select value from jsonb_array_elements(v_run.selected_opponents)
    where (value->>'battleIndex')::integer=v_run.battle_index
      and value->>'instanceId'=any(coalesce(p_defeated_instance_ids,'{}'::text[]))
      and not coalesce(v_accum->'defeatedOpponentInstanceIds','[]'::jsonb) ? (value->>'instanceId')
    order by (value->>'battlefieldSlot')::integer
  loop
    v_new_defeated:=v_new_defeated||jsonb_build_array(v_instance->>'instanceId');
    v_battle_critter_xp:=v_battle_critter_xp+coalesce((v_instance->>'critter_xp_reward')::integer,0);
    v_battle_rollcaster_xp:=v_battle_rollcaster_xp+coalesce((v_instance->>'rollcaster_xp_reward')::integer,0);
    insert into public.user_seen_critters(user_id,critter_id)
    values(v_user,v_instance->>'critter_id') on conflict do nothing;

    for v_drop in select value from jsonb_array_elements(coalesce(v_instance->'currencyDrops','[]'::jsonb)) loop
      v_reward:=public.grant_dungeon_drop_internal(
        v_user,v_drop,v_run.random_seed,
        'opponent:'||(v_instance->>'instanceId')||':'||(v_drop->>'id'),'opponent'
      );
      v_entries:=v_entries||v_reward;
    end loop;
    for v_drop in select value from jsonb_array_elements(coalesce(v_instance->'itemDrops','[]'::jsonb)) loop
      v_reward:=public.grant_dungeon_drop_internal(
        v_user,v_drop,v_run.random_seed,
        'opponent:'||(v_instance->>'instanceId')||':'||(v_drop->>'id'),'opponent'
      );
      v_entries:=v_entries||v_reward;
    end loop;
  end loop;

  select count(distinct participant) into v_participant_count
  from unnest(coalesce(p_participant_user_critter_ids,'{}'::uuid[])) participant;
  if v_battle_critter_xp>0 and v_participant_count=0 then
    raise exception 'VALIDATION: defeated opponents require at least one participant';
  end if;
  if v_battle_critter_xp>0 and v_participant_count>0 then
    v_base:=v_battle_critter_xp/v_participant_count;
    v_remainder:=mod(v_battle_critter_xp,v_participant_count);
    v_index:=0;
    for v_participant in
      select participant
      from unnest(p_participant_user_critter_ids) participant
      group by participant
      order by public.dungeon_runtime_random(v_run.random_seed,'xp:'||v_run.battle_index||':'||participant)
    loop
      v_index:=v_index+1;
      v_award:=v_base+case when v_index<=v_remainder then 1 else 0 end;
      update public.user_critters owned
      set xp=owned.xp+v_award,
          level=public.calc_critter_level(owned.critter_id,owned.xp+v_award)
      where owned.id=v_participant and owned.user_id=v_user;
      v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
        'id','battle:'||v_run.battle_index||':critter-xp:'||v_participant,
        'source','opponent','kind','critter_xp','targetId','xp',
        'recipientId',v_participant,'amount',v_award
      ));
      v_accum:=jsonb_set(
        v_accum,array['critterXp',v_participant::text],
        to_jsonb(coalesce((v_accum->'critterXp'->>v_participant::text)::integer,0)+v_award),true
      );
    end loop;
  end if;

  if v_battle_rollcaster_xp>0 then
    update public.user_rollcasters owned
    set xp=owned.xp+v_battle_rollcaster_xp,
        level=public.calc_rollcaster_level(owned.rollcaster_id,owned.xp+v_battle_rollcaster_xp)
    where owned.id=(v_run.squad_snapshot->>'activeRollcasterId')::uuid
      and owned.user_id=v_user;
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
      'id','battle:'||v_run.battle_index||':rollcaster-xp',
      'source','opponent','kind','rollcaster_xp','targetId','xp',
      'recipientId',v_run.squad_snapshot->>'activeRollcasterId',
      'amount',v_battle_rollcaster_xp
    ));
    v_accum:=jsonb_set(
      v_accum,'{rollcasterXp}',
      to_jsonb(coalesce((v_accum->>'rollcasterXp')::integer,0)+v_battle_rollcaster_xp),true
    );
  end if;

  v_accum:=jsonb_set(v_accum,'{entries}',coalesce(v_accum->'entries','[]'::jsonb)||v_entries,true);
  v_accum:=jsonb_set(
    v_accum,'{defeatedOpponentInstanceIds}',
    coalesce(v_accum->'defeatedOpponentInstanceIds','[]'::jsonb)||v_new_defeated,true
  );

  if p_outcome='lost' then
    update public.dungeon_runs set
      status='lost',rewards=v_accum,combat_state=jsonb_build_object('squadHp',p_squad_hp),
      battle_results=battle_results||jsonb_build_array(jsonb_build_object(
        'battleIndex',battle_index,'outcome','lost','rewards',v_entries,'recordedAt',now()
      )),
      state_version=state_version+1,resolved_at=now()
    where id=p_run_id;
  elsif v_run.battle_index<v_run.battle_count then
    update public.dungeon_runs set
      battle_index=battle_index+1,rewards=v_accum,
      combat_state=jsonb_build_object('squadHp',p_squad_hp),
      battle_results=battle_results||jsonb_build_array(jsonb_build_object(
        'battleIndex',battle_index,'outcome','won','rewards',v_entries,'recordedAt',now()
      )),
      turn_number=1,player_mana=0,opponent_mana=0,state_version=state_version+1
    where id=p_run_id;
  else
    select case when progress.clear_count=0 then 'first_time' else 'regular' end
    into v_phase
    from public.user_dungeon_progress progress
    where progress.user_id=v_user and progress.dungeon_id=v_run.dungeon_id
    for update;
    for v_drop in
      select value from jsonb_array_elements(coalesce(v_run.catalog_snapshot->'completionDrops','[]'::jsonb))
      where value->>'completion_phase'=v_phase
      order by (value->>'sort_order')::integer
    loop
      v_reward:=public.grant_dungeon_drop_internal(
        v_user,v_drop,v_run.random_seed,
        'completion:'||v_phase||':'||(v_drop->>'id'),'completion'
      );
      v_completion_entries:=v_completion_entries||v_reward;
    end loop;
    v_accum:=jsonb_set(
      v_accum,'{entries}',
      coalesce(v_accum->'entries','[]'::jsonb)||v_completion_entries,true
    );
    v_accum:=v_accum||jsonb_build_object('completionPhase',v_phase);

    update public.user_dungeon_progress
    set completed_at=coalesce(completed_at,now()),clear_count=clear_count+1
    where user_id=v_user and dungeon_id=v_run.dungeon_id;
    select dungeon.next_dungeon_id into v_next
    from public.dungeons dungeon where dungeon.id=v_run.dungeon_id;
    if v_next is not null and exists(
      select 1 from public.dungeons where id=v_next and is_active and not is_archived
    ) then
      insert into public.user_dungeon_progress(user_id,dungeon_id,is_unlocked)
      values(v_user,v_next,true)
      on conflict(user_id,dungeon_id) do update set is_unlocked=true;
    else
      v_next:=null;
    end if;

    update public.dungeon_runs set
      status='won',rewards=v_accum,combat_state=jsonb_build_object('squadHp',p_squad_hp),
      battle_results=battle_results||jsonb_build_array(jsonb_build_object(
        'battleIndex',battle_index,'outcome','won','rewards',v_entries,'recordedAt',now()
      )),
      state_version=state_version+1,resolved_at=now()
    where id=p_run_id;
  end if;

  v_response:=jsonb_build_object(
    'run',public.dungeon_run_payload(p_run_id),
    'battleRewards',jsonb_build_object(
      'entries',v_entries,
      'defeatedOpponentInstanceIds',v_new_defeated,
      'critterXp',(
        select coalesce(jsonb_object_agg(entry->>'recipientId',(entry->>'amount')::integer),'{}'::jsonb)
        from jsonb_array_elements(v_entries) entry where entry->>'kind'='critter_xp'
      ),
      'rollcasterXp',v_battle_rollcaster_xp
    ),
    'dungeonRewards',case when v_phase is not null then jsonb_build_object(
      'entries',v_completion_entries,
      'defeatedOpponentInstanceIds','[]'::jsonb,
      'critterXp','{}'::jsonb,
      'rollcasterXp',0,
      'completionPhase',v_phase
    ) else null end,
    'nextDungeonId',v_next
  );
  insert into public.dungeon_run_commands(run_id,request_id,user_id,command_type,response)
  values(p_run_id,p_request_id,v_user,'battle_result',v_response);
  return v_response;
end;
$$;


ALTER FUNCTION "public"."record_dungeon_battle_result"("p_run_id" "uuid", "p_expected_battle_index" integer, "p_outcome" "text", "p_defeated_instance_ids" "text"[], "p_participant_user_critter_ids" "uuid"[], "p_squad_hp" "jsonb", "p_request_id" "uuid") OWNER TO "postgres";

--
-- Name: redeem_promo_code("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."redeem_promo_code"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user uuid:=auth.uid();
  v_code public.promo_codes%rowtype;
  v_reward public.promo_code_rewards%rowtype;
  v_redemption_id uuid:=gen_random_uuid();
  v_player_redemption_count bigint;
  v_current bigint;
  v_required bigint;
  v_max_owned integer;
  v_granted bigint;
  v_discarded bigint;
  v_unlocked boolean;
  v_reward_name text;
  v_asset_path text;
  v_row_count integer;
  v_did_unlock boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.ensure_user_game_state();

  select * into v_code
  from public.promo_codes
  where upper(code)=upper(btrim(p_code))
  for update;
  if not found or not v_code.is_active or v_code.is_archived then
    raise exception 'PROMO_CODE_INVALID_OR_INACTIVE';
  end if;

  select count(*) into v_player_redemption_count
  from public.promo_code_redemptions
  where user_id=v_user and promo_code_id=v_code.id;
  if not v_code.infinite_uses_per_player
    and v_player_redemption_count>=v_code.uses_per_player
  then raise exception 'PROMO_CODE_PLAYER_LIMIT_REACHED'; end if;
  if not v_code.infinite_use and v_code.redemption_count>=v_code.redemption_limit then
    raise exception 'PROMO_CODE_LIMIT_REACHED';
  end if;

  insert into public.promo_code_redemptions(id,promo_code_id,user_id,code_snapshot)
  values(v_redemption_id,v_code.id,v_user,v_code.code);

  for v_reward in
    select * from public.promo_code_rewards
    where promo_code_id=v_code.id
    order by sort_order,id
  loop
    v_current:=0;
    v_required:=null;
    v_max_owned:=null;
    v_granted:=0;
    v_discarded:=0;
    v_unlocked:=false;
    v_did_unlock:=false;
    v_reward_name:=null;
    v_asset_path:=null;

    if v_reward.reward_type='currency' then
      select name,asset_path into v_reward_name,v_asset_path
      from public.currencies where id=v_reward.target_id;
      insert into public.user_currencies(user_id,currency_id,balance,updated_at)
      values(v_user,v_reward.target_id,v_reward.quantity,now())
      on conflict(user_id,currency_id) do update set
        balance=public.user_currencies.balance+excluded.balance,
        updated_at=now();
      v_granted:=v_reward.quantity;

    elsif v_reward.reward_type='shard' then
      if v_reward.target_category='critter' then
        select exists(
          select 1 from public.user_critters
          where user_id=v_user and critter_id=v_reward.target_id
        ) into v_unlocked;
        select name,asset_path into v_reward_name,v_asset_path
        from public.critters where id=v_reward.target_id;
      elsif v_reward.target_category='rollcaster' then
        select exists(
          select 1 from public.user_rollcasters
          where user_id=v_user and rollcaster_id=v_reward.target_id
        ) into v_unlocked;
        select name,asset_path into v_reward_name,v_asset_path
        from public.rollcasters where id=v_reward.target_id;
      else
        select exists(
          select 1 from public.user_relic_inventory
          where user_id=v_user and relic_id=v_reward.target_id and discovered_at is not null
        ) into v_unlocked;
        select name,asset_path into v_reward_name,v_asset_path
        from public.relics where id=v_reward.target_id;
      end if;
      v_reward_name:=v_reward_name||' Shards';
      select required_amount into v_required
      from public.collectible_unlock_challenges
      where collectible_type=v_reward.target_category
        and collectible_id=v_reward.target_id
        and challenge_type='shop_shards';
      select quantity into v_current
      from public.user_collectible_shards
      where user_id=v_user
        and collectible_type=v_reward.target_category
        and collectible_id=v_reward.target_id
      for update;
      v_current:=coalesce(v_current,0);
      if not v_unlocked then
        v_granted:=least(v_reward.quantity,greatest(0,v_required-v_current));
        insert into public.user_collectible_shards(
          user_id,collectible_type,collectible_id,quantity,updated_at
        ) values (
          v_user,v_reward.target_category,v_reward.target_id,v_current+v_granted,now()
        )
        on conflict(user_id,collectible_type,collectible_id) do update set
          quantity=excluded.quantity,
          updated_at=now();
      end if;
      v_discarded:=v_reward.quantity-v_granted;

    elsif v_reward.reward_type='critter' then
      select name,asset_path into v_reward_name,v_asset_path
      from public.critters where id=v_reward.target_id;
      insert into public.user_critters(user_id,critter_id)
      values(v_user,v_reward.target_id)
      on conflict(user_id,critter_id) do nothing;
      get diagnostics v_row_count=row_count;
      v_granted:=v_row_count;
      v_did_unlock:=v_row_count>0;
      v_discarded:=v_reward.quantity-v_granted;
      perform public.complete_promo_collectible_challenges(v_user,'critter',v_reward.target_id);

    elsif v_reward.reward_type='rollcaster' then
      select name,asset_path into v_reward_name,v_asset_path
      from public.rollcasters where id=v_reward.target_id;
      insert into public.user_rollcasters(user_id,rollcaster_id)
      values(v_user,v_reward.target_id)
      on conflict(user_id,rollcaster_id) do nothing;
      get diagnostics v_row_count=row_count;
      v_granted:=v_row_count;
      v_did_unlock:=v_row_count>0;
      v_discarded:=v_reward.quantity-v_granted;
      perform public.complete_promo_collectible_challenges(v_user,'rollcaster',v_reward.target_id);

    elsif v_reward.reward_type='relic' then
      select name,asset_path,max_owned into v_reward_name,v_asset_path,v_max_owned
      from public.relics where id=v_reward.target_id for update;
      select quantity,discovered_at is not null into v_current,v_unlocked
      from public.user_relic_inventory
      where user_id=v_user and relic_id=v_reward.target_id
      for update;
      v_current:=coalesce(v_current,0);
      v_unlocked:=coalesce(v_unlocked,false);
      v_did_unlock:=not v_unlocked;
      v_granted:=least(v_reward.quantity,greatest(0,v_max_owned-v_current));
      v_discarded:=v_reward.quantity-v_granted;
      insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
      values(v_user,v_reward.target_id,v_current+v_granted,now())
      on conflict(user_id,relic_id) do update set
        quantity=excluded.quantity,
        discovered_at=coalesce(public.user_relic_inventory.discovered_at,excluded.discovered_at);
      perform public.complete_promo_collectible_challenges(v_user,'relic',v_reward.target_id);
    end if;

    insert into public.promo_code_redemption_rewards(
      redemption_id,reward_type,target_category,target_id,reward_name,reward_asset_path,
      quantity_configured,quantity_granted,quantity_discarded,did_unlock,sort_order
    ) values (
      v_redemption_id,v_reward.reward_type,v_reward.target_category,v_reward.target_id,
      coalesce(v_reward_name,v_reward.target_id),v_asset_path,
      v_reward.quantity,v_granted,v_discarded,v_did_unlock,v_reward.sort_order
    );
  end loop;

  update public.promo_codes
  set redemption_count=redemption_count+1,updated_at=now()
  where id=v_code.id;

  return (
    select jsonb_build_object(
      'redemptionId',r.id,
      'code',r.code_snapshot,
      'redeemedAt',r.redeemed_at,
      'playerUses',v_player_redemption_count+1,
      'playerUsesRemaining',case
        when v_code.infinite_uses_per_player then null
        else greatest(0,v_code.uses_per_player-(v_player_redemption_count+1))
      end,
      'globalUsesRemaining',case
        when v_code.infinite_use then null
        else greatest(0,v_code.redemption_limit-(v_code.redemption_count+1))
      end,
      'rewards',coalesce((
        select jsonb_agg(jsonb_build_object(
          'type',rr.reward_type,
          'targetCategory',rr.target_category,
          'targetId',rr.target_id,
          'name',rr.reward_name,
          'assetPath',rr.reward_asset_path,
          'quantity',rr.quantity_granted,
          'configuredQuantity',rr.quantity_configured,
          'discardedQuantity',rr.quantity_discarded,
          'didUnlock',rr.did_unlock
        ) order by rr.sort_order,rr.id)
        from public.promo_code_redemption_rewards rr
        where rr.redemption_id=r.id
      ),'[]'::jsonb)
    )
    from public.promo_code_redemptions r
    where r.id=v_redemption_id
  );
end;
$$;


ALTER FUNCTION "public"."redeem_promo_code"("p_code" "text") OWNER TO "postgres";

--
-- Name: reject_dev_tool_game_state(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."reject_dev_tool_game_state"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  if public.is_dev_tool_identity(new.user_id) then
    raise exception using errcode = '42501', message = 'DEV_TOOL_ACCOUNT_CANNOT_OWN_GAME_STATE';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."reject_dev_tool_game_state"() OWNER TO "postgres";

--
-- Name: replace_collectible_unlocks("text", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."replace_collectible_unlocks"("p_type" "text", "p_id" "text", "p_collect" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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

  select coalesce(array_agg(distinct tracked.user_id),'{}'::uuid[]) into v_affected_users
  from public.user_tracked_collectible_challenges tracked
  join public.collectible_unlock_challenges challenge on challenge.id=tracked.challenge_id
  where challenge.collectible_type=p_type and challenge.collectible_id=p_id;

  insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges,updated_at,updated_by)
  values(p_type,p_id,0,now(),auth.uid())
  on conflict(collectible_type,collectible_id) do update set required_challenges=0,updated_at=now(),updated_by=auth.uid();

  for v_challenge in select value from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) loop
    if nullif(v_challenge->>'id','') is null then raise exception 'VALIDATION: every challenge needs a stable ID'; end if;
    v_uuid:=(v_challenge->>'id')::uuid;
    if v_uuid=any(v_ids) then raise exception 'VALIDATION: challenge IDs must be unique'; end if;
    v_ids:=array_append(v_ids,v_uuid);
  end loop;
  delete from public.collectible_unlock_challenges
  where collectible_type=p_type and collectible_id=p_id and not (id=any(v_ids));

  -- Release existing positions before the per-row upserts so a valid swap such
  -- as 1 <-> 2 cannot collide with the partial unique index mid-transaction.
  update public.collectible_unlock_challenges
  set gate_order=null
  where collectible_type=p_type and collectible_id=p_id and gate_order is not null;

  for v_challenge,v_order in
    select value,ordinality from jsonb_array_elements(coalesce(p_collect->'challenges','[]'::jsonb)) with ordinality
  loop
    v_uuid:=(v_challenge->>'id')::uuid;
    select collectible_type,collectible_id,
      to_jsonb(challenge)-'created_at'-'updated_at'-'sort_order'-'gate_order'
      into v_existing_owner_type,v_existing_owner_id,v_before_definition
    from public.collectible_unlock_challenges challenge where id=v_uuid for update;
    if v_existing_owner_type is not null and (v_existing_owner_type<>p_type or v_existing_owner_id<>p_id) then
      raise exception 'VALIDATION: a challenge ID cannot move to another collectible';
    end if;
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,target_category,target_id,target_mode,
      any_target,target_ids,required_amount,required_level,sort_order,gate_order
    ) values (
      v_uuid,p_type,p_id,v_challenge->>'type',nullif(v_challenge->>'targetCategory',''),nullif(v_challenge->>'targetId',''),nullif(v_challenge->>'targetMode',''),
      coalesce((v_challenge->>'anyTarget')::boolean,false),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_challenge->'targetIds','[]'::jsonb))),'{}'),
      nullif(v_challenge->>'requiredAmount','')::bigint,nullif(v_challenge->>'requiredLevel','')::integer,
      coalesce((v_challenge->>'sortOrder')::integer,(v_order-1)::integer),
      nullif(v_challenge->>'gateOrder','')::integer
    ) on conflict(id) do update set
      challenge_type=excluded.challenge_type,target_category=excluded.target_category,target_id=excluded.target_id,
      target_mode=excluded.target_mode,any_target=excluded.any_target,target_ids=excluded.target_ids,
      required_amount=excluded.required_amount,required_level=excluded.required_level,
      sort_order=excluded.sort_order,gate_order=excluded.gate_order,updated_at=now();
    select to_jsonb(challenge)-'created_at'-'updated_at'-'sort_order'-'gate_order' into v_after_definition
    from public.collectible_unlock_challenges challenge where id=v_uuid;
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
  perform public.assert_collectible_gate_integrity(p_type,p_id);

  foreach v_affected_user in array v_affected_users loop
    perform public.reconcile_user_gated_tracking_internal(v_affected_user);
    perform public.evaluate_collectible_unlock_internal(v_affected_user,p_type,p_id);
  end loop;
end;
$$;


ALTER FUNCTION "public"."replace_collectible_unlocks"("p_type" "text", "p_id" "text", "p_collect" "jsonb") OWNER TO "postgres";

--
-- Name: replace_inline_effects("text", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."replace_inline_effects"("p_owner" "text", "p_owner_id" "text", "p_effects" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
declare
  v_table text;
  v_owner_column text;
  v_effect jsonb;
  v_order bigint;
begin
  v_table:=case p_owner when 'skill' then 'skill_effects' when 'ability' then 'ability_effects' when 'relic' then 'relic_effects' when 'status' then 'status_effects' end;
  v_owner_column:=case p_owner when 'skill' then 'skill_id' when 'ability' then 'ability_id' when 'relic' then 'relic_id' when 'status' then 'status_id' end;
  if v_table is null then raise exception 'VALIDATION: invalid inline effect owner'; end if;
  if jsonb_typeof(coalesce(p_effects,'[]'::jsonb))<>'array' then raise exception 'VALIDATION: effects must be an array'; end if;
  execute format('delete from public.%I where %I=$1',v_table,v_owner_column) using p_owner_id;
  for v_effect,v_order in select value,ordinality from jsonb_array_elements(coalesce(p_effects,'[]'::jsonb)) with ordinality loop
    if nullif(btrim(v_effect->>'id'),'') is null or nullif(btrim(v_effect->>'name'),'') is null or nullif(btrim(v_effect->>'description'),'') is null then raise exception 'VALIDATION: every effect needs id, name, and description'; end if;
    perform public.validate_inline_effect_parameters(v_effect->>'templateId',coalesce(v_effect->'parameters','{}'::jsonb),p_owner);
    execute format('insert into public.%I(%I,id,name,description,template_id,parameters,sort_order) values($1,$2,$3,$4,$5,$6,$7)',v_table,v_owner_column)
      using p_owner_id,v_effect->>'id',v_effect->>'name',v_effect->>'description',v_effect->>'templateId',coalesce(v_effect->'parameters','{}'::jsonb),(v_order-1)::integer;
  end loop;
end; $_$;


ALTER FUNCTION "public"."replace_inline_effects"("p_owner" "text", "p_owner_id" "text", "p_effects" "jsonb") OWNER TO "postgres";

--
-- Name: resolve_dungeon_run("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."resolve_dungeon_run"("p_run_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user uuid:=auth.uid();
  v_status text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select status into v_status from public.dungeon_runs
  where id=p_run_id and user_id=v_user;
  if not found then raise exception 'DUNGEON_RUN_NOT_FOUND'; end if;
  if v_status='started' then
    raise exception 'DUNGEON_BATTLE_RESULT_REQUIRED';
  end if;
end;
$$;


ALTER FUNCTION "public"."resolve_dungeon_run"("p_run_id" "uuid") OWNER TO "postgres";

--
-- Name: save_dungeon_run_state("uuid", integer, "jsonb", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."save_dungeon_run_state"("p_run_id" "uuid", "p_expected_version" integer, "p_state" "jsonb", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user uuid:=auth.uid();
  v_run public.dungeon_runs%rowtype;
  v_existing jsonb;
  v_response jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null or jsonb_typeof(p_state) is distinct from 'object' then
    raise exception 'VALIDATION: request id and state object are required';
  end if;
  if pg_column_size(p_state)>1048576 then raise exception 'VALIDATION: combat state is too large'; end if;
  select response into v_existing from public.dungeon_run_commands
  where run_id=p_run_id and request_id=p_request_id and user_id=v_user;
  if v_existing is not null then return v_existing; end if;
  select * into v_run from public.dungeon_runs
  where id=p_run_id and user_id=v_user for update;
  if not found then raise exception 'DUNGEON_RUN_NOT_FOUND'; end if;
  if v_run.status<>'started' then raise exception 'DUNGEON_RUN_RESOLVED'; end if;
  if v_run.state_version<>p_expected_version then raise exception 'DUNGEON_STATE_CONFLICT'; end if;
  update public.dungeon_runs
  set combat_state=p_state,state_version=state_version+1
  where id=p_run_id;
  v_response:=jsonb_build_object(
    'run',public.dungeon_run_payload(p_run_id),
    'combatState',p_state
  );
  insert into public.dungeon_run_commands(run_id,request_id,user_id,command_type,response)
  values(p_run_id,p_request_id,v_user,'save_state',v_response);
  return v_response;
end;
$$;


ALTER FUNCTION "public"."save_dungeon_run_state"("p_run_id" "uuid", "p_expected_version" integer, "p_state" "jsonb", "p_request_id" "uuid") OWNER TO "postgres";

--
-- Name: select_starter_critter("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."select_starter_critter"("p_critter_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid:=auth.uid();
  v_user_critter_id uuid;
  v_skill_id text;
  v_rollcaster_selected_at timestamptz;
  v_starter_selected_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_user_game_state();

  if not exists(
    select 1 from public.starter_options
    where critter_id=p_critter_id and is_active
  ) then
    raise exception 'Invalid starter critter';
  end if;

  select starter_rollcaster_selected_at,starter_selected_at
  into v_rollcaster_selected_at,v_starter_selected_at
  from public.profiles
  where user_id=v_user_id
  for update;

  if v_rollcaster_selected_at is null then
    raise exception 'Select a starter Rollcaster before selecting a starter Critter';
  end if;

  if v_starter_selected_at is not null then
    return;
  end if;

  insert into public.user_critters(user_id,critter_id)
  values(v_user_id,p_critter_id)
  on conflict(user_id,critter_id) do update set critter_id=excluded.critter_id
  returning id into v_user_critter_id;

  insert into public.user_collectible_shards(
    user_id,
    collectible_type,
    collectible_id,
    quantity,
    updated_at
  ) values(v_user_id,'critter',p_critter_id,50,now())
  on conflict(user_id,collectible_type,collectible_id) do update
  set quantity=greatest(public.user_collectible_shards.quantity,excluded.quantity),
      updated_at=case
        when public.user_collectible_shards.quantity<excluded.quantity then now()
        else public.user_collectible_shards.updated_at
      end;

  insert into public.user_seen_critters(user_id,critter_id)
  select v_user_id,critter_id
  from public.starter_options
  where is_active
  on conflict do nothing;

  for v_skill_id in
    select skill_id from public.critter_skill_unlocks
    where critter_id=p_critter_id and unlock_level=1 and unlock_cost=0
    order by sort_order
  loop
    insert into public.user_critter_skills(user_critter_id,skill_id)
    values(v_user_critter_id,v_skill_id)
    on conflict do nothing;
  end loop;

  select skill_id into v_skill_id
  from public.critter_skill_unlocks
  where critter_id=p_critter_id and unlock_level=1 and unlock_cost=0
  order by sort_order
  limit 1;

  insert into public.user_critter_skill_slots(user_critter_id,slot_index,skill_id)
  values
    (v_user_critter_id,1,v_skill_id),
    (v_user_critter_id,2,null),
    (v_user_critter_id,3,null),
    (v_user_critter_id,4,null)
  on conflict(user_critter_id,slot_index) do update set skill_id=excluded.skill_id;

  update public.user_squad_slots
  set user_critter_id=v_user_critter_id
  where user_id=v_user_id and slot_index=1;

  update public.profiles
  set starter_selected_at=now(),updated_at=now()
  where user_id=v_user_id;
end;
$$;


ALTER FUNCTION "public"."select_starter_critter"("p_critter_id" "text") OWNER TO "postgres";

--
-- Name: select_starter_rollcaster("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."select_starter_rollcaster"("p_rollcaster_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid:=auth.uid();
  v_user_rollcaster_id uuid;
  v_ability_id text;
  v_ability_slots integer:=1;
  v_selected_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_user_game_state();

  if not exists(
    select 1
    from public.starter_rollcaster_options starter
    join public.rollcasters rollcaster on rollcaster.id=starter.rollcaster_id
    where starter.rollcaster_id=p_rollcaster_id
      and starter.is_active
      and rollcaster.is_active
      and not rollcaster.is_archived
  ) then
    raise exception 'Invalid starter Rollcaster';
  end if;

  select starter_rollcaster_selected_at into v_selected_at
  from public.profiles
  where user_id=v_user_id
  for update;

  if v_selected_at is not null then
    return;
  end if;

  insert into public.user_rollcasters(user_id,rollcaster_id)
  values(v_user_id,p_rollcaster_id)
  on conflict(user_id,rollcaster_id) do update
  set rollcaster_id=excluded.rollcaster_id
  returning id into v_user_rollcaster_id;

  insert into public.user_rollcaster_abilities(user_id,user_rollcaster_id,ability_id)
  select v_user_id,v_user_rollcaster_id,ability_id
  from public.rollcaster_ability_unlocks
  where rollcaster_id=p_rollcaster_id
    and unlock_level=1
    and unlock_cost=0
  order by sort_order
  on conflict do nothing;

  select ability_id into v_ability_id
  from public.rollcaster_ability_unlocks
  where rollcaster_id=p_rollcaster_id
    and unlock_level=1
    and unlock_cost=0
  order by is_default desc,sort_order,ability_id
  limit 1;

  select greatest(coalesce(max(total_unlocked_ability_slots),1),1)
  into v_ability_slots
  from public.rollcaster_level_progression
  where rollcaster_id=p_rollcaster_id
    and level<=1;

  insert into public.user_rollcaster_ability_slots(
    user_rollcaster_id,
    slot_index,
    ability_id
  )
  select
    v_user_rollcaster_id,
    slot,
    case when slot=1 then v_ability_id else null end
  from generate_series(1,v_ability_slots) slot
  on conflict(user_rollcaster_id,slot_index) do update
  set ability_id=excluded.ability_id;

  insert into public.user_collectible_shards(
    user_id,
    collectible_type,
    collectible_id,
    quantity,
    updated_at
  ) values(v_user_id,'rollcaster',p_rollcaster_id,20,now())
  on conflict(user_id,collectible_type,collectible_id) do update
  set quantity=greatest(public.user_collectible_shards.quantity,excluded.quantity),
      updated_at=case
        when public.user_collectible_shards.quantity<excluded.quantity then now()
        else public.user_collectible_shards.updated_at
      end;

  update public.profiles
  set active_rollcaster_id=v_user_rollcaster_id,
      starter_rollcaster_selected_at=now(),
      updated_at=now()
  where user_id=v_user_id;
end;
$$;


ALTER FUNCTION "public"."select_starter_rollcaster"("p_rollcaster_id" "text") OWNER TO "postgres";

--
-- Name: set_active_rollcaster("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_active_rollcaster"("p_user_rollcaster_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user_id uuid := auth.uid();
begin
  if not exists (select 1 from user_rollcasters where id = p_user_rollcaster_id and user_id = v_user_id) then raise exception 'Rollcaster is not owned'; end if;
  update profiles set active_rollcaster_id = p_user_rollcaster_id, updated_at = now() where user_id = v_user_id;
end; $$;


ALTER FUNCTION "public"."set_active_rollcaster"("p_user_rollcaster_id" "uuid") OWNER TO "postgres";

--
-- Name: set_critter_relic_slot("uuid", integer, "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_critter_relic_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_relic_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user_id uuid := auth.uid(); v_level int; v_critter_id text; v_slots int; v_owned int; v_equipped int;
begin
  select level, critter_id into v_level, v_critter_id from user_critters where id = p_user_critter_id and user_id = v_user_id;
  if v_critter_id is null then raise exception 'Critter is not owned'; end if;
  select total_unlocked_relic_slots into v_slots from critter_level_progression
    where critter_id = v_critter_id and level <= v_level order by level desc limit 1;
  if p_slot_index < 1 or p_slot_index > coalesce(v_slots, 0) then raise exception 'Relic slot is locked'; end if;
  if p_relic_id is not null then
    select quantity into v_owned from user_relic_inventory where user_id = v_user_id and relic_id = p_relic_id;
    select count(*) into v_equipped from user_critter_relic_slots urs
      join user_critters uc on uc.id = urs.user_critter_id
      where uc.user_id = v_user_id and urs.relic_id = p_relic_id
        and not (urs.user_critter_id = p_user_critter_id and urs.slot_index = p_slot_index);
    if coalesce(v_owned, 0) <= v_equipped then raise exception 'No relic copies available'; end if;
  end if;
  insert into user_critter_relic_slots(user_critter_id, slot_index, relic_id)
  values(p_user_critter_id, p_slot_index, p_relic_id)
  on conflict(user_critter_id, slot_index) do update set relic_id = excluded.relic_id;
end; $$;


ALTER FUNCTION "public"."set_critter_relic_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_relic_id" "text") OWNER TO "postgres";

--
-- Name: set_critter_skill_slot("uuid", integer, "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_critter_skill_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_skill_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user_id uuid := auth.uid();
begin
  if not exists (select 1 from user_critters where id = p_user_critter_id and user_id = v_user_id) then raise exception 'Critter is not owned'; end if;
  if p_slot_index not between 1 and 4 then raise exception 'Skill slot is locked'; end if;
  if p_skill_id is not null and not exists (
    select 1 from user_critter_skills where user_critter_id = p_user_critter_id and skill_id = p_skill_id
  ) then raise exception 'Skill is not unlocked'; end if;
  if p_skill_id is not null and exists (
    select 1 from user_critter_skill_slots where user_critter_id = p_user_critter_id and skill_id = p_skill_id and slot_index <> p_slot_index
  ) then raise exception 'Skill is already equipped'; end if;
  if p_skill_id is null and (
    select count(*) from user_critter_skill_slots where user_critter_id = p_user_critter_id and skill_id is not null and slot_index <> p_slot_index
  ) < 1 then raise exception 'At least one skill must remain equipped'; end if;
  insert into user_critter_skill_slots(user_critter_id, slot_index, skill_id)
  values(p_user_critter_id, p_slot_index, p_skill_id)
  on conflict(user_critter_id, slot_index) do update set skill_id = excluded.skill_id;
end; $$;


ALTER FUNCTION "public"."set_critter_skill_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_skill_id" "text") OWNER TO "postgres";

--
-- Name: set_rollcaster_ability_slot("uuid", integer, "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_rollcaster_ability_slot"("p_user_rollcaster_id" "uuid", "p_slot_index" integer, "p_ability_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_level int;
  v_rollcaster_id text;
  v_slots int;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;

  select level, rollcaster_id
  into v_level, v_rollcaster_id
  from public.user_rollcasters
  where id = p_user_rollcaster_id and user_id = v_user_id;
  if v_rollcaster_id is null then raise exception 'Rollcaster is not owned'; end if;

  select total_unlocked_ability_slots
  into v_slots
  from public.rollcaster_level_progression
  where rollcaster_id = v_rollcaster_id and level <= v_level
  order by level desc
  limit 1;
  if p_slot_index < 1 or p_slot_index > coalesce(v_slots, 0) then
    raise exception 'Ability slot is locked';
  end if;

  if p_ability_id is not null and not exists (
    select 1
    from public.user_rollcaster_abilities
    where user_rollcaster_id = p_user_rollcaster_id and ability_id = p_ability_id
  ) then
    raise exception 'Ability is not unlocked';
  end if;

  if p_ability_id is not null and exists (
    select 1
    from public.user_rollcaster_ability_slots
    where user_rollcaster_id = p_user_rollcaster_id
      and ability_id = p_ability_id
      and slot_index <> p_slot_index
  ) then
    raise exception 'Ability is already equipped';
  end if;

  insert into public.user_rollcaster_ability_slots(user_rollcaster_id, slot_index, ability_id)
  values(p_user_rollcaster_id, p_slot_index, p_ability_id)
  on conflict(user_rollcaster_id, slot_index)
  do update set ability_id = excluded.ability_id;
end;
$$;


ALTER FUNCTION "public"."set_rollcaster_ability_slot"("p_user_rollcaster_id" "uuid", "p_slot_index" integer, "p_ability_id" "text") OWNER TO "postgres";

--
-- Name: set_squad_critter_slot(integer, "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_squad_critter_slot"("p_slot_index" integer, "p_user_critter_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if p_slot_index not between 1 and 3 then raise exception 'Squad slot is locked'; end if;
  if p_user_critter_id is not null and not exists (
    select 1 from user_critters where id = p_user_critter_id and user_id = v_user_id
  ) then raise exception 'Critter is not owned'; end if;
  if p_user_critter_id is not null and exists (
    select 1 from user_squad_slots where user_id = v_user_id and user_critter_id = p_user_critter_id and slot_index <> p_slot_index
  ) then raise exception 'Critter is already in the squad'; end if;
  if p_user_critter_id is null and (
    select count(*) from user_squad_slots where user_id = v_user_id and user_critter_id is not null and slot_index <> p_slot_index
  ) < 1 then raise exception 'At least one combat-ready critter is required'; end if;
  insert into user_squad_slots(user_id, slot_index, user_critter_id)
  values(v_user_id, p_slot_index, p_user_critter_id)
  on conflict(user_id, slot_index) do update set user_critter_id = excluded.user_critter_id;
end; $$;


ALTER FUNCTION "public"."set_squad_critter_slot"("p_slot_index" integer, "p_user_critter_id" "uuid") OWNER TO "postgres";

--
-- Name: shop_purchase_receipt_json("uuid", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."shop_purchase_receipt_json"("p_user" "uuid", "p_request" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'request_id',request_id,'entry_id',entry_id,'shop_type',shop_type,
    'target_category',target_category,'target_id',target_id,'currency_id',currency_id,
    'price',price::text,'balance',balance_after::text,'granted',granted::text,
    'discarded',discarded::text,'unlock_event_id',unlock_event_id,'created_at',created_at
  ) from public.shop_purchase_receipts where user_id=p_user and request_id=p_request;
$$;


ALTER FUNCTION "public"."shop_purchase_receipt_json"("p_user" "uuid", "p_request" "uuid") OWNER TO "postgres";

--
-- Name: snapshot_dungeon_run_effects("uuid", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_existing jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_snapshot is null
     or jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_snapshot->'effects') <> 'array'
     or jsonb_typeof(p_snapshot->'loadouts') <> 'object'
     or jsonb_typeof(p_snapshot->'statuses') <> 'array'
     or jsonb_typeof(p_snapshot->'seed') <> 'number' then
    raise exception 'Invalid effect snapshot';
  end if;

  select effect_snapshot
  into v_existing
  from public.dungeon_runs
  where id = p_run_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Run not found';
  end if;

  if v_existing is not null then
    if v_existing = p_snapshot then return; end if;
    raise exception 'Effect snapshot already exists';
  end if;

  update public.dungeon_runs
  set effect_snapshot = p_snapshot
  where id = p_run_id
    and user_id = v_user_id
    and status = 'started';

  if not found then
    raise exception 'Run is not active';
  end if;
end;
$$;


ALTER FUNCTION "public"."snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb") OWNER TO "postgres";

--
-- Name: FUNCTION "snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb") IS 'Stores the authenticated user''s deterministic effect snapshot exactly once per started dungeon run.';


--
-- Name: start_dungeon_run("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."start_dungeon_run"("p_dungeon_id" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare v_payload jsonb;
begin
  v_payload:=public.start_dungeon_run_v2(p_dungeon_id,gen_random_uuid());
  return (v_payload->>'id')::uuid;
end;
$$;


ALTER FUNCTION "public"."start_dungeon_run"("p_dungeon_id" "text") OWNER TO "postgres";

--
-- Name: start_dungeon_run_v2("text", "uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."start_dungeon_run_v2"("p_dungeon_id" "text", "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_user uuid:=auth.uid();
  v_dungeon public.dungeons%rowtype;
  v_progress public.user_dungeon_progress%rowtype;
  v_run_id uuid:=gen_random_uuid();
  v_mode text;
  v_player_count integer;
  v_opponent_count integer;
  v_battle_count integer;
  v_catalog jsonb;
  v_pool jsonb;
  v_selected jsonb:='[]'::jsonb;
  v_squad jsonb;
  v_seed bigint;
  v_battle integer;
  v_slot integer;
  v_cursor integer:=0;
  v_random numeric;
  v_cumulative numeric;
  v_candidate jsonb;
  v_chosen jsonb;
  v_existing uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_request_id is null then raise exception 'VALIDATION: request id is required'; end if;

  select id into v_existing from public.dungeon_runs
  where user_id=v_user and request_id=p_request_id;
  if v_existing is not null then return public.dungeon_run_payload(v_existing); end if;
  perform id from auth.users where id=v_user for update;
  select id into v_existing from public.dungeon_runs
  where user_id=v_user and request_id=p_request_id;
  if v_existing is not null then return public.dungeon_run_payload(v_existing); end if;

  select * into v_dungeon from public.dungeons
  where id=p_dungeon_id and is_active and not is_archived;
  if not found then raise exception 'DUNGEON_UNAVAILABLE'; end if;
  select * into v_progress from public.user_dungeon_progress
  where user_id=v_user and dungeon_id=p_dungeon_id and is_unlocked
  for update;
  if not found then raise exception 'DUNGEON_LOCKED'; end if;
  if not exists(
    select 1 from public.profiles profile
    join public.user_rollcasters owned on owned.id=profile.active_rollcaster_id
    where profile.user_id=v_user and owned.user_id=v_user
  ) then raise exception 'DUNGEON_ROLLCASTER_REQUIRED'; end if;
  if not exists(
    select 1 from public.user_squad_slots slot
    join public.user_critters owned on owned.id=slot.user_critter_id
    where slot.user_id=v_user and owned.user_id=v_user
  ) then raise exception 'DUNGEON_SQUAD_REQUIRED'; end if;

  v_player_count:=split_part(v_dungeon.battle_format,'v',1)::integer;
  v_opponent_count:=split_part(v_dungeon.battle_format,'v',2)::integer;
  v_mode:=case
    when v_dungeon.dungeon_type='boss' and v_progress.clear_count=0 then 'boss'
    else 'regular'
  end;
  v_catalog:=public.dungeon_snapshot(v_dungeon.id);
  select coalesce(jsonb_agg(value order by (value->>'sequence_index')::integer),'[]'::jsonb)
  into v_pool
  from jsonb_array_elements(v_catalog->'opponents')
  where value->>'pool_type'=case when v_mode='boss' then 'boss_order' else 'regular_pool' end;
  if jsonb_array_length(v_pool)=0 then raise exception 'DUNGEON_ENCOUNTERS_MISSING'; end if;
  v_battle_count:=case
    when v_mode='boss' then jsonb_array_length(v_pool)/v_opponent_count
    else v_dungeon.battle_count
  end;
  if v_battle_count<1
    or (v_mode='boss' and jsonb_array_length(v_pool)<>v_battle_count*v_opponent_count)
  then raise exception 'DUNGEON_ENCOUNTERS_INVALID'; end if;

  v_seed:=hashtextextended(v_run_id::text,0);
  for v_battle in 1..v_battle_count loop
    for v_slot in 1..v_opponent_count loop
      if v_mode='boss' then
        v_chosen:=v_pool->((v_battle-1)*v_opponent_count+v_slot-1);
      else
        v_random:=public.dungeon_runtime_random(v_seed,'encounter:'||v_cursor);
        v_cursor:=v_cursor+1;
        v_cumulative:=0;
        v_chosen:=v_pool->(jsonb_array_length(v_pool)-1);
        for v_candidate in select value from jsonb_array_elements(v_pool) loop
          v_cumulative:=v_cumulative+coalesce((v_candidate->>'probability')::numeric,0);
          if v_random<v_cumulative then
            v_chosen:=v_candidate;
            exit;
          end if;
        end loop;
      end if;
      v_selected:=v_selected||jsonb_build_array(v_chosen||jsonb_build_object(
        'instanceId',v_run_id::text||':'||v_battle||':'||v_slot,
        'battleIndex',v_battle,
        'battlefieldSlot',v_slot-1
      ));
    end loop;
  end loop;

  select jsonb_build_object(
    'activeRollcasterId',profile.active_rollcaster_id,
    'squad',coalesce(jsonb_agg(jsonb_build_object(
      'slotIndex',slot.slot_index,
      'userCritterId',owned.id,
      'critterId',owned.critter_id,
      'level',owned.level,
      'xp',owned.xp,
      'skillIds',coalesce((
        select jsonb_agg(skill_slot.skill_id order by skill_slot.slot_index)
        from public.user_critter_skill_slots skill_slot
        where skill_slot.user_critter_id=owned.id and skill_slot.skill_id is not null
      ),'[]'::jsonb),
      'relicIds',coalesce((
        select jsonb_agg(relic_slot.relic_id order by relic_slot.slot_index)
        from public.user_critter_relic_slots relic_slot
        where relic_slot.user_critter_id=owned.id and relic_slot.relic_id is not null
      ),'[]'::jsonb)
    ) order by slot.slot_index),'[]'::jsonb)
  ) into v_squad
  from public.profiles profile
  join public.user_squad_slots slot on slot.user_id=profile.user_id
  join public.user_critters owned on owned.id=slot.user_critter_id and owned.user_id=profile.user_id
  where profile.user_id=v_user
  group by profile.active_rollcaster_id;

  insert into public.dungeon_runs(
    id,user_id,dungeon_id,status,selected_opponents,battle_format,
    player_active_count,opponent_active_count,turn_number,player_mana,opponent_mana,
    combat_state,battle_log,rewards,request_id,dungeon_version,effective_mode,
    battle_count,battle_index,random_seed,random_cursor,state_version,
    catalog_snapshot,squad_snapshot,battle_results
  ) values(
    v_run_id,v_user,v_dungeon.id,'started',v_selected,v_dungeon.battle_format,
    v_player_count,v_opponent_count,1,0,0,'{}'::jsonb,'[]'::jsonb,
    jsonb_build_object(
      'entries','[]'::jsonb,
      'defeatedOpponentInstanceIds','[]'::jsonb,
      'critterXp','{}'::jsonb,
      'rollcasterXp',0
    ),
    p_request_id,v_dungeon.version,v_mode,v_battle_count,1,v_seed,v_cursor,1,
    v_catalog,v_squad,'[]'::jsonb
  );
  return public.dungeon_run_payload(v_run_id);
end;
$$;


ALTER FUNCTION "public"."start_dungeon_run_v2"("p_dungeon_id" "text", "p_request_id" "uuid") OWNER TO "postgres";

--
-- Name: submit_collectible_combat_events("uuid", integer, "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."submit_collectible_combat_events"("p_run_id" "uuid", "p_turn_number" integer, "p_events" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid:=auth.uid(); v_run public.dungeon_runs%rowtype; e jsonb; c record;
  v_key text; v_type text; v_source text; v_target text; v_skill text; v_amount bigint;
  v_match_id text; v_match_element text; v_goal bigint; v_increment bigint; v_inserted integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_turn_number<1 or jsonb_typeof(coalesce(p_events,'[]'::jsonb))<>'array' then raise exception 'VALIDATION: invalid combat events'; end if;
  select * into v_run from public.dungeon_runs where id=p_run_id and user_id=v_user for update;
  if not found or v_run.status not in ('started','won') then raise exception 'COMBAT_RUN_UNAVAILABLE'; end if;
  perform public.reconcile_user_gated_tracking_internal(v_user);

  for e in select value from jsonb_array_elements(p_events)
  loop
    v_key:=btrim(coalesce(e->>'event_key',''));
    v_type:=e->>'event_type'; v_source:=e->>'source_critter_id'; v_target:=e->>'target_critter_id';
    v_skill:=e->>'skill_id'; v_amount:=coalesce((e->>'amount')::bigint,0);
    if v_key='' or v_type not in ('knock_out_critters','deal_damage','take_damage','use_skill') or v_amount<1 then
      raise exception 'VALIDATION: invalid combat event';
    end if;
    if v_type in ('knock_out_critters','deal_damage') then
      if not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_target) then raise exception 'VALIDATION: invalid enemy target'; end if;
      v_match_id:=v_target;
      select element_id into v_match_element from public.critters where id=v_target;
    elsif v_type='take_damage' then
      if not exists(select 1 from jsonb_array_elements(v_run.selected_opponents) o where o->>'critter_id'=v_source) then raise exception 'VALIDATION: invalid enemy source'; end if;
      if not exists(select 1 from public.user_critters where user_id=v_user and critter_id=v_target) then raise exception 'VALIDATION: invalid friendly target'; end if;
      v_match_id:=v_source;
      select element_id into v_match_element from public.critters where id=v_source;
    else
      if not exists(select 1 from public.user_critters uc join public.user_critter_skills us on us.user_critter_id=uc.id
        where uc.user_id=v_user and uc.critter_id=v_source and us.skill_id=v_skill) then raise exception 'VALIDATION: invalid skill source'; end if;
      v_match_id:=v_skill;
      select element_id into v_match_element from public.skills where id=v_skill;
      v_amount:=1;
    end if;

    insert into public.collectible_combat_events(run_id,event_key,user_id,turn_number,event_type,source_critter_id,target_critter_id,skill_id,amount,payload)
    values(p_run_id,v_key,v_user,p_turn_number,v_type,v_source,v_target,v_skill,v_amount,e)
    on conflict(run_id,event_key) do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted=0 then continue; end if;

    for c in
      select challenge.*
      from public.user_tracked_collectible_challenges tracked
      join public.collectible_unlock_challenges challenge on challenge.id=tracked.challenge_id
      join lateral public.collectible_challenge_states(
        v_user,
        challenge.collectible_type,
        challenge.collectible_id
      ) state on state.challenge_id=challenge.id and state.eligible
      where tracked.user_id=v_user and challenge.challenge_type=v_type
      order by tracked.slot_order
    loop
      if not c.any_target then
        if c.target_mode in ('species','skill') and not (v_match_id=any(c.target_ids)) then continue; end if;
        if c.target_mode='element' and not (v_match_element=any(c.target_ids)) then continue; end if;
      end if;
      v_goal:=c.required_amount;
      v_increment:=case when v_type in ('knock_out_critters','use_skill') then 1 else v_amount end;
      insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at,updated_at)
      values(v_user,c.id,least(v_goal,v_increment),case when v_increment>=v_goal then now() else null end,now())
      on conflict(user_id,challenge_id) do update set
        progress=least(v_goal,public.user_collectible_challenge_progress.progress+v_increment),
        completed_at=case when least(v_goal,public.user_collectible_challenge_progress.progress+v_increment)>=v_goal
          then coalesce(public.user_collectible_challenge_progress.completed_at,now()) else null end,
        updated_at=now();
    end loop;
  end loop;
  perform public.evaluate_all_collectible_unlocks_internal(v_user);
  return public.get_collectible_player_snapshot();
end;
$$;


ALTER FUNCTION "public"."submit_collectible_combat_events"("p_run_id" "uuid", "p_turn_number" integer, "p_events" "jsonb") OWNER TO "postgres";

--
-- Name: sync_currency_coins_to_profile(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."sync_currency_coins_to_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if pg_trigger_depth()>1 or new.currency_id<>'coins' then return new; end if;
  if new.balance>2147483647 then raise exception 'VALIDATION: Coins balance exceeds the legacy profiles.coins range'; end if;
  update public.profiles set coins=new.balance::integer,updated_at=now() where user_id=new.user_id and coins<>new.balance::integer;
  return new;
end; $$;


ALTER FUNCTION "public"."sync_currency_coins_to_profile"() OWNER TO "postgres";

--
-- Name: sync_profile_coins_to_currency(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."sync_profile_coins_to_currency"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if pg_trigger_depth()>1 then return new; end if;
  insert into public.user_currencies(user_id,currency_id,balance,updated_at)
  values(new.user_id,'coins',greatest(new.coins,0),now())
  on conflict(user_id,currency_id) do update set balance=excluded.balance,updated_at=now();
  return new;
end; $$;


ALTER FUNCTION "public"."sync_profile_coins_to_currency"() OWNER TO "postgres";

--
-- Name: track_collectible_challenge("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."track_collectible_challenge"("p_challenge_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid:=auth.uid();
  v_type text;
  v_id text;
  v_slot integer;
  v_eligible boolean;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select collectible_type,collectible_id into v_type,v_id
  from public.collectible_unlock_challenges
  where id=p_challenge_id
    and challenge_type in ('knock_out_critters','deal_damage','take_damage','use_skill');
  if v_type is null then raise exception 'VALIDATION: challenge is not trackable'; end if;

  select state.eligible into v_eligible
  from public.collectible_challenge_states(v_user,v_type,v_id) state
  where state.challenge_id=p_challenge_id;
  if not coalesce(v_eligible,false) then raise exception 'CHALLENGE_GATED'; end if;

  if exists(select 1 from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id) then
    select slot_order into v_slot from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id;
    return jsonb_build_object('challenge_id',p_challenge_id,'slot_order',v_slot);
  end if;
  delete from public.user_tracked_collectible_challenges tracked
  using public.collectible_unlock_challenges challenge
  where tracked.user_id=v_user
    and tracked.challenge_id=challenge.id
    and challenge.collectible_type=v_type
    and challenge.collectible_id=v_id;
  select slot into v_slot
  from generate_series(1,3) slot
  where not exists(
    select 1 from public.user_tracked_collectible_challenges
    where user_id=v_user and slot_order=slot
  )
  order by slot limit 1;
  if v_slot is null then raise exception 'TRACKING_LIMIT_REACHED'; end if;
  insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order)
  values(v_user,p_challenge_id,v_slot);
  return jsonb_build_object('challenge_id',p_challenge_id,'slot_order',v_slot);
end;
$$;


ALTER FUNCTION "public"."track_collectible_challenge"("p_challenge_id" "uuid") OWNER TO "postgres";

--
-- Name: unlock_critter_skill("uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."unlock_critter_skill"("p_user_critter_id" "uuid", "p_skill_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_critter_id text;
  v_level int;
  v_skill_points int;
  v_unlock_level int;
  v_unlock_cost int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select owned.critter_id, owned.level, owned.skill_points
  into v_critter_id, v_level, v_skill_points
  from public.user_critters owned
  where owned.id = p_user_critter_id
    and owned.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Critter is not owned';
  end if;

  select authored.unlock_level, authored.unlock_cost
  into v_unlock_level, v_unlock_cost
  from public.critter_skill_unlocks authored
  where authored.critter_id = v_critter_id
    and authored.skill_id = p_skill_id;

  if not found then
    raise exception 'Skill is not available for this Critter';
  end if;

  if exists (
    select 1
    from public.user_critter_skills unlocked
    where unlocked.user_critter_id = p_user_critter_id
      and unlocked.skill_id = p_skill_id
  ) then
    raise exception 'Skill is already unlocked';
  end if;

  if v_level < v_unlock_level then
    raise exception 'Skill requires Critter level %', v_unlock_level;
  end if;

  if v_skill_points < v_unlock_cost then
    raise exception 'Not enough Skill points';
  end if;

  update public.user_critters
  set skill_points = skill_points - v_unlock_cost
  where id = p_user_critter_id;

  insert into public.user_critter_skills(user_critter_id, skill_id)
  values(p_user_critter_id, p_skill_id);
end;
$$;


ALTER FUNCTION "public"."unlock_critter_skill"("p_user_critter_id" "uuid", "p_skill_id" "text") OWNER TO "postgres";

--
-- Name: unlock_rollcaster_ability("uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."unlock_rollcaster_ability"("p_user_rollcaster_id" "uuid", "p_ability_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_rollcaster_id text;
  v_level int;
  v_ability_points int;
  v_unlock_level int;
  v_unlock_cost int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select owned.rollcaster_id, owned.level, owned.ability_points
  into v_rollcaster_id, v_level, v_ability_points
  from public.user_rollcasters owned
  where owned.id = p_user_rollcaster_id
    and owned.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Rollcaster is not owned';
  end if;

  select authored.unlock_level, authored.unlock_cost
  into v_unlock_level, v_unlock_cost
  from public.rollcaster_ability_unlocks authored
  where authored.rollcaster_id = v_rollcaster_id
    and authored.ability_id = p_ability_id;

  if not found then
    raise exception 'Ability is not available for this Rollcaster';
  end if;

  if exists (
    select 1
    from public.user_rollcaster_abilities unlocked
    where unlocked.user_rollcaster_id = p_user_rollcaster_id
      and unlocked.ability_id = p_ability_id
  ) then
    raise exception 'Ability is already unlocked';
  end if;

  if v_level < v_unlock_level then
    raise exception 'Ability requires Rollcaster level %', v_unlock_level;
  end if;

  if v_ability_points < v_unlock_cost then
    raise exception 'Not enough Ability points';
  end if;

  update public.user_rollcasters
  set ability_points = ability_points - v_unlock_cost
  where id = p_user_rollcaster_id;

  insert into public.user_rollcaster_abilities(user_id, user_rollcaster_id, ability_id)
  values(v_user_id, p_user_rollcaster_id, p_ability_id);
end;
$$;


ALTER FUNCTION "public"."unlock_rollcaster_ability"("p_user_rollcaster_id" "uuid", "p_ability_id" "text") OWNER TO "postgres";

--
-- Name: untrack_collectible_challenge("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."untrack_collectible_challenge"("p_challenge_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  delete from public.user_tracked_collectible_challenges where user_id=v_user and challenge_id=p_challenge_id;
  perform public.compact_user_tracking_slots(v_user);
end;
$$;


ALTER FUNCTION "public"."untrack_collectible_challenge"("p_challenge_id" "uuid") OWNER TO "postgres";

--
-- Name: validate_collectible_gate_configuration_trigger(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_collectible_gate_configuration_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op='UPDATE' and (old.collectible_type,old.collectible_id) is distinct from (new.collectible_type,new.collectible_id) then
    perform public.assert_collectible_gate_integrity(old.collectible_type,old.collectible_id);
  end if;
  if tg_op='DELETE' then
    perform public.assert_collectible_gate_integrity(old.collectible_type,old.collectible_id);
  else
    perform public.assert_collectible_gate_integrity(new.collectible_type,new.collectible_id);
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."validate_collectible_gate_configuration_trigger"() OWNER TO "postgres";

--
-- Name: validate_collectible_unlock_challenge(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_collectible_unlock_challenge"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."validate_collectible_unlock_challenge"() OWNER TO "postgres";

--
-- Name: validate_dungeon_completion_drop_row(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_dungeon_completion_drop_row"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.validate_dungeon_drop_target(new.drop_type,new.target_category,new.target_id);
  return new;
end; $$;


ALTER FUNCTION "public"."validate_dungeon_completion_drop_row"() OWNER TO "postgres";

--
-- Name: validate_dungeon_drop_target("text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_dungeon_drop_target"("p_drop_type" "text", "p_target_category" "text", "p_target_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
begin
  if p_drop_type='relic' then
    if p_target_category<>'relic' or not exists(select 1 from public.relics where id=p_target_id) then
      raise exception 'VALIDATION: choose an existing Relic drop';
    end if;
  elsif p_drop_type='shard' then
    if p_target_category not in ('critter','rollcaster','relic') then
      raise exception 'VALIDATION: choose a collectible category for Shards';
    end if;
    if not exists(
      select 1 from public.collectible_unlock_challenges challenge
      where challenge.collectible_type=p_target_category
        and challenge.collectible_id=p_target_id
        and challenge.challenge_type='shop_shards'
    ) then
      raise exception 'VALIDATION: Shard drops require an existing Shard Shop unlock challenge';
    end if;
  elsif p_drop_type='currency' then
    if not exists(select 1 from public.currencies where id=p_target_id) then
      raise exception 'VALIDATION: choose an existing Currency drop';
    end if;
  else
    raise exception 'VALIDATION: unsupported Dungeon drop type';
  end if;
end; $$;


ALTER FUNCTION "public"."validate_dungeon_drop_target"("p_drop_type" "text", "p_target_category" "text", "p_target_id" "text") OWNER TO "postgres";

--
-- Name: validate_dungeon_item_drop_row(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_dungeon_item_drop_row"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.validate_dungeon_drop_target(new.drop_type,new.target_category,new.target_id);
  return new;
end; $$;


ALTER FUNCTION "public"."validate_dungeon_item_drop_row"() OWNER TO "postgres";

--
-- Name: validate_inline_effect_parameters("text", "jsonb", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_inline_effect_parameters"("p_template_id" "text", "p_parameters" "jsonb", "p_owner" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_kind text;
  v_category text;
  v_target text := p_parameters->>'target';
  v_element_target boolean;
begin
  select runtime_kind,effect_category into v_kind,v_category
  from public.effect_templates
  where id=p_template_id and is_active and not is_archived and is_runtime_supported;
  if v_kind is null then raise exception 'VALIDATION: inactive, unsupported, or missing effect template %',p_template_id; end if;
  if v_category<>p_owner then raise exception 'VALIDATION: template % does not belong to % effects',p_template_id,p_owner; end if;
  if jsonb_typeof(p_parameters)<>'object' then raise exception 'VALIDATION: effect parameters must be an object'; end if;

  if p_owner='skill' and v_target not in ('self','all_allies','all_friendlies','all_enemies','target_enemies') then raise exception 'VALIDATION: invalid Skill effect target'; end if;
  if p_owner='ability' and v_target not in ('all_friendlies','all_enemies','all_element_friendlies','all_element_enemies') then raise exception 'VALIDATION: invalid Ability effect target'; end if;
  if p_owner='relic' and v_target not in ('equipped_critter','equipped_allies','equipped_friendlies','all_enemies') then raise exception 'VALIDATION: invalid Relic effect target'; end if;
  if p_owner='status' and v_target not in ('status_holder','status_holder_allies','status_holder_friendlies','status_holder_enemies') then raise exception 'VALIDATION: invalid Status effect target'; end if;

  if v_kind='stat_modifier' then
    if p_parameters->>'stat' not in ('hp','atk','def','spd') or p_parameters->>'value_mode' not in ('flat','percentage') or jsonb_typeof(p_parameters->'amount')<>'number' then raise exception 'VALIDATION: invalid Stat Modifier parameters'; end if;
    if p_owner='skill' and (jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1) then raise exception 'VALIDATION: Skill Stat Modifier chance must be between 0 and 1'; end if;
  elsif v_kind='mana_dice_modifier' then
    if jsonb_typeof(p_parameters->'minimum_delta')<>'number' or jsonb_typeof(p_parameters->'maximum_delta')<>'number'
      or (p_parameters->>'minimum_delta')::numeric<>trunc((p_parameters->>'minimum_delta')::numeric)
      or (p_parameters->>'maximum_delta')::numeric<>trunc((p_parameters->>'maximum_delta')::numeric)
      or ((p_parameters->>'minimum_delta')::numeric=0 and (p_parameters->>'maximum_delta')::numeric=0)
    then raise exception 'VALIDATION: Mana Dice deltas must be non-zero integer changes'; end if;
  elsif v_kind='apply_status' then
    if not exists(select 1 from public.statuses where id=p_parameters->>'status_id') then raise exception 'VALIDATION: Apply Status references an unknown Status'; end if;
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 then raise exception 'VALIDATION: Apply Status chance must be between 0 and 1'; end if;
    if jsonb_typeof(p_parameters->'indefinite')<>'boolean' then raise exception 'VALIDATION: Apply Status indefinite must be boolean'; end if;
    if not (p_parameters->>'indefinite')::boolean and (jsonb_typeof(p_parameters->'turns')<>'number' or (p_parameters->>'turns')::numeric<1 or (p_parameters->>'turns')::numeric<>trunc((p_parameters->>'turns')::numeric)) then raise exception 'VALIDATION: Apply Status turns must be a positive integer'; end if;
  elsif v_kind='restore_hp' then
    if p_parameters->>'value_mode' not in ('flat','percent_max_hp','percent_damage_done') or jsonb_typeof(p_parameters->'amount')<>'number' or (p_parameters->>'amount')::numeric<0 then raise exception 'VALIDATION: invalid Restore HP amount'; end if;
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 then raise exception 'VALIDATION: Restore HP chance must be between 0 and 1'; end if;
  elsif v_kind='damage_over_time' then
    if p_parameters->>'timing' not in ('start_of_turn','end_of_turn') or p_parameters->>'value_mode' not in ('flat','percent_max_hp') or jsonb_typeof(p_parameters->'amount')<>'number' or (p_parameters->>'amount')::numeric<0 then raise exception 'VALIDATION: invalid Damage Over Time parameters'; end if;
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 then raise exception 'VALIDATION: Damage Over Time chance must be between 0 and 1'; end if;
  elsif v_kind='skip_action_chance' then
    if jsonb_typeof(p_parameters->'chance')<>'number' or (p_parameters->>'chance')::numeric not between 0 and 1 or p_parameters->>'combat_action' not in ('swap','block','skill','all') then raise exception 'VALIDATION: invalid Skip Action Chance parameters'; end if;
  end if;

  v_element_target := p_owner='ability' and v_target in ('all_element_friendlies','all_element_enemies');
  if v_element_target then
    if jsonb_typeof(p_parameters->'element_ids')<>'array' or jsonb_array_length(p_parameters->'element_ids')=0 then raise exception 'VALIDATION: element target requires element_ids'; end if;
    if exists(select 1 from jsonb_array_elements_text(p_parameters->'element_ids') id where not exists(select 1 from public.elements e where e.id=id.value)) then raise exception 'VALIDATION: element_ids contains an unknown Element'; end if;
  end if;
end; $$;


ALTER FUNCTION "public"."validate_inline_effect_parameters"("p_template_id" "text", "p_parameters" "jsonb", "p_owner" "text") OWNER TO "postgres";

--
-- Name: validate_inline_effect_row(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_inline_effect_row"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_owner text;
begin
  v_owner:=case tg_table_name when 'skill_effects' then 'skill' when 'ability_effects' then 'ability' when 'relic_effects' then 'relic' when 'status_effects' then 'status' end;
  perform public.validate_inline_effect_parameters(new.template_id,new.parameters,v_owner);
  return new;
end; $$;


ALTER FUNCTION "public"."validate_inline_effect_row"() OWNER TO "postgres";

--
-- Name: validate_promo_code_reward(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_promo_code_reward"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_max_owned integer;
begin
  if new.reward_type='currency' then
    new.target_category:=null;
    if not exists(
      select 1 from public.currencies
      where id=new.target_id and is_active and not is_archived
    ) then raise exception 'VALIDATION: Promo Currency target must be active'; end if;
  elsif new.reward_type='shard' then
    if new.target_category is null
      or not public.collectible_exists(new.target_category,new.target_id)
      or not exists(
        select 1 from public.collectible_unlock_challenges
        where collectible_type=new.target_category
          and collectible_id=new.target_id
          and challenge_type='shop_shards'
      )
    then raise exception 'VALIDATION: Promo Shards require a collectible with a Shop Shards challenge'; end if;
  elsif new.reward_type='critter' then
    new.target_category:='critter';
    new.quantity:=1;
    if not exists(select 1 from public.critters where id=new.target_id and is_active and not is_archived)
      then raise exception 'VALIDATION: Promo Critter target must be active'; end if;
  elsif new.reward_type='rollcaster' then
    new.target_category:='rollcaster';
    new.quantity:=1;
    if not exists(select 1 from public.rollcasters where id=new.target_id and is_active and not is_archived)
      then raise exception 'VALIDATION: Promo Rollcaster target must be active'; end if;
  elsif new.reward_type='relic' then
    new.target_category:='relic';
    select max_owned into v_max_owned
    from public.relics where id=new.target_id and is_active and not is_archived;
    if v_max_owned is null then raise exception 'VALIDATION: Promo Relic target must be active'; end if;
    if new.quantity>v_max_owned then raise exception 'VALIDATION: Promo Relic quantity exceeds max_owned'; end if;
  end if;
  new.updated_at:=now();
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_promo_code_reward"() OWNER TO "postgres";

--
-- Name: validate_shop_entry(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_shop_entry"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."validate_shop_entry"() OWNER TO "postgres";

--
-- Name: validate_tracked_collectible_challenge(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_tracked_collectible_challenge"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."validate_tracked_collectible_challenge"() OWNER TO "postgres";

--
-- Name: validate_user_collectible_shards(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."validate_user_collectible_shards"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.collectible_exists(new.collectible_type,new.collectible_id) then raise exception 'VALIDATION: shard collectible does not exist'; end if;
  new.updated_at:=now(); return new;
end; $$;


ALTER FUNCTION "public"."validate_user_collectible_shards"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: ability_effects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."ability_effects" (
    "ability_id" "text" NOT NULL,
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "template_id" "text" NOT NULL,
    "effect_category" "text" GENERATED ALWAYS AS ('ability'::"text") STORED,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "ability_effects_description_check" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "ability_effects_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "ability_effects_parameters_check" CHECK (("jsonb_typeof"("parameters") = 'object'::"text")),
    CONSTRAINT "ability_effects_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."ability_effects" OWNER TO "postgres";

--
-- Name: collectible_combat_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."collectible_combat_events" (
    "run_id" "uuid" NOT NULL,
    "event_key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "turn_number" integer NOT NULL,
    "event_type" "text" NOT NULL,
    "source_critter_id" "text",
    "target_critter_id" "text",
    "skill_id" "text",
    "amount" bigint NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "collectible_combat_events_amount_check" CHECK (("amount" > 0)),
    CONSTRAINT "collectible_combat_events_event_key_check" CHECK (("btrim"("event_key") <> ''::"text")),
    CONSTRAINT "collectible_combat_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['knock_out_critters'::"text", 'deal_damage'::"text", 'take_damage'::"text", 'use_skill'::"text"]))),
    CONSTRAINT "collectible_combat_events_turn_number_check" CHECK (("turn_number" > 0))
);


ALTER TABLE "public"."collectible_combat_events" OWNER TO "postgres";

--
-- Name: collectible_unlock_challenges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."collectible_unlock_challenges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "collectible_type" "text" NOT NULL,
    "collectible_id" "text" NOT NULL,
    "challenge_type" "text" NOT NULL,
    "target_category" "text",
    "target_id" "text",
    "target_mode" "text",
    "any_target" boolean DEFAULT false NOT NULL,
    "target_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "required_amount" bigint,
    "required_level" integer,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gate_order" integer,
    CONSTRAINT "collectible_unlock_challenges_challenge_type_check" CHECK (("challenge_type" = ANY (ARRAY['own_collectible'::"text", 'level_up_critter'::"text", 'knock_out_critters'::"text", 'deal_damage'::"text", 'take_damage'::"text", 'use_skill'::"text", 'shop_shards'::"text", 'shop_relic'::"text"]))),
    CONSTRAINT "collectible_unlock_challenges_collectible_type_check" CHECK (("collectible_type" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))),
    CONSTRAINT "collectible_unlock_challenges_gate_order_check" CHECK ((("gate_order" IS NULL) OR ("gate_order" > 0))),
    CONSTRAINT "collectible_unlock_challenges_required_amount_check" CHECK ((("required_amount" IS NULL) OR ("required_amount" > 0))),
    CONSTRAINT "collectible_unlock_challenges_required_level_check" CHECK ((("required_level" IS NULL) OR ("required_level" > 0))),
    CONSTRAINT "collectible_unlock_challenges_sort_order_check" CHECK (("sort_order" >= 0)),
    CONSTRAINT "collectible_unlock_challenges_target_category_check" CHECK ((("target_category" IS NULL) OR ("target_category" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"])))),
    CONSTRAINT "collectible_unlock_challenges_target_mode_check" CHECK ((("target_mode" IS NULL) OR ("target_mode" = ANY (ARRAY['species'::"text", 'element'::"text", 'skill'::"text"]))))
);


ALTER TABLE "public"."collectible_unlock_challenges" OWNER TO "postgres";

--
-- Name: COLUMN "collectible_unlock_challenges"."gate_order"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."collectible_unlock_challenges"."gate_order" IS 'Nullable 1-based prerequisite order. NULL means ungated. Gate sequences are contiguous per collectible.';


--
-- Name: collectible_unlock_requirements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."collectible_unlock_requirements" (
    "collectible_type" "text" NOT NULL,
    "collectible_id" "text" NOT NULL,
    "required_challenges" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "collectible_unlock_requirements_collectible_type_check" CHECK (("collectible_type" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))),
    CONSTRAINT "collectible_unlock_requirements_required_challenges_check" CHECK (("required_challenges" >= 0))
);


ALTER TABLE "public"."collectible_unlock_requirements" OWNER TO "postgres";

--
-- Name: effect_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."effect_templates" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "runtime_kind" "text" NOT NULL,
    "runtime_version" integer NOT NULL,
    "allowed_owners" "text"[] NOT NULL,
    "parameter_schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ui_schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "description_template" "text",
    "is_runtime_supported" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "effect_category" "text" NOT NULL,
    CONSTRAINT "effect_templates_category_check" CHECK (("effect_category" = ANY (ARRAY['skill'::"text", 'ability'::"text", 'relic'::"text", 'status'::"text"]))),
    CONSTRAINT "effect_templates_category_id_check" CHECK (("id" ~~ ("effect_category" || '-%'::"text"))),
    CONSTRAINT "effect_templates_runtime_version_check" CHECK (("runtime_version" > 0)),
    CONSTRAINT "effect_templates_single_category_check" CHECK (("allowed_owners" = ARRAY["effect_category"])),
    CONSTRAINT "effect_templates_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."effect_templates" OWNER TO "postgres";

--
-- Name: relic_effects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."relic_effects" (
    "relic_id" "text" NOT NULL,
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "template_id" "text" NOT NULL,
    "effect_category" "text" GENERATED ALWAYS AS ('relic'::"text") STORED,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "relic_effects_description_check" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "relic_effects_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "relic_effects_parameters_check" CHECK (("jsonb_typeof"("parameters") = 'object'::"text")),
    CONSTRAINT "relic_effects_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."relic_effects" OWNER TO "postgres";

--
-- Name: skill_effects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."skill_effects" (
    "skill_id" "text" NOT NULL,
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "template_id" "text" NOT NULL,
    "effect_category" "text" GENERATED ALWAYS AS ('skill'::"text") STORED,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "skill_effects_description_check" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "skill_effects_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "skill_effects_parameters_check" CHECK (("jsonb_typeof"("parameters") = 'object'::"text")),
    CONSTRAINT "skill_effects_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."skill_effects" OWNER TO "postgres";

--
-- Name: status_effects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."status_effects" (
    "status_id" "text" NOT NULL,
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "template_id" "text" NOT NULL,
    "effect_category" "text" GENERATED ALWAYS AS ('status'::"text") STORED,
    "parameters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "status_effects_description_check" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "status_effects_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "status_effects_parameters_check" CHECK (("jsonb_typeof"("parameters") = 'object'::"text")),
    CONSTRAINT "status_effects_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."status_effects" OWNER TO "postgres";

--
-- Name: combat_effects_v1; Type: VIEW; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW "public"."combat_effects_v1" AS
 SELECT 'skill'::"text" AS "owner_type",
    "e"."skill_id" AS "owner_id",
    "e"."id",
    "e"."name",
    "e"."description",
    "e"."sort_order",
    "e"."parameters",
    "t"."id" AS "template_id",
    "t"."runtime_kind",
    "t"."runtime_version"
   FROM ("public"."skill_effects" "e"
     JOIN "public"."effect_templates" "t" ON (("t"."id" = "e"."template_id")))
UNION ALL
 SELECT 'ability'::"text" AS "owner_type",
    "e"."ability_id" AS "owner_id",
    "e"."id",
    "e"."name",
    "e"."description",
    "e"."sort_order",
    "e"."parameters",
    "t"."id" AS "template_id",
    "t"."runtime_kind",
    "t"."runtime_version"
   FROM ("public"."ability_effects" "e"
     JOIN "public"."effect_templates" "t" ON (("t"."id" = "e"."template_id")))
UNION ALL
 SELECT 'relic'::"text" AS "owner_type",
    "e"."relic_id" AS "owner_id",
    "e"."id",
    "e"."name",
    "e"."description",
    "e"."sort_order",
    "e"."parameters",
    "t"."id" AS "template_id",
    "t"."runtime_kind",
    "t"."runtime_version"
   FROM ("public"."relic_effects" "e"
     JOIN "public"."effect_templates" "t" ON (("t"."id" = "e"."template_id")))
UNION ALL
 SELECT 'status'::"text" AS "owner_type",
    "e"."status_id" AS "owner_id",
    "e"."id",
    "e"."name",
    "e"."description",
    "e"."sort_order",
    "e"."parameters",
    "t"."id" AS "template_id",
    "t"."runtime_kind",
    "t"."runtime_version"
   FROM ("public"."status_effects" "e"
     JOIN "public"."effect_templates" "t" ON (("t"."id" = "e"."template_id")));


ALTER VIEW "public"."combat_effects_v1" OWNER TO "postgres";

--
-- Name: combat_turn_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."combat_turn_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "run_id" "uuid" NOT NULL,
    "turn_number" integer NOT NULL,
    "side" "text" NOT NULL,
    "actor_slot" integer NOT NULL,
    "action_type" "text" NOT NULL,
    "skill_id" "text",
    "target_side" "text",
    "target_slot" integer,
    "swap_in_user_critter_id" "uuid",
    "mana_cost" integer DEFAULT 0 NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "combat_turn_actions_action_type_check" CHECK (("action_type" = ANY (ARRAY['swap'::"text", 'block'::"text", 'skill'::"text", 'skip'::"text"]))),
    CONSTRAINT "combat_turn_actions_side_check" CHECK (("side" = ANY (ARRAY['player'::"text", 'opponent'::"text"]))),
    CONSTRAINT "combat_turn_actions_target_side_check" CHECK (("target_side" = ANY (ARRAY['player'::"text", 'opponent'::"text"])))
);


ALTER TABLE "public"."combat_turn_actions" OWNER TO "postgres";

--
-- Name: content_change_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."content_change_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "previous_version" integer,
    "next_version" integer,
    "before_snapshot" "jsonb",
    "after_snapshot" "jsonb",
    "change_note" "text",
    CONSTRAINT "content_change_log_operation_check" CHECK (("operation" = ANY (ARRAY['create'::"text", 'update'::"text", 'publish'::"text", 'archive'::"text", 'restore'::"text", 'rename'::"text", 'delete'::"text"])))
);


ALTER TABLE "public"."content_change_log" OWNER TO "postgres";

--
-- Name: TABLE "content_change_log"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."content_change_log" IS 'Append-only snapshots for all catalog mutations performed through admin RPCs.';


--
-- Name: COLUMN "content_change_log"."admin_user_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."content_change_log"."admin_user_id" IS 'Historical Auth user UUID retained after user deletion; intentionally not a live foreign key.';


--
-- Name: critter_level_progression; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."critter_level_progression" (
    "critter_id" "text" NOT NULL,
    "level" integer NOT NULL,
    "total_required_xp" integer NOT NULL,
    "grant_skill_points" integer DEFAULT 0 NOT NULL,
    "hp_delta" integer DEFAULT 0 NOT NULL,
    "atk_delta" integer DEFAULT 0 NOT NULL,
    "def_delta" integer DEFAULT 0 NOT NULL,
    "spd_delta" integer DEFAULT 0 NOT NULL,
    "dice_max_delta" integer DEFAULT 0 NOT NULL,
    "block_cost_delta" integer DEFAULT 0 NOT NULL,
    "swap_cost_delta" integer DEFAULT 0 NOT NULL,
    "total_unlocked_relic_slots" integer DEFAULT 1 NOT NULL,
    "dice_min_delta" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."critter_level_progression" OWNER TO "postgres";

--
-- Name: critter_skill_unlocks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."critter_skill_unlocks" (
    "critter_id" "text" NOT NULL,
    "skill_id" "text" NOT NULL,
    "unlock_level" integer NOT NULL,
    "unlock_cost" integer DEFAULT 0 NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "sort_order" integer NOT NULL
);


ALTER TABLE "public"."critter_skill_unlocks" OWNER TO "postgres";

--
-- Name: critters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."critters" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "element_1_id" "text" NOT NULL,
    "base_hp" integer NOT NULL,
    "base_atk" integer NOT NULL,
    "base_def" integer NOT NULL,
    "base_spd" integer NOT NULL,
    "base_dice_max" integer NOT NULL,
    "base_block_cost" integer NOT NULL,
    "base_swap_cost" integer NOT NULL,
    "asset_path" "text",
    "description" "text",
    "sort_order" integer NOT NULL,
    "base_dice_min" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "element_2_id" "text",
    "element_id" "text" GENERATED ALWAYS AS ("element_1_id") STORED,
    CONSTRAINT "critters_base_dice_bounds_check" CHECK (("base_dice_max" >= "base_dice_min")),
    CONSTRAINT "critters_base_dice_min_check" CHECK (("base_dice_min" >= 1)),
    CONSTRAINT "critters_element_slots_distinct_check" CHECK ((("element_2_id" IS NULL) OR ("element_2_id" <> "element_1_id"))),
    CONSTRAINT "critters_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."critters" OWNER TO "postgres";

--
-- Name: COLUMN "critters"."element_1_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."critters"."element_1_id" IS 'Required primary Element. Display and serialize before element_2_id.';


--
-- Name: COLUMN "critters"."element_2_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."critters"."element_2_id" IS 'Optional secondary Element. Must be null or different from element_1_id.';


--
-- Name: COLUMN "critters"."element_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."critters"."element_id" IS 'Deprecated read-only compatibility alias for element_1_id. New code must use element_1_id.';


--
-- Name: currencies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."currencies" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "asset_path" "text",
    "is_default" boolean DEFAULT false NOT NULL,
    "is_system" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "text_color" "text",
    CONSTRAINT "currencies_description_check" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "currencies_id_check" CHECK (("id" ~ '^[A-Za-z0-9_-]+$'::"text")),
    CONSTRAINT "currencies_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "currencies_text_color_check" CHECK ((("text_color" IS NULL) OR ("text_color" ~ '^#[0-9A-Fa-f]{6}$'::"text"))),
    CONSTRAINT "currencies_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."currencies" OWNER TO "postgres";

--
-- Name: dev_tool_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dev_tool_users" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."dev_tool_users" OWNER TO "postgres";

--
-- Name: TABLE "dev_tool_users"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."dev_tool_users" IS 'Allowlist for dev-only Supabase Auth identities that may use Rollcasters Content Studio.';


--
-- Name: dungeon_completion_drops; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_completion_drops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dungeon_id" "text" NOT NULL,
    "completion_phase" "text" NOT NULL,
    "drop_type" "text" NOT NULL,
    "target_category" "text",
    "target_id" "text" NOT NULL,
    "min_amount" integer NOT NULL,
    "max_amount" integer NOT NULL,
    "probability" numeric(8,6) NOT NULL,
    "dupe_currency_id" "text",
    "dupe_currency_amount" integer,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "dungeon_completion_drops_check" CHECK (("max_amount" >= "min_amount")),
    CONSTRAINT "dungeon_completion_drops_check1" CHECK (((("drop_type" = 'currency'::"text") AND ("target_category" IS NULL) AND ("dupe_currency_id" IS NULL) AND ("dupe_currency_amount" IS NULL)) OR (("drop_type" = 'shard'::"text") AND ("target_category" IS NOT NULL) AND ("dupe_currency_id" IS NOT NULL) AND ("dupe_currency_amount" IS NOT NULL)) OR (("drop_type" = 'relic'::"text") AND ("target_category" = 'relic'::"text") AND ("dupe_currency_id" IS NOT NULL) AND ("dupe_currency_amount" IS NOT NULL)))),
    CONSTRAINT "dungeon_completion_drops_check2" CHECK ((("completion_phase" <> 'first_time'::"text") OR (("min_amount" = "max_amount") AND ("probability" = (1)::numeric)))),
    CONSTRAINT "dungeon_completion_drops_completion_phase_check" CHECK (("completion_phase" = ANY (ARRAY['first_time'::"text", 'regular'::"text"]))),
    CONSTRAINT "dungeon_completion_drops_drop_type_check" CHECK (("drop_type" = ANY (ARRAY['currency'::"text", 'shard'::"text", 'relic'::"text"]))),
    CONSTRAINT "dungeon_completion_drops_dupe_currency_amount_check" CHECK (("dupe_currency_amount" >= 0)),
    CONSTRAINT "dungeon_completion_drops_min_amount_check" CHECK (("min_amount" > 0)),
    CONSTRAINT "dungeon_completion_drops_probability_check" CHECK ((("probability" >= (0)::numeric) AND ("probability" <= (1)::numeric))),
    CONSTRAINT "dungeon_completion_drops_sort_order_check" CHECK (("sort_order" >= 0)),
    CONSTRAINT "dungeon_completion_drops_target_category_check" CHECK ((("target_category" IS NULL) OR ("target_category" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))))
);


ALTER TABLE "public"."dungeon_completion_drops" OWNER TO "postgres";

--
-- Name: TABLE "dungeon_completion_drops"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."dungeon_completion_drops" IS 'First-clear guaranteed rewards and repeat-clear probabilistic completion rewards.';


--
-- Name: dungeon_opponent_currency_drops; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_opponent_currency_drops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opponent_id" "uuid" NOT NULL,
    "currency_id" "text" NOT NULL,
    "min_amount" integer NOT NULL,
    "max_amount" integer NOT NULL,
    "probability" numeric(8,6) NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "dungeon_opponent_currency_drops_check" CHECK (("max_amount" >= "min_amount")),
    CONSTRAINT "dungeon_opponent_currency_drops_min_amount_check" CHECK (("min_amount" > 0)),
    CONSTRAINT "dungeon_opponent_currency_drops_probability_check" CHECK ((("probability" >= (0)::numeric) AND ("probability" <= (1)::numeric))),
    CONSTRAINT "dungeon_opponent_currency_drops_sort_order_check" CHECK (("sort_order" >= 0))
);


ALTER TABLE "public"."dungeon_opponent_currency_drops" OWNER TO "postgres";

--
-- Name: TABLE "dungeon_opponent_currency_drops"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."dungeon_opponent_currency_drops" IS 'Independent currency rolls awarded when one authored Dungeon opponent is defeated.';


--
-- Name: dungeon_opponent_item_drops; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_opponent_item_drops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opponent_id" "uuid" NOT NULL,
    "drop_type" "text" NOT NULL,
    "target_category" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "min_amount" integer NOT NULL,
    "max_amount" integer NOT NULL,
    "probability" numeric(8,6) NOT NULL,
    "dupe_currency_id" "text" NOT NULL,
    "dupe_currency_amount" integer NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "dungeon_opponent_item_drops_check" CHECK (("max_amount" >= "min_amount")),
    CONSTRAINT "dungeon_opponent_item_drops_check1" CHECK (((("drop_type" = 'relic'::"text") AND ("target_category" = 'relic'::"text")) OR ("drop_type" = 'shard'::"text"))),
    CONSTRAINT "dungeon_opponent_item_drops_drop_type_check" CHECK (("drop_type" = ANY (ARRAY['shard'::"text", 'relic'::"text"]))),
    CONSTRAINT "dungeon_opponent_item_drops_dupe_currency_amount_check" CHECK (("dupe_currency_amount" >= 0)),
    CONSTRAINT "dungeon_opponent_item_drops_min_amount_check" CHECK (("min_amount" > 0)),
    CONSTRAINT "dungeon_opponent_item_drops_probability_check" CHECK ((("probability" >= (0)::numeric) AND ("probability" <= (1)::numeric))),
    CONSTRAINT "dungeon_opponent_item_drops_sort_order_check" CHECK (("sort_order" >= 0)),
    CONSTRAINT "dungeon_opponent_item_drops_target_category_check" CHECK (("target_category" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"])))
);


ALTER TABLE "public"."dungeon_opponent_item_drops" OWNER TO "postgres";

--
-- Name: TABLE "dungeon_opponent_item_drops"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."dungeon_opponent_item_drops" IS 'Independent Relic/Shard rolls with per-item duplicate-currency conversion.';


--
-- Name: dungeon_opponent_relics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_opponent_relics" (
    "opponent_id" "uuid" NOT NULL,
    "relic_id" "text" NOT NULL,
    "slot_index" integer NOT NULL,
    CONSTRAINT "dungeon_opponent_relics_slot_index_check" CHECK (("slot_index" >= 0))
);


ALTER TABLE "public"."dungeon_opponent_relics" OWNER TO "postgres";

--
-- Name: dungeon_opponent_rewards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_opponent_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opponent_id" "uuid" NOT NULL,
    "reward_type" "text" NOT NULL,
    "reward_ref_id" "text",
    "chance" numeric NOT NULL,
    "quantity" integer DEFAULT 1 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "dungeon_opponent_rewards_chance_check" CHECK ((("chance" >= (0)::numeric) AND ("chance" <= (1)::numeric))),
    CONSTRAINT "dungeon_opponent_rewards_check" CHECK (((("reward_type" = 'coins'::"text") AND ("reward_ref_id" IS NULL)) OR (("reward_type" <> 'coins'::"text") AND ("reward_ref_id" IS NOT NULL)))),
    CONSTRAINT "dungeon_opponent_rewards_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "dungeon_opponent_rewards_reward_type_check" CHECK (("reward_type" = ANY (ARRAY['relic'::"text", 'critter_unlock'::"text", 'rollcaster_unlock'::"text", 'coins'::"text"])))
);


ALTER TABLE "public"."dungeon_opponent_rewards" OWNER TO "postgres";

--
-- Name: dungeon_opponent_skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_opponent_skills" (
    "opponent_id" "uuid" NOT NULL,
    "skill_id" "text" NOT NULL,
    "slot_index" integer NOT NULL,
    CONSTRAINT "dungeon_opponent_skills_slot_index_check" CHECK ((("slot_index" >= 0) AND ("slot_index" <= 3)))
);


ALTER TABLE "public"."dungeon_opponent_skills" OWNER TO "postgres";

--
-- Name: dungeon_opponent_stat_overrides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_opponent_stat_overrides" (
    "opponent_id" "uuid" NOT NULL,
    "stat_key" "text" NOT NULL,
    "value" integer NOT NULL,
    CONSTRAINT "dungeon_opponent_stat_overrides_check" CHECK (((("stat_key" = ANY (ARRAY['hp'::"text", 'atk'::"text", 'def'::"text", 'spd'::"text", 'dice_min'::"text", 'dice_max'::"text"])) AND ("value" > 0)) OR (("stat_key" = ANY (ARRAY['block_cost'::"text", 'swap_cost'::"text", 'relic_slots'::"text"])) AND ("value" >= 0)))),
    CONSTRAINT "dungeon_opponent_stat_overrides_stat_key_check" CHECK (("stat_key" = ANY (ARRAY['hp'::"text", 'atk'::"text", 'def'::"text", 'spd'::"text", 'dice_min'::"text", 'dice_max'::"text", 'block_cost'::"text", 'swap_cost'::"text", 'relic_slots'::"text"])))
);


ALTER TABLE "public"."dungeon_opponent_stat_overrides" OWNER TO "postgres";

--
-- Name: dungeon_opponents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_opponents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dungeon_id" "text" NOT NULL,
    "pool_type" "text" NOT NULL,
    "sequence_index" integer,
    "probability" numeric,
    "critter_id" "text" NOT NULL,
    "critter_level" integer NOT NULL,
    "skill_ids" "text"[] NOT NULL,
    "relic_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "rollcaster_xp_reward" integer NOT NULL,
    "critter_xp_reward" integer NOT NULL,
    "currency_reward" integer DEFAULT 0 NOT NULL,
    "drops" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "selection_weight" numeric,
    CONSTRAINT "dungeon_opponents_pool_type_check" CHECK (("pool_type" = ANY (ARRAY['regular_pool'::"text", 'boss_order'::"text"]))),
    CONSTRAINT "dungeon_opponents_probability_check" CHECK (((("pool_type" = 'regular_pool'::"text") AND (("probability" >= (0)::numeric) AND ("probability" <= (1)::numeric))) OR (("pool_type" = 'boss_order'::"text") AND ("probability" IS NULL)))),
    CONSTRAINT "dungeon_opponents_sequence_check" CHECK ((("sequence_index" IS NOT NULL) AND ("sequence_index" >= 0)))
);


ALTER TABLE "public"."dungeon_opponents" OWNER TO "postgres";

--
-- Name: dungeon_run_commands; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_run_commands" (
    "run_id" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "command_type" "text" NOT NULL,
    "response" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dungeon_run_commands_command_type_check" CHECK (("command_type" = ANY (ARRAY['battle_result'::"text", 'save_state'::"text"])))
);


ALTER TABLE "public"."dungeon_run_commands" OWNER TO "postgres";

--
-- Name: dungeon_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeon_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "dungeon_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "selected_opponents" "jsonb" NOT NULL,
    "battle_format" "text" NOT NULL,
    "player_active_count" integer NOT NULL,
    "opponent_active_count" integer NOT NULL,
    "turn_number" integer DEFAULT 1 NOT NULL,
    "player_mana" integer DEFAULT 0 NOT NULL,
    "opponent_mana" integer DEFAULT 0 NOT NULL,
    "combat_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "battle_log" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rewards" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "effect_snapshot" "jsonb",
    "request_id" "uuid",
    "dungeon_version" integer NOT NULL,
    "effective_mode" "text" NOT NULL,
    "battle_count" integer NOT NULL,
    "battle_index" integer DEFAULT 1 NOT NULL,
    "random_seed" bigint NOT NULL,
    "random_cursor" integer DEFAULT 0 NOT NULL,
    "state_version" integer DEFAULT 1 NOT NULL,
    "catalog_snapshot" "jsonb" NOT NULL,
    "squad_snapshot" "jsonb" NOT NULL,
    "battle_results" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "dungeon_runs_battle_count_check" CHECK ((("battle_count" > 0) AND (("battle_index" >= 1) AND ("battle_index" <= "battle_count")))),
    CONSTRAINT "dungeon_runs_effective_mode_check" CHECK (("effective_mode" = ANY (ARRAY['regular'::"text", 'boss'::"text"]))),
    CONSTRAINT "dungeon_runs_state_version_check" CHECK ((("state_version" > 0) AND ("random_cursor" >= 0))),
    CONSTRAINT "dungeon_runs_status_check" CHECK (("status" = ANY (ARRAY['started'::"text", 'won'::"text", 'lost'::"text", 'abandoned'::"text"])))
);


ALTER TABLE "public"."dungeon_runs" OWNER TO "postgres";

--
-- Name: COLUMN "dungeon_runs"."effect_snapshot"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeon_runs"."effect_snapshot" IS 'Write-once resolved effect/status/loadout/RNG inputs used for deterministic combat replay.';


--
-- Name: dungeons; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."dungeons" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "dungeon_type" "text" NOT NULL,
    "difficulty" integer NOT NULL,
    "battle_format" "text" NOT NULL,
    "player_active_count" integer NOT NULL,
    "opponent_active_count" integer NOT NULL,
    "encounter_count" integer DEFAULT 1 NOT NULL,
    "next_dungeon_id" "text",
    "sort_order" integer NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "battle_count" integer DEFAULT 1 NOT NULL,
    "regular_logo_path" "text",
    "boss_logo_path" "text",
    CONSTRAINT "dungeons_battle_count_check" CHECK (("battle_count" > 0)),
    CONSTRAINT "dungeons_battle_format_check" CHECK (("battle_format" = ANY (ARRAY['1v1'::"text", '1v2'::"text", '1v3'::"text", '2v1'::"text", '2v2'::"text", '2v3'::"text", '3v1'::"text", '3v2'::"text", '3v3'::"text"]))),
    CONSTRAINT "dungeons_dungeon_type_check" CHECK (("dungeon_type" = ANY (ARRAY['regular'::"text", 'boss'::"text"]))),
    CONSTRAINT "dungeons_next_dungeon_numeric_check" CHECK ((("next_dungeon_id" IS NULL) OR ("next_dungeon_id" ~ '^[0-9]+$'::"text"))),
    CONSTRAINT "dungeons_opponent_active_count_check" CHECK ((("opponent_active_count" >= 1) AND ("opponent_active_count" <= 3))),
    CONSTRAINT "dungeons_player_active_count_check" CHECK ((("player_active_count" >= 1) AND ("player_active_count" <= 3))),
    CONSTRAINT "dungeons_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."dungeons" OWNER TO "postgres";

--
-- Name: COLUMN "dungeons"."difficulty"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."difficulty" IS 'Compatibility cache maintained by admin_save_dungeon. Never author directly; calculate from the active pool average level.';


--
-- Name: COLUMN "dungeons"."player_active_count"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."player_active_count" IS 'Deprecated compatibility cache derived from battle_format.';


--
-- Name: COLUMN "dungeons"."opponent_active_count"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."opponent_active_count" IS 'Deprecated compatibility cache derived from battle_format.';


--
-- Name: COLUMN "dungeons"."encounter_count"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."encounter_count" IS 'Deprecated compatibility cache mirroring battle_count.';


--
-- Name: COLUMN "dungeons"."sort_order"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."sort_order" IS 'Deprecated for presentation. Dungeon catalog order is numeric ID order.';


--
-- Name: COLUMN "dungeons"."battle_count"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."battle_count" IS 'Canonical number of regular-mode battles required for a clear. Boss first-clear mode uses Boss Order length.';


--
-- Name: COLUMN "dungeons"."regular_logo_path"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."regular_logo_path" IS 'Optional game-assets path used in regular mode and after a Boss dungeon first clear.';


--
-- Name: COLUMN "dungeons"."boss_logo_path"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."dungeons"."boss_logo_path" IS 'Optional game-assets path used only before a Boss dungeon first clear.';


--
-- Name: element_chart_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."element_chart_config" (
    "id" boolean DEFAULT true NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "element_chart_config_id_check" CHECK ("id"),
    CONSTRAINT "element_chart_config_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."element_chart_config" OWNER TO "postgres";

--
-- Name: element_effectiveness; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."element_effectiveness" (
    "attacking_element_id" "text" NOT NULL,
    "defending_element_id" "text" NOT NULL,
    "multiplier" numeric(8,4) DEFAULT 1 NOT NULL,
    CONSTRAINT "element_effectiveness_multiplier_check" CHECK (("multiplier" >= (0)::numeric))
);


ALTER TABLE "public"."element_effectiveness" OWNER TO "postgres";

--
-- Name: TABLE "element_effectiveness"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."element_effectiveness" IS 'Complete square matrix: attacking Skill Element × defending Critter Element. Missing cells are invalid; new Elements receive neutral 1× cells.';


--
-- Name: elements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."elements" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "sort_order" integer NOT NULL,
    "asset_path" "text",
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "elements_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."elements" OWNER TO "postgres";

--
-- Name: game_assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."game_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket_id" "text" DEFAULT 'game-assets'::"text" NOT NULL,
    "path" "text" NOT NULL,
    "category" "text" NOT NULL,
    "owner_table" "text",
    "owner_id" "text",
    "variant" "text" DEFAULT 'default'::"text" NOT NULL,
    "display_name" "text",
    "alt_text" "text",
    "content_type" "text",
    "width" integer,
    "height" integer,
    "checksum" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_assets_category_check" CHECK (("category" ~ '^[a-z0-9][a-z0-9_-]*$'::"text")),
    CONSTRAINT "game_assets_path_check" CHECK ((("path" <> ''::"text") AND ("path" !~ '^/'::"text"))),
    CONSTRAINT "game_assets_variant_check" CHECK (("variant" <> ''::"text"))
);


ALTER TABLE "public"."game_assets" OWNER TO "postgres";

--
-- Name: TABLE "game_assets"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."game_assets" IS 'Registry for public game art stored in the Supabase Storage game-assets bucket.';


--
-- Name: COLUMN "game_assets"."path"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."game_assets"."path" IS 'Object path inside game-assets, for example critters/001-toxichick.png or logos/elements/aqua.png.';


--
-- Name: COLUMN "game_assets"."variant"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."game_assets"."variant" IS 'Asset variant such as default, icon, portrait, sprite-front, sprite-back, shiny, or thumbnail.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "coins" integer DEFAULT 0 NOT NULL,
    "starter_selected_at" timestamp with time zone,
    "active_rollcaster_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "starter_rollcaster_selected_at" timestamp with time zone
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";

--
-- Name: promo_code_redemption_rewards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."promo_code_redemption_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "redemption_id" "uuid" NOT NULL,
    "reward_type" "text" NOT NULL,
    "target_category" "text",
    "target_id" "text" NOT NULL,
    "reward_name" "text" NOT NULL,
    "reward_asset_path" "text",
    "quantity_configured" bigint NOT NULL,
    "quantity_granted" bigint NOT NULL,
    "quantity_discarded" bigint NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "did_unlock" boolean DEFAULT false NOT NULL,
    CONSTRAINT "promo_code_redemption_rewards_quantity_configured_check" CHECK (("quantity_configured" > 0)),
    CONSTRAINT "promo_code_redemption_rewards_quantity_discarded_check" CHECK (("quantity_discarded" >= 0)),
    CONSTRAINT "promo_code_redemption_rewards_quantity_granted_check" CHECK (("quantity_granted" >= 0)),
    CONSTRAINT "promo_code_redemption_rewards_reward_type_check" CHECK (("reward_type" = ANY (ARRAY['currency'::"text", 'shard'::"text", 'critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))),
    CONSTRAINT "promo_code_redemption_rewards_sort_order_check" CHECK (("sort_order" >= 0)),
    CONSTRAINT "promo_code_redemption_rewards_target_category_check" CHECK ((("target_category" IS NULL) OR ("target_category" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))))
);


ALTER TABLE "public"."promo_code_redemption_rewards" OWNER TO "postgres";

--
-- Name: TABLE "promo_code_redemption_rewards"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."promo_code_redemption_rewards" IS 'Immutable player-history snapshots, including names/artwork and actual granted/discarded quantities.';


--
-- Name: promo_code_redemptions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."promo_code_redemptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promo_code_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_snapshot" "text" NOT NULL,
    "redeemed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."promo_code_redemptions" OWNER TO "postgres";

--
-- Name: TABLE "promo_code_redemptions"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."promo_code_redemptions" IS 'One immutable row per successful Promo Code claim; multiple rows per user/code are allowed by the authored player-use limit.';


--
-- Name: promo_code_rewards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."promo_code_rewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promo_code_id" "uuid" NOT NULL,
    "reward_type" "text" NOT NULL,
    "target_category" "text",
    "target_id" "text" NOT NULL,
    "quantity" bigint NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "promo_code_rewards_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "promo_code_rewards_reward_type_check" CHECK (("reward_type" = ANY (ARRAY['currency'::"text", 'shard'::"text", 'critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))),
    CONSTRAINT "promo_code_rewards_sort_order_check" CHECK (("sort_order" >= 0)),
    CONSTRAINT "promo_code_rewards_target_category_check" CHECK ((("target_category" IS NULL) OR ("target_category" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))))
);


ALTER TABLE "public"."promo_code_rewards" OWNER TO "postgres";

--
-- Name: TABLE "promo_code_rewards"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."promo_code_rewards" IS 'Ordered rewards atomically granted by redeem_promo_code.';


--
-- Name: promo_codes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."promo_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "internal_notes" "text" DEFAULT ''::"text" NOT NULL,
    "redemption_limit" bigint,
    "infinite_use" boolean DEFAULT false NOT NULL,
    "redemption_count" bigint DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "uses_per_player" bigint DEFAULT 1,
    "infinite_uses_per_player" boolean DEFAULT false NOT NULL,
    CONSTRAINT "promo_codes_check" CHECK ((("infinite_use" AND ("redemption_limit" IS NULL)) OR ((NOT "infinite_use") AND ("redemption_limit" IS NOT NULL) AND ("redemption_limit" > 0)))),
    CONSTRAINT "promo_codes_player_use_limit_check" CHECK ((("infinite_uses_per_player" AND ("uses_per_player" IS NULL)) OR ((NOT "infinite_uses_per_player") AND ("uses_per_player" IS NOT NULL) AND ("uses_per_player" > 0)))),
    CONSTRAINT "promo_codes_redemption_count_check" CHECK (("redemption_count" >= 0)),
    CONSTRAINT "promo_codes_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."promo_codes" OWNER TO "postgres";

--
-- Name: TABLE "promo_codes"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."promo_codes" IS 'Server-only Promo Code definitions. Regular players cannot list or inspect codes.';


--
-- Name: COLUMN "promo_codes"."uses_per_player"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."promo_codes"."uses_per_player" IS 'Finite successful-claim limit for each player; null only when infinite_uses_per_player is true.';


--
-- Name: COLUMN "promo_codes"."infinite_uses_per_player"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."promo_codes"."infinite_uses_per_player" IS 'When true, one player may claim this code repeatedly until the global limit is reached.';


--
-- Name: relics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."relics" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "max_owned" integer NOT NULL,
    "asset_path" "text",
    "sort_order" integer NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "relics_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."relics" OWNER TO "postgres";

--
-- Name: rollcaster_abilities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."rollcaster_abilities" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "rollcaster_abilities_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."rollcaster_abilities" OWNER TO "postgres";

--
-- Name: rollcaster_ability_unlocks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."rollcaster_ability_unlocks" (
    "rollcaster_id" "text" NOT NULL,
    "ability_id" "text" NOT NULL,
    "unlock_level" integer NOT NULL,
    "unlock_cost" integer DEFAULT 0 NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "sort_order" integer NOT NULL
);


ALTER TABLE "public"."rollcaster_ability_unlocks" OWNER TO "postgres";

--
-- Name: rollcaster_level_progression; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."rollcaster_level_progression" (
    "rollcaster_id" "text" NOT NULL,
    "level" integer NOT NULL,
    "total_required_xp" integer NOT NULL,
    "grant_ability_points" integer DEFAULT 0 NOT NULL,
    "total_unlocked_ability_slots" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."rollcaster_level_progression" OWNER TO "postgres";

--
-- Name: rollcasters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."rollcasters" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "asset_path" "text",
    "description" "text",
    "sort_order" integer NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "rollcasters_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."rollcasters" OWNER TO "postgres";

--
-- Name: shop_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."shop_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "target_category" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "currency_id" "text" NOT NULL,
    "price" bigint NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "shop_entries_description_check" CHECK (("btrim"("description") <> ''::"text")),
    CONSTRAINT "shop_entries_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "shop_entries_price_check" CHECK (("price" >= 0)),
    CONSTRAINT "shop_entries_quantity_check" CHECK (("quantity" > 0)),
    CONSTRAINT "shop_entries_shop_type_check" CHECK (("shop_type" = ANY (ARRAY['shard'::"text", 'relic'::"text"]))),
    CONSTRAINT "shop_entries_target_category_check" CHECK (("target_category" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))),
    CONSTRAINT "shop_entries_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."shop_entries" OWNER TO "postgres";

--
-- Name: shop_purchase_receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."shop_purchase_receipts" (
    "user_id" "uuid" NOT NULL,
    "request_id" "uuid" NOT NULL,
    "entry_id" "uuid" NOT NULL,
    "shop_type" "text" NOT NULL,
    "target_category" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "currency_id" "text" NOT NULL,
    "price" bigint NOT NULL,
    "balance_after" bigint NOT NULL,
    "granted" bigint NOT NULL,
    "discarded" bigint DEFAULT 0 NOT NULL,
    "unlock_event_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shop_purchase_receipts_balance_after_check" CHECK (("balance_after" >= 0)),
    CONSTRAINT "shop_purchase_receipts_discarded_check" CHECK (("discarded" >= 0)),
    CONSTRAINT "shop_purchase_receipts_granted_check" CHECK (("granted" >= 0)),
    CONSTRAINT "shop_purchase_receipts_price_check" CHECK (("price" >= 0)),
    CONSTRAINT "shop_purchase_receipts_shop_type_check" CHECK (("shop_type" = ANY (ARRAY['shard'::"text", 'relic'::"text"]))),
    CONSTRAINT "shop_purchase_receipts_target_category_check" CHECK (("target_category" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"])))
);


ALTER TABLE "public"."shop_purchase_receipts" OWNER TO "postgres";

--
-- Name: skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."skills" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "element_id" "text" NOT NULL,
    "skill_type" "text" NOT NULL,
    "power" integer DEFAULT 0 NOT NULL,
    "mana_cost" integer DEFAULT 0 NOT NULL,
    "description" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "targeting" "text" DEFAULT 'single_enemy'::"text" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "skills_skill_type_check" CHECK (("skill_type" = ANY (ARRAY['attack'::"text", 'support'::"text"]))),
    CONSTRAINT "skills_targeting_check" CHECK (("targeting" = ANY (ARRAY['single_enemy'::"text", 'all_enemies'::"text", 'all_others'::"text", 'single_any'::"text", 'self_only'::"text", 'all_allies'::"text", 'all_friendlies'::"text"]))),
    CONSTRAINT "skills_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."skills" OWNER TO "postgres";

--
-- Name: COLUMN "skills"."targeting"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."skills"."targeting" IS 'Targeting mode. self_only selects only the acting critter; all_allies selects every friendly teammate except the acting critter; all_friendlies includes the acting critter.';


--
-- Name: starter_options; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."starter_options" (
    "critter_id" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."starter_options" OWNER TO "postgres";

--
-- Name: starter_rollcaster_options; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."starter_rollcaster_options" (
    "rollcaster_id" "text" NOT NULL,
    "sort_order" integer NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."starter_rollcaster_options" OWNER TO "postgres";

--
-- Name: statuses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."statuses" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "stacking_policy" "text" DEFAULT 'refresh'::"text" NOT NULL,
    "default_duration" integer DEFAULT 3 NOT NULL,
    "max_stacks" integer DEFAULT 1 NOT NULL,
    "asset_path" "text",
    CONSTRAINT "statuses_default_duration_check" CHECK (("default_duration" >= 1)),
    CONSTRAINT "statuses_max_stacks_check" CHECK (("max_stacks" >= 1)),
    CONSTRAINT "statuses_stacking_policy_check" CHECK (("stacking_policy" = ANY (ARRAY['refresh'::"text", 'extend'::"text", 'stack'::"text", 'ignore'::"text"]))),
    CONSTRAINT "statuses_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."statuses" OWNER TO "postgres";

--
-- Name: user_collectible_challenge_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_collectible_challenge_progress" (
    "user_id" "uuid" NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "progress" bigint DEFAULT 0 NOT NULL,
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_collectible_challenge_progress_progress_check" CHECK (("progress" >= 0))
);


ALTER TABLE "public"."user_collectible_challenge_progress" OWNER TO "postgres";

--
-- Name: user_collectible_shards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_collectible_shards" (
    "user_id" "uuid" NOT NULL,
    "collectible_type" "text" NOT NULL,
    "collectible_id" "text" NOT NULL,
    "quantity" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_collectible_shards_collectible_type_check" CHECK (("collectible_type" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"]))),
    CONSTRAINT "user_collectible_shards_quantity_check" CHECK (("quantity" >= 0))
);


ALTER TABLE "public"."user_collectible_shards" OWNER TO "postgres";

--
-- Name: user_collectible_unlock_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_collectible_unlock_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "collectible_type" "text" NOT NULL,
    "collectible_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "acknowledged_at" timestamp with time zone,
    CONSTRAINT "user_collectible_unlock_events_collectible_type_check" CHECK (("collectible_type" = ANY (ARRAY['critter'::"text", 'rollcaster'::"text", 'relic'::"text"])))
);


ALTER TABLE "public"."user_collectible_unlock_events" OWNER TO "postgres";

--
-- Name: user_critter_relic_slots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_critter_relic_slots" (
    "user_critter_id" "uuid" NOT NULL,
    "slot_index" integer NOT NULL,
    "relic_id" "text"
);


ALTER TABLE "public"."user_critter_relic_slots" OWNER TO "postgres";

--
-- Name: user_critter_skill_slots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_critter_skill_slots" (
    "user_critter_id" "uuid" NOT NULL,
    "slot_index" integer NOT NULL,
    "skill_id" "text",
    CONSTRAINT "user_critter_skill_slots_slot_index_check" CHECK ((("slot_index" >= 1) AND ("slot_index" <= 4)))
);


ALTER TABLE "public"."user_critter_skill_slots" OWNER TO "postgres";

--
-- Name: user_critter_skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_critter_skills" (
    "user_critter_id" "uuid" NOT NULL,
    "skill_id" "text" NOT NULL,
    "unlocked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_critter_skills" OWNER TO "postgres";

--
-- Name: user_critters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_critters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "critter_id" "text" NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "xp" integer DEFAULT 0 NOT NULL,
    "skill_points" integer DEFAULT 0 NOT NULL,
    "highest_processed_level" integer DEFAULT 1 NOT NULL,
    "unlocked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_critters" OWNER TO "postgres";

--
-- Name: user_currencies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_currencies" (
    "user_id" "uuid" NOT NULL,
    "currency_id" "text" NOT NULL,
    "balance" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_currencies_balance_check" CHECK (("balance" >= 0))
);


ALTER TABLE "public"."user_currencies" OWNER TO "postgres";

--
-- Name: user_dungeon_progress; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_dungeon_progress" (
    "user_id" "uuid" NOT NULL,
    "dungeon_id" "text" NOT NULL,
    "is_unlocked" boolean DEFAULT false NOT NULL,
    "completed_at" timestamp with time zone,
    "clear_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."user_dungeon_progress" OWNER TO "postgres";

--
-- Name: user_relic_inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_relic_inventory" (
    "user_id" "uuid" NOT NULL,
    "relic_id" "text" NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "discovered_at" timestamp with time zone
);


ALTER TABLE "public"."user_relic_inventory" OWNER TO "postgres";

--
-- Name: user_rollcaster_abilities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_rollcaster_abilities" (
    "user_id" "uuid" NOT NULL,
    "user_rollcaster_id" "uuid" NOT NULL,
    "ability_id" "text" NOT NULL,
    "unlocked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_rollcaster_abilities" OWNER TO "postgres";

--
-- Name: user_rollcaster_ability_slots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_rollcaster_ability_slots" (
    "user_rollcaster_id" "uuid" NOT NULL,
    "slot_index" integer NOT NULL,
    "ability_id" "text"
);


ALTER TABLE "public"."user_rollcaster_ability_slots" OWNER TO "postgres";

--
-- Name: user_rollcasters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_rollcasters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rollcaster_id" "text" NOT NULL,
    "level" integer DEFAULT 1 NOT NULL,
    "xp" integer DEFAULT 0 NOT NULL,
    "ability_points" integer DEFAULT 0 NOT NULL,
    "highest_processed_level" integer DEFAULT 1 NOT NULL,
    "unlocked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_rollcasters" OWNER TO "postgres";

--
-- Name: user_seen_critters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_seen_critters" (
    "user_id" "uuid" NOT NULL,
    "critter_id" "text" NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_seen_critters" OWNER TO "postgres";

--
-- Name: user_squad_slots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_squad_slots" (
    "user_id" "uuid" NOT NULL,
    "slot_index" integer NOT NULL,
    "user_critter_id" "uuid",
    CONSTRAINT "user_squad_slots_slot_index_check" CHECK ((("slot_index" >= 1) AND ("slot_index" <= 3)))
);


ALTER TABLE "public"."user_squad_slots" OWNER TO "postgres";

--
-- Name: user_tracked_collectible_challenges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."user_tracked_collectible_challenges" (
    "user_id" "uuid" NOT NULL,
    "challenge_id" "uuid" NOT NULL,
    "slot_order" smallint NOT NULL,
    "tracked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_tracked_collectible_challenges_slot_order_check" CHECK ((("slot_order" >= 1) AND ("slot_order" <= 3)))
);


ALTER TABLE "public"."user_tracked_collectible_challenges" OWNER TO "postgres";

--
-- Name: ability_effects ability_effects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ability_effects"
    ADD CONSTRAINT "ability_effects_pkey" PRIMARY KEY ("ability_id", "id");


--
-- Name: collectible_combat_events collectible_combat_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."collectible_combat_events"
    ADD CONSTRAINT "collectible_combat_events_pkey" PRIMARY KEY ("run_id", "event_key");


--
-- Name: collectible_unlock_challenges collectible_unlock_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."collectible_unlock_challenges"
    ADD CONSTRAINT "collectible_unlock_challenges_pkey" PRIMARY KEY ("id");


--
-- Name: collectible_unlock_requirements collectible_unlock_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."collectible_unlock_requirements"
    ADD CONSTRAINT "collectible_unlock_requirements_pkey" PRIMARY KEY ("collectible_type", "collectible_id");


--
-- Name: combat_turn_actions combat_turn_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."combat_turn_actions"
    ADD CONSTRAINT "combat_turn_actions_pkey" PRIMARY KEY ("id");


--
-- Name: content_change_log content_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."content_change_log"
    ADD CONSTRAINT "content_change_log_pkey" PRIMARY KEY ("id");


--
-- Name: critter_level_progression critter_level_progression_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critter_level_progression"
    ADD CONSTRAINT "critter_level_progression_pkey" PRIMARY KEY ("critter_id", "level");


--
-- Name: critter_skill_unlocks critter_skill_unlocks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critter_skill_unlocks"
    ADD CONSTRAINT "critter_skill_unlocks_pkey" PRIMARY KEY ("critter_id", "skill_id");


--
-- Name: critters critters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critters"
    ADD CONSTRAINT "critters_pkey" PRIMARY KEY ("id");


--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."currencies"
    ADD CONSTRAINT "currencies_pkey" PRIMARY KEY ("id");


--
-- Name: dev_tool_users dev_tool_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dev_tool_users"
    ADD CONSTRAINT "dev_tool_users_pkey" PRIMARY KEY ("user_id");


--
-- Name: dungeon_completion_drops dungeon_completion_drops_dungeon_id_completion_phase_sort_o_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_completion_drops"
    ADD CONSTRAINT "dungeon_completion_drops_dungeon_id_completion_phase_sort_o_key" UNIQUE ("dungeon_id", "completion_phase", "sort_order");


--
-- Name: dungeon_completion_drops dungeon_completion_drops_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_completion_drops"
    ADD CONSTRAINT "dungeon_completion_drops_pkey" PRIMARY KEY ("id");


--
-- Name: dungeon_opponent_currency_drops dungeon_opponent_currency_drops_opponent_id_sort_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_currency_drops"
    ADD CONSTRAINT "dungeon_opponent_currency_drops_opponent_id_sort_order_key" UNIQUE ("opponent_id", "sort_order");


--
-- Name: dungeon_opponent_currency_drops dungeon_opponent_currency_drops_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_currency_drops"
    ADD CONSTRAINT "dungeon_opponent_currency_drops_pkey" PRIMARY KEY ("id");


--
-- Name: dungeon_opponent_item_drops dungeon_opponent_item_drops_opponent_id_sort_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_item_drops"
    ADD CONSTRAINT "dungeon_opponent_item_drops_opponent_id_sort_order_key" UNIQUE ("opponent_id", "sort_order");


--
-- Name: dungeon_opponent_item_drops dungeon_opponent_item_drops_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_item_drops"
    ADD CONSTRAINT "dungeon_opponent_item_drops_pkey" PRIMARY KEY ("id");


--
-- Name: dungeon_opponent_relics dungeon_opponent_relics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_relics"
    ADD CONSTRAINT "dungeon_opponent_relics_pkey" PRIMARY KEY ("opponent_id", "slot_index");


--
-- Name: dungeon_opponent_rewards dungeon_opponent_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_rewards"
    ADD CONSTRAINT "dungeon_opponent_rewards_pkey" PRIMARY KEY ("id");


--
-- Name: dungeon_opponent_skills dungeon_opponent_skills_opponent_id_skill_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_skills"
    ADD CONSTRAINT "dungeon_opponent_skills_opponent_id_skill_id_key" UNIQUE ("opponent_id", "skill_id");


--
-- Name: dungeon_opponent_skills dungeon_opponent_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_skills"
    ADD CONSTRAINT "dungeon_opponent_skills_pkey" PRIMARY KEY ("opponent_id", "slot_index");


--
-- Name: dungeon_opponent_stat_overrides dungeon_opponent_stat_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_stat_overrides"
    ADD CONSTRAINT "dungeon_opponent_stat_overrides_pkey" PRIMARY KEY ("opponent_id", "stat_key");


--
-- Name: dungeon_opponents dungeon_opponents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponents"
    ADD CONSTRAINT "dungeon_opponents_pkey" PRIMARY KEY ("id");


--
-- Name: dungeon_run_commands dungeon_run_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_run_commands"
    ADD CONSTRAINT "dungeon_run_commands_pkey" PRIMARY KEY ("run_id", "request_id");


--
-- Name: dungeon_runs dungeon_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_runs"
    ADD CONSTRAINT "dungeon_runs_pkey" PRIMARY KEY ("id");


--
-- Name: dungeons dungeons_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeons"
    ADD CONSTRAINT "dungeons_pkey" PRIMARY KEY ("id");


--
-- Name: effect_templates effect_templates_id_category_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."effect_templates"
    ADD CONSTRAINT "effect_templates_id_category_key" UNIQUE ("id", "effect_category");


--
-- Name: effect_templates effect_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."effect_templates"
    ADD CONSTRAINT "effect_templates_pkey" PRIMARY KEY ("id");


--
-- Name: element_chart_config element_chart_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."element_chart_config"
    ADD CONSTRAINT "element_chart_config_pkey" PRIMARY KEY ("id");


--
-- Name: element_effectiveness element_effectiveness_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."element_effectiveness"
    ADD CONSTRAINT "element_effectiveness_pkey" PRIMARY KEY ("attacking_element_id", "defending_element_id");


--
-- Name: elements elements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."elements"
    ADD CONSTRAINT "elements_pkey" PRIMARY KEY ("id");


--
-- Name: game_assets game_assets_bucket_id_path_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."game_assets"
    ADD CONSTRAINT "game_assets_bucket_id_path_key" UNIQUE ("bucket_id", "path");


--
-- Name: game_assets game_assets_category_owner_table_owner_id_variant_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."game_assets"
    ADD CONSTRAINT "game_assets_category_owner_table_owner_id_variant_key" UNIQUE ("category", "owner_table", "owner_id", "variant");


--
-- Name: game_assets game_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."game_assets"
    ADD CONSTRAINT "game_assets_pkey" PRIMARY KEY ("id");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");


--
-- Name: promo_code_redemption_rewards promo_code_redemption_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_redemption_rewards"
    ADD CONSTRAINT "promo_code_redemption_rewards_pkey" PRIMARY KEY ("id");


--
-- Name: promo_code_redemption_rewards promo_code_redemption_rewards_redemption_id_sort_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_redemption_rewards"
    ADD CONSTRAINT "promo_code_redemption_rewards_redemption_id_sort_order_key" UNIQUE ("redemption_id", "sort_order");


--
-- Name: promo_code_redemptions promo_code_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id");


--
-- Name: promo_code_rewards promo_code_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_rewards"
    ADD CONSTRAINT "promo_code_rewards_pkey" PRIMARY KEY ("id");


--
-- Name: promo_code_rewards promo_code_rewards_promo_code_id_sort_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_rewards"
    ADD CONSTRAINT "promo_code_rewards_promo_code_id_sort_order_key" UNIQUE ("promo_code_id", "sort_order");


--
-- Name: promo_codes promo_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id");


--
-- Name: relic_effects relic_effects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."relic_effects"
    ADD CONSTRAINT "relic_effects_pkey" PRIMARY KEY ("relic_id", "id");


--
-- Name: relics relics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."relics"
    ADD CONSTRAINT "relics_pkey" PRIMARY KEY ("id");


--
-- Name: rollcaster_abilities rollcaster_abilities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_abilities"
    ADD CONSTRAINT "rollcaster_abilities_pkey" PRIMARY KEY ("id");


--
-- Name: rollcaster_ability_unlocks rollcaster_ability_unlocks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_ability_unlocks"
    ADD CONSTRAINT "rollcaster_ability_unlocks_pkey" PRIMARY KEY ("rollcaster_id", "ability_id");


--
-- Name: rollcaster_level_progression rollcaster_level_progression_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_level_progression"
    ADD CONSTRAINT "rollcaster_level_progression_pkey" PRIMARY KEY ("rollcaster_id", "level");


--
-- Name: rollcasters rollcasters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcasters"
    ADD CONSTRAINT "rollcasters_pkey" PRIMARY KEY ("id");


--
-- Name: shop_entries shop_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."shop_entries"
    ADD CONSTRAINT "shop_entries_pkey" PRIMARY KEY ("id");


--
-- Name: shop_purchase_receipts shop_purchase_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."shop_purchase_receipts"
    ADD CONSTRAINT "shop_purchase_receipts_pkey" PRIMARY KEY ("user_id", "request_id");


--
-- Name: skill_effects skill_effects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."skill_effects"
    ADD CONSTRAINT "skill_effects_pkey" PRIMARY KEY ("skill_id", "id");


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_pkey" PRIMARY KEY ("id");


--
-- Name: starter_options starter_options_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."starter_options"
    ADD CONSTRAINT "starter_options_pkey" PRIMARY KEY ("critter_id");


--
-- Name: starter_rollcaster_options starter_rollcaster_options_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."starter_rollcaster_options"
    ADD CONSTRAINT "starter_rollcaster_options_pkey" PRIMARY KEY ("rollcaster_id");


--
-- Name: status_effects status_effects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."status_effects"
    ADD CONSTRAINT "status_effects_pkey" PRIMARY KEY ("status_id", "id");


--
-- Name: statuses statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."statuses"
    ADD CONSTRAINT "statuses_pkey" PRIMARY KEY ("id");


--
-- Name: user_collectible_challenge_progress user_collectible_challenge_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_challenge_progress"
    ADD CONSTRAINT "user_collectible_challenge_progress_pkey" PRIMARY KEY ("user_id", "challenge_id");


--
-- Name: user_collectible_shards user_collectible_shards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_shards"
    ADD CONSTRAINT "user_collectible_shards_pkey" PRIMARY KEY ("user_id", "collectible_type", "collectible_id");


--
-- Name: user_collectible_unlock_events user_collectible_unlock_event_user_id_collectible_type_coll_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_unlock_events"
    ADD CONSTRAINT "user_collectible_unlock_event_user_id_collectible_type_coll_key" UNIQUE ("user_id", "collectible_type", "collectible_id");


--
-- Name: user_collectible_unlock_events user_collectible_unlock_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_unlock_events"
    ADD CONSTRAINT "user_collectible_unlock_events_pkey" PRIMARY KEY ("id");


--
-- Name: user_critter_relic_slots user_critter_relic_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_relic_slots"
    ADD CONSTRAINT "user_critter_relic_slots_pkey" PRIMARY KEY ("user_critter_id", "slot_index");


--
-- Name: user_critter_skill_slots user_critter_skill_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_skill_slots"
    ADD CONSTRAINT "user_critter_skill_slots_pkey" PRIMARY KEY ("user_critter_id", "slot_index");


--
-- Name: user_critter_skills user_critter_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_skills"
    ADD CONSTRAINT "user_critter_skills_pkey" PRIMARY KEY ("user_critter_id", "skill_id");


--
-- Name: user_critters user_critters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critters"
    ADD CONSTRAINT "user_critters_pkey" PRIMARY KEY ("id");


--
-- Name: user_critters user_critters_user_id_critter_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critters"
    ADD CONSTRAINT "user_critters_user_id_critter_id_key" UNIQUE ("user_id", "critter_id");


--
-- Name: user_currencies user_currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_currencies"
    ADD CONSTRAINT "user_currencies_pkey" PRIMARY KEY ("user_id", "currency_id");


--
-- Name: user_dungeon_progress user_dungeon_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_dungeon_progress"
    ADD CONSTRAINT "user_dungeon_progress_pkey" PRIMARY KEY ("user_id", "dungeon_id");


--
-- Name: user_relic_inventory user_relic_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_relic_inventory"
    ADD CONSTRAINT "user_relic_inventory_pkey" PRIMARY KEY ("user_id", "relic_id");


--
-- Name: user_rollcaster_abilities user_rollcaster_abilities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcaster_abilities"
    ADD CONSTRAINT "user_rollcaster_abilities_pkey" PRIMARY KEY ("user_rollcaster_id", "ability_id");


--
-- Name: user_rollcaster_ability_slots user_rollcaster_ability_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcaster_ability_slots"
    ADD CONSTRAINT "user_rollcaster_ability_slots_pkey" PRIMARY KEY ("user_rollcaster_id", "slot_index");


--
-- Name: user_rollcasters user_rollcasters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcasters"
    ADD CONSTRAINT "user_rollcasters_pkey" PRIMARY KEY ("id");


--
-- Name: user_rollcasters user_rollcasters_user_id_rollcaster_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcasters"
    ADD CONSTRAINT "user_rollcasters_user_id_rollcaster_id_key" UNIQUE ("user_id", "rollcaster_id");


--
-- Name: user_seen_critters user_seen_critters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_seen_critters"
    ADD CONSTRAINT "user_seen_critters_pkey" PRIMARY KEY ("user_id", "critter_id");


--
-- Name: user_squad_slots user_squad_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_squad_slots"
    ADD CONSTRAINT "user_squad_slots_pkey" PRIMARY KEY ("user_id", "slot_index");


--
-- Name: user_tracked_collectible_challenges user_tracked_collectible_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_tracked_collectible_challenges"
    ADD CONSTRAINT "user_tracked_collectible_challenges_pkey" PRIMARY KEY ("user_id", "challenge_id");


--
-- Name: user_tracked_collectible_challenges user_tracked_collectible_challenges_user_id_slot_order_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_tracked_collectible_challenges"
    ADD CONSTRAINT "user_tracked_collectible_challenges_user_id_slot_order_key" UNIQUE ("user_id", "slot_order");


--
-- Name: ability_effects_runtime_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ability_effects_runtime_idx" ON "public"."ability_effects" USING "btree" ("ability_id", "sort_order", "template_id");


--
-- Name: collectible_combat_events_user_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "collectible_combat_events_user_idx" ON "public"."collectible_combat_events" USING "btree" ("user_id", "created_at");


--
-- Name: collectible_unlock_challenges_gate_order_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "collectible_unlock_challenges_gate_order_idx" ON "public"."collectible_unlock_challenges" USING "btree" ("collectible_type", "collectible_id", "gate_order") WHERE ("gate_order" IS NOT NULL);


--
-- Name: collectible_unlock_challenges_gate_order_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "collectible_unlock_challenges_gate_order_unique" ON "public"."collectible_unlock_challenges" USING "btree" ("collectible_type", "collectible_id", "gate_order") WHERE ("gate_order" IS NOT NULL);


--
-- Name: collectible_unlock_challenges_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "collectible_unlock_challenges_owner_idx" ON "public"."collectible_unlock_challenges" USING "btree" ("collectible_type", "collectible_id", "sort_order", "id");


--
-- Name: collectible_unlock_one_shop_method_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "collectible_unlock_one_shop_method_idx" ON "public"."collectible_unlock_challenges" USING "btree" ("collectible_type", "collectible_id", "challenge_type") WHERE ("challenge_type" = ANY (ARRAY['shop_shards'::"text", 'shop_relic'::"text"]));


--
-- Name: content_change_log_admin_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "content_change_log_admin_idx" ON "public"."content_change_log" USING "btree" ("admin_user_id", "changed_at" DESC);


--
-- Name: content_change_log_entity_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "content_change_log_entity_idx" ON "public"."content_change_log" USING "btree" ("entity_type", "entity_id", "changed_at" DESC);


--
-- Name: critters_element_1_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "critters_element_1_id_idx" ON "public"."critters" USING "btree" ("element_1_id");


--
-- Name: critters_element_2_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "critters_element_2_id_idx" ON "public"."critters" USING "btree" ("element_2_id") WHERE ("element_2_id" IS NOT NULL);


--
-- Name: critters_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "critters_lifecycle_idx" ON "public"."critters" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: currencies_catalog_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "currencies_catalog_idx" ON "public"."currencies" USING "btree" ("sort_order", "id");


--
-- Name: currencies_one_default_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "currencies_one_default_idx" ON "public"."currencies" USING "btree" ("is_default") WHERE ("is_default" AND "is_active" AND (NOT "is_archived"));


--
-- Name: dungeon_boss_order_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "dungeon_boss_order_unique_idx" ON "public"."dungeon_opponents" USING "btree" ("dungeon_id", "sequence_index") WHERE ("pool_type" = 'boss_order'::"text");


--
-- Name: dungeon_opponent_rewards_opponent_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "dungeon_opponent_rewards_opponent_idx" ON "public"."dungeon_opponent_rewards" USING "btree" ("opponent_id", "sort_order");


--
-- Name: dungeon_opponent_skills_opponent_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "dungeon_opponent_skills_opponent_idx" ON "public"."dungeon_opponent_skills" USING "btree" ("opponent_id", "slot_index");


--
-- Name: dungeon_opponents_dungeon_pool_sequence_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "dungeon_opponents_dungeon_pool_sequence_idx" ON "public"."dungeon_opponents" USING "btree" ("dungeon_id", "pool_type", "sequence_index");


--
-- Name: dungeon_runs_user_request_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "dungeon_runs_user_request_unique_idx" ON "public"."dungeon_runs" USING "btree" ("user_id", "request_id") WHERE ("request_id" IS NOT NULL);


--
-- Name: dungeon_runs_user_started_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "dungeon_runs_user_started_idx" ON "public"."dungeon_runs" USING "btree" ("user_id", "started_at" DESC);


--
-- Name: dungeons_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "dungeons_lifecycle_idx" ON "public"."dungeons" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: effect_templates_category_runtime_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "effect_templates_category_runtime_idx" ON "public"."effect_templates" USING "btree" ("effect_category", "runtime_kind", "runtime_version") WHERE ("is_active" AND (NOT "is_archived") AND "is_runtime_supported");


--
-- Name: elements_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "elements_lifecycle_idx" ON "public"."elements" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: game_assets_category_sort_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "game_assets_category_sort_idx" ON "public"."game_assets" USING "btree" ("category", "sort_order", "path") WHERE "is_active";


--
-- Name: game_assets_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "game_assets_owner_idx" ON "public"."game_assets" USING "btree" ("owner_table", "owner_id", "variant") WHERE "is_active";


--
-- Name: promo_code_redemption_rewards_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "promo_code_redemption_rewards_history_idx" ON "public"."promo_code_redemption_rewards" USING "btree" ("redemption_id", "sort_order", "id");


--
-- Name: promo_code_redemptions_user_code_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "promo_code_redemptions_user_code_idx" ON "public"."promo_code_redemptions" USING "btree" ("user_id", "promo_code_id", "redeemed_at" DESC, "id");


--
-- Name: promo_code_redemptions_user_history_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "promo_code_redemptions_user_history_idx" ON "public"."promo_code_redemptions" USING "btree" ("user_id", "redeemed_at" DESC, "id");


--
-- Name: promo_code_rewards_owner_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "promo_code_rewards_owner_idx" ON "public"."promo_code_rewards" USING "btree" ("promo_code_id", "sort_order", "id");


--
-- Name: promo_code_rewards_target_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "promo_code_rewards_target_idx" ON "public"."promo_code_rewards" USING "btree" ("reward_type", "target_category", "target_id");


--
-- Name: promo_codes_catalog_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "promo_codes_catalog_idx" ON "public"."promo_codes" USING "btree" ("sort_order", "code", "id");


--
-- Name: promo_codes_code_unique_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "promo_codes_code_unique_idx" ON "public"."promo_codes" USING "btree" ("upper"("code"));


--
-- Name: relic_effects_runtime_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "relic_effects_runtime_idx" ON "public"."relic_effects" USING "btree" ("relic_id", "sort_order", "template_id");


--
-- Name: relics_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "relics_lifecycle_idx" ON "public"."relics" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: rollcaster_abilities_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "rollcaster_abilities_lifecycle_idx" ON "public"."rollcaster_abilities" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: rollcasters_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "rollcasters_lifecycle_idx" ON "public"."rollcasters" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: shop_entries_catalog_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "shop_entries_catalog_idx" ON "public"."shop_entries" USING "btree" ("shop_type", "sort_order", "id");


--
-- Name: shop_entries_target_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "shop_entries_target_idx" ON "public"."shop_entries" USING "btree" ("target_category", "target_id", "shop_type");


--
-- Name: skill_effects_runtime_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "skill_effects_runtime_idx" ON "public"."skill_effects" USING "btree" ("skill_id", "sort_order", "template_id");


--
-- Name: skills_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "skills_lifecycle_idx" ON "public"."skills" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: status_effects_runtime_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "status_effects_runtime_idx" ON "public"."status_effects" USING "btree" ("status_id", "sort_order", "template_id");


--
-- Name: statuses_lifecycle_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "statuses_lifecycle_idx" ON "public"."statuses" USING "btree" ("is_active", "is_archived", "sort_order");


--
-- Name: user_collectible_unlock_events_pending_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_collectible_unlock_events_pending_idx" ON "public"."user_collectible_unlock_events" USING "btree" ("user_id", "created_at", "id") WHERE ("acknowledged_at" IS NULL);


--
-- Name: user_critters_user_unlocked_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_critters_user_unlocked_idx" ON "public"."user_critters" USING "btree" ("user_id", "unlocked_at");


--
-- Name: user_dungeon_progress_user_unlocked_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_dungeon_progress_user_unlocked_idx" ON "public"."user_dungeon_progress" USING "btree" ("user_id", "is_unlocked", "dungeon_id");


--
-- Name: user_rollcasters_user_unlocked_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_rollcasters_user_unlocked_idx" ON "public"."user_rollcasters" USING "btree" ("user_id", "unlocked_at");


--
-- Name: user_seen_critters_critter_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "user_seen_critters_critter_idx" ON "public"."user_seen_critters" USING "btree" ("critter_id");


--
-- Name: user_critters award_user_critter_level_progression; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "award_user_critter_level_progression" BEFORE INSERT OR UPDATE OF "level" ON "public"."user_critters" FOR EACH ROW EXECUTE FUNCTION "public"."award_user_critter_level_progression"();


--
-- Name: user_rollcasters award_user_rollcaster_level_progression; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "award_user_rollcaster_level_progression" BEFORE INSERT OR UPDATE OF "level" ON "public"."user_rollcasters" FOR EACH ROW EXECUTE FUNCTION "public"."award_user_rollcaster_level_progression"();


--
-- Name: critters cascade_critter_catalog_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cascade_critter_catalog_id" AFTER UPDATE OF "id" ON "public"."critters" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_collectible_catalog_id"('critter');


--
-- Name: critters cascade_promo_critter_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cascade_promo_critter_id" AFTER UPDATE OF "id" ON "public"."critters" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_promo_reward_target_id"('critter');


--
-- Name: currencies cascade_promo_currency_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cascade_promo_currency_id" AFTER UPDATE OF "id" ON "public"."currencies" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_promo_reward_target_id"('currency');


--
-- Name: relics cascade_promo_relic_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cascade_promo_relic_id" AFTER UPDATE OF "id" ON "public"."relics" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_promo_reward_target_id"('relic');


--
-- Name: rollcasters cascade_promo_rollcaster_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cascade_promo_rollcaster_id" AFTER UPDATE OF "id" ON "public"."rollcasters" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_promo_reward_target_id"('rollcaster');


--
-- Name: relics cascade_relic_catalog_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cascade_relic_catalog_id" AFTER UPDATE OF "id" ON "public"."relics" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_collectible_catalog_id"('relic');


--
-- Name: rollcasters cascade_rollcaster_catalog_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cascade_rollcaster_catalog_id" AFTER UPDATE OF "id" ON "public"."rollcasters" FOR EACH ROW EXECUTE FUNCTION "public"."cascade_collectible_catalog_id"('rollcaster');


--
-- Name: critters cleanup_critter_catalog_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cleanup_critter_catalog_delete" BEFORE DELETE ON "public"."critters" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_collectible_catalog_delete"('critter');


--
-- Name: relics cleanup_relic_catalog_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cleanup_relic_catalog_delete" BEFORE DELETE ON "public"."relics" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_collectible_catalog_delete"('relic');


--
-- Name: rollcasters cleanup_rollcaster_catalog_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "cleanup_rollcaster_catalog_delete" BEFORE DELETE ON "public"."rollcasters" FOR EACH ROW EXECUTE FUNCTION "public"."cleanup_collectible_catalog_delete"('rollcaster');


--
-- Name: content_change_log content_change_log_immutable; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "content_change_log_immutable" BEFORE DELETE OR UPDATE ON "public"."content_change_log" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_content_change_log_mutation"();


--
-- Name: collectible_unlock_challenges ensure_promo_shard_challenge_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER "ensure_promo_shard_challenge_trigger" AFTER DELETE OR UPDATE ON "public"."collectible_unlock_challenges" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."ensure_promo_shard_challenge"();


--
-- Name: collectible_unlock_challenges ensure_referenced_shard_challenge_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER "ensure_referenced_shard_challenge_trigger" AFTER DELETE OR UPDATE ON "public"."collectible_unlock_challenges" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."ensure_referenced_shard_challenge"();


--
-- Name: user_critters evaluate_collectibles_after_critter_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "evaluate_collectibles_after_critter_change" AFTER INSERT OR UPDATE OF "xp", "level" ON "public"."user_critters" FOR EACH ROW EXECUTE FUNCTION "public"."evaluate_collectible_after_player_change"();


--
-- Name: user_collectible_challenge_progress evaluate_collectibles_after_progress_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "evaluate_collectibles_after_progress_change" AFTER INSERT OR UPDATE OF "progress" ON "public"."user_collectible_challenge_progress" FOR EACH ROW EXECUTE FUNCTION "public"."evaluate_collectible_after_player_change"();


--
-- Name: user_relic_inventory evaluate_collectibles_after_relic_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "evaluate_collectibles_after_relic_change" AFTER INSERT OR UPDATE OF "quantity", "discovered_at" ON "public"."user_relic_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."evaluate_collectible_after_player_change"();


--
-- Name: user_rollcasters evaluate_collectibles_after_rollcaster_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "evaluate_collectibles_after_rollcaster_change" AFTER INSERT OR UPDATE OF "xp", "level" ON "public"."user_rollcasters" FOR EACH ROW EXECUTE FUNCTION "public"."evaluate_collectible_after_player_change"();


--
-- Name: user_collectible_shards evaluate_collectibles_after_shard_change; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "evaluate_collectibles_after_shard_change" AFTER INSERT OR UPDATE OF "quantity" ON "public"."user_collectible_shards" FOR EACH ROW EXECUTE FUNCTION "public"."evaluate_collectible_after_player_change"();


--
-- Name: elements initialize_element_effectiveness_after_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "initialize_element_effectiveness_after_insert" AFTER INSERT ON "public"."elements" FOR EACH ROW EXECUTE FUNCTION "public"."initialize_element_effectiveness"();


--
-- Name: promo_codes normalize_promo_code_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "normalize_promo_code_trigger" BEFORE INSERT OR UPDATE ON "public"."promo_codes" FOR EACH ROW EXECUTE FUNCTION "public"."normalize_promo_code"();


--
-- Name: critters prevent_promo_critter_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "prevent_promo_critter_delete" BEFORE DELETE ON "public"."critters" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_promo_reward_target_delete"('critter');


--
-- Name: currencies prevent_promo_currency_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "prevent_promo_currency_delete" BEFORE DELETE ON "public"."currencies" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_promo_reward_target_delete"('currency');


--
-- Name: relics prevent_promo_relic_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "prevent_promo_relic_delete" BEFORE DELETE ON "public"."relics" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_promo_reward_target_delete"('relic');


--
-- Name: rollcasters prevent_promo_rollcaster_delete; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "prevent_promo_rollcaster_delete" BEFORE DELETE ON "public"."rollcasters" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_promo_reward_target_delete"('rollcaster');


--
-- Name: profiles reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: promo_code_redemptions reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."promo_code_redemptions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_collectible_challenge_progress reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_collectible_challenge_progress" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_collectible_shards reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_collectible_shards" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_collectible_unlock_events reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_collectible_unlock_events" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_critters reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_critters" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_currencies reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_currencies" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_dungeon_progress reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_dungeon_progress" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_relic_inventory reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_relic_inventory" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_rollcaster_abilities reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_rollcaster_abilities" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_rollcasters reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_rollcasters" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_seen_critters reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_seen_critters" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_squad_slots reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_squad_slots" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_tracked_collectible_challenges reject_dev_tool_game_state; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "reject_dev_tool_game_state" BEFORE INSERT OR UPDATE OF "user_id" ON "public"."user_tracked_collectible_challenges" FOR EACH ROW EXECUTE FUNCTION "public"."reject_dev_tool_game_state"();


--
-- Name: user_currencies sync_currency_coins_to_profile; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "sync_currency_coins_to_profile" AFTER INSERT OR UPDATE OF "balance" ON "public"."user_currencies" FOR EACH ROW EXECUTE FUNCTION "public"."sync_currency_coins_to_profile"();


--
-- Name: profiles sync_profile_coins_to_currency; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "sync_profile_coins_to_currency" AFTER INSERT OR UPDATE OF "coins" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."sync_profile_coins_to_currency"();


--
-- Name: ability_effects validate_ability_effect; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_ability_effect" BEFORE INSERT OR UPDATE ON "public"."ability_effects" FOR EACH ROW EXECUTE FUNCTION "public"."validate_inline_effect_row"();


--
-- Name: collectible_unlock_challenges validate_collectible_gate_configuration_on_challenge; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER "validate_collectible_gate_configuration_on_challenge" AFTER INSERT OR DELETE OR UPDATE ON "public"."collectible_unlock_challenges" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."validate_collectible_gate_configuration_trigger"();


--
-- Name: collectible_unlock_requirements validate_collectible_gate_configuration_on_requirement; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE CONSTRAINT TRIGGER "validate_collectible_gate_configuration_on_requirement" AFTER INSERT OR UPDATE ON "public"."collectible_unlock_requirements" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."validate_collectible_gate_configuration_trigger"();


--
-- Name: collectible_unlock_challenges validate_collectible_unlock_challenge; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_collectible_unlock_challenge" BEFORE INSERT OR UPDATE ON "public"."collectible_unlock_challenges" FOR EACH ROW EXECUTE FUNCTION "public"."validate_collectible_unlock_challenge"();


--
-- Name: dungeon_completion_drops validate_dungeon_completion_drop_row_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_dungeon_completion_drop_row_trigger" BEFORE INSERT OR UPDATE ON "public"."dungeon_completion_drops" FOR EACH ROW EXECUTE FUNCTION "public"."validate_dungeon_completion_drop_row"();


--
-- Name: dungeon_opponent_item_drops validate_dungeon_item_drop_row_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_dungeon_item_drop_row_trigger" BEFORE INSERT OR UPDATE ON "public"."dungeon_opponent_item_drops" FOR EACH ROW EXECUTE FUNCTION "public"."validate_dungeon_item_drop_row"();


--
-- Name: promo_code_rewards validate_promo_code_reward_trigger; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_promo_code_reward_trigger" BEFORE INSERT OR UPDATE ON "public"."promo_code_rewards" FOR EACH ROW EXECUTE FUNCTION "public"."validate_promo_code_reward"();


--
-- Name: relic_effects validate_relic_effect; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_relic_effect" BEFORE INSERT OR UPDATE ON "public"."relic_effects" FOR EACH ROW EXECUTE FUNCTION "public"."validate_inline_effect_row"();


--
-- Name: shop_entries validate_shop_entry; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_shop_entry" BEFORE INSERT OR UPDATE ON "public"."shop_entries" FOR EACH ROW EXECUTE FUNCTION "public"."validate_shop_entry"();


--
-- Name: skill_effects validate_skill_effect; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_skill_effect" BEFORE INSERT OR UPDATE ON "public"."skill_effects" FOR EACH ROW EXECUTE FUNCTION "public"."validate_inline_effect_row"();


--
-- Name: status_effects validate_status_effect; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_status_effect" BEFORE INSERT OR UPDATE ON "public"."status_effects" FOR EACH ROW EXECUTE FUNCTION "public"."validate_inline_effect_row"();


--
-- Name: user_tracked_collectible_challenges validate_tracked_collectible_challenge; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_tracked_collectible_challenge" BEFORE INSERT OR UPDATE ON "public"."user_tracked_collectible_challenges" FOR EACH ROW EXECUTE FUNCTION "public"."validate_tracked_collectible_challenge"();


--
-- Name: user_collectible_shards validate_user_collectible_shards; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "validate_user_collectible_shards" BEFORE INSERT OR UPDATE ON "public"."user_collectible_shards" FOR EACH ROW EXECUTE FUNCTION "public"."validate_user_collectible_shards"();


--
-- Name: ability_effects ability_effects_ability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ability_effects"
    ADD CONSTRAINT "ability_effects_ability_id_fkey" FOREIGN KEY ("ability_id") REFERENCES "public"."rollcaster_abilities"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ability_effects ability_effects_template_id_effect_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."ability_effects"
    ADD CONSTRAINT "ability_effects_template_id_effect_category_fkey" FOREIGN KEY ("template_id", "effect_category") REFERENCES "public"."effect_templates"("id", "effect_category");


--
-- Name: collectible_combat_events collectible_combat_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."collectible_combat_events"
    ADD CONSTRAINT "collectible_combat_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."dungeon_runs"("id") ON DELETE CASCADE;


--
-- Name: collectible_combat_events collectible_combat_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."collectible_combat_events"
    ADD CONSTRAINT "collectible_combat_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: collectible_unlock_challenges collectible_unlock_challenges_collectible_type_collectible_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."collectible_unlock_challenges"
    ADD CONSTRAINT "collectible_unlock_challenges_collectible_type_collectible_fkey" FOREIGN KEY ("collectible_type", "collectible_id") REFERENCES "public"."collectible_unlock_requirements"("collectible_type", "collectible_id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: collectible_unlock_requirements collectible_unlock_requirements_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."collectible_unlock_requirements"
    ADD CONSTRAINT "collectible_unlock_requirements_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: combat_turn_actions combat_turn_actions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."combat_turn_actions"
    ADD CONSTRAINT "combat_turn_actions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."dungeon_runs"("id") ON DELETE CASCADE;


--
-- Name: combat_turn_actions combat_turn_actions_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."combat_turn_actions"
    ADD CONSTRAINT "combat_turn_actions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON UPDATE CASCADE;


--
-- Name: combat_turn_actions combat_turn_actions_swap_in_user_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."combat_turn_actions"
    ADD CONSTRAINT "combat_turn_actions_swap_in_user_critter_id_fkey" FOREIGN KEY ("swap_in_user_critter_id") REFERENCES "public"."user_critters"("id");


--
-- Name: critter_level_progression critter_level_progression_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critter_level_progression"
    ADD CONSTRAINT "critter_level_progression_critter_id_fkey" FOREIGN KEY ("critter_id") REFERENCES "public"."critters"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: critter_skill_unlocks critter_skill_unlocks_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critter_skill_unlocks"
    ADD CONSTRAINT "critter_skill_unlocks_critter_id_fkey" FOREIGN KEY ("critter_id") REFERENCES "public"."critters"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: critter_skill_unlocks critter_skill_unlocks_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critter_skill_unlocks"
    ADD CONSTRAINT "critter_skill_unlocks_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON UPDATE CASCADE;


--
-- Name: critters critters_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critters"
    ADD CONSTRAINT "critters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: critters critters_element_1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critters"
    ADD CONSTRAINT "critters_element_1_id_fkey" FOREIGN KEY ("element_1_id") REFERENCES "public"."elements"("id") ON UPDATE CASCADE;


--
-- Name: critters critters_element_2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critters"
    ADD CONSTRAINT "critters_element_2_id_fkey" FOREIGN KEY ("element_2_id") REFERENCES "public"."elements"("id") ON UPDATE CASCADE;


--
-- Name: critters critters_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."critters"
    ADD CONSTRAINT "critters_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: currencies currencies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."currencies"
    ADD CONSTRAINT "currencies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: currencies currencies_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."currencies"
    ADD CONSTRAINT "currencies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: dev_tool_users dev_tool_users_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dev_tool_users"
    ADD CONSTRAINT "dev_tool_users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: dev_tool_users dev_tool_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dev_tool_users"
    ADD CONSTRAINT "dev_tool_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: dungeon_completion_drops dungeon_completion_drops_dungeon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_completion_drops"
    ADD CONSTRAINT "dungeon_completion_drops_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "public"."dungeons"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: dungeon_completion_drops dungeon_completion_drops_dupe_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_completion_drops"
    ADD CONSTRAINT "dungeon_completion_drops_dupe_currency_id_fkey" FOREIGN KEY ("dupe_currency_id") REFERENCES "public"."currencies"("id") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: dungeon_opponent_currency_drops dungeon_opponent_currency_drops_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_currency_drops"
    ADD CONSTRAINT "dungeon_opponent_currency_drops_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: dungeon_opponent_currency_drops dungeon_opponent_currency_drops_opponent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_currency_drops"
    ADD CONSTRAINT "dungeon_opponent_currency_drops_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."dungeon_opponents"("id") ON DELETE CASCADE;


--
-- Name: dungeon_opponent_item_drops dungeon_opponent_item_drops_dupe_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_item_drops"
    ADD CONSTRAINT "dungeon_opponent_item_drops_dupe_currency_id_fkey" FOREIGN KEY ("dupe_currency_id") REFERENCES "public"."currencies"("id") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: dungeon_opponent_item_drops dungeon_opponent_item_drops_opponent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_item_drops"
    ADD CONSTRAINT "dungeon_opponent_item_drops_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."dungeon_opponents"("id") ON DELETE CASCADE;


--
-- Name: dungeon_opponent_relics dungeon_opponent_relics_opponent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_relics"
    ADD CONSTRAINT "dungeon_opponent_relics_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."dungeon_opponents"("id") ON DELETE CASCADE;


--
-- Name: dungeon_opponent_relics dungeon_opponent_relics_relic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_relics"
    ADD CONSTRAINT "dungeon_opponent_relics_relic_id_fkey" FOREIGN KEY ("relic_id") REFERENCES "public"."relics"("id") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: dungeon_opponent_rewards dungeon_opponent_rewards_opponent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_rewards"
    ADD CONSTRAINT "dungeon_opponent_rewards_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."dungeon_opponents"("id") ON DELETE CASCADE;


--
-- Name: dungeon_opponent_skills dungeon_opponent_skills_opponent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_skills"
    ADD CONSTRAINT "dungeon_opponent_skills_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."dungeon_opponents"("id") ON DELETE CASCADE;


--
-- Name: dungeon_opponent_skills dungeon_opponent_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_skills"
    ADD CONSTRAINT "dungeon_opponent_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: dungeon_opponent_stat_overrides dungeon_opponent_stat_overrides_opponent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponent_stat_overrides"
    ADD CONSTRAINT "dungeon_opponent_stat_overrides_opponent_id_fkey" FOREIGN KEY ("opponent_id") REFERENCES "public"."dungeon_opponents"("id") ON DELETE CASCADE;


--
-- Name: dungeon_opponents dungeon_opponents_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponents"
    ADD CONSTRAINT "dungeon_opponents_critter_id_fkey" FOREIGN KEY ("critter_id") REFERENCES "public"."critters"("id") ON UPDATE CASCADE;


--
-- Name: dungeon_opponents dungeon_opponents_dungeon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_opponents"
    ADD CONSTRAINT "dungeon_opponents_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "public"."dungeons"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: dungeon_run_commands dungeon_run_commands_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_run_commands"
    ADD CONSTRAINT "dungeon_run_commands_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."dungeon_runs"("id") ON DELETE CASCADE;


--
-- Name: dungeon_run_commands dungeon_run_commands_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_run_commands"
    ADD CONSTRAINT "dungeon_run_commands_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: dungeon_runs dungeon_runs_dungeon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_runs"
    ADD CONSTRAINT "dungeon_runs_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "public"."dungeons"("id") ON UPDATE CASCADE;


--
-- Name: dungeon_runs dungeon_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeon_runs"
    ADD CONSTRAINT "dungeon_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: dungeons dungeons_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeons"
    ADD CONSTRAINT "dungeons_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: dungeons dungeons_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."dungeons"
    ADD CONSTRAINT "dungeons_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: effect_templates effect_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."effect_templates"
    ADD CONSTRAINT "effect_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: effect_templates effect_templates_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."effect_templates"
    ADD CONSTRAINT "effect_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: element_chart_config element_chart_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."element_chart_config"
    ADD CONSTRAINT "element_chart_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: element_effectiveness element_effectiveness_attacking_element_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."element_effectiveness"
    ADD CONSTRAINT "element_effectiveness_attacking_element_id_fkey" FOREIGN KEY ("attacking_element_id") REFERENCES "public"."elements"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: element_effectiveness element_effectiveness_defending_element_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."element_effectiveness"
    ADD CONSTRAINT "element_effectiveness_defending_element_id_fkey" FOREIGN KEY ("defending_element_id") REFERENCES "public"."elements"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: elements elements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."elements"
    ADD CONSTRAINT "elements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: elements elements_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."elements"
    ADD CONSTRAINT "elements_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: game_assets game_assets_bucket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."game_assets"
    ADD CONSTRAINT "game_assets_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "storage"."buckets"("id");


--
-- Name: profiles profiles_active_rollcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_active_rollcaster_id_fkey" FOREIGN KEY ("active_rollcaster_id") REFERENCES "public"."user_rollcasters"("id");


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: promo_code_redemption_rewards promo_code_redemption_rewards_redemption_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_redemption_rewards"
    ADD CONSTRAINT "promo_code_redemption_rewards_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "public"."promo_code_redemptions"("id") ON DELETE CASCADE;


--
-- Name: promo_code_redemptions promo_code_redemptions_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE RESTRICT;


--
-- Name: promo_code_redemptions promo_code_redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: promo_code_rewards promo_code_rewards_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_code_rewards"
    ADD CONSTRAINT "promo_code_rewards_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE CASCADE;


--
-- Name: promo_codes promo_codes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");


--
-- Name: promo_codes promo_codes_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");


--
-- Name: relic_effects relic_effects_relic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."relic_effects"
    ADD CONSTRAINT "relic_effects_relic_id_fkey" FOREIGN KEY ("relic_id") REFERENCES "public"."relics"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: relic_effects relic_effects_template_id_effect_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."relic_effects"
    ADD CONSTRAINT "relic_effects_template_id_effect_category_fkey" FOREIGN KEY ("template_id", "effect_category") REFERENCES "public"."effect_templates"("id", "effect_category");


--
-- Name: relics relics_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."relics"
    ADD CONSTRAINT "relics_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: relics relics_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."relics"
    ADD CONSTRAINT "relics_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: rollcaster_abilities rollcaster_abilities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_abilities"
    ADD CONSTRAINT "rollcaster_abilities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: rollcaster_abilities rollcaster_abilities_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_abilities"
    ADD CONSTRAINT "rollcaster_abilities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: rollcaster_ability_unlocks rollcaster_ability_unlocks_ability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_ability_unlocks"
    ADD CONSTRAINT "rollcaster_ability_unlocks_ability_id_fkey" FOREIGN KEY ("ability_id") REFERENCES "public"."rollcaster_abilities"("id") ON UPDATE CASCADE;


--
-- Name: rollcaster_ability_unlocks rollcaster_ability_unlocks_rollcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_ability_unlocks"
    ADD CONSTRAINT "rollcaster_ability_unlocks_rollcaster_id_fkey" FOREIGN KEY ("rollcaster_id") REFERENCES "public"."rollcasters"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rollcaster_level_progression rollcaster_level_progression_rollcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcaster_level_progression"
    ADD CONSTRAINT "rollcaster_level_progression_rollcaster_id_fkey" FOREIGN KEY ("rollcaster_id") REFERENCES "public"."rollcasters"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: rollcasters rollcasters_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcasters"
    ADD CONSTRAINT "rollcasters_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: rollcasters rollcasters_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."rollcasters"
    ADD CONSTRAINT "rollcasters_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: shop_entries shop_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."shop_entries"
    ADD CONSTRAINT "shop_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: shop_entries shop_entries_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."shop_entries"
    ADD CONSTRAINT "shop_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON UPDATE CASCADE;


--
-- Name: shop_entries shop_entries_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."shop_entries"
    ADD CONSTRAINT "shop_entries_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: shop_purchase_receipts shop_purchase_receipts_unlock_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."shop_purchase_receipts"
    ADD CONSTRAINT "shop_purchase_receipts_unlock_event_id_fkey" FOREIGN KEY ("unlock_event_id") REFERENCES "public"."user_collectible_unlock_events"("id") ON DELETE SET NULL;


--
-- Name: shop_purchase_receipts shop_purchase_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."shop_purchase_receipts"
    ADD CONSTRAINT "shop_purchase_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: skill_effects skill_effects_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."skill_effects"
    ADD CONSTRAINT "skill_effects_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: skill_effects skill_effects_template_id_effect_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."skill_effects"
    ADD CONSTRAINT "skill_effects_template_id_effect_category_fkey" FOREIGN KEY ("template_id", "effect_category") REFERENCES "public"."effect_templates"("id", "effect_category");


--
-- Name: skills skills_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: skills skills_element_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "public"."elements"("id") ON UPDATE CASCADE;


--
-- Name: skills skills_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."skills"
    ADD CONSTRAINT "skills_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: starter_options starter_options_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."starter_options"
    ADD CONSTRAINT "starter_options_critter_id_fkey" FOREIGN KEY ("critter_id") REFERENCES "public"."critters"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: starter_rollcaster_options starter_rollcaster_options_rollcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."starter_rollcaster_options"
    ADD CONSTRAINT "starter_rollcaster_options_rollcaster_id_fkey" FOREIGN KEY ("rollcaster_id") REFERENCES "public"."rollcasters"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: status_effects status_effects_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."status_effects"
    ADD CONSTRAINT "status_effects_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: status_effects status_effects_template_id_effect_category_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."status_effects"
    ADD CONSTRAINT "status_effects_template_id_effect_category_fkey" FOREIGN KEY ("template_id", "effect_category") REFERENCES "public"."effect_templates"("id", "effect_category");


--
-- Name: statuses statuses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."statuses"
    ADD CONSTRAINT "statuses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: statuses statuses_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."statuses"
    ADD CONSTRAINT "statuses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;


--
-- Name: user_collectible_challenge_progress user_collectible_challenge_progress_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_challenge_progress"
    ADD CONSTRAINT "user_collectible_challenge_progress_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."collectible_unlock_challenges"("id") ON DELETE CASCADE;


--
-- Name: user_collectible_challenge_progress user_collectible_challenge_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_challenge_progress"
    ADD CONSTRAINT "user_collectible_challenge_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_collectible_shards user_collectible_shards_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_shards"
    ADD CONSTRAINT "user_collectible_shards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_collectible_unlock_events user_collectible_unlock_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_collectible_unlock_events"
    ADD CONSTRAINT "user_collectible_unlock_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_critter_relic_slots user_critter_relic_slots_relic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_relic_slots"
    ADD CONSTRAINT "user_critter_relic_slots_relic_id_fkey" FOREIGN KEY ("relic_id") REFERENCES "public"."relics"("id") ON UPDATE CASCADE;


--
-- Name: user_critter_relic_slots user_critter_relic_slots_user_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_relic_slots"
    ADD CONSTRAINT "user_critter_relic_slots_user_critter_id_fkey" FOREIGN KEY ("user_critter_id") REFERENCES "public"."user_critters"("id") ON DELETE CASCADE;


--
-- Name: user_critter_skill_slots user_critter_skill_slots_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_skill_slots"
    ADD CONSTRAINT "user_critter_skill_slots_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON UPDATE CASCADE;


--
-- Name: user_critter_skill_slots user_critter_skill_slots_user_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_skill_slots"
    ADD CONSTRAINT "user_critter_skill_slots_user_critter_id_fkey" FOREIGN KEY ("user_critter_id") REFERENCES "public"."user_critters"("id") ON DELETE CASCADE;


--
-- Name: user_critter_skills user_critter_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_skills"
    ADD CONSTRAINT "user_critter_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON UPDATE CASCADE;


--
-- Name: user_critter_skills user_critter_skills_user_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critter_skills"
    ADD CONSTRAINT "user_critter_skills_user_critter_id_fkey" FOREIGN KEY ("user_critter_id") REFERENCES "public"."user_critters"("id") ON DELETE CASCADE;


--
-- Name: user_critters user_critters_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critters"
    ADD CONSTRAINT "user_critters_critter_id_fkey" FOREIGN KEY ("critter_id") REFERENCES "public"."critters"("id") ON UPDATE CASCADE;


--
-- Name: user_critters user_critters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_critters"
    ADD CONSTRAINT "user_critters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_currencies user_currencies_currency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_currencies"
    ADD CONSTRAINT "user_currencies_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON UPDATE CASCADE;


--
-- Name: user_currencies user_currencies_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_currencies"
    ADD CONSTRAINT "user_currencies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_dungeon_progress user_dungeon_progress_dungeon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_dungeon_progress"
    ADD CONSTRAINT "user_dungeon_progress_dungeon_id_fkey" FOREIGN KEY ("dungeon_id") REFERENCES "public"."dungeons"("id") ON UPDATE CASCADE;


--
-- Name: user_dungeon_progress user_dungeon_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_dungeon_progress"
    ADD CONSTRAINT "user_dungeon_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_relic_inventory user_relic_inventory_relic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_relic_inventory"
    ADD CONSTRAINT "user_relic_inventory_relic_id_fkey" FOREIGN KEY ("relic_id") REFERENCES "public"."relics"("id") ON UPDATE CASCADE;


--
-- Name: user_relic_inventory user_relic_inventory_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_relic_inventory"
    ADD CONSTRAINT "user_relic_inventory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_rollcaster_abilities user_rollcaster_abilities_ability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcaster_abilities"
    ADD CONSTRAINT "user_rollcaster_abilities_ability_id_fkey" FOREIGN KEY ("ability_id") REFERENCES "public"."rollcaster_abilities"("id") ON UPDATE CASCADE;


--
-- Name: user_rollcaster_abilities user_rollcaster_abilities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcaster_abilities"
    ADD CONSTRAINT "user_rollcaster_abilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_rollcaster_abilities user_rollcaster_abilities_user_rollcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcaster_abilities"
    ADD CONSTRAINT "user_rollcaster_abilities_user_rollcaster_id_fkey" FOREIGN KEY ("user_rollcaster_id") REFERENCES "public"."user_rollcasters"("id") ON DELETE CASCADE;


--
-- Name: user_rollcaster_ability_slots user_rollcaster_ability_slots_ability_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcaster_ability_slots"
    ADD CONSTRAINT "user_rollcaster_ability_slots_ability_id_fkey" FOREIGN KEY ("ability_id") REFERENCES "public"."rollcaster_abilities"("id") ON UPDATE CASCADE;


--
-- Name: user_rollcaster_ability_slots user_rollcaster_ability_slots_user_rollcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcaster_ability_slots"
    ADD CONSTRAINT "user_rollcaster_ability_slots_user_rollcaster_id_fkey" FOREIGN KEY ("user_rollcaster_id") REFERENCES "public"."user_rollcasters"("id") ON DELETE CASCADE;


--
-- Name: user_rollcasters user_rollcasters_rollcaster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcasters"
    ADD CONSTRAINT "user_rollcasters_rollcaster_id_fkey" FOREIGN KEY ("rollcaster_id") REFERENCES "public"."rollcasters"("id") ON UPDATE CASCADE;


--
-- Name: user_rollcasters user_rollcasters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_rollcasters"
    ADD CONSTRAINT "user_rollcasters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_seen_critters user_seen_critters_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_seen_critters"
    ADD CONSTRAINT "user_seen_critters_critter_id_fkey" FOREIGN KEY ("critter_id") REFERENCES "public"."critters"("id") ON UPDATE CASCADE;


--
-- Name: user_seen_critters user_seen_critters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_seen_critters"
    ADD CONSTRAINT "user_seen_critters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_squad_slots user_squad_slots_user_critter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_squad_slots"
    ADD CONSTRAINT "user_squad_slots_user_critter_id_fkey" FOREIGN KEY ("user_critter_id") REFERENCES "public"."user_critters"("id") ON DELETE SET NULL;


--
-- Name: user_squad_slots user_squad_slots_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_squad_slots"
    ADD CONSTRAINT "user_squad_slots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: user_tracked_collectible_challenges user_tracked_collectible_challenges_challenge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_tracked_collectible_challenges"
    ADD CONSTRAINT "user_tracked_collectible_challenges_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "public"."collectible_unlock_challenges"("id") ON DELETE CASCADE;


--
-- Name: user_tracked_collectible_challenges user_tracked_collectible_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."user_tracked_collectible_challenges"
    ADD CONSTRAINT "user_tracked_collectible_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: ability_effects; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."ability_effects" ENABLE ROW LEVEL SECURITY;

--
-- Name: ability_effects ability_effects_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "ability_effects_read_all" ON "public"."ability_effects" FOR SELECT USING (true);


--
-- Name: collectible_combat_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."collectible_combat_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: collectible_combat_events collectible_combat_events_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collectible_combat_events_read_own" ON "public"."collectible_combat_events" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: collectible_unlock_challenges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."collectible_unlock_challenges" ENABLE ROW LEVEL SECURITY;

--
-- Name: collectible_unlock_challenges collectible_unlock_challenges_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collectible_unlock_challenges_read_all" ON "public"."collectible_unlock_challenges" FOR SELECT USING (true);


--
-- Name: collectible_unlock_requirements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."collectible_unlock_requirements" ENABLE ROW LEVEL SECURITY;

--
-- Name: collectible_unlock_requirements collectible_unlock_requirements_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "collectible_unlock_requirements_read_all" ON "public"."collectible_unlock_requirements" FOR SELECT USING (true);


--
-- Name: combat_turn_actions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."combat_turn_actions" ENABLE ROW LEVEL SECURITY;

--
-- Name: combat_turn_actions combat_turn_actions_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "combat_turn_actions_own_select" ON "public"."combat_turn_actions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."dungeon_runs"
  WHERE (("dungeon_runs"."id" = "combat_turn_actions"."run_id") AND ("dungeon_runs"."user_id" = "auth"."uid"())))));


--
-- Name: content_change_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."content_change_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: content_change_log content_change_log_admin_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "content_change_log_admin_read" ON "public"."content_change_log" FOR SELECT TO "authenticated" USING ("public"."is_content_admin"());


--
-- Name: critter_level_progression; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."critter_level_progression" ENABLE ROW LEVEL SECURITY;

--
-- Name: critter_level_progression critter_level_progression_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "critter_level_progression_read_all" ON "public"."critter_level_progression" FOR SELECT USING (true);


--
-- Name: critter_skill_unlocks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."critter_skill_unlocks" ENABLE ROW LEVEL SECURITY;

--
-- Name: critter_skill_unlocks critter_skill_unlocks_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "critter_skill_unlocks_read_all" ON "public"."critter_skill_unlocks" FOR SELECT USING (true);


--
-- Name: critters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."critters" ENABLE ROW LEVEL SECURITY;

--
-- Name: critters critters_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "critters_read_all" ON "public"."critters" FOR SELECT USING (true);


--
-- Name: currencies; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."currencies" ENABLE ROW LEVEL SECURITY;

--
-- Name: currencies currencies_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "currencies_read_all" ON "public"."currencies" FOR SELECT USING (true);


--
-- Name: dev_tool_users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dev_tool_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: dev_tool_users dev_tool_users_read_self; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dev_tool_users_read_self" ON "public"."dev_tool_users" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));


--
-- Name: dungeon_completion_drops; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_completion_drops" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_completion_drops dungeon_completion_drops_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_completion_drops_read" ON "public"."dungeon_completion_drops" FOR SELECT USING (true);


--
-- Name: dungeon_opponent_currency_drops; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_opponent_currency_drops" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_opponent_currency_drops dungeon_opponent_currency_drops_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_opponent_currency_drops_read" ON "public"."dungeon_opponent_currency_drops" FOR SELECT USING (true);


--
-- Name: dungeon_opponent_item_drops; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_opponent_item_drops" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_opponent_item_drops dungeon_opponent_item_drops_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_opponent_item_drops_read" ON "public"."dungeon_opponent_item_drops" FOR SELECT USING (true);


--
-- Name: dungeon_opponent_relics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_opponent_relics" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_opponent_relics dungeon_opponent_relics_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_opponent_relics_read_all" ON "public"."dungeon_opponent_relics" FOR SELECT USING (true);


--
-- Name: dungeon_opponent_rewards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_opponent_rewards" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_opponent_rewards dungeon_opponent_rewards_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_opponent_rewards_read_all" ON "public"."dungeon_opponent_rewards" FOR SELECT USING (true);


--
-- Name: dungeon_opponent_skills; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_opponent_skills" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_opponent_skills dungeon_opponent_skills_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_opponent_skills_read_all" ON "public"."dungeon_opponent_skills" FOR SELECT USING (true);


--
-- Name: dungeon_opponent_stat_overrides; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_opponent_stat_overrides" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_opponent_stat_overrides dungeon_opponent_stat_overrides_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_opponent_stat_overrides_read_all" ON "public"."dungeon_opponent_stat_overrides" FOR SELECT USING (true);


--
-- Name: dungeon_opponents; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_opponents" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_opponents dungeon_opponents_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_opponents_read_all" ON "public"."dungeon_opponents" FOR SELECT USING (true);


--
-- Name: dungeon_run_commands; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_run_commands" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_run_commands dungeon_run_commands_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_run_commands_own_select" ON "public"."dungeon_run_commands" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: dungeon_runs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeon_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeon_runs dungeon_runs_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeon_runs_own_select" ON "public"."dungeon_runs" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: dungeons; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."dungeons" ENABLE ROW LEVEL SECURITY;

--
-- Name: dungeons dungeons_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "dungeons_read_all" ON "public"."dungeons" FOR SELECT USING (true);


--
-- Name: effect_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."effect_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: effect_templates effect_templates_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "effect_templates_read_all" ON "public"."effect_templates" FOR SELECT USING (true);


--
-- Name: element_chart_config; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."element_chart_config" ENABLE ROW LEVEL SECURITY;

--
-- Name: element_chart_config element_chart_config_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "element_chart_config_read" ON "public"."element_chart_config" FOR SELECT USING (true);


--
-- Name: element_effectiveness; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."element_effectiveness" ENABLE ROW LEVEL SECURITY;

--
-- Name: element_effectiveness element_effectiveness_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "element_effectiveness_read" ON "public"."element_effectiveness" FOR SELECT USING (true);


--
-- Name: elements; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."elements" ENABLE ROW LEVEL SECURITY;

--
-- Name: elements elements_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "elements_read_all" ON "public"."elements" FOR SELECT USING (true);


--
-- Name: game_assets; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."game_assets" ENABLE ROW LEVEL SECURITY;

--
-- Name: game_assets game_assets_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "game_assets_read_all" ON "public"."game_assets" FOR SELECT USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles_own_select" ON "public"."profiles" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: promo_code_redemption_rewards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."promo_code_redemption_rewards" ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_code_redemption_rewards promo_code_redemption_rewards_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "promo_code_redemption_rewards_read_own" ON "public"."promo_code_redemption_rewards" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."promo_code_redemptions" "r"
  WHERE (("r"."id" = "promo_code_redemption_rewards"."redemption_id") AND ("r"."user_id" = "auth"."uid"())))));


--
-- Name: promo_code_redemptions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."promo_code_redemptions" ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_code_redemptions promo_code_redemptions_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "promo_code_redemptions_read_own" ON "public"."promo_code_redemptions" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));


--
-- Name: promo_code_rewards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."promo_code_rewards" ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_code_rewards promo_code_rewards_admin_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "promo_code_rewards_admin_read" ON "public"."promo_code_rewards" FOR SELECT TO "authenticated" USING ("public"."is_content_admin"());


--
-- Name: promo_codes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."promo_codes" ENABLE ROW LEVEL SECURITY;

--
-- Name: promo_codes promo_codes_admin_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "promo_codes_admin_read" ON "public"."promo_codes" FOR SELECT TO "authenticated" USING ("public"."is_content_admin"());


--
-- Name: relic_effects; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."relic_effects" ENABLE ROW LEVEL SECURITY;

--
-- Name: relic_effects relic_effects_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "relic_effects_read_all" ON "public"."relic_effects" FOR SELECT USING (true);


--
-- Name: relics; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."relics" ENABLE ROW LEVEL SECURITY;

--
-- Name: relics relics_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "relics_read_all" ON "public"."relics" FOR SELECT USING (true);


--
-- Name: rollcaster_abilities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."rollcaster_abilities" ENABLE ROW LEVEL SECURITY;

--
-- Name: rollcaster_abilities rollcaster_abilities_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "rollcaster_abilities_read_all" ON "public"."rollcaster_abilities" FOR SELECT USING (true);


--
-- Name: rollcaster_ability_unlocks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."rollcaster_ability_unlocks" ENABLE ROW LEVEL SECURITY;

--
-- Name: rollcaster_ability_unlocks rollcaster_ability_unlocks_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "rollcaster_ability_unlocks_read_all" ON "public"."rollcaster_ability_unlocks" FOR SELECT USING (true);


--
-- Name: rollcaster_level_progression; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."rollcaster_level_progression" ENABLE ROW LEVEL SECURITY;

--
-- Name: rollcaster_level_progression rollcaster_level_progression_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "rollcaster_level_progression_read_all" ON "public"."rollcaster_level_progression" FOR SELECT USING (true);


--
-- Name: rollcasters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."rollcasters" ENABLE ROW LEVEL SECURITY;

--
-- Name: rollcasters rollcasters_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "rollcasters_read_all" ON "public"."rollcasters" FOR SELECT USING (true);


--
-- Name: shop_entries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."shop_entries" ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_entries shop_entries_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "shop_entries_read_all" ON "public"."shop_entries" FOR SELECT USING (true);


--
-- Name: shop_purchase_receipts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."shop_purchase_receipts" ENABLE ROW LEVEL SECURITY;

--
-- Name: shop_purchase_receipts shop_purchase_receipts_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "shop_purchase_receipts_read_own" ON "public"."shop_purchase_receipts" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: skill_effects; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."skill_effects" ENABLE ROW LEVEL SECURITY;

--
-- Name: skill_effects skill_effects_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "skill_effects_read_all" ON "public"."skill_effects" FOR SELECT USING (true);


--
-- Name: skills; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."skills" ENABLE ROW LEVEL SECURITY;

--
-- Name: skills skills_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "skills_read_all" ON "public"."skills" FOR SELECT USING (true);


--
-- Name: starter_options; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."starter_options" ENABLE ROW LEVEL SECURITY;

--
-- Name: starter_options starter_options_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "starter_options_read_all" ON "public"."starter_options" FOR SELECT USING (true);


--
-- Name: starter_rollcaster_options; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."starter_rollcaster_options" ENABLE ROW LEVEL SECURITY;

--
-- Name: starter_rollcaster_options starter_rollcaster_options_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "starter_rollcaster_options_read_all" ON "public"."starter_rollcaster_options" FOR SELECT USING (true);


--
-- Name: status_effects; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."status_effects" ENABLE ROW LEVEL SECURITY;

--
-- Name: status_effects status_effects_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "status_effects_read_all" ON "public"."status_effects" FOR SELECT USING (true);


--
-- Name: statuses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."statuses" ENABLE ROW LEVEL SECURITY;

--
-- Name: statuses statuses_read_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "statuses_read_all" ON "public"."statuses" FOR SELECT USING (true);


--
-- Name: user_collectible_challenge_progress; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_collectible_challenge_progress" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_collectible_challenge_progress user_collectible_challenge_progress_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_collectible_challenge_progress_read_own" ON "public"."user_collectible_challenge_progress" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: user_collectible_shards; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_collectible_shards" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_collectible_shards user_collectible_shards_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_collectible_shards_read_own" ON "public"."user_collectible_shards" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: user_collectible_unlock_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_collectible_unlock_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_collectible_unlock_events user_collectible_unlock_events_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_collectible_unlock_events_read_own" ON "public"."user_collectible_unlock_events" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: user_critter_relic_slots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_critter_relic_slots" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_critter_relic_slots user_critter_relic_slots_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_critter_relic_slots_own_select" ON "public"."user_critter_relic_slots" FOR SELECT USING ("public"."owns_user_critter"("user_critter_id"));


--
-- Name: user_critter_skill_slots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_critter_skill_slots" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_critter_skill_slots user_critter_skill_slots_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_critter_skill_slots_own_select" ON "public"."user_critter_skill_slots" FOR SELECT USING ("public"."owns_user_critter"("user_critter_id"));


--
-- Name: user_critter_skills; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_critter_skills" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_critter_skills user_critter_skills_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_critter_skills_own_select" ON "public"."user_critter_skills" FOR SELECT USING ("public"."owns_user_critter"("user_critter_id"));


--
-- Name: user_critters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_critters" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_critters user_critters_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_critters_own_select" ON "public"."user_critters" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: user_currencies; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_currencies" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_currencies user_currencies_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_currencies_read_own" ON "public"."user_currencies" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: user_dungeon_progress; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_dungeon_progress" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_dungeon_progress user_dungeon_progress_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_dungeon_progress_own_select" ON "public"."user_dungeon_progress" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: user_relic_inventory; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_relic_inventory" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_relic_inventory user_relic_inventory_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_relic_inventory_own_select" ON "public"."user_relic_inventory" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: user_rollcaster_abilities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_rollcaster_abilities" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_rollcaster_abilities user_rollcaster_abilities_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_rollcaster_abilities_own_select" ON "public"."user_rollcaster_abilities" FOR SELECT USING ("public"."owns_user_rollcaster"("user_rollcaster_id"));


--
-- Name: user_rollcaster_ability_slots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_rollcaster_ability_slots" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_rollcaster_ability_slots user_rollcaster_ability_slots_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_rollcaster_ability_slots_own_select" ON "public"."user_rollcaster_ability_slots" FOR SELECT USING ("public"."owns_user_rollcaster"("user_rollcaster_id"));


--
-- Name: user_rollcasters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_rollcasters" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_rollcasters user_rollcasters_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_rollcasters_own_select" ON "public"."user_rollcasters" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: user_seen_critters; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_seen_critters" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_seen_critters user_seen_critters_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_seen_critters_own_select" ON "public"."user_seen_critters" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: user_squad_slots; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_squad_slots" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_squad_slots user_squad_slots_own_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_squad_slots_own_select" ON "public"."user_squad_slots" FOR SELECT USING (("user_id" = "auth"."uid"()));


--
-- Name: user_tracked_collectible_challenges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."user_tracked_collectible_challenges" ENABLE ROW LEVEL SECURITY;

--
-- Name: user_tracked_collectible_challenges user_tracked_collectible_challenges_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "user_tracked_collectible_challenges_read_own" ON "public"."user_tracked_collectible_challenges" FOR SELECT USING (("auth"."uid"() = "user_id"));


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "acknowledge_collectible_unlock_event"("p_event_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."acknowledge_collectible_unlock_event"("p_event_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."acknowledge_collectible_unlock_event"("p_event_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."acknowledge_collectible_unlock_event"("p_event_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "admin_archive_content"("entity_type" "text", "entity_id" "text", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_archive_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_archive_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_archive_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_archive_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_content_usage"("entity_type" "text", "entity_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_content_usage"("entity_type" "text", "entity_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_content_usage"("entity_type" "text", "entity_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_content_usage"("entity_type" "text", "entity_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_content_usage"("entity_type" "text", "entity_id" "text") TO "service_role";


--
-- Name: FUNCTION "admin_delete_content"("entity_type" "text", "entity_id" "text", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_delete_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_delete_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_delete_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_publish_content"("entity_type" "text", "entity_id" "text", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_publish_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_publish_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_publish_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_publish_content"("entity_type" "text", "entity_id" "text", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reorder_catalog_ids"("entity_type" "text", "id_changes" "jsonb") TO "service_role";


--
-- Name: FUNCTION "admin_reorder_dungeon_ids"("id_changes" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_reorder_dungeon_ids"("id_changes" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reorder_dungeon_ids"("id_changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_reorder_dungeon_ids"("id_changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reorder_dungeon_ids"("id_changes" "jsonb") TO "service_role";


--
-- Name: FUNCTION "admin_save_ability"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_ability"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_ability"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_ability"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_ability"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_asset"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_asset"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_asset"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_asset"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_asset"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_critter"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_critter"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_critter"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_critter"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_critter"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_currency"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_currency"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_currency"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_currency"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_currency"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_dungeon"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_dungeon"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_dungeon"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_dungeon"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_dungeon"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_element"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_element"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_element"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_element"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_element"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_element_chart"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_element_chart"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_element_chart"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_element_chart"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_element_chart"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_promo_code"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_promo_code"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_promo_code"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_promo_code"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_promo_code"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_relic"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_relic"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_relic"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_relic"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_relic"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_relic_shop_entry"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_relic_shop_entry"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_relic_shop_entry"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_relic_shop_entry"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_relic_shop_entry"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_rollcaster"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_rollcaster"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_rollcaster"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_rollcaster"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_rollcaster"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_shard_shop_entry"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_shard_shop_entry"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_shard_shop_entry"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_shard_shop_entry"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_shard_shop_entry"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_shop_entry"("payload" "jsonb", "expected_version" integer, "p_shop_type" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_shop_entry"("payload" "jsonb", "expected_version" integer, "p_shop_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_shop_entry"("payload" "jsonb", "expected_version" integer, "p_shop_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_shop_entry"("payload" "jsonb", "expected_version" integer, "p_shop_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_shop_entry"("payload" "jsonb", "expected_version" integer, "p_shop_type" "text") TO "service_role";


--
-- Name: FUNCTION "admin_save_skill"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_skill"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_skill"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_skill"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_skill"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_save_status"("payload" "jsonb", "expected_version" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_save_status"("payload" "jsonb", "expected_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_save_status"("payload" "jsonb", "expected_version" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_save_status"("payload" "jsonb", "expected_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_save_status"("payload" "jsonb", "expected_version" integer) TO "service_role";


--
-- Name: FUNCTION "admin_validate_content"("entity_type" "text", "entity_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_validate_content"("entity_type" "text", "entity_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_validate_content"("entity_type" "text", "entity_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_validate_content"("entity_type" "text", "entity_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_validate_content"("entity_type" "text", "entity_id" "text") TO "service_role";


--
-- Name: FUNCTION "admin_write_audit"("p_entity_type" "text", "p_entity_id" "text", "p_operation" "text", "p_previous_version" integer, "p_next_version" integer, "p_before" "jsonb", "p_after" "jsonb", "p_note" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."admin_write_audit"("p_entity_type" "text", "p_entity_id" "text", "p_operation" "text", "p_previous_version" integer, "p_next_version" integer, "p_before" "jsonb", "p_after" "jsonb", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_write_audit"("p_entity_type" "text", "p_entity_id" "text", "p_operation" "text", "p_previous_version" integer, "p_next_version" integer, "p_before" "jsonb", "p_after" "jsonb", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_write_audit"("p_entity_type" "text", "p_entity_id" "text", "p_operation" "text", "p_previous_version" integer, "p_next_version" integer, "p_before" "jsonb", "p_after" "jsonb", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_write_audit"("p_entity_type" "text", "p_entity_id" "text", "p_operation" "text", "p_previous_version" integer, "p_next_version" integer, "p_before" "jsonb", "p_after" "jsonb", "p_note" "text") TO "service_role";


--
-- Name: FUNCTION "assert_collectible_gate_integrity"("p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."assert_collectible_gate_integrity"("p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_collectible_gate_integrity"("p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."assert_collectible_gate_integrity"("p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_collectible_gate_integrity"("p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "assert_content_admin"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."assert_content_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_content_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_content_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_content_admin"() TO "service_role";


--
-- Name: FUNCTION "award_user_critter_level_progression"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."award_user_critter_level_progression"() TO "anon";
GRANT ALL ON FUNCTION "public"."award_user_critter_level_progression"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."award_user_critter_level_progression"() TO "service_role";


--
-- Name: FUNCTION "award_user_rollcaster_level_progression"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."award_user_rollcaster_level_progression"() TO "anon";
GRANT ALL ON FUNCTION "public"."award_user_rollcaster_level_progression"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."award_user_rollcaster_level_progression"() TO "service_role";


--
-- Name: FUNCTION "calc_critter_level"("p_critter_id" "text", "p_xp" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."calc_critter_level"("p_critter_id" "text", "p_xp" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calc_critter_level"("p_critter_id" "text", "p_xp" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_critter_level"("p_critter_id" "text", "p_xp" integer) TO "service_role";


--
-- Name: FUNCTION "calc_rollcaster_level"("p_rollcaster_id" "text", "p_xp" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."calc_rollcaster_level"("p_rollcaster_id" "text", "p_xp" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calc_rollcaster_level"("p_rollcaster_id" "text", "p_xp" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_rollcaster_level"("p_rollcaster_id" "text", "p_xp" integer) TO "service_role";


--
-- Name: FUNCTION "cascade_collectible_catalog_id"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."cascade_collectible_catalog_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."cascade_collectible_catalog_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cascade_collectible_catalog_id"() TO "service_role";


--
-- Name: FUNCTION "cascade_promo_reward_target_id"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."cascade_promo_reward_target_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cascade_promo_reward_target_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."cascade_promo_reward_target_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cascade_promo_reward_target_id"() TO "service_role";


--
-- Name: FUNCTION "cleanup_collectible_catalog_delete"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."cleanup_collectible_catalog_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_collectible_catalog_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_collectible_catalog_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_collectible_catalog_delete"() TO "service_role";


--
-- Name: FUNCTION "collectible_challenge_current"("p_user" "uuid", "p_challenge" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."collectible_challenge_current"("p_user" "uuid", "p_challenge" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."collectible_challenge_current"("p_user" "uuid", "p_challenge" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."collectible_challenge_current"("p_user" "uuid", "p_challenge" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."collectible_challenge_current"("p_user" "uuid", "p_challenge" "uuid") TO "service_role";


--
-- Name: FUNCTION "collectible_challenge_goal"("p_challenge" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."collectible_challenge_goal"("p_challenge" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."collectible_challenge_goal"("p_challenge" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."collectible_challenge_goal"("p_challenge" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."collectible_challenge_goal"("p_challenge" "uuid") TO "service_role";


--
-- Name: FUNCTION "collectible_challenge_states"("p_user" "uuid", "p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."collectible_challenge_states"("p_user" "uuid", "p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."collectible_challenge_states"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."collectible_challenge_states"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."collectible_challenge_states"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "collectible_exists"("p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."collectible_exists"("p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."collectible_exists"("p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."collectible_exists"("p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."collectible_exists"("p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "collectible_is_unlocked"("p_user" "uuid", "p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."collectible_is_unlocked"("p_user" "uuid", "p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."collectible_is_unlocked"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."collectible_is_unlocked"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."collectible_is_unlocked"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "collectible_unlock_snapshot"("p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."collectible_unlock_snapshot"("p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."collectible_unlock_snapshot"("p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."collectible_unlock_snapshot"("p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."collectible_unlock_snapshot"("p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "compact_user_tracking_slots"("p_user" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."compact_user_tracking_slots"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compact_user_tracking_slots"("p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compact_user_tracking_slots"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compact_user_tracking_slots"("p_user" "uuid") TO "service_role";


--
-- Name: FUNCTION "complete_promo_collectible_challenges"("p_user" "uuid", "p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."complete_promo_collectible_challenges"("p_user" "uuid", "p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_promo_collectible_challenges"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_promo_collectible_challenges"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_promo_collectible_challenges"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "dev_manage_user_collectible"("p_action" "text", "p_collectible_type" "text", "p_user_email" "text", "p_collectible_id" "text", "p_count" integer); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."dev_manage_user_collectible"("p_action" "text", "p_collectible_type" "text", "p_user_email" "text", "p_collectible_id" "text", "p_count" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dev_manage_user_collectible"("p_action" "text", "p_collectible_type" "text", "p_user_email" "text", "p_collectible_id" "text", "p_count" integer) TO "service_role";


--
-- Name: FUNCTION "dungeon_run_payload"("p_run_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."dungeon_run_payload"("p_run_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dungeon_run_payload"("p_run_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "dungeon_runtime_amount"("p_seed" bigint, "p_key" "text", "p_min" integer, "p_max" integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."dungeon_runtime_amount"("p_seed" bigint, "p_key" "text", "p_min" integer, "p_max" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dungeon_runtime_amount"("p_seed" bigint, "p_key" "text", "p_min" integer, "p_max" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dungeon_runtime_amount"("p_seed" bigint, "p_key" "text", "p_min" integer, "p_max" integer) TO "service_role";


--
-- Name: FUNCTION "dungeon_runtime_random"("p_seed" bigint, "p_key" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."dungeon_runtime_random"("p_seed" bigint, "p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."dungeon_runtime_random"("p_seed" bigint, "p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dungeon_runtime_random"("p_seed" bigint, "p_key" "text") TO "service_role";


--
-- Name: FUNCTION "dungeon_snapshot"("p_dungeon_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."dungeon_snapshot"("p_dungeon_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."dungeon_snapshot"("p_dungeon_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dungeon_snapshot"("p_dungeon_id" "text") TO "service_role";


--
-- Name: FUNCTION "ensure_promo_shard_challenge"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."ensure_promo_shard_challenge"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_promo_shard_challenge"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_promo_shard_challenge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_promo_shard_challenge"() TO "service_role";


--
-- Name: FUNCTION "ensure_referenced_shard_challenge"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."ensure_referenced_shard_challenge"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_referenced_shard_challenge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_referenced_shard_challenge"() TO "service_role";


--
-- Name: FUNCTION "ensure_user_game_state"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."ensure_user_game_state"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_user_game_state"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_user_game_state"() TO "service_role";


--
-- Name: FUNCTION "evaluate_all_collectible_unlocks_internal"("p_user" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."evaluate_all_collectible_unlocks_internal"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."evaluate_all_collectible_unlocks_internal"("p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."evaluate_all_collectible_unlocks_internal"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."evaluate_all_collectible_unlocks_internal"("p_user" "uuid") TO "service_role";


--
-- Name: FUNCTION "evaluate_collectible_after_player_change"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."evaluate_collectible_after_player_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."evaluate_collectible_after_player_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."evaluate_collectible_after_player_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."evaluate_collectible_after_player_change"() TO "service_role";


--
-- Name: FUNCTION "evaluate_collectible_unlock_internal"("p_user" "uuid", "p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."evaluate_collectible_unlock_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."evaluate_collectible_unlock_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."evaluate_collectible_unlock_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."evaluate_collectible_unlock_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "get_active_dungeon_run_v2"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."get_active_dungeon_run_v2"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_dungeon_run_v2"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_dungeon_run_v2"() TO "service_role";


--
-- Name: FUNCTION "get_collectible_player_snapshot"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."get_collectible_player_snapshot"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_collectible_player_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_collectible_player_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_collectible_player_snapshot"() TO "service_role";


--
-- Name: FUNCTION "get_collectible_shop_catalog"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."get_collectible_shop_catalog"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_collectible_shop_catalog"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_collectible_shop_catalog"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_collectible_shop_catalog"() TO "service_role";


--
-- Name: FUNCTION "grant_collectible_internal"("p_user" "uuid", "p_type" "text", "p_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."grant_collectible_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_collectible_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."grant_collectible_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."grant_collectible_internal"("p_user" "uuid", "p_type" "text", "p_id" "text") TO "service_role";


--
-- Name: FUNCTION "grant_dungeon_currency_internal"("p_user" "uuid", "p_currency" "text", "p_amount" bigint); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."grant_dungeon_currency_internal"("p_user" "uuid", "p_currency" "text", "p_amount" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_dungeon_currency_internal"("p_user" "uuid", "p_currency" "text", "p_amount" bigint) TO "service_role";


--
-- Name: FUNCTION "grant_dungeon_drop_internal"("p_user" "uuid", "p_drop" "jsonb", "p_seed" bigint, "p_key" "text", "p_source" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."grant_dungeon_drop_internal"("p_user" "uuid", "p_drop" "jsonb", "p_seed" bigint, "p_key" "text", "p_source" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grant_dungeon_drop_internal"("p_user" "uuid", "p_drop" "jsonb", "p_seed" bigint, "p_key" "text", "p_source" "text") TO "service_role";


--
-- Name: FUNCTION "initialize_element_effectiveness"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."initialize_element_effectiveness"() TO "anon";
GRANT ALL ON FUNCTION "public"."initialize_element_effectiveness"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."initialize_element_effectiveness"() TO "service_role";


--
-- Name: FUNCTION "inline_effects_snapshot"("p_owner" "text", "p_owner_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."inline_effects_snapshot"("p_owner" "text", "p_owner_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."inline_effects_snapshot"("p_owner" "text", "p_owner_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."inline_effects_snapshot"("p_owner" "text", "p_owner_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inline_effects_snapshot"("p_owner" "text", "p_owner_id" "text") TO "service_role";


--
-- Name: FUNCTION "is_content_admin"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."is_content_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_content_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_content_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_content_admin"() TO "service_role";


--
-- Name: FUNCTION "is_dev_tool_identity"("p_user_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."is_dev_tool_identity"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_dev_tool_identity"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_dev_tool_identity"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_dev_tool_identity"("p_user_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "normalize_promo_code"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."normalize_promo_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_promo_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_promo_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_promo_code"() TO "service_role";


--
-- Name: FUNCTION "owns_user_critter"("p_user_critter_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."owns_user_critter"("p_user_critter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."owns_user_critter"("p_user_critter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."owns_user_critter"("p_user_critter_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "owns_user_rollcaster"("p_user_rollcaster_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."owns_user_rollcaster"("p_user_rollcaster_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."owns_user_rollcaster"("p_user_rollcaster_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."owns_user_rollcaster"("p_user_rollcaster_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "prevent_content_change_log_mutation"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."prevent_content_change_log_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_content_change_log_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_content_change_log_mutation"() TO "service_role";


--
-- Name: FUNCTION "prevent_promo_reward_target_delete"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."prevent_promo_reward_target_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_promo_reward_target_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_promo_reward_target_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_promo_reward_target_delete"() TO "service_role";


--
-- Name: FUNCTION "promo_code_redemption_history"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."promo_code_redemption_history"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promo_code_redemption_history"() TO "anon";
GRANT ALL ON FUNCTION "public"."promo_code_redemption_history"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."promo_code_redemption_history"() TO "service_role";


--
-- Name: FUNCTION "promo_code_snapshot"("p_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."promo_code_snapshot"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promo_code_snapshot"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."promo_code_snapshot"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promo_code_snapshot"("p_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "purchase_shop_entry"("p_entry_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "purchase_shop_entry"("p_entry_id" "uuid", "p_request_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid", "p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid", "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."purchase_shop_entry"("p_entry_id" "uuid", "p_request_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "reconcile_user_gated_tracking_internal"("p_user" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."reconcile_user_gated_tracking_internal"("p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_user_gated_tracking_internal"("p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_user_gated_tracking_internal"("p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_user_gated_tracking_internal"("p_user" "uuid") TO "service_role";


--
-- Name: FUNCTION "record_dungeon_battle_result"("p_run_id" "uuid", "p_expected_battle_index" integer, "p_outcome" "text", "p_defeated_instance_ids" "text"[], "p_participant_user_critter_ids" "uuid"[], "p_squad_hp" "jsonb", "p_request_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."record_dungeon_battle_result"("p_run_id" "uuid", "p_expected_battle_index" integer, "p_outcome" "text", "p_defeated_instance_ids" "text"[], "p_participant_user_critter_ids" "uuid"[], "p_squad_hp" "jsonb", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_dungeon_battle_result"("p_run_id" "uuid", "p_expected_battle_index" integer, "p_outcome" "text", "p_defeated_instance_ids" "text"[], "p_participant_user_critter_ids" "uuid"[], "p_squad_hp" "jsonb", "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_dungeon_battle_result"("p_run_id" "uuid", "p_expected_battle_index" integer, "p_outcome" "text", "p_defeated_instance_ids" "text"[], "p_participant_user_critter_ids" "uuid"[], "p_squad_hp" "jsonb", "p_request_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "redeem_promo_code"("p_code" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."redeem_promo_code"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."redeem_promo_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."redeem_promo_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."redeem_promo_code"("p_code" "text") TO "service_role";


--
-- Name: FUNCTION "reject_dev_tool_game_state"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."reject_dev_tool_game_state"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_dev_tool_game_state"() TO "anon";
GRANT ALL ON FUNCTION "public"."reject_dev_tool_game_state"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_dev_tool_game_state"() TO "service_role";


--
-- Name: FUNCTION "replace_collectible_unlocks"("p_type" "text", "p_id" "text", "p_collect" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."replace_collectible_unlocks"("p_type" "text", "p_id" "text", "p_collect" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_collectible_unlocks"("p_type" "text", "p_id" "text", "p_collect" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_collectible_unlocks"("p_type" "text", "p_id" "text", "p_collect" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_collectible_unlocks"("p_type" "text", "p_id" "text", "p_collect" "jsonb") TO "service_role";


--
-- Name: FUNCTION "replace_inline_effects"("p_owner" "text", "p_owner_id" "text", "p_effects" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."replace_inline_effects"("p_owner" "text", "p_owner_id" "text", "p_effects" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_inline_effects"("p_owner" "text", "p_owner_id" "text", "p_effects" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."replace_inline_effects"("p_owner" "text", "p_owner_id" "text", "p_effects" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."replace_inline_effects"("p_owner" "text", "p_owner_id" "text", "p_effects" "jsonb") TO "service_role";


--
-- Name: FUNCTION "resolve_dungeon_run"("p_run_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."resolve_dungeon_run"("p_run_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_dungeon_run"("p_run_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_dungeon_run"("p_run_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "save_dungeon_run_state"("p_run_id" "uuid", "p_expected_version" integer, "p_state" "jsonb", "p_request_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."save_dungeon_run_state"("p_run_id" "uuid", "p_expected_version" integer, "p_state" "jsonb", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_dungeon_run_state"("p_run_id" "uuid", "p_expected_version" integer, "p_state" "jsonb", "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_dungeon_run_state"("p_run_id" "uuid", "p_expected_version" integer, "p_state" "jsonb", "p_request_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "select_starter_critter"("p_critter_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."select_starter_critter"("p_critter_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."select_starter_critter"("p_critter_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."select_starter_critter"("p_critter_id" "text") TO "service_role";


--
-- Name: FUNCTION "select_starter_rollcaster"("p_rollcaster_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."select_starter_rollcaster"("p_rollcaster_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."select_starter_rollcaster"("p_rollcaster_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."select_starter_rollcaster"("p_rollcaster_id" "text") TO "service_role";


--
-- Name: FUNCTION "set_active_rollcaster"("p_user_rollcaster_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_active_rollcaster"("p_user_rollcaster_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_active_rollcaster"("p_user_rollcaster_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_active_rollcaster"("p_user_rollcaster_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "set_critter_relic_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_relic_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_critter_relic_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_relic_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_critter_relic_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_relic_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_critter_relic_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_relic_id" "text") TO "service_role";


--
-- Name: FUNCTION "set_critter_skill_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_skill_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_critter_skill_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_skill_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_critter_skill_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_skill_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_critter_skill_slot"("p_user_critter_id" "uuid", "p_slot_index" integer, "p_skill_id" "text") TO "service_role";


--
-- Name: FUNCTION "set_rollcaster_ability_slot"("p_user_rollcaster_id" "uuid", "p_slot_index" integer, "p_ability_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_rollcaster_ability_slot"("p_user_rollcaster_id" "uuid", "p_slot_index" integer, "p_ability_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_rollcaster_ability_slot"("p_user_rollcaster_id" "uuid", "p_slot_index" integer, "p_ability_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_rollcaster_ability_slot"("p_user_rollcaster_id" "uuid", "p_slot_index" integer, "p_ability_id" "text") TO "service_role";


--
-- Name: FUNCTION "set_squad_critter_slot"("p_slot_index" integer, "p_user_critter_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_squad_critter_slot"("p_slot_index" integer, "p_user_critter_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."set_squad_critter_slot"("p_slot_index" integer, "p_user_critter_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_squad_critter_slot"("p_slot_index" integer, "p_user_critter_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "shop_purchase_receipt_json"("p_user" "uuid", "p_request" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."shop_purchase_receipt_json"("p_user" "uuid", "p_request" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."shop_purchase_receipt_json"("p_user" "uuid", "p_request" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."shop_purchase_receipt_json"("p_user" "uuid", "p_request" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."shop_purchase_receipt_json"("p_user" "uuid", "p_request" "uuid") TO "service_role";


--
-- Name: FUNCTION "snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_dungeon_run_effects"("p_run_id" "uuid", "p_snapshot" "jsonb") TO "service_role";


--
-- Name: FUNCTION "start_dungeon_run"("p_dungeon_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."start_dungeon_run"("p_dungeon_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."start_dungeon_run"("p_dungeon_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_dungeon_run"("p_dungeon_id" "text") TO "service_role";


--
-- Name: FUNCTION "start_dungeon_run_v2"("p_dungeon_id" "text", "p_request_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."start_dungeon_run_v2"("p_dungeon_id" "text", "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_dungeon_run_v2"("p_dungeon_id" "text", "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_dungeon_run_v2"("p_dungeon_id" "text", "p_request_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "submit_collectible_combat_events"("p_run_id" "uuid", "p_turn_number" integer, "p_events" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."submit_collectible_combat_events"("p_run_id" "uuid", "p_turn_number" integer, "p_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_collectible_combat_events"("p_run_id" "uuid", "p_turn_number" integer, "p_events" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_collectible_combat_events"("p_run_id" "uuid", "p_turn_number" integer, "p_events" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_collectible_combat_events"("p_run_id" "uuid", "p_turn_number" integer, "p_events" "jsonb") TO "service_role";


--
-- Name: FUNCTION "sync_currency_coins_to_profile"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."sync_currency_coins_to_profile"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_currency_coins_to_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_currency_coins_to_profile"() TO "service_role";


--
-- Name: FUNCTION "sync_profile_coins_to_currency"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."sync_profile_coins_to_currency"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_profile_coins_to_currency"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_profile_coins_to_currency"() TO "service_role";


--
-- Name: FUNCTION "track_collectible_challenge"("p_challenge_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."track_collectible_challenge"("p_challenge_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."track_collectible_challenge"("p_challenge_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."track_collectible_challenge"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."track_collectible_challenge"("p_challenge_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "unlock_critter_skill"("p_user_critter_id" "uuid", "p_skill_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."unlock_critter_skill"("p_user_critter_id" "uuid", "p_skill_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unlock_critter_skill"("p_user_critter_id" "uuid", "p_skill_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unlock_critter_skill"("p_user_critter_id" "uuid", "p_skill_id" "text") TO "service_role";


--
-- Name: FUNCTION "unlock_rollcaster_ability"("p_user_rollcaster_id" "uuid", "p_ability_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."unlock_rollcaster_ability"("p_user_rollcaster_id" "uuid", "p_ability_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unlock_rollcaster_ability"("p_user_rollcaster_id" "uuid", "p_ability_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unlock_rollcaster_ability"("p_user_rollcaster_id" "uuid", "p_ability_id" "text") TO "service_role";


--
-- Name: FUNCTION "untrack_collectible_challenge"("p_challenge_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."untrack_collectible_challenge"("p_challenge_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."untrack_collectible_challenge"("p_challenge_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."untrack_collectible_challenge"("p_challenge_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."untrack_collectible_challenge"("p_challenge_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "validate_collectible_gate_configuration_trigger"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."validate_collectible_gate_configuration_trigger"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_collectible_gate_configuration_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_collectible_gate_configuration_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_collectible_gate_configuration_trigger"() TO "service_role";


--
-- Name: FUNCTION "validate_collectible_unlock_challenge"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."validate_collectible_unlock_challenge"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_collectible_unlock_challenge"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_collectible_unlock_challenge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_collectible_unlock_challenge"() TO "service_role";


--
-- Name: FUNCTION "validate_dungeon_completion_drop_row"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."validate_dungeon_completion_drop_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_dungeon_completion_drop_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_dungeon_completion_drop_row"() TO "service_role";


--
-- Name: FUNCTION "validate_dungeon_drop_target"("p_drop_type" "text", "p_target_category" "text", "p_target_id" "text"); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."validate_dungeon_drop_target"("p_drop_type" "text", "p_target_category" "text", "p_target_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_dungeon_drop_target"("p_drop_type" "text", "p_target_category" "text", "p_target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_dungeon_drop_target"("p_drop_type" "text", "p_target_category" "text", "p_target_id" "text") TO "service_role";


--
-- Name: FUNCTION "validate_dungeon_item_drop_row"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."validate_dungeon_item_drop_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_dungeon_item_drop_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_dungeon_item_drop_row"() TO "service_role";


--
-- Name: FUNCTION "validate_inline_effect_parameters"("p_template_id" "text", "p_parameters" "jsonb", "p_owner" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."validate_inline_effect_parameters"("p_template_id" "text", "p_parameters" "jsonb", "p_owner" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_inline_effect_parameters"("p_template_id" "text", "p_parameters" "jsonb", "p_owner" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."validate_inline_effect_parameters"("p_template_id" "text", "p_parameters" "jsonb", "p_owner" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_inline_effect_parameters"("p_template_id" "text", "p_parameters" "jsonb", "p_owner" "text") TO "service_role";


--
-- Name: FUNCTION "validate_inline_effect_row"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."validate_inline_effect_row"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_inline_effect_row"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_inline_effect_row"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_inline_effect_row"() TO "service_role";


--
-- Name: FUNCTION "validate_promo_code_reward"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."validate_promo_code_reward"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_promo_code_reward"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_promo_code_reward"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_promo_code_reward"() TO "service_role";


--
-- Name: FUNCTION "validate_shop_entry"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."validate_shop_entry"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_shop_entry"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_shop_entry"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_shop_entry"() TO "service_role";


--
-- Name: FUNCTION "validate_tracked_collectible_challenge"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."validate_tracked_collectible_challenge"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_tracked_collectible_challenge"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_tracked_collectible_challenge"() TO "service_role";


--
-- Name: FUNCTION "validate_user_collectible_shards"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."validate_user_collectible_shards"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_user_collectible_shards"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_user_collectible_shards"() TO "service_role";


--
-- Name: TABLE "ability_effects"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."ability_effects" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."ability_effects" TO "authenticated";
GRANT ALL ON TABLE "public"."ability_effects" TO "service_role";


--
-- Name: TABLE "collectible_combat_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."collectible_combat_events" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."collectible_combat_events" TO "authenticated";
GRANT ALL ON TABLE "public"."collectible_combat_events" TO "service_role";


--
-- Name: TABLE "collectible_unlock_challenges"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."collectible_unlock_challenges" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."collectible_unlock_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."collectible_unlock_challenges" TO "service_role";


--
-- Name: TABLE "collectible_unlock_requirements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."collectible_unlock_requirements" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."collectible_unlock_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."collectible_unlock_requirements" TO "service_role";


--
-- Name: TABLE "effect_templates"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."effect_templates" TO "anon";
GRANT ALL ON TABLE "public"."effect_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."effect_templates" TO "service_role";


--
-- Name: TABLE "relic_effects"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."relic_effects" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."relic_effects" TO "authenticated";
GRANT ALL ON TABLE "public"."relic_effects" TO "service_role";


--
-- Name: TABLE "skill_effects"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."skill_effects" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."skill_effects" TO "authenticated";
GRANT ALL ON TABLE "public"."skill_effects" TO "service_role";


--
-- Name: TABLE "status_effects"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."status_effects" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."status_effects" TO "authenticated";
GRANT ALL ON TABLE "public"."status_effects" TO "service_role";


--
-- Name: TABLE "combat_effects_v1"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."combat_effects_v1" TO "anon";
GRANT ALL ON TABLE "public"."combat_effects_v1" TO "authenticated";
GRANT ALL ON TABLE "public"."combat_effects_v1" TO "service_role";


--
-- Name: TABLE "combat_turn_actions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."combat_turn_actions" TO "anon";
GRANT ALL ON TABLE "public"."combat_turn_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."combat_turn_actions" TO "service_role";


--
-- Name: TABLE "content_change_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."content_change_log" TO "anon";
GRANT ALL ON TABLE "public"."content_change_log" TO "authenticated";
GRANT ALL ON TABLE "public"."content_change_log" TO "service_role";


--
-- Name: TABLE "critter_level_progression"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."critter_level_progression" TO "anon";
GRANT ALL ON TABLE "public"."critter_level_progression" TO "authenticated";
GRANT ALL ON TABLE "public"."critter_level_progression" TO "service_role";


--
-- Name: TABLE "critter_skill_unlocks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."critter_skill_unlocks" TO "anon";
GRANT ALL ON TABLE "public"."critter_skill_unlocks" TO "authenticated";
GRANT ALL ON TABLE "public"."critter_skill_unlocks" TO "service_role";


--
-- Name: TABLE "critters"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."critters" TO "anon";
GRANT ALL ON TABLE "public"."critters" TO "authenticated";
GRANT ALL ON TABLE "public"."critters" TO "service_role";


--
-- Name: TABLE "currencies"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."currencies" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."currencies" TO "authenticated";
GRANT ALL ON TABLE "public"."currencies" TO "service_role";


--
-- Name: TABLE "dev_tool_users"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dev_tool_users" TO "service_role";
GRANT SELECT ON TABLE "public"."dev_tool_users" TO "authenticated";


--
-- Name: TABLE "dungeon_completion_drops"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_completion_drops" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_completion_drops" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_completion_drops" TO "service_role";


--
-- Name: TABLE "dungeon_opponent_currency_drops"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_opponent_currency_drops" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_opponent_currency_drops" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_opponent_currency_drops" TO "service_role";


--
-- Name: TABLE "dungeon_opponent_item_drops"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_opponent_item_drops" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_opponent_item_drops" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_opponent_item_drops" TO "service_role";


--
-- Name: TABLE "dungeon_opponent_relics"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_opponent_relics" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_opponent_relics" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_opponent_relics" TO "service_role";


--
-- Name: TABLE "dungeon_opponent_rewards"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_opponent_rewards" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_opponent_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_opponent_rewards" TO "service_role";


--
-- Name: TABLE "dungeon_opponent_skills"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_opponent_skills" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_opponent_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_opponent_skills" TO "service_role";


--
-- Name: TABLE "dungeon_opponent_stat_overrides"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_opponent_stat_overrides" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_opponent_stat_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_opponent_stat_overrides" TO "service_role";


--
-- Name: TABLE "dungeon_opponents"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_opponents" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_opponents" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_opponents" TO "service_role";


--
-- Name: TABLE "dungeon_run_commands"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_run_commands" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_run_commands" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_run_commands" TO "service_role";


--
-- Name: TABLE "dungeon_runs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeon_runs" TO "anon";
GRANT ALL ON TABLE "public"."dungeon_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeon_runs" TO "service_role";


--
-- Name: TABLE "dungeons"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."dungeons" TO "anon";
GRANT ALL ON TABLE "public"."dungeons" TO "authenticated";
GRANT ALL ON TABLE "public"."dungeons" TO "service_role";


--
-- Name: TABLE "element_chart_config"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."element_chart_config" TO "anon";
GRANT ALL ON TABLE "public"."element_chart_config" TO "authenticated";
GRANT ALL ON TABLE "public"."element_chart_config" TO "service_role";


--
-- Name: TABLE "element_effectiveness"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."element_effectiveness" TO "anon";
GRANT ALL ON TABLE "public"."element_effectiveness" TO "authenticated";
GRANT ALL ON TABLE "public"."element_effectiveness" TO "service_role";


--
-- Name: TABLE "elements"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."elements" TO "anon";
GRANT ALL ON TABLE "public"."elements" TO "authenticated";
GRANT ALL ON TABLE "public"."elements" TO "service_role";


--
-- Name: TABLE "game_assets"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."game_assets" TO "anon";
GRANT ALL ON TABLE "public"."game_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."game_assets" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "promo_code_redemption_rewards"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."promo_code_redemption_rewards" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."promo_code_redemption_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_code_redemption_rewards" TO "service_role";


--
-- Name: TABLE "promo_code_redemptions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."promo_code_redemptions" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."promo_code_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_code_redemptions" TO "service_role";


--
-- Name: TABLE "promo_code_rewards"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."promo_code_rewards" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."promo_code_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_code_rewards" TO "service_role";


--
-- Name: TABLE "promo_codes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."promo_codes" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."promo_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_codes" TO "service_role";


--
-- Name: TABLE "relics"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."relics" TO "anon";
GRANT ALL ON TABLE "public"."relics" TO "authenticated";
GRANT ALL ON TABLE "public"."relics" TO "service_role";


--
-- Name: TABLE "rollcaster_abilities"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."rollcaster_abilities" TO "anon";
GRANT ALL ON TABLE "public"."rollcaster_abilities" TO "authenticated";
GRANT ALL ON TABLE "public"."rollcaster_abilities" TO "service_role";


--
-- Name: TABLE "rollcaster_ability_unlocks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."rollcaster_ability_unlocks" TO "anon";
GRANT ALL ON TABLE "public"."rollcaster_ability_unlocks" TO "authenticated";
GRANT ALL ON TABLE "public"."rollcaster_ability_unlocks" TO "service_role";


--
-- Name: TABLE "rollcaster_level_progression"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."rollcaster_level_progression" TO "anon";
GRANT ALL ON TABLE "public"."rollcaster_level_progression" TO "authenticated";
GRANT ALL ON TABLE "public"."rollcaster_level_progression" TO "service_role";


--
-- Name: TABLE "rollcasters"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."rollcasters" TO "anon";
GRANT ALL ON TABLE "public"."rollcasters" TO "authenticated";
GRANT ALL ON TABLE "public"."rollcasters" TO "service_role";


--
-- Name: TABLE "shop_entries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."shop_entries" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."shop_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_entries" TO "service_role";


--
-- Name: TABLE "shop_purchase_receipts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."shop_purchase_receipts" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."shop_purchase_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."shop_purchase_receipts" TO "service_role";


--
-- Name: TABLE "skills"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."skills" TO "anon";
GRANT ALL ON TABLE "public"."skills" TO "authenticated";
GRANT ALL ON TABLE "public"."skills" TO "service_role";


--
-- Name: TABLE "starter_options"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."starter_options" TO "anon";
GRANT ALL ON TABLE "public"."starter_options" TO "authenticated";
GRANT ALL ON TABLE "public"."starter_options" TO "service_role";


--
-- Name: TABLE "starter_rollcaster_options"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."starter_rollcaster_options" TO "anon";
GRANT ALL ON TABLE "public"."starter_rollcaster_options" TO "authenticated";
GRANT ALL ON TABLE "public"."starter_rollcaster_options" TO "service_role";


--
-- Name: TABLE "statuses"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."statuses" TO "anon";
GRANT ALL ON TABLE "public"."statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."statuses" TO "service_role";


--
-- Name: TABLE "user_collectible_challenge_progress"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."user_collectible_challenge_progress" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."user_collectible_challenge_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."user_collectible_challenge_progress" TO "service_role";


--
-- Name: TABLE "user_collectible_shards"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."user_collectible_shards" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."user_collectible_shards" TO "authenticated";
GRANT ALL ON TABLE "public"."user_collectible_shards" TO "service_role";


--
-- Name: TABLE "user_collectible_unlock_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."user_collectible_unlock_events" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."user_collectible_unlock_events" TO "authenticated";
GRANT ALL ON TABLE "public"."user_collectible_unlock_events" TO "service_role";


--
-- Name: TABLE "user_critter_relic_slots"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_critter_relic_slots" TO "anon";
GRANT ALL ON TABLE "public"."user_critter_relic_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."user_critter_relic_slots" TO "service_role";


--
-- Name: TABLE "user_critter_skill_slots"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_critter_skill_slots" TO "anon";
GRANT ALL ON TABLE "public"."user_critter_skill_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."user_critter_skill_slots" TO "service_role";


--
-- Name: TABLE "user_critter_skills"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_critter_skills" TO "anon";
GRANT ALL ON TABLE "public"."user_critter_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."user_critter_skills" TO "service_role";


--
-- Name: TABLE "user_critters"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_critters" TO "anon";
GRANT ALL ON TABLE "public"."user_critters" TO "authenticated";
GRANT ALL ON TABLE "public"."user_critters" TO "service_role";


--
-- Name: TABLE "user_currencies"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."user_currencies" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."user_currencies" TO "authenticated";
GRANT ALL ON TABLE "public"."user_currencies" TO "service_role";


--
-- Name: TABLE "user_dungeon_progress"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_dungeon_progress" TO "anon";
GRANT ALL ON TABLE "public"."user_dungeon_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."user_dungeon_progress" TO "service_role";


--
-- Name: TABLE "user_relic_inventory"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_relic_inventory" TO "anon";
GRANT ALL ON TABLE "public"."user_relic_inventory" TO "authenticated";
GRANT ALL ON TABLE "public"."user_relic_inventory" TO "service_role";


--
-- Name: TABLE "user_rollcaster_abilities"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_rollcaster_abilities" TO "anon";
GRANT ALL ON TABLE "public"."user_rollcaster_abilities" TO "authenticated";
GRANT ALL ON TABLE "public"."user_rollcaster_abilities" TO "service_role";


--
-- Name: TABLE "user_rollcaster_ability_slots"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_rollcaster_ability_slots" TO "anon";
GRANT ALL ON TABLE "public"."user_rollcaster_ability_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."user_rollcaster_ability_slots" TO "service_role";


--
-- Name: TABLE "user_rollcasters"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_rollcasters" TO "anon";
GRANT ALL ON TABLE "public"."user_rollcasters" TO "authenticated";
GRANT ALL ON TABLE "public"."user_rollcasters" TO "service_role";


--
-- Name: TABLE "user_seen_critters"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_seen_critters" TO "anon";
GRANT ALL ON TABLE "public"."user_seen_critters" TO "authenticated";
GRANT ALL ON TABLE "public"."user_seen_critters" TO "service_role";


--
-- Name: TABLE "user_squad_slots"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."user_squad_slots" TO "anon";
GRANT ALL ON TABLE "public"."user_squad_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."user_squad_slots" TO "service_role";


--
-- Name: TABLE "user_tracked_collectible_challenges"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."user_tracked_collectible_challenges" TO "anon";
GRANT SELECT,MAINTAIN ON TABLE "public"."user_tracked_collectible_challenges" TO "authenticated";
GRANT ALL ON TABLE "public"."user_tracked_collectible_challenges" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- PostgreSQL database dump complete
--

-- \unrestrict ZE8OqG8hm7LSTHjZNRxM2WVpUx9dhafRIVZywcucQpkL9FA8mCaGrUYdQweBHIV

SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict ljpd4U8d9U2RqVPrNQw0zgo5nmi2MG43etPRI1oLXFaRfploKQk7dmiW4UqHxzQ

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: effect_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."effect_templates" ("id", "name", "description", "runtime_kind", "runtime_version", "allowed_owners", "parameter_schema", "ui_schema", "description_template", "is_runtime_supported", "is_active", "is_archived", "version", "sort_order", "created_at", "updated_at", "created_by", "updated_by", "effect_category") VALUES
	('skill-apply-status', 'Apply Status', 'Applies a created Status indefinitely or for a configured number of turns.', 'apply_status', 1, '{skill}', '{"type": "object", "required": ["status_id", "chance", "target", "indefinite"], "properties": {"turns": {"type": "integer", "minimum": 1}, "chance": {"type": "number", "maximum": 1, "minimum": 0}, "target": {"enum": ["self", "all_allies", "all_friendlies", "all_enemies", "target_enemies"]}, "status_id": {"type": "string"}, "indefinite": {"type": "boolean"}}}', '{"order": ["status_id", "chance", "target", "indefinite", "turns"], "conditional": {"turns": {"when": {"indefinite": false}}}}', NULL, true, true, false, 1, 20, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'skill'),
	('skill-restore-hp', 'Restore HP', 'Restores flat HP, maximum-HP percentage, or a percentage of damage dealt.', 'restore_hp', 1, '{skill}', '{"type": "object", "required": ["value_mode", "amount", "chance", "target"], "properties": {"amount": {"type": "number", "minimum": 0}, "chance": {"type": "number", "maximum": 1, "minimum": 0}, "target": {"enum": ["self", "all_allies", "all_friendlies", "all_enemies", "target_enemies"]}, "value_mode": {"enum": ["flat", "percent_max_hp", "percent_damage_done"]}}}', '{"order": ["value_mode", "amount", "chance", "target"], "fractionFields": ["amount", "chance"]}', NULL, true, true, false, 1, 30, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'skill'),
	('ability-mana-dice-modifier', 'Mana Dice Modifier', 'Changes Mana Dice minimum and maximum bounds while the Ability is equipped.', 'mana_dice_modifier', 1, '{ability}', '{"type": "object", "required": ["minimum_delta", "maximum_delta", "target"], "properties": {"target": {"enum": ["all_friendlies", "all_enemies", "all_element_friendlies", "all_element_enemies"]}, "element_ids": {"type": "array", "items": {"type": "string"}}, "maximum_delta": {"type": "integer"}, "minimum_delta": {"type": "integer"}}}', '{"order": ["minimum_delta", "maximum_delta", "target", "element_ids"], "conditional": {"element_ids": {"when": {"target": ["all_element_friendlies", "all_element_enemies"]}}}}', NULL, true, true, false, 1, 20, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'ability'),
	('skill-stat-modifier', 'Stat Modifier', 'Adjusts HP, ATK, DEF, or SPEED when the Skill resolves.', 'stat_modifier', 1, '{skill}', '{"type": "object", "required": ["stat", "value_mode", "amount", "chance", "target"], "properties": {"stat": {"enum": ["hp", "atk", "def", "spd"]}, "amount": {"type": "number"}, "chance": {"type": "number", "maximum": 1, "minimum": 0}, "target": {"enum": ["self", "all_allies", "all_friendlies", "all_enemies", "target_enemies"]}, "value_mode": {"enum": ["flat", "percentage"]}}}', '{"order": ["stat", "value_mode", "amount", "chance", "target"], "fractionFields": ["amount", "chance"]}', NULL, true, true, false, 1, 10, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'skill'),
	('ability-stat-modifier', 'Stat Modifier', 'Applies a persistent global stat modifier while the Ability is equipped.', 'stat_modifier', 1, '{ability}', '{"type": "object", "required": ["stat", "value_mode", "amount", "target"], "properties": {"stat": {"enum": ["hp", "atk", "def", "spd"]}, "amount": {"type": "number"}, "target": {"enum": ["all_friendlies", "all_enemies", "all_element_friendlies", "all_element_enemies"]}, "value_mode": {"enum": ["flat", "percentage"]}, "element_ids": {"type": "array", "items": {"type": "string"}}}}', '{"order": ["stat", "value_mode", "amount", "target", "element_ids"], "conditional": {"element_ids": {"when": {"target": ["all_element_friendlies", "all_element_enemies"]}}}}', NULL, true, true, false, 1, 10, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'ability'),
	('relic-stat-modifier', 'Stat Modifier', 'Applies a persistent stat modifier while the Relic bearer remains active.', 'stat_modifier', 1, '{relic}', '{"type": "object", "required": ["stat", "value_mode", "amount", "target"], "properties": {"stat": {"enum": ["hp", "atk", "def", "spd"]}, "amount": {"type": "number"}, "target": {"enum": ["equipped_critter", "equipped_allies", "equipped_friendlies", "all_enemies"]}, "value_mode": {"enum": ["flat", "percentage"]}}}', '{"order": ["stat", "value_mode", "amount", "target"]}', NULL, true, true, false, 1, 10, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'relic'),
	('relic-mana-dice-modifier', 'Mana Dice Modifier', 'Changes Mana Dice bounds while the Relic bearer remains active.', 'mana_dice_modifier', 1, '{relic}', '{"type": "object", "required": ["minimum_delta", "maximum_delta", "target"], "properties": {"target": {"enum": ["equipped_critter", "equipped_allies", "equipped_friendlies", "all_enemies"]}, "maximum_delta": {"type": "integer"}, "minimum_delta": {"type": "integer"}}}', '{"order": ["minimum_delta", "maximum_delta", "target"]}', NULL, true, true, false, 1, 20, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'relic'),
	('status-damage-over-time', 'Damage Over Time', 'Deals flat or maximum-HP percentage damage at a configured turn timing.', 'damage_over_time', 1, '{status}', '{"type": "object", "required": ["timing", "value_mode", "amount", "chance", "target"], "properties": {"amount": {"type": "number", "minimum": 0}, "chance": {"type": "number", "maximum": 1, "minimum": 0}, "target": {"enum": ["status_holder", "status_holder_allies", "status_holder_friendlies", "status_holder_enemies"]}, "timing": {"enum": ["start_of_turn", "end_of_turn"]}, "value_mode": {"enum": ["flat", "percent_max_hp"]}}}', '{"order": ["timing", "value_mode", "amount", "chance", "target"], "fractionFields": ["amount", "chance"]}', NULL, true, true, false, 1, 10, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'status'),
	('status-skip-action-chance', 'Skip Action Chance', 'May cancel Swap, Block, Skill, or any action without charging Mana.', 'skip_action_chance', 1, '{status}', '{"type": "object", "required": ["chance", "combat_action", "target"], "properties": {"chance": {"type": "number", "maximum": 1, "minimum": 0}, "target": {"enum": ["status_holder", "status_holder_allies", "status_holder_friendlies", "status_holder_enemies"]}, "combat_action": {"enum": ["swap", "block", "skill", "all"]}}}', '{"order": ["chance", "combat_action", "target"], "fractionFields": ["chance"]}', NULL, true, true, false, 1, 20, '2026-07-12 21:57:09.70961+00', '2026-07-13 02:29:07.618356+00', NULL, NULL, 'status');


--
-- Data for Name: rollcaster_abilities; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rollcaster_abilities" ("id", "name", "description", "sort_order", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by") VALUES
	('loaded-dice-1', 'Loaded Dice I', 'Boost critter mana die rolls slightly.', 3, true, false, 7, '2026-07-16 20:58:02.567997+00', '2026-07-16 21:25:03.260456+00', NULL, NULL),
	('harden-1', 'Harden I', 'Boost critter DEF slightly.', 2, true, false, 6, '2026-07-13 22:11:02.742951+00', '2026-07-16 21:25:04.601942+00', NULL, NULL),
	('sharpen-1', 'Sharpen I', 'Boost critter ATK slightly.', 1, true, false, 9, '2026-07-12 21:57:09.70961+00', '2026-07-16 21:25:05.748229+00', NULL, NULL);


--
-- Data for Name: ability_effects; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."ability_effects" ("ability_id", "id", "name", "description", "template_id", "parameters", "sort_order") VALUES
	('loaded-dice-1', 'b7c09cd3-7d71-469f-aa7f-41a13314ceeb', 'Boost Roll I', 'Increase maximum mana die roll by +1.', 'ability-mana-dice-modifier', '{"target": "all_friendlies", "element_ids": [], "maximum_delta": 1, "minimum_delta": 0}', 0),
	('harden-1', '8561eafb-2202-4223-8b3d-01b707b9d5b7', 'Harden Squad I', 'Each critter in your squad gains +4 DEF.', 'ability-stat-modifier', '{"stat": "def", "amount": 4, "target": "all_friendlies", "value_mode": "flat"}', 0),
	('sharpen-1', 'c79c4d5d-21d1-4c1a-a4e6-7165eb153b6e', 'Sharpen Squad I', 'Each critter in your squad gains +3 ATK.', 'ability-stat-modifier', '{"stat": "atk", "amount": 3, "target": "all_friendlies", "value_mode": "flat"}', 0);


--
-- Data for Name: collectible_unlock_requirements; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."collectible_unlock_requirements" ("collectible_type", "collectible_id", "required_challenges", "updated_at", "updated_by") VALUES
	('critter', '016', 2, '2026-07-19 17:13:42.691199+00', NULL),
	('critter', '017', 2, '2026-07-19 17:15:33.042825+00', NULL),
	('critter', '015', 1, '2026-07-19 17:17:01.048818+00', NULL),
	('critter', '018', 2, '2026-07-19 17:20:22.10518+00', NULL),
	('critter', '019', 2, '2026-07-19 17:22:04.754165+00', NULL),
	('critter', '009', 2, '2026-07-17 04:41:16.06207+00', NULL),
	('critter', '008', 2, '2026-07-17 04:41:17.328494+00', NULL),
	('rollcaster', '001', 1, '2026-07-17 05:03:31.321096+00', NULL),
	('rollcaster', '002', 1, '2026-07-17 05:03:43.80854+00', NULL),
	('rollcaster', '003', 1, '2026-07-17 05:03:54.688345+00', NULL),
	('critter', '004', 1, '2026-07-17 17:02:21.630875+00', NULL),
	('critter', '001', 1, '2026-07-17 18:57:41.096423+00', NULL),
	('critter', '012', 0, '2026-07-15 19:16:58.896757+00', NULL),
	('critter', '010', 1, '2026-07-16 18:11:00.710113+00', NULL),
	('critter', '007', 1, '2026-07-15 16:15:13.224517+00', NULL),
	('critter', '014', 3, '2026-07-16 00:44:27.061786+00', NULL),
	('critter', '013', 2, '2026-07-16 00:44:36.924123+00', NULL),
	('critter', '011', 2, '2026-07-16 00:44:58.24311+00', NULL),
	('relic', '002', 1, '2026-07-15 16:36:55.93133+00', NULL),
	('relic', '003', 1, '2026-07-15 16:36:57.1862+00', NULL),
	('relic', '001', 1, '2026-07-15 16:36:58.471638+00', NULL),
	('critter', '006', 2, '2026-07-16 00:45:20.021859+00', NULL),
	('critter', '005', 2, '2026-07-16 00:45:29.548013+00', NULL),
	('critter', '003', 2, '2026-07-16 00:45:30.82015+00', NULL),
	('critter', '002', 2, '2026-07-16 00:45:32.177704+00', NULL);


--
-- Data for Name: collectible_unlock_challenges; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."collectible_unlock_challenges" ("id", "collectible_type", "collectible_id", "challenge_type", "target_category", "target_id", "target_mode", "any_target", "target_ids", "required_amount", "required_level", "sort_order", "created_at", "updated_at", "gate_order") VALUES
	('66e490f3-7a98-4ab5-8123-2f8bca37019a', 'critter', '007', 'shop_shards', NULL, NULL, NULL, false, '{}', 50, NULL, 0, '2026-07-15 16:15:13.224517+00', '2026-07-15 16:15:13.224517+00', NULL),
	('fb4edd6b-2a42-4d08-b17e-2b68f621094f', 'critter', '017', 'own_collectible', 'critter', '016', NULL, false, '{}', 1, NULL, 0, '2026-07-19 17:15:33.042825+00', '2026-07-19 17:15:33.042825+00', 1),
	('250c449c-94ce-495d-ba3a-259bfc59650c', 'critter', '017', 'level_up_critter', NULL, '016', NULL, false, '{}', NULL, 25, 1, '2026-07-19 17:15:33.042825+00', '2026-07-19 17:15:33.042825+00', NULL),
	('e5f2b3c1-596c-4ee0-8035-b4b217d46b34', 'critter', '015', 'knock_out_critters', NULL, NULL, 'species', false, '{015}', 10, NULL, 0, '2026-07-19 01:06:55.089889+00', '2026-07-19 17:17:01.048818+00', NULL),
	('d009ecff-e1b3-4bb7-9d61-6f4d1050a91e', 'critter', '019', 'own_collectible', 'critter', '018', NULL, false, '{}', 1, NULL, 0, '2026-07-19 17:22:04.754165+00', '2026-07-19 17:22:04.754165+00', 1),
	('b041a174-930b-4e51-a715-dce4b24df795', 'critter', '013', 'own_collectible', 'critter', '012', NULL, false, '{}', 1, NULL, 0, '2026-07-16 00:39:57.194273+00', '2026-07-16 00:44:36.924123+00', 1),
	('e0ec3a59-e7b0-44eb-8b65-ec4b1fce53a6', 'critter', '013', 'level_up_critter', NULL, '012', NULL, false, '{}', NULL, 20, 1, '2026-07-16 00:39:57.194273+00', '2026-07-16 00:44:36.924123+00', NULL),
	('ff2fa046-8242-4371-9f2b-192e752157ae', 'relic', '002', 'shop_relic', NULL, NULL, NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:36:55.93133+00', '2026-07-15 16:36:55.93133+00', NULL),
	('12dc319c-7d3b-415e-89b8-2ef5a97110a3', 'relic', '003', 'shop_relic', NULL, NULL, NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:36:57.1862+00', '2026-07-15 16:36:57.1862+00', NULL),
	('0ffca6d4-aaf2-494a-ba93-70d7750a6259', 'relic', '001', 'shop_relic', NULL, NULL, NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:36:58.471638+00', '2026-07-15 16:36:58.471638+00', NULL),
	('bd0a9855-e5f6-4d71-a0be-a911662fb6c3', 'critter', '011', 'own_collectible', 'critter', '010', NULL, false, '{}', 1, NULL, 0, '2026-07-16 00:44:05.815528+00', '2026-07-16 00:44:58.24311+00', 1),
	('48fcbc68-1c89-402a-837a-3d854669a5a9', 'critter', '011', 'level_up_critter', NULL, '010', NULL, false, '{}', NULL, 20, 1, '2026-07-16 00:44:05.815528+00', '2026-07-16 00:44:58.24311+00', NULL),
	('a36de702-a82e-4f94-ae01-abfdab91a8ed', 'critter', '019', 'level_up_critter', NULL, '018', NULL, false, '{}', NULL, 10, 1, '2026-07-19 17:22:04.754165+00', '2026-07-19 17:22:04.754165+00', NULL),
	('e6c4cae7-08bd-4e6b-a8f7-cc314e7ae161', 'critter', '001', 'shop_shards', NULL, NULL, NULL, false, '{}', 50, NULL, 0, '2026-07-15 16:11:53.180012+00', '2026-07-17 18:57:41.096423+00', NULL),
	('9e5387a1-d64b-45f7-b8e8-114f97891195', 'critter', '006', 'own_collectible', 'critter', '005', NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:12:38.46528+00', '2026-07-16 00:45:20.021859+00', 1),
	('455d78b2-5ea2-40f7-b5a9-7574bbfb8a1b', 'critter', '006', 'level_up_critter', NULL, '005', NULL, false, '{}', NULL, 20, 1, '2026-07-15 16:12:38.46528+00', '2026-07-16 00:45:20.021859+00', NULL),
	('81e39bd4-99ba-4c2e-bb36-669eb9a8bd3e', 'critter', '005', 'own_collectible', 'critter', '004', NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:12:37.175589+00', '2026-07-16 00:45:29.548013+00', 1),
	('0208c66e-8cb7-4e1a-ba32-2df2d04b9ab1', 'critter', '005', 'level_up_critter', NULL, '004', NULL, false, '{}', NULL, 20, 1, '2026-07-15 16:12:37.175589+00', '2026-07-16 00:45:29.548013+00', NULL),
	('8c8009c2-d253-45ca-920a-c68804467842', 'critter', '003', 'own_collectible', 'critter', '002', NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:10:03.410567+00', '2026-07-16 00:45:30.82015+00', 1),
	('a694d22a-678b-48be-97be-ded36b9d431f', 'critter', '003', 'level_up_critter', NULL, '002', NULL, false, '{}', NULL, 20, 1, '2026-07-15 16:10:03.410567+00', '2026-07-16 00:45:30.82015+00', NULL),
	('a5582c62-0ea8-4fd6-8d07-535b597aea24', 'critter', '002', 'own_collectible', 'critter', '001', NULL, false, '{}', 1, NULL, 0, '2026-07-15 14:46:21.556379+00', '2026-07-16 00:45:32.177704+00', 1),
	('49b5bad3-83e2-4891-acd3-a77ca1a6b8c7', 'critter', '002', 'level_up_critter', NULL, '001', NULL, false, '{}', NULL, 20, 1, '2026-07-15 14:46:21.556379+00', '2026-07-16 00:45:32.177704+00', NULL),
	('5f0cb6c0-5dc1-4cb6-acb0-79af2107bbac', 'critter', '010', 'knock_out_critters', NULL, NULL, 'species', true, '{}', 10, NULL, 0, '2026-07-15 16:16:28.054068+00', '2026-07-16 18:11:00.710113+00', NULL),
	('779274ac-3649-46f5-b003-d1a04b60013b', 'critter', '009', 'own_collectible', 'critter', '008', NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:15:15.678418+00', '2026-07-17 04:41:16.06207+00', 1),
	('a7d9a6e2-e204-4c46-9490-f3582452675c', 'critter', '009', 'level_up_critter', NULL, '008', NULL, false, '{}', NULL, 20, 1, '2026-07-15 16:15:15.678418+00', '2026-07-17 04:41:16.06207+00', NULL),
	('b0506b49-0901-4f0f-adc6-87d25c146bb7', 'critter', '008', 'own_collectible', 'critter', '007', NULL, false, '{}', 1, NULL, 0, '2026-07-15 16:15:14.463974+00', '2026-07-17 04:41:17.328494+00', 1),
	('49159fc0-6ab4-4a2e-b370-8f9b517a2446', 'critter', '008', 'level_up_critter', NULL, '007', NULL, false, '{}', NULL, 20, 1, '2026-07-15 16:15:14.463974+00', '2026-07-17 04:41:17.328494+00', NULL),
	('cc316236-7271-4d95-8186-682ae549235b', 'rollcaster', '001', 'shop_shards', NULL, NULL, NULL, false, '{}', 20, NULL, 0, '2026-07-17 05:03:31.321096+00', '2026-07-17 05:03:31.321096+00', NULL),
	('7d061778-9175-4e78-bd36-8b214928920e', 'rollcaster', '003', 'shop_shards', NULL, NULL, NULL, false, '{}', 20, NULL, 0, '2026-07-17 05:03:54.688345+00', '2026-07-17 05:03:54.688345+00', NULL),
	('d1ff1bea-ef2c-472a-84f4-7d5f37cd80c5', 'critter', '004', 'shop_shards', NULL, NULL, NULL, false, '{}', 50, NULL, 0, '2026-07-15 16:11:51.844717+00', '2026-07-17 17:02:21.630875+00', NULL),
	('50931b52-d725-434d-95f0-1a2d049a65a2', 'critter', '012', 'own_collectible', 'critter', '010', NULL, false, '{}', 1, NULL, 0, '2026-07-15 19:16:58.896757+00', '2026-07-15 19:16:58.896757+00', 1),
	('b88d933c-7919-4160-be84-af7043dc24f1', 'critter', '012', 'deal_damage', NULL, NULL, 'element', false, '{vile}', 1250, NULL, 1, '2026-07-15 19:16:58.896757+00', '2026-07-15 19:16:58.896757+00', NULL),
	('e93a75c3-3377-49db-8240-91c8ed1606e3', 'critter', '014', 'own_collectible', 'critter', '013', NULL, false, '{}', 1, NULL, 0, '2026-07-16 00:42:53.676085+00', '2026-07-16 00:44:27.061786+00', 1),
	('fc299195-127b-4968-a24e-809f6a8f1122', 'critter', '014', 'level_up_critter', NULL, '013', NULL, false, '{}', NULL, 25, 1, '2026-07-16 00:42:53.676085+00', '2026-07-16 00:44:27.061786+00', NULL),
	('02b78db7-0d2a-4537-9aed-6faf0e16c37d', 'critter', '014', 'use_skill', NULL, NULL, 'skill', false, '{vile-injection}', 10, NULL, 2, '2026-07-16 00:42:53.676085+00', '2026-07-16 00:44:27.061786+00', NULL),
	('cbe8de78-41c5-4aed-a1ea-439247c6a5df', 'rollcaster', '002', 'shop_shards', NULL, NULL, NULL, false, '{}', 20, NULL, 0, '2026-07-17 05:03:43.80854+00', '2026-07-17 05:03:43.80854+00', NULL),
	('ea7181ad-c6dc-46ab-bda9-e12b3e9a7a25', 'critter', '018', 'shop_shards', NULL, NULL, NULL, false, '{}', 10, NULL, 0, '2026-07-19 17:20:22.10518+00', '2026-07-19 17:20:22.10518+00', 1),
	('d53640d3-0861-4ba3-856c-d86068994a9d', 'critter', '018', 'deal_damage', NULL, NULL, 'species', true, '{}', 500, NULL, 1, '2026-07-19 17:20:22.10518+00', '2026-07-19 17:20:22.10518+00', NULL),
	('84616468-ad9f-4aab-98fe-5ee355384089', 'critter', '016', 'own_collectible', 'critter', '015', NULL, false, '{}', 1, NULL, 0, '2026-07-19 17:13:42.691199+00', '2026-07-19 17:13:42.691199+00', 1),
	('bc8631b6-66b8-4ad7-ac0c-c29258d576c4', 'critter', '016', 'level_up_critter', NULL, '015', NULL, false, '{}', NULL, 15, 1, '2026-07-19 17:13:42.691199+00', '2026-07-19 17:13:42.691199+00', NULL);


--
-- Data for Name: elements; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."elements" ("id", "name", "description", "sort_order", "asset_path", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by") VALUES
	('vile', 'Vile', 'Toxic and corrosive force.', 5, 'logos/elements/vile.png', true, false, 2, '2026-07-12 21:57:09.70961+00', '2026-07-13 04:38:05.073434+00', NULL, NULL),
	('frost', 'Frost', 'Frost Element', 6, 'logos/elements/frost.png', true, false, 1, '2026-07-16 20:48:18.60531+00', '2026-07-16 20:48:18.60531+00', NULL, NULL),
	('bloom', 'Bloom', 'Growth, spores, and natural recovery.', 3, 'logos/elements/bloom.png', true, false, 3, '2026-07-12 21:57:09.70961+00', '2026-07-16 21:23:28.006724+00', NULL, NULL),
	('aqua', 'Aqua', 'Flowing water pressure and control.', 4, 'logos/elements/aqua.png', true, false, 3, '2026-07-12 21:57:09.70961+00', '2026-07-16 21:23:28.006724+00', NULL, NULL),
	('thunder', 'Thunder', 'Thunder Element', 7, 'logos/elements/thunder.png', true, false, 2, '2026-07-16 20:48:36.008403+00', '2026-07-16 21:23:28.006724+00', NULL, NULL),
	('basic', 'Basic', 'Reliable neutral techniques.', 1, 'logos/elements/basic.png', true, false, 5, '2026-07-12 21:57:09.70961+00', '2026-07-16 21:24:08.059515+00', NULL, NULL),
	('ember', 'Ember', 'Ember element', 2, 'logos/elements/ember.png', true, false, 4, '2026-07-13 04:37:52.5469+00', '2026-07-16 21:24:08.059515+00', NULL, NULL);


--
-- Data for Name: critters; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."critters" ("id", "name", "element_1_id", "base_hp", "base_atk", "base_def", "base_spd", "base_dice_max", "base_block_cost", "base_swap_cost", "asset_path", "description", "sort_order", "base_dice_min", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by", "element_2_id") VALUES
	('012', 'Toxichick', 'vile', 34, 17, 12, 18, 5, 2, 2, 'critters/012-toxichick.png', 'Fast Vile starter with sharp early tempo.', 4, 1, true, false, 12, '2026-07-12 21:57:09.70961+00', '2026-07-15 19:16:58.896757+00', NULL, NULL, NULL),
	('014', 'Venoquill', 'vile', 30, 10, 10, 10, 6, 2, 2, 'critters/014-venoquill.png', 'Venoquill', 13, 1, true, false, 3, '2026-07-16 00:42:53.676085+00', '2026-07-16 00:44:27.061786+00', NULL, NULL, NULL),
	('013', 'Viperch', 'vile', 30, 10, 10, 10, 6, 2, 2, 'critters/013-viperch.png', 'Viperch', 12, 1, true, false, 3, '2026-07-16 00:39:57.194273+00', '2026-07-16 00:44:36.924123+00', NULL, NULL, NULL),
	('011', 'Walbrute', 'basic', 30, 10, 10, 10, 6, 2, 2, 'critters/011-walbrute.png', 'Walbrute', 14, 1, true, false, 2, '2026-07-16 00:44:05.815528+00', '2026-07-16 00:44:58.24311+00', NULL, NULL, NULL),
	('006', 'Barkhowl', 'bloom', 30, 10, 10, 10, 6, 2, 2, 'critters/006-barkhowl.png', 'Desc', 9, 1, true, false, 3, '2026-07-15 04:34:22.110205+00', '2026-07-16 00:45:20.021859+00', NULL, NULL, NULL),
	('005', 'Florhound', 'bloom', 30, 10, 10, 10, 6, 2, 2, 'critters/005-florhound.png', 'Desc', 8, 1, true, false, 3, '2026-07-15 04:33:54.104045+00', '2026-07-16 00:45:29.548013+00', NULL, NULL, NULL),
	('007', 'Congua', 'aqua', 44, 13, 18, 10, 5, 3, 2, 'critters/007-congua.png', 'Durable Aqua starter with a larger mana die.', 2, 1, true, false, 8, '2026-07-12 21:57:09.70961+00', '2026-07-15 16:15:13.224517+00', NULL, NULL, NULL),
	('010', 'Nutter', 'basic', 36, 13, 18, 16, 4, 1, 1, 'critters/010-nutter.png', 'A small squirrel critter with hardened cheeks from the amount of chestnuts it consumes. They have tough claws to rip open the shells of even the hardest nuts.', 3, 1, true, false, 16, '2026-07-13 21:16:12.068813+00', '2026-07-16 18:11:00.710113+00', NULL, NULL, NULL),
	('003', 'Magmouflon', 'ember', 30, 10, 10, 10, 6, 2, 2, 'critters/003-magmouflon.png', 'Desc.', 6, 1, true, false, 3, '2026-07-15 04:32:55.69153+00', '2026-07-16 00:45:30.82015+00', NULL, NULL, NULL),
	('002', 'Cragram', 'ember', 30, 10, 10, 10, 6, 2, 2, 'critters/002-cragram.png', 'Desc.', 6, 1, true, false, 3, '2026-07-15 04:32:19.371391+00', '2026-07-16 00:45:32.177704+00', NULL, NULL, NULL),
	('004', 'Spreagle', 'bloom', 40, 14, 16, 13, 4, 2, 3, 'critters/004-spreagle.png', 'Balanced Bloom starter with sturdy growth potential.', 1, 1, true, false, 8, '2026-07-12 21:57:09.70961+00', '2026-07-17 17:02:21.630875+00', NULL, NULL, NULL),
	('009', 'Voltrill', 'aqua', 30, 10, 10, 10, 6, 2, 2, 'critters/009-voltrill.png', 'Desc', 10, 1, true, false, 4, '2026-07-15 04:35:54.096478+00', '2026-07-17 04:41:16.06207+00', NULL, NULL, 'thunder'),
	('008', 'Rivolt', 'aqua', 30, 10, 10, 10, 6, 2, 2, 'critters/008-rivolt.png', 'Desc', 10, 1, true, false, 4, '2026-07-15 04:35:32.062652+00', '2026-07-17 04:41:17.328494+00', NULL, NULL, 'thunder'),
	('001', 'Ramber', 'ember', 38, 17, 14, 16, 4, 2, 2, 'critters/001-ramber-2.png', 'A small Ram critter with magma horns and hooves, useful for defending itself and climbing steep volcanoes', 4, 1, true, false, 14, '2026-07-13 21:12:56.610657+00', '2026-07-17 18:57:41.096423+00', NULL, NULL, NULL),
	('016', 'Grumpoaf', 'frost', 30, 10, 10, 10, 6, 2, 2, 'critters/016-grumpoaf.png', 'Grumpoaf', 16, 1, true, false, 2, '2026-07-19 01:08:55.421163+00', '2026-07-19 17:13:42.691199+00', NULL, NULL, NULL),
	('017', 'Blizzump', 'frost', 30, 10, 10, 10, 6, 2, 2, 'critters/017-blizzump.png', 'Blizzump', 17, 1, true, false, 1, '2026-07-19 17:15:33.042825+00', '2026-07-19 17:15:33.042825+00', NULL, NULL, NULL),
	('015', 'Snubbo', 'frost', 30, 10, 10, 10, 6, 2, 2, 'critters/015-snubbo.png', 'Snubbo Critter', 15, 1, true, false, 3, '2026-07-19 01:06:55.089889+00', '2026-07-19 17:17:01.048818+00', NULL, NULL, NULL),
	('018', 'Glimbit', 'thunder', 30, 10, 10, 10, 6, 2, 2, 'critters/018-glimbit.png', 'Glimbit', 18, 1, true, false, 2, '2026-07-19 17:18:30.920799+00', '2026-07-19 17:20:22.10518+00', NULL, NULL, NULL),
	('019', 'Flickor', 'thunder', 30, 10, 10, 10, 6, 2, 2, 'critters/019-flickor.png', 'Flickor', 19, 1, true, false, 1, '2026-07-19 17:22:04.754165+00', '2026-07-19 17:22:04.754165+00', NULL, NULL, NULL);


--
-- Data for Name: critter_level_progression; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."critter_level_progression" ("critter_id", "level", "total_required_xp", "grant_skill_points", "hp_delta", "atk_delta", "def_delta", "spd_delta", "dice_max_delta", "block_cost_delta", "swap_cost_delta", "total_unlocked_relic_slots", "dice_min_delta") VALUES
	('017', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('017', 2, 200, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('017', 3, 400, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('017', 4, 600, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('017', 5, 800, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('015', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('015', 2, 200, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('015', 3, 400, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('015', 4, 600, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('015', 5, 800, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('014', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('014', 2, 200, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('014', 3, 400, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('014', 4, 600, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('014', 5, 800, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('013', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('013', 2, 200, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('013', 3, 400, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('013', 4, 600, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('013', 5, 800, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('011', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('011', 2, 200, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('011', 3, 400, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('011', 4, 600, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('011', 5, 800, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('018', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('018', 2, 200, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('018', 3, 400, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('018', 4, 600, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('018', 5, 800, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('019', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('019', 2, 200, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('019', 3, 400, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('019', 4, 600, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('019', 5, 800, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('007', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('007', 2, 80, 1, 6, 1, 2, 1, 0, 0, 0, 1, 0),
	('007', 3, 180, 2, 6, 2, 3, 1, 0, 0, 0, 1, 0),
	('007', 4, 340, 2, 6, 2, 3, 1, 0, -1, 0, 1, 0),
	('007', 5, 560, 3, 7, 2, 3, 1, 1, 0, 0, 1, 0),
	('006', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('005', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('003', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('002', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('012', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('012', 2, 80, 1, 4, 2, 1, 2, 0, 0, 0, 1, 0),
	('012', 3, 180, 2, 4, 2, 2, 1, 0, 0, 0, 1, 0),
	('012', 4, 340, 2, 5, 2, 2, 2, 0, 0, 0, 1, 0),
	('012', 5, 560, 3, 5, 3, 2, 2, 1, 0, 0, 1, 0),
	('010', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('010', 2, 75, 1, 6, 2, 3, 2, 0, 0, 0, 1, 0),
	('010', 3, 160, 1, 5, 1, 3, 2, 0, 0, 0, 1, 0),
	('010', 4, 300, 2, 6, 2, 2, 2, 0, 0, 0, 1, 0),
	('010', 5, 500, 2, 6, 3, 4, 2, 0, 0, 0, 1, 0),
	('009', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('008', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('004', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('004', 2, 80, 1, 5, 1, 2, 1, 0, 0, 0, 1, 0),
	('004', 3, 180, 2, 5, 2, 2, 1, 0, 0, 0, 1, 0),
	('004', 4, 340, 2, 6, 2, 2, 1, 0, 0, -1, 1, 0),
	('004', 5, 560, 3, 6, 2, 3, 2, 1, 0, 0, 2, 0),
	('001', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('001', 2, 80, 1, 4, 2, 1, 2, 0, 0, 0, 1, 0),
	('001', 3, 180, 2, 5, 2, 1, 2, 0, 0, 0, 1, 0),
	('001', 4, 340, 2, 4, 3, 2, 4, 0, 0, 0, 1, 0),
	('001', 5, 560, 3, 4, 3, 2, 2, 0, 0, 0, 1, 0),
	('016', 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('016', 2, 200, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('016', 3, 400, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('016', 4, 600, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	('016', 5, 800, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0);


--
-- Data for Name: skills; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."skills" ("id", "name", "element_id", "skill_type", "power", "mana_cost", "description", "sort_order", "targeting", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by") VALUES
	('fire-rush', 'Fire Rush', 'ember', 'attack', 55, 3, 'The user charges forward engulfed in flames and slams into its opponent.', 3, 'single_enemy', true, false, 1, '2026-07-14 06:28:22.976757+00', '2026-07-14 06:28:22.976757+00', NULL, NULL),
	('sprout-up', 'Sprout Up', 'bloom', 'attack', 45, 2, 'The user manipulates the terrain and wraps the enemy up with grass and stems.', 5, 'single_enemy', true, false, 1, '2026-07-14 19:54:43.570508+00', '2026-07-14 19:54:43.570508+00', NULL, NULL),
	('aqua-dash', 'Aqua Dash', 'aqua', 'attack', 40, 2, 'The user moves swiftly through the water running into the enemy and knocking them back', 5, 'single_enemy', true, false, 1, '2026-07-14 19:56:35.146716+00', '2026-07-14 19:56:35.146716+00', NULL, NULL),
	('vile-injection', 'Vile Injection', 'vile', 'support', 0, 3, 'The user injects an oozing venom into the target which has healing properties, but can also causes Toxic poisoning.', 7, 'single_any', true, false, 2, '2026-07-14 20:04:38.669223+00', '2026-07-14 20:06:22.463377+00', NULL, NULL),
	('swipe', 'Swipe', 'basic', 'attack', 30, 1, 'The user scratches the enemy in a swift motion.', 4, 'single_enemy', true, false, 4, '2026-07-14 19:20:35.652749+00', '2026-07-16 15:07:52.502094+00', NULL, NULL),
	('headbutt', 'Headbutt', 'basic', 'attack', 50, 2, 'The user rams its head into the target, normally with a running start', 2, 'single_enemy', true, false, 2, '2026-07-13 21:48:27.086608+00', '2026-07-16 15:07:53.779562+00', NULL, NULL),
	('slam', 'Slam', 'basic', 'attack', 40, 2, 'A clean physical hit with no secondary effect.', 1, 'single_enemy', true, false, 4, '2026-07-12 21:57:09.70961+00', '2026-07-16 15:07:51.183978+00', NULL, NULL),
	('acid', 'Acid', 'vile', 'attack', 40, 2, 'The user sprays acid on the enemy, coating them in a Toxic goo.', 7, 'single_enemy', true, false, 2, '2026-07-14 20:02:11.942803+00', '2026-07-16 15:08:05.17208+00', NULL, NULL),
	('small-shock', 'Small Shock', 'thunder', 'attack', 30, 3, 'The user sends off a short ranged weak shock at all opponents', 9, 'all_enemies', true, false, 1, '2026-07-16 21:28:41.898425+00', '2026-07-16 21:28:41.898425+00', NULL, NULL),
	('chilling-wind', 'Chilling Wind', 'frost', 'attack', 30, 3, 'The user blows a very cold wind towards the opponent, causing them to possibly lower their defenses.', 10, 'single_enemy', true, false, 1, '2026-07-16 21:31:37.072057+00', '2026-07-16 21:31:37.072057+00', NULL, NULL);


--
-- Data for Name: critter_skill_unlocks; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."critter_skill_unlocks" ("critter_id", "skill_id", "unlock_level", "unlock_cost", "is_default", "sort_order") VALUES
	('016', 'slam', 1, 0, true, 0),
	('016', 'chilling-wind', 1, 0, true, 1),
	('017', 'slam', 1, 0, true, 0),
	('017', 'headbutt', 1, 0, true, 1),
	('017', 'chilling-wind', 1, 0, true, 2),
	('015', 'slam', 1, 0, true, 0),
	('015', 'chilling-wind', 3, 3, false, 1),
	('018', 'slam', 1, 0, true, 0),
	('018', 'small-shock', 2, 2, false, 1),
	('007', 'slam', 1, 0, true, 0),
	('007', 'aqua-dash', 2, 2, false, 1),
	('019', 'slam', 1, 0, true, 0),
	('019', 'swipe', 1, 0, true, 1),
	('019', 'small-shock', 1, 0, true, 2),
	('012', 'slam', 1, 0, true, 0),
	('012', 'acid', 3, 2, false, 1),
	('014', 'slam', 1, 0, true, 0),
	('014', 'acid', 1, 0, true, 1),
	('014', 'vile-injection', 1, 0, true, 2),
	('013', 'slam', 1, 0, true, 0),
	('013', 'acid', 1, 0, true, 1),
	('013', 'vile-injection', 1, 0, true, 2),
	('011', 'slam', 1, 0, true, 0),
	('011', 'headbutt', 1, 0, true, 1),
	('011', 'swipe', 1, 0, true, 2),
	('006', 'slam', 1, 0, true, 0),
	('005', 'slam', 1, 0, true, 0),
	('003', 'slam', 1, 0, true, 0),
	('002', 'slam', 1, 0, true, 0),
	('010', 'slam', 1, 0, true, 0),
	('010', 'swipe', 3, 2, false, 1),
	('009', 'slam', 1, 0, true, 0),
	('008', 'slam', 1, 0, true, 0),
	('004', 'slam', 1, 0, true, 0),
	('004', 'sprout-up', 3, 2, false, 1),
	('001', 'headbutt', 1, 0, true, 0),
	('001', 'fire-rush', 3, 3, false, 1);


--
-- Data for Name: currencies; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."currencies" ("id", "name", "description", "asset_path", "is_default", "is_system", "sort_order", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by", "text_color") VALUES
	('coins', 'Coins', 'The standard currency earned and spent throughout Rollcasters.', 'ui/coins.png', true, true, 0, true, false, 1, '2026-07-15 08:18:58.812535+00', '2026-07-15 17:14:57.613194+00', NULL, NULL, '#FFD65A'),
	('prismite', 'Prismite', 'A rarer currency only found in challenging dungeons', 'ui/prismite.png', false, false, 2, true, false, 2, '2026-07-15 16:38:57.856157+00', '2026-07-15 17:14:57.613194+00', NULL, NULL, '#7DE8FF');


--
-- Data for Name: dungeons; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."dungeons" ("id", "name", "dungeon_type", "difficulty", "battle_format", "player_active_count", "opponent_active_count", "encounter_count", "next_dungeon_id", "sort_order", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by", "description", "battle_count", "regular_logo_path", "boss_logo_path") VALUES
	('002', 'Creek Clash', 'regular', 1, '2v2', 2, 2, 2, NULL, 2, true, false, 3, '2026-07-12 21:57:09.70961+00', '2026-07-18 20:07:15.574931+00', NULL, NULL, '', 2, NULL, NULL),
	('001', 'Journey Begins', 'regular', 1, '1v1', 1, 1, 2, '002', 1, true, false, 12, '2026-07-12 21:57:09.70961+00', '2026-07-18 21:03:52.525249+00', NULL, NULL, 'Begin your Rollcasting journey!', 2, NULL, NULL);


--
-- Data for Name: dungeon_completion_drops; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."dungeon_completion_drops" ("id", "dungeon_id", "completion_phase", "drop_type", "target_category", "target_id", "min_amount", "max_amount", "probability", "dupe_currency_id", "dupe_currency_amount", "sort_order") VALUES
	('e6dbebd9-dab7-43e3-bedb-39da00ce1327', '001', 'first_time', 'currency', NULL, 'coins', 10, 10, 1.000000, NULL, NULL, 0),
	('2bd69a9b-8ab4-476a-b0df-624b278d1a7c', '001', 'regular', 'currency', NULL, 'coins', 6, 8, 0.050000, NULL, NULL, 1),
	('987dab7f-d625-4624-a1a8-e35dc3f01321', '001', 'regular', 'currency', NULL, 'coins', 3, 5, 0.200000, NULL, NULL, 2);


--
-- Data for Name: dungeon_opponents; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."dungeon_opponents" ("id", "dungeon_id", "pool_type", "sequence_index", "probability", "critter_id", "critter_level", "skill_ids", "relic_ids", "rollcaster_xp_reward", "critter_xp_reward", "currency_reward", "drops", "selection_weight") VALUES
	('ae468d86-9646-4505-bd2a-2644bc5e0375', '001', 'regular_pool', 0, 0.7, '010', 1, '{slam}', '{}', 35, 20, 0, '[]', 0.7),
	('a2f771df-4637-4684-94b2-77d03d4cf58a', '001', 'regular_pool', 1, 0.3, '012', 1, '{slam}', '{}', 50, 30, 0, '[]', 0.3),
	('6d3485cd-8a84-4ea4-b0eb-513b141e4406', '002', 'regular_pool', 0, 0.4, '010', 1, '{slam}', '{}', 35, 40, 0, '[]', 0.4),
	('7047a8fd-3959-4990-b5fc-214a9a8f3006', '002', 'regular_pool', 1, 0.3, '004', 1, '{slam}', '{}', 40, 50, 0, '[]', 0.3),
	('b1905ea0-95c7-43ab-9304-5a9ab05035a2', '002', 'regular_pool', 2, 0.3, '007', 1, '{slam}', '{}', 40, 50, 0, '[]', 0.3);


--
-- Data for Name: dungeon_opponent_currency_drops; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."dungeon_opponent_currency_drops" ("id", "opponent_id", "currency_id", "min_amount", "max_amount", "probability", "sort_order") VALUES
	('e6c2980b-3874-4e7b-a795-241585abe75b', '6d3485cd-8a84-4ea4-b0eb-513b141e4406', 'coins', 8, 10, 0.600000, 0),
	('e9e9cd62-8928-44fa-b6a3-9e79dab056c2', '7047a8fd-3959-4990-b5fc-214a9a8f3006', 'coins', 10, 15, 0.800000, 0),
	('8d412083-6f4a-4b60-9f78-c7b20a518d61', 'b1905ea0-95c7-43ab-9304-5a9ab05035a2', 'coins', 10, 15, 0.750000, 0),
	('c71de7ba-2c19-446c-9fc3-478385ee8567', 'ae468d86-9646-4505-bd2a-2644bc5e0375', 'coins', 5, 7, 1.000000, 0),
	('e540ce59-13b2-4dd4-aad8-f725761304c9', 'a2f771df-4637-4684-94b2-77d03d4cf58a', 'coins', 8, 12, 1.000000, 0);


--
-- Data for Name: dungeon_opponent_item_drops; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: relics; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."relics" ("id", "name", "description", "max_owned", "asset_path", "sort_order", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by") VALUES
	('002', 'Wooden Die', 'Equipped Critter gains +1/+1 to its Mana Die rolls.', 6, 'relics/002-wooden-die.png', 2, true, false, 3, '2026-07-14 05:52:08.45499+00', '2026-07-15 16:36:55.93133+00', NULL, NULL),
	('003', 'Leather Greaves', 'Equipped Critter gains +3 SPEED.', 5, 'relics/003-leather-greaves.png', 3, true, false, 3, '2026-07-14 05:55:06.890855+00', '2026-07-15 16:36:57.1862+00', NULL, NULL),
	('001', 'Copper Shield', 'Equipped critter gains +5 DEF.', 10, 'relics/001-copper-shield.png', 1, true, false, 5, '2026-07-12 21:57:09.70961+00', '2026-07-15 16:36:58.471638+00', NULL, NULL);


--
-- Data for Name: dungeon_opponent_relics; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: dungeon_opponent_rewards; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: dungeon_opponent_skills; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."dungeon_opponent_skills" ("opponent_id", "skill_id", "slot_index") VALUES
	('6d3485cd-8a84-4ea4-b0eb-513b141e4406', 'slam', 0),
	('7047a8fd-3959-4990-b5fc-214a9a8f3006', 'slam', 0),
	('b1905ea0-95c7-43ab-9304-5a9ab05035a2', 'slam', 0),
	('ae468d86-9646-4505-bd2a-2644bc5e0375', 'slam', 0),
	('a2f771df-4637-4684-94b2-77d03d4cf58a', 'slam', 0);


--
-- Data for Name: dungeon_opponent_stat_overrides; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: element_chart_config; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."element_chart_config" ("id", "version", "updated_at", "updated_by") VALUES
	(true, 2, '2026-07-17 20:31:12.12116+00', NULL);


--
-- Data for Name: element_effectiveness; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."element_effectiveness" ("attacking_element_id", "defending_element_id", "multiplier") VALUES
	('basic', 'basic', 1.0000),
	('basic', 'ember', 1.0000),
	('basic', 'bloom', 1.0000),
	('basic', 'aqua', 1.0000),
	('basic', 'vile', 1.0000),
	('basic', 'frost', 1.0000),
	('basic', 'thunder', 1.0000),
	('ember', 'basic', 1.0000),
	('ember', 'ember', 1.0000),
	('ember', 'bloom', 2.0000),
	('ember', 'aqua', 0.5000),
	('ember', 'vile', 1.0000),
	('ember', 'frost', 1.0000),
	('ember', 'thunder', 1.0000),
	('bloom', 'basic', 1.0000),
	('bloom', 'ember', 0.5000),
	('bloom', 'bloom', 1.0000),
	('bloom', 'aqua', 2.0000),
	('bloom', 'vile', 1.0000),
	('bloom', 'frost', 1.0000),
	('bloom', 'thunder', 1.0000),
	('aqua', 'basic', 1.0000),
	('aqua', 'ember', 2.0000),
	('aqua', 'bloom', 0.5000),
	('aqua', 'aqua', 1.0000),
	('aqua', 'vile', 1.0000),
	('aqua', 'frost', 1.0000),
	('aqua', 'thunder', 1.0000),
	('vile', 'basic', 1.0000),
	('vile', 'ember', 1.0000),
	('vile', 'bloom', 1.0000),
	('vile', 'aqua', 1.0000),
	('vile', 'vile', 1.0000),
	('vile', 'frost', 1.0000),
	('vile', 'thunder', 1.0000),
	('frost', 'basic', 1.0000),
	('frost', 'ember', 1.0000),
	('frost', 'bloom', 1.0000),
	('frost', 'aqua', 1.0000),
	('frost', 'vile', 1.0000),
	('frost', 'frost', 1.0000),
	('frost', 'thunder', 1.0000),
	('thunder', 'basic', 1.0000),
	('thunder', 'ember', 1.0000),
	('thunder', 'bloom', 1.0000),
	('thunder', 'aqua', 1.0000),
	('thunder', 'vile', 1.0000),
	('thunder', 'frost', 1.0000),
	('thunder', 'thunder', 1.0000);


--
-- Data for Name: game_assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."game_assets" ("id", "bucket_id", "path", "category", "owner_table", "owner_id", "variant", "display_name", "alt_text", "content_type", "width", "height", "checksum", "metadata", "is_active", "sort_order", "created_at", "updated_at") VALUES
	('0432c971-96be-4b17-ac8b-7fc2c026be7e', 'game-assets', 'logos/statuses/frostbite.png', 'status', 'statuses', 'frostbite', 'default', 'Frostbite', 'status image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 18, '2026-07-14 05:40:24.225881+00', '2026-07-14 05:40:24.225881+00'),
	('989426fb-1d08-43e3-84c3-1c4ba77d3974', 'game-assets', 'logos/statuses/toxic.png', 'status', 'statuses', 'toxic', 'default', 'Toxic', 'status image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 18, '2026-07-14 05:40:26.734972+00', '2026-07-14 05:40:26.734972+00'),
	('86767b2a-3169-4bd1-a1a4-b6060c4847f3', 'game-assets', 'relics/003-leather-greaves.png', 'relic', 'relics', '003', 'default', 'Leather Greaves', 'relic image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 21, '2026-07-14 05:51:26.952692+00', '2026-07-14 05:51:26.952692+00'),
	('c0f73194-0289-44ab-8462-96dc577ba4d6', 'game-assets', 'critters/003-magmouflon.png', 'critter', NULL, NULL, 'default', 'Magmouflon', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:36.521141+00', '2026-07-14 23:25:36.521141+00'),
	('aabb3ace-7bda-4583-8720-5958c1f5dae6', 'game-assets', 'critters/006-barkhowl.png', 'critter', NULL, NULL, 'default', 'Barkhowl', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:39.133582+00', '2026-07-14 23:25:39.133582+00'),
	('ecefea36-fd46-4265-a1b9-7494a7e78325', 'game-assets', 'critters/008-rivolt.png', 'critter', NULL, NULL, 'default', 'Rivolt', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:41.791831+00', '2026-07-14 23:25:41.791831+00'),
	('91d0198c-7011-4214-a362-8590ee5f71ad', 'game-assets', 'critters/010-nutter.png', 'critter', NULL, NULL, 'default', 'Nutter', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:44.295273+00', '2026-07-14 23:25:44.295273+00'),
	('880ba663-30cb-4d0b-9c5b-997eab9a1ebc', 'game-assets', 'logos/elements/basic.png', 'element', 'elements', 'basic', 'icon', 'Basic element logo', 'Basic element logo', 'image/png', NULL, NULL, NULL, '{}', true, 1, '2026-07-12 01:52:39.222476+00', '2026-07-13 02:29:07.618356+00'),
	('884298d4-bbfa-4fd4-a2cf-5c604e79a5ba', 'game-assets', 'logos/elements/vile.png', 'element', 'elements', 'vile', 'icon', 'Vile element logo', 'Vile element logo', 'image/png', NULL, NULL, NULL, '{}', true, 2, '2026-07-12 01:52:39.222476+00', '2026-07-13 02:29:07.618356+00'),
	('2c0086c8-10e4-4d9e-8c00-6083285561a3', 'game-assets', 'logos/elements/bloom.png', 'element', 'elements', 'bloom', 'icon', 'Bloom element logo', 'Bloom element logo', 'image/png', NULL, NULL, NULL, '{}', true, 3, '2026-07-12 01:52:39.222476+00', '2026-07-13 02:29:07.618356+00'),
	('ab97de85-0e09-473f-a8c7-ca12c9ba82de', 'game-assets', 'critters/012-toxichick.png', 'critter', 'critters', '012', 'default', 'Toxichick', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 205, '2026-07-13 20:02:29.632346+00', '2026-07-14 23:25:46.885827+00'),
	('bfe170c3-506a-4cb8-8a9e-a4938d74f9a3', 'game-assets', 'critters/011-walbrute.png', 'critter', NULL, NULL, 'default', 'Walbrute', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 30, '2026-07-16 00:39:43.259715+00', '2026-07-16 00:39:43.259715+00'),
	('519bb1a2-5ce1-4f32-9e54-f5c0f7b7a916', 'game-assets', 'critters/014-venoquill.png', 'critter', NULL, NULL, 'default', 'Venoquill', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 30, '2026-07-16 00:39:45.76721+00', '2026-07-16 00:39:45.76721+00'),
	('a75d1246-7973-417b-b4c8-52a51d825cfd', 'game-assets', 'logos/elements/aqua.png', 'element', 'elements', 'aqua', 'icon', 'Aqua element logo', 'Aqua element logo', 'image/png', NULL, NULL, NULL, '{}', true, 4, '2026-07-12 01:52:39.222476+00', '2026-07-13 02:29:07.618356+00'),
	('305ddb1a-b571-4c17-b4ec-a5d0d03aee9f', 'game-assets', 'ui/coins.png', 'currency', 'global', 'coins', 'icon', 'Coin logo', 'Coin currency logo', 'image/png', NULL, NULL, NULL, '{}', true, 10, '2026-07-12 01:52:39.222476+00', '2026-07-13 02:29:07.618356+00'),
	('965837f5-dae7-408b-8536-24766d056aab', 'game-assets', 'ui/mana.png', 'mana', 'global', 'mana', 'icon', 'Mana logo', 'Mana resource logo', 'image/png', NULL, NULL, NULL, '{}', true, 11, '2026-07-12 01:52:39.222476+00', '2026-07-13 02:29:07.618356+00'),
	('1750f321-4c3a-4abf-92b5-f94bdd4231d7', 'game-assets', 'ui/logo.png', 'ui', 'global', 'logo', 'full', 'Rollcasters logo', 'Rollcasters', 'image/png', NULL, NULL, NULL, '{}', true, 1, '2026-07-12 17:15:52.996805+00', '2026-07-13 02:29:07.618356+00'),
	('e4e4f0c0-c149-47e3-9534-d5c0e8cc3c09', 'game-assets', 'ui/small-logo.png', 'ui', 'global', 'logo', 'compact', 'Rollcasters compact logo', 'Rollcasters home', 'image/png', NULL, NULL, NULL, '{}', true, 2, '2026-07-12 17:15:52.996805+00', '2026-07-13 02:29:07.618356+00'),
	('d7313b4a-5779-4825-ba40-e735165e790a', 'game-assets', 'logos/elements/thunder.png', 'element', NULL, NULL, 'default', 'Thunder', 'element image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 33, '2026-07-16 20:48:01.578607+00', '2026-07-16 20:48:01.578607+00'),
	('67c04fa2-8cb8-4728-994b-31ad07e42e31', 'game-assets', 'logos/elements/ember.png', 'element', 'elements', 'ember', 'element', 'Ember', 'Ember element logo', 'image/png', NULL, NULL, NULL, '{}', true, 15, '2026-07-13 04:35:22.397779+00', '2026-07-13 04:35:22.397779+00'),
	('5d9389df-e7b3-4cbf-9037-312a1322dbad', 'game-assets', 'critters/001-ramber-2.png', 'critter', NULL, NULL, 'default', 'Ramber', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 201, '2026-07-13 20:07:53.002515+00', '2026-07-13 20:09:18.175215+00'),
	('24c10403-411f-4dca-9fd0-16fe618dfdca', 'game-assets', 'rollcasters/001-roland-2.png', 'rollcaster', 'rollcasters', '001', 'default', 'Roland', 'Roland Rollcaster sprite', 'image/png', NULL, NULL, NULL, '{}', true, 100, '2026-07-12 01:52:39.222476+00', '2026-07-16 20:55:46.338823+00'),
	('c47aa301-e4f1-4427-a9df-0bf56e4be500', 'game-assets', 'critters/015-snubbo.png', 'critter', NULL, NULL, 'default', 'Snubbo', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 36, '2026-07-19 01:06:49.514169+00', '2026-07-19 01:06:49.514169+00'),
	('a847623a-9f5e-4878-9297-62d4062eeaae', 'game-assets', 'critters/017-blizzump.png', 'critter', NULL, NULL, 'default', 'Blizzump', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 36, '2026-07-19 01:06:51.890172+00', '2026-07-19 01:06:51.890172+00'),
	('0cf94afd-b52d-4566-adb6-6a3fc98c9919', 'game-assets', 'critters/019-flickor.png', 'critter', NULL, NULL, 'default', 'Flickor', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 36, '2026-07-19 01:06:54.021815+00', '2026-07-19 01:06:54.021815+00'),
	('df820c78-8a8d-4f1f-b264-3f453d836bd4', 'game-assets', 'critters/016-grumpoaf.png', 'critter', NULL, NULL, 'default', 'Grumpoaf', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 36, '2026-07-19 01:06:50.686655+00', '2026-07-19 01:06:50.686655+00'),
	('c53ff13d-f24b-4f1e-828f-5866bd928e17', 'game-assets', 'critters/018-glimbit.png', 'critter', NULL, NULL, 'default', 'Glimbit', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 36, '2026-07-19 01:06:52.940731+00', '2026-07-19 01:06:52.940731+00'),
	('614988e0-1cb3-465e-a2bc-7a6f585e9227', 'game-assets', 'relics/001-copper-shield.png', 'relic', 'relics', '001', 'default', 'Copper Shield sprite', 'Copper Shield relic sprite', 'image/png', NULL, NULL, NULL, '{}', true, 301, '2026-07-12 01:52:39.222476+00', '2026-07-13 02:29:07.618356+00'),
	('0166f77b-b209-46a8-bdda-64ddcdbcfdfb', 'game-assets', 'rollcasters/002-pippa.png', 'rollcaster', 'rollcasters', '002', 'default', 'Pippa', 'rollcaster image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 17, '2026-07-13 22:06:29.820807+00', '2026-07-13 22:06:29.820807+00'),
	('7a1f0f72-c8d0-4914-a6bf-f07b24accde6', 'game-assets', 'logos/statuses/paralysis.png', 'status', 'statuses', 'paralysis', 'default', 'Paralysis', 'status image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 18, '2026-07-14 05:40:25.53567+00', '2026-07-14 05:40:25.53567+00'),
	('36789982-41f5-44ec-9029-df4a52f0d9d9', 'game-assets', 'relics/002-wooden-die.png', 'relic', 'relics', '002', 'default', 'Wooden Die', 'relic image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 21, '2026-07-14 05:51:25.552125+00', '2026-07-14 05:51:25.552125+00'),
	('0c287bdf-19c3-4ac3-9bea-b2c217507e2b', 'game-assets', 'critters/002-cragram.png', 'critter', NULL, NULL, 'default', 'Cragram', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:35.271735+00', '2026-07-14 23:25:35.271735+00'),
	('17a43c6b-de86-4584-ae82-eef22a315178', 'game-assets', 'critters/005-florhound.png', 'critter', NULL, NULL, 'default', 'Florhound', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:37.807316+00', '2026-07-14 23:25:37.807316+00'),
	('5d6283e1-c225-45bc-adae-1d74c61ae07b', 'game-assets', 'critters/007-congua.png', 'critter', NULL, NULL, 'default', 'Congua', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:40.422142+00', '2026-07-14 23:25:40.422142+00'),
	('e6b8dc9f-73d8-4d7e-a860-bc276fa5b68c', 'game-assets', 'critters/009-voltrill.png', 'critter', NULL, NULL, 'default', 'Voltrill', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 23, '2026-07-14 23:25:43.085392+00', '2026-07-14 23:25:43.085392+00'),
	('281f5c5f-3828-4f40-914d-646137675335', 'game-assets', 'critters/004-spreagle.png', 'critter', 'critters', '004', 'default', 'Spreagle sprite', 'Spreagle sprite', 'image/png', NULL, NULL, NULL, '{}', true, 202, '2026-07-12 01:52:39.222476+00', '2026-07-14 23:25:45.590858+00'),
	('2599fcf4-fc12-40b5-88b9-c090c895305b', 'game-assets', 'ui/prismite.png', 'currency', 'currency', 'prismite', 'icon', 'Prismite', 'ui image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 29, '2026-07-15 16:39:56.403786+00', '2026-07-15 16:42:20.869139+00'),
	('afb9b7e4-7cc4-489c-a8dd-fc2d0e7ef8a5', 'game-assets', 'critters/013-viperch.png', 'critter', NULL, NULL, 'default', 'Viperch', 'critter image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 30, '2026-07-16 00:39:44.569208+00', '2026-07-16 00:39:44.569208+00'),
	('24162606-d859-40e2-8fef-7218c018d290', 'game-assets', 'logos/elements/frost.png', 'element', NULL, NULL, 'default', 'Frost', 'element image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 33, '2026-07-16 20:48:00.372478+00', '2026-07-16 20:48:00.372478+00'),
	('92fbc7b7-9709-433b-9219-8c3ed81d5bc8', 'game-assets', 'rollcasters/003-chance.png', 'rollcaster', NULL, NULL, 'default', 'Chance', 'rollcaster image from Storage', 'image/png', NULL, NULL, NULL, '{}', true, 33, '2026-07-16 20:48:02.814767+00', '2026-07-16 20:48:02.814767+00');


--
-- Data for Name: relic_effects; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."relic_effects" ("relic_id", "id", "name", "description", "template_id", "parameters", "sort_order") VALUES
	('002', 'a597cea0-309a-4a70-9f49-bb691c38c111', 'Lighter Roll', 'Equipped Critter gains +1/+1 to its Mana Die rolls.', 'relic-mana-dice-modifier', '{"target": "equipped_critter", "element_ids": [], "maximum_delta": 1, "minimum_delta": 1}', 0),
	('003', '9feb0d5d-0848-441c-8f24-73aa3ccdefb3', 'Slight Traction', 'Equipped Critter gains +3 SPEED.', 'relic-stat-modifier', '{"stat": "spd", "amount": 3, "target": "equipped_critter", "value_mode": "flat"}', 0),
	('001', 'c9c5d71f-f066-4210-bf55-4bac3042f48d', 'Minor Hardening', 'Equipped critter gains +5 DEF.', 'relic-stat-modifier', '{"stat": "def", "amount": 5, "target": "equipped_critter", "value_mode": "flat"}', 0);


--
-- Data for Name: rollcasters; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rollcasters" ("id", "name", "asset_path", "description", "sort_order", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by") VALUES
	('001', 'Roland', 'rollcasters/001-roland-2.png', 'Rollcaster who sharpens the squad for direct offense.', 1, true, false, 8, '2026-07-12 21:57:09.70961+00', '2026-07-17 05:03:31.321096+00', NULL, NULL),
	('002', 'Pippa', 'rollcasters/002-pippa.png', 'Rollcaster who hardens the squad for strategic defense.', 2, true, false, 4, '2026-07-13 22:08:35.464716+00', '2026-07-17 05:03:43.80854+00', NULL, NULL),
	('003', 'Chance', 'rollcasters/003-chance.png', 'Rollcaster who rolls high to boost the squad mana rolls', 3, true, false, 4, '2026-07-16 20:49:26.856166+00', '2026-07-17 05:03:54.688345+00', NULL, NULL);


--
-- Data for Name: rollcaster_ability_unlocks; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rollcaster_ability_unlocks" ("rollcaster_id", "ability_id", "unlock_level", "unlock_cost", "is_default", "sort_order") VALUES
	('001', 'sharpen-1', 1, 0, true, 0),
	('002', 'harden-1', 1, 0, true, 0),
	('003', 'loaded-dice-1', 1, 0, true, 0);


--
-- Data for Name: rollcaster_level_progression; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."rollcaster_level_progression" ("rollcaster_id", "level", "total_required_xp", "grant_ability_points", "total_unlocked_ability_slots") VALUES
	('001', 1, 0, 0, 1),
	('001', 2, 120, 2, 1),
	('001', 3, 260, 2, 1),
	('001', 4, 460, 3, 1),
	('001', 5, 720, 3, 1),
	('002', 1, 0, 0, 1),
	('002', 2, 120, 2, 1),
	('002', 3, 260, 2, 1),
	('002', 4, 460, 3, 1),
	('002', 5, 720, 3, 1),
	('003', 1, 0, 0, 1),
	('003', 2, 200, 1, 1),
	('003', 3, 400, 1, 1),
	('003', 4, 600, 1, 1),
	('003', 5, 800, 1, 1);


--
-- Data for Name: shop_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."shop_entries" ("id", "shop_type", "name", "description", "target_category", "target_id", "quantity", "currency_id", "price", "sort_order", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by") VALUES
	('efddc75a-914b-4d73-93b0-9bc1fed75e2c', 'relic', 'Copper Shield', 'Relic Shop offer for Copper Shield (#001).', 'relic', '001', 1, 'coins', 50, 1, true, false, 1, '2026-07-15 16:17:22.978962+00', '2026-07-16 18:35:06.104108+00', NULL, NULL),
	('5ced4bc5-a32e-4903-8c10-cd8ab80e84e3', 'relic', 'Leather Greaves', 'Relic Shop offer for Leather Greaves (#003).', 'relic', '003', 1, 'coins', 60, 2, true, false, 1, '2026-07-15 16:18:52.079166+00', '2026-07-16 18:35:06.104108+00', NULL, NULL),
	('324273e1-5b43-4f48-9c06-f32f7ff40285', 'relic', 'Wooden Die', 'Relic Shop offer for Wooden Die (#002).', 'relic', '002', 1, 'coins', 70, 3, true, false, 1, '2026-07-15 16:19:14.102393+00', '2026-07-16 18:35:06.104108+00', NULL, NULL),
	('f6a1f17c-a9ec-43d6-be65-f7aa07180a04', 'shard', 'Spreagle Shards', 'Shard Shop offer for Spreagle (#004).', 'critter', '004', 1, 'coins', 100, 1, true, false, 1, '2026-07-15 16:25:36.576681+00', '2026-07-16 18:35:06.104108+00', NULL, NULL),
	('8b0e4c23-cefd-4b19-be9c-9a77c9013ca1', 'shard', 'Congua Shards', 'Shard Shop offer for Congua (#007).', 'critter', '007', 1, 'coins', 100, 2, true, false, 1, '2026-07-15 16:27:37.682997+00', '2026-07-16 18:35:06.104108+00', NULL, NULL),
	('1b39d9a3-cdc7-44bc-b721-bae9add2d2fe', 'shard', 'Ramber Shards', 'Shard Shop offer for Ramber (#001).', 'critter', '001', 1, 'coins', 100, 3, true, false, 1, '2026-07-15 16:27:53.167182+00', '2026-07-16 18:35:06.104108+00', NULL, NULL),
	('e49665da-6a3b-4e81-81f8-b006631b1c1b', 'shard', 'Roland Shards', 'Shard Shop offer for Roland (#001).', 'rollcaster', '001', 1, 'coins', 50, 4, true, false, 1, '2026-07-17 05:06:38.127419+00', '2026-07-17 05:06:38.127419+00', NULL, NULL),
	('2b2048ad-dd4e-4210-8510-35ead086f8c7', 'shard', 'Pippa Shards', 'Shard Shop offer for Pippa (#002).', 'rollcaster', '002', 1, 'coins', 50, 5, true, false, 1, '2026-07-17 05:06:39.270428+00', '2026-07-17 05:06:39.270428+00', NULL, NULL),
	('4db91e43-2c7c-4356-839f-0bf102d39811', 'shard', 'Chance Shards', 'Shard Shop offer for Chance (#003).', 'rollcaster', '003', 1, 'coins', 20, 6, true, false, 1, '2026-07-17 05:08:35.224096+00', '2026-07-17 05:08:35.224096+00', NULL, NULL);


--
-- Data for Name: skill_effects; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."skill_effects" ("skill_id", "id", "name", "description", "template_id", "parameters", "sort_order") VALUES
	('vile-injection', 'a3901008-9244-483b-8536-9f1fb2ef25cf', 'Oozing Restoration', 'Restore 30% of a target''s maximum HP. ', 'skill-restore-hp', '{"amount": 0.3, "chance": 1, "target": "target_enemies", "value_mode": "percent_max_hp"}', 0),
	('vile-injection', '2c50bba4-9de8-4016-a6af-c95f992ebea8', 'Injected Toxic', 'The target has Toxic applied for 3 turns.', 'skill-apply-status', '{"turns": 3, "chance": 1, "target": "target_enemies", "status_id": "toxic", "indefinite": false}', 1),
	('swipe', 'c7682f61-3f9d-4e20-948c-41acd55b5344', 'Guard Break', 'Has a 10% chance to reduce the enemy''s DEF by -5. ', 'skill-stat-modifier', '{"stat": "def", "amount": -5, "chance": 0.1, "target": "target_enemies", "value_mode": "flat"}', 0),
	('acid', '929c9d77-5d88-47fd-bc3e-060bcc0fa269', 'Leaking Toxic', 'Has a 20% chance to apply Toxic status to the target for 3 turns.', 'skill-apply-status', '{"turns": 3, "chance": 0.2, "target": "target_enemies", "status_id": "toxic", "indefinite": false}', 0),
	('chilling-wind', '5c481c5c-f7c0-4cab-9dc8-a918ba9abcb6', 'Frozen Guard', 'Has a 30% chance to reduce target critter''s DEF by 20%', 'skill-stat-modifier', '{"stat": "atk", "amount": 0.2, "chance": 0.3, "target": "target_enemies", "value_mode": "percentage"}', 0);


--
-- Data for Name: starter_options; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."starter_options" ("critter_id", "sort_order", "is_active") VALUES
	('001', 1, true),
	('004', 2, true),
	('007', 3, true);


--
-- Data for Name: starter_rollcaster_options; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."starter_rollcaster_options" ("rollcaster_id", "sort_order", "is_active") VALUES
	('001', 1, true),
	('002', 2, true),
	('003', 3, true);


--
-- Data for Name: statuses; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."statuses" ("id", "name", "description", "sort_order", "is_active", "is_archived", "version", "created_at", "updated_at", "created_by", "updated_by", "stacking_policy", "default_duration", "max_stacks", "asset_path") VALUES
	('paralysis', 'Paralysis', 'Has a 30% chance to prevent the afflicted critter from acting each turn.', 0, true, false, 3, '2026-07-12 21:57:09.70961+00', '2026-07-14 05:40:59.870656+00', NULL, NULL, 'refresh', 3, 1, 'logos/statuses/paralysis.png'),
	('toxic', 'Toxic', 'Deals 8% of the afflicted Critter''s max HP at the end of each turn.', 1, true, false, 3, '2026-07-12 21:57:09.70961+00', '2026-07-16 21:02:29.372678+00', NULL, NULL, 'refresh', 3, 1, 'logos/statuses/toxic.png'),
	('frostbite', 'Frostbite', 'Has a 20% chance to cause the afflicted critter to be unable to use a Skill, and a 70% chance that the afflicted critter takes 8% max HP damage at the start of each turn', 3, true, false, 4, '2026-07-16 21:35:20.147804+00', '2026-07-16 21:37:27.074847+00', NULL, NULL, 'refresh', 3, 1, 'logos/statuses/frostbite.png');


--
-- Data for Name: status_effects; Type: TABLE DATA; Schema: public; Owner: postgres
--

INSERT INTO "public"."status_effects" ("status_id", "id", "name", "description", "template_id", "parameters", "sort_order") VALUES
	('paralysis', 'c6920656-9acc-4f13-99d3-3f8470881b23', 'Paralysis', 'Has a 30% chance to prevent the afflicted critter from acting each turn.', 'status-skip-action-chance', '{"chance": 0.3, "target": "status_holder", "combat_action": "all"}', 0),
	('toxic', 'b98932ca-f44a-4a23-8644-41f73824859e', 'Toxic', 'Deals 8% of the afflicted Critter''s max HP at the end of each turn.', 'status-damage-over-time', '{"amount": 0.08, "chance": 1, "target": "status_holder", "timing": "end_of_turn", "value_mode": "percent_max_hp"}', 0),
	('frostbite', '03b6c21d-bd55-4d90-bbdd-c24e503689b4', 'Icy Bite', 'Afflicted critter has a 70% chance to take 8% damage at the start of each turn.', 'status-damage-over-time', '{"amount": 0.08, "chance": 0.7, "target": "status_holder", "timing": "start_of_turn", "value_mode": "percent_max_hp"}', 0),
	('frostbite', '4ea499ea-d778-48ba-ba2e-74ddeb0a9f9f', 'Frozen', 'Has a 20% chance that afflicted critter cannot use a SKill on each turn.', 'status-skip-action-chance', '{"chance": 0.2, "target": "status_holder", "combat_action": "skill"}', 1);


--
-- PostgreSQL database dump complete
--

-- \unrestrict ljpd4U8d9U2RqVPrNQw0zgo5nmi2MG43etPRI1oLXFaRfploKQk7dmiW4UqHxzQ

RESET ALL;

SET session_replication_role = origin;
