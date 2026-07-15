-- Serialize every bigint used by the player shop as text before it crosses JSON.
-- This keeps prices and challenge goals exact in JavaScript clients.

create or replace function public.get_collectible_shop_catalog()
returns jsonb
language sql
stable
security invoker
set search_path=public
as $$
  select jsonb_build_object(
    'currencies', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.sort_order,c.name,c.id)
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

revoke all on function public.get_collectible_shop_catalog() from public;
grant execute on function public.get_collectible_shop_catalog() to anon,authenticated;
