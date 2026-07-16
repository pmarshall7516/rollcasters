-- Keep Auth-user deletion compatible with catalog authorship and audit history.
--
-- Catalog created_by/updated_by values are optional live metadata, so clear
-- them when their Auth user is removed. The append-only content change log
-- keeps its actor UUID as historical data without a live Auth foreign key.
--
-- This repeats the intent of the former migration 002 for every authorship
-- column introduced by later additive migrations.

do $$
declare
  v_fk record;
begin
  for v_fk in
    select
      namespace.nspname as schema_name,
      relation.relname as table_name,
      constraint_row.conname as constraint_name,
      attribute.attname as column_name
    from pg_constraint constraint_row
    join pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join lateral unnest(constraint_row.conkey) as constrained_column(attnum)
      on true
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = constrained_column.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and constraint_row.confdeltype <> 'n'
      and namespace.nspname = 'public'
      and array_length(constraint_row.conkey, 1) = 1
      and attribute.attname in ('created_by', 'updated_by')
  loop
    execute format(
      'alter table %I.%I drop constraint %I',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.constraint_name
    );
    execute format(
      'alter table %I.%I add constraint %I foreign key (%I) references auth.users(id) on delete set null',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.constraint_name,
      v_fk.column_name
    );
  end loop;
end $$;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select constraint_row.conname
    from pg_constraint constraint_row
    join pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join lateral unnest(constraint_row.conkey) as constrained_column(attnum)
      on true
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = constrained_column.attnum
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'auth.users'::regclass
      and namespace.nspname = 'public'
      and relation.relname = 'content_change_log'
      and attribute.attname = 'admin_user_id'
  loop
    execute format(
      'alter table public.content_change_log drop constraint %I',
      v_constraint_name
    );
  end loop;
end $$;

comment on column public.content_change_log.admin_user_id is
  'Historical Auth user UUID retained after user deletion; intentionally not a live foreign key.';
