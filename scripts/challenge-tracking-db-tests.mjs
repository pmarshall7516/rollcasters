import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const db = createDbClient();
await db.connect();

try {
  await db.query("begin");

  const fixture = (await db.query(`
    select
      player.id as user_id,
      challenge.id as tiny_blade_challenge_id,
      dungeon.dungeon_id
    from auth.users player
    cross join lateral (
      select c.id,c.collectible_type,c.collectible_id
      from public.release_collectible_challenges(public.current_game_catalog_release_id()) c
      where c.collectible_type='relic'
        and c.collectible_id='017'
        and c.challenge_type='defeat_rollcaster_type'
      order by c.sort_order,c.id
      limit 1
    ) challenge
    join lateral (
      select state.trackable,state.eligible,state.complete
      from public.collectible_challenge_states(player.id,challenge.collectible_type,challenge.collectible_id) state
      where state.challenge_id=challenge.id
    ) state on state.trackable
    join lateral (
      select dungeon_id
      from public.user_dungeon_progress
      where user_id=player.id and is_unlocked
      order by dungeon_id
      limit 1
    ) dungeon on true
    where not public.is_dev_tool_identity(player.id)
      and state.eligible
      and not state.complete
    order by player.created_at
    limit 1
  `)).rows[0];
  check(fixture, "The development database needs an eligible Tiny Blade Defeat Rollcaster Type challenge.");

  const { user_id: userId, tiny_blade_challenge_id: tinyBladeChallengeId } = fixture;
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await db.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await db.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, tinyBladeChallengeId]);

  const trackingDefinition = (await db.query(
    "select pg_get_functiondef('public.track_collectible_challenge(uuid)'::regprocedure) as definition",
  )).rows[0].definition;
  check(
    trackingDefinition.includes("collectible_challenge_requires_tracking(p_challenge_id)")
      && !trackingDefinition.includes("challenge_type in ("),
    "The tracking RPC must derive eligibility from the published template policy, not a hard-coded type list.",
  );

  const candidates = (await db.query(`
    select distinct on (c.challenge_type)
      c.challenge_type,c.id as challenge_id,c.collectible_type,c.collectible_id
    from public.release_collectible_challenges(public.current_game_catalog_release_id()) c
    join public.release_unlock_challenge_templates(public.current_game_catalog_release_id()) template
      on template.id=c.challenge_type
    join lateral public.collectible_challenge_states($1,c.collectible_type,c.collectible_id) state
      on state.challenge_id=c.id and state.trackable
    where template.challenge_category='tracked'
      and template.progress_mode='tracked_event'
      and coalesce(c.parameters->>'tracking_required','true')='true'
    order by c.challenge_type,c.collectible_type,c.collectible_id,c.sort_order,c.id
  `, [userId])).rows;
  check(candidates.length > 0, "The published release needs at least one eligible tracked challenge.");

  for (const candidate of candidates) {
    await db.query("savepoint challenge_tracking_family");
    try {
      const tracked = (await db.query(
        "select public.track_collectible_challenge($1) as value",
        [candidate.challenge_id],
      )).rows[0].value;
      check(tracked?.challenge_id === candidate.challenge_id, `${candidate.challenge_type} must be accepted by the tracking RPC.`);
    } finally {
      await db.query("rollback to savepoint challenge_tracking_family");
    }
  }

  const tracked = (await db.query(
    "select public.track_collectible_challenge($1) as value",
    [tinyBladeChallengeId],
  )).rows[0].value;
  check(tracked?.challenge_id === tinyBladeChallengeId, "Tiny Blade's Acolyte challenge must be trackable.");

  const sameCollectiblePair = (await db.query(`
    select
      first_challenge.id as first_challenge_id,
      second_challenge.id as second_challenge_id
    from public.release_collectible_challenges(public.current_game_catalog_release_id()) first_challenge
    join public.release_collectible_challenges(public.current_game_catalog_release_id()) second_challenge
      on second_challenge.collectible_type=first_challenge.collectible_type
      and second_challenge.collectible_id=first_challenge.collectible_id
      and second_challenge.id>first_challenge.id
    join public.release_unlock_challenge_templates(public.current_game_catalog_release_id()) first_template
      on first_template.id=first_challenge.challenge_type
    join public.release_unlock_challenge_templates(public.current_game_catalog_release_id()) second_template
      on second_template.id=second_challenge.challenge_type
    join public.collectible_unlock_requirements requirement
      on requirement.collectible_type=first_challenge.collectible_type
      and requirement.collectible_id=first_challenge.collectible_id
    join lateral public.collectible_challenge_states($1,first_challenge.collectible_type,first_challenge.collectible_id) first_state
      on first_state.challenge_id=first_challenge.id and first_state.trackable
    join lateral public.collectible_challenge_states($1,second_challenge.collectible_type,second_challenge.collectible_id) second_state
      on second_state.challenge_id=second_challenge.id and second_state.trackable
    where first_template.challenge_category='tracked'
      and first_template.progress_mode='tracked_event'
      and second_template.challenge_category='tracked'
      and second_template.progress_mode='tracked_event'
      and coalesce(first_challenge.parameters->>'tracking_required','true')='true'
      and coalesce(second_challenge.parameters->>'tracking_required','true')='true'
      and first_state.eligible
      and second_state.eligible
      and not first_state.complete
      and not second_state.complete
      and requirement.required_challenges>1
      and first_challenge.id<>$2
      and second_challenge.id<>$2
    order by first_challenge.collectible_type,first_challenge.collectible_id,first_challenge.sort_order,second_challenge.sort_order
    limit 1
  `, [userId, tinyBladeChallengeId])).rows[0];
  check(sameCollectiblePair, "The published release needs two eligible tracked challenges on one collectible.");

  await db.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  const firstSameCollectible = (await db.query(
    "select public.track_collectible_challenge($1) as value",
    [sameCollectiblePair.first_challenge_id],
  )).rows[0].value;
  const secondSameCollectible = (await db.query(
    "select public.track_collectible_challenge($1) as value",
    [sameCollectiblePair.second_challenge_id],
  )).rows[0].value;
  const sameCollectibleTrackedRows = (await db.query(
    "select challenge_id,slot_order from public.user_tracked_collectible_challenges where user_id=$1 order by slot_order",
    [userId],
  )).rows;
  check(
    firstSameCollectible?.challenge_id === sameCollectiblePair.first_challenge_id
      && secondSameCollectible?.challenge_id === sameCollectiblePair.second_challenge_id
      && sameCollectibleTrackedRows.length === 2
      && sameCollectibleTrackedRows[0].challenge_id === sameCollectiblePair.first_challenge_id
      && sameCollectibleTrackedRows[1].challenge_id === sameCollectiblePair.second_challenge_id
      && sameCollectibleTrackedRows[0].slot_order !== sameCollectibleTrackedRows[1].slot_order,
    "Two challenges for the same collectible must occupy two tracking slots together.",
  );

  const firstSameCollectibleGoal = (await db.query(
    "select public.collectible_challenge_goal($1)::text as goal",
    [sameCollectiblePair.first_challenge_id],
  )).rows[0].goal;
  await db.query(`
    insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at,updated_at)
    values($1,$2,$3::bigint,now(),now())
    on conflict(user_id,challenge_id) do update set progress=excluded.progress,completed_at=excluded.completed_at,updated_at=excluded.updated_at
  `, [userId, sameCollectiblePair.first_challenge_id, firstSameCollectibleGoal]);
  const afterSiblingCompletion = (await db.query(
    "select public.get_collectible_player_snapshot() as snapshot",
  )).rows[0].snapshot;
  const remainingAfterSiblingCompletion = afterSiblingCompletion.tracked.map((row) => row.challenge_id);
  check(
    !remainingAfterSiblingCompletion.includes(sameCollectiblePair.first_challenge_id)
      && remainingAfterSiblingCompletion.includes(sameCollectiblePair.second_challenge_id),
    "Completing one tracked challenge must release only that challenge's slot while the same-collectible sibling remains tracked.",
  );

  await db.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  const restoredTinyBladeTracking = (await db.query(
    "select public.track_collectible_challenge($1) as value",
    [tinyBladeChallengeId],
  )).rows[0].value;
  check(restoredTinyBladeTracking?.challenge_id === tinyBladeChallengeId, "The combat fixture challenge must be restored after the same-collectible tracking assertion.");

  const run = (await db.query(
    "select public.start_dungeon_run_v3($1,$2) as value",
    [fixture.dungeon_id, crypto.randomUUID()],
  )).rows[0].value;
  const runId = run.id;
  const encounter = run.selectedEnemyEncounters.find((row) => Number(row.battleIndex) === Number(run.battleIndex));
  check(encounter?.enemyRollcaster?.eclipse_order_type === "acolyte", "The combat fixture must select an Acolyte encounter.");

  const submit = (eventKey, won) => db.query(
    "select public.submit_collectible_combat_events($1,1,$2::jsonb) as value",
    [runId, JSON.stringify([{
      event_key: eventKey,
      event_type: "battle_completed",
      source_critter_id: null,
      target_critter_id: null,
      skill_id: null,
      amount: 1,
      payload: { won, enemy_rollcaster_type: "spoofed" },
    }])],
  );

  let snapshot = (await submit("tiny-blade-acolyte-win", true)).rows[0].value;
  check(snapshot.progress.find((row) => row.challenge_id === tinyBladeChallengeId)?.current === "1", "A winning Acolyte battle must advance Tiny Blade progress.");

  snapshot = (await submit("tiny-blade-acolyte-win", true)).rows[0].value;
  check(snapshot.progress.find((row) => row.challenge_id === tinyBladeChallengeId)?.current === "1", "A duplicate battle event must not double-count Tiny Blade progress.");

  snapshot = (await submit("tiny-blade-acolyte-loss", false)).rows[0].value;
  check(snapshot.progress.find((row) => row.challenge_id === tinyBladeChallengeId)?.current === "1", "A lost battle must not advance Tiny Blade progress.");

  console.log(`Challenge tracking database regression passed for ${candidates.length} tracked families and Tiny Blade ${tinyBladeChallengeId}; all fixture changes will be rolled back.`);
} finally {
  await db.query("rollback").catch(() => undefined);
  await db.end().catch(() => undefined);
}
