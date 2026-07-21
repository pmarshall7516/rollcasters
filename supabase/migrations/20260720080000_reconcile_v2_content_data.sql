begin;

-- The v2 authoring rollout preserved legacy rows, but two ownership rows need
-- semantic reconciliation. Critter 028 is the newly authored "own seven
-- different Critters" gate. Critter 027's legacy "own three of Relic 004"
-- row is quantity-based and therefore cannot be marked unique.
update public.collectible_unlock_challenges
set parameters=jsonb_build_object(
      'collectible_category','critter',
      'collectible_ids','[]'::jsonb,
      'required_amount',7,
      'require_unique_collectibles',true,
      'retroactive',true
    ),
    updated_at=now()
where id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid
  and collectible_type='critter'
  and collectible_id='028'
  and challenge_type='own_collectible';

update public.collectible_unlock_challenges
set parameters=jsonb_set(parameters,'{require_unique_collectibles}','false'::jsonb,true),
    updated_at=now()
where id='c16fc945-5cc3-468b-9235-0aeb67d66a50'::uuid
  and collectible_type='critter'
  and collectible_id='027'
  and challenge_type='own_collectible';

-- Semantic definition changes invalidate durable event progress and tracking.
-- Derived ownership progress is recomputed from inventory on the next snapshot.
do $$
declare
  v_user uuid;
begin
  for v_user in
    select distinct tracked.user_id
    from public.user_tracked_collectible_challenges tracked
    where tracked.challenge_id in (
      '3599e15f-f459-498a-b92a-b95c79cec468'::uuid,
      'c16fc945-5cc3-468b-9235-0aeb67d66a50'::uuid
    )
  loop
    delete from public.user_tracked_collectible_challenges
    where user_id=v_user and challenge_id in (
      '3599e15f-f459-498a-b92a-b95c79cec468'::uuid,
      'c16fc945-5cc3-468b-9235-0aeb67d66a50'::uuid
    );
    perform public.compact_user_tracking_slots(v_user);
  end loop;
end;
$$;

delete from public.user_collectible_challenge_scope_progress
where challenge_id in (
  '3599e15f-f459-498a-b92a-b95c79cec468'::uuid,
  'c16fc945-5cc3-468b-9235-0aeb67d66a50'::uuid
);
delete from public.user_collectible_challenge_progress
where challenge_id in (
  '3599e15f-f459-498a-b92a-b95c79cec468'::uuid,
  'c16fc945-5cc3-468b-9235-0aeb67d66a50'::uuid
);

-- Correct legacy Effects that received the rollout's positive default even
-- though they harm their target.
update public.status_effects
set classification='negative'
where template_id in (
  select id from public.effect_templates
  where runtime_kind in ('damage_over_time','skip_action_chance')
);

update public.skill_effects
set classification='negative'
where template_id in (
    select id from public.effect_templates where runtime_kind='apply_status'
  )
  and parameters->>'target' in ('target_enemies','selected_enemy','all_enemies');

update public.skill_effects
set classification='negative'
where template_id in (
    select id from public.effect_templates where runtime_kind='stat_modifier'
  )
  and coalesce((parameters->>'amount')::numeric,0)<0;

-- Chilling Wind's source description and Skill definition both specify a DEF
-- reduction. Its compatibility migration accidentally produced ATK +20%.
update public.skill_effects
set parameters=parameters || '{"stat":"def","amount":-0.2,"value_mode":"percentage"}'::jsonb,
    classification='negative'
where id='5c481c5c-f7c0-4cab-9dc8-a918ba9abcb6'
  and skill_id='chilling-wind';

-- Fail the migration if an environment contains the target row but the
-- canonical projections did not synchronize through the validation trigger.
do $$
begin
  if exists(
    select 1 from public.collectible_unlock_challenges
    where id='3599e15f-f459-498a-b92a-b95c79cec468'::uuid
      and (
        parameters->>'collectible_category'<>'critter'
        or parameters->>'required_amount'<>'7'
        or parameters->>'require_unique_collectibles'<>'true'
        or jsonb_array_length(parameters->'collectible_ids')<>0
        or target_category<>'critter'
        or required_amount<>7
      )
  ) then raise exception 'Challenge 3599e15f was not reconciled'; end if;
end;
$$;

commit;
