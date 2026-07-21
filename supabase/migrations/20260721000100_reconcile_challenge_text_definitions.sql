begin;

-- Critter 028 was intended to be the authored collection milestone, but an
-- earlier release left its legacy ownership row in place. Keep the stable ID,
-- repair the authoritative v2 definition, and preserve the authored gate
-- ordering while invalidating stale derived ownership progress.
update public.collectible_unlock_challenges
set parameters=jsonb_build_object(
      'collectible_category','critter',
      'collectible_ids','[]'::jsonb,
      'required_amount',7,
      'require_unique_collectibles',true,
      'retroactive',true
    ),
    display_text=null,
    updated_at=now()
where id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid
  and collectible_type='critter'
  and collectible_id='028'
  and challenge_type='own_collectible';

do $$
declare
  v_user uuid;
begin
  for v_user in
    select user_id from public.user_tracked_collectible_challenges
    where challenge_id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid
  loop
    delete from public.user_tracked_collectible_challenges
    where user_id=v_user and challenge_id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid;
    perform public.compact_user_tracking_slots(v_user);
  end loop;
end;
$$;
delete from public.user_collectible_challenge_scope_progress
where challenge_id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid;
delete from public.user_collectible_challenge_progress
where challenge_id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid;

-- This is the canonical player-facing copy requested for the specific
-- diversity challenge. The client still supports generated fallback text for
-- every other definition, while authored overrides are rendered verbatim.
update public.collectible_unlock_challenges
set display_text='Own 1 Critter from each of: Basic, Vile, Frost.',
    parameters=jsonb_set(parameters,'{required_distinct_types}','3'::jsonb,true),
    updated_at=now()
where id='46317156-deed-4147-ae78-39860b3b2fb6'::uuid
  and challenge_type='collection_diversity';

do $$
begin
  if not exists(
    select 1 from public.collectible_unlock_challenges
    where id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid
      and parameters->>'collectible_category'='critter'
      and parameters->>'required_amount'='7'
      and jsonb_array_length(parameters->'collectible_ids')=0
  ) then raise exception 'Challenge 028 definition was not reconciled'; end if;
  if not exists(
    select 1 from public.collectible_unlock_challenges
    where id='46317156-deed-4147-ae78-39860b3b2fb6'::uuid
      and display_text='Own 1 Critter from each of: Basic, Vile, Frost.'
  ) then raise exception 'Whispsqueak display text was not reconciled'; end if;
end;
$$;

commit;
