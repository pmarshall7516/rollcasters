import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectDbError(client, savepoint, expectedCode, action) {
  await client.query(`savepoint ${savepoint}`);
  let matched = false;
  try {
    await action();
  } catch (error) {
    matched = String(error.message).includes(expectedCode);
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  check(matched, `Expected database error ${expectedCode}.`);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;
  // Ownership and gate regressions use the same published challenge fixture;
  // serialize their rollback-safe player mutations when a DB suite runs them
  // concurrently.
  await client.query("select pg_advisory_xact_lock(hashtextextended('rollcaster:collectible-db-fixture',0))");

  const fixture = await client.query(`
    select player.id as user_id, owned.critter_id as owned_critter_id, target.collectible_id as target_id
    from auth.users player
    join lateral (
      select critter_id
      from public.user_critters
      where user_id=player.id
      order by unlocked_at,id
      limit 1
    ) owned on true
    join lateral (
      select challenge.collectible_id
      from public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
      join public.critters target on target.id=challenge.collectible_id
        and target.is_active and not target.is_archived
      where challenge.collectible_type='critter'
        and challenge.gate_order=1
        and not exists (
          select 1
          from public.user_collectible_unlock_events event
          where event.user_id=player.id and event.collectible_type='critter' and event.collectible_id=challenge.collectible_id
        )
        and not exists (
          select 1
          from public.user_critters owned_target
          where owned_target.user_id=player.id and owned_target.critter_id=challenge.collectible_id
        )
        and (
          select count(*) from public.release_collectible_challenges(public.current_game_catalog_release_id()) gate_two
          where gate_two.collectible_type='critter' and gate_two.collectible_id=challenge.collectible_id and gate_two.gate_order=2
        )=1
        and (
          select count(*) from public.release_collectible_challenges(public.current_game_catalog_release_id()) tracked
          where tracked.collectible_type='critter'
            and tracked.collectible_id=challenge.collectible_id
            and tracked.gate_order is null
            and tracked.parameters->>'tracking_required'='true'
        )=1
      order by challenge.collectible_id
      limit 1
    ) target on true
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The published release needs a user, an unowned gated Critter, and an owned Critter fixture.");

  const { user_id: userId, target_id: targetId } = fixture.rows[0];
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  const challenges = (await client.query(`
    select id,challenge_type,parameters,required_amount,required_level,gate_order,sort_order
    from public.release_collectible_challenges(public.current_game_catalog_release_id())
    where collectible_type='critter' and collectible_id=$1
    order by sort_order,id
  `, [targetId])).rows;
  const gateOne = challenges.filter((challenge) => challenge.gate_order === 1);
  const gateTwo = challenges.filter((challenge) => challenge.gate_order === 2);
  const tracked = challenges.find((challenge) => challenge.gate_order === null && challenge.parameters?.tracking_required === true);
  check(gateOne.length === 1 && gateTwo.length === 1 && tracked, "The published gate fixture must contain one Gate 1 challenge, one Gate 2 challenge, and one tracked ungated challenge.");
  const gateOneId = gateOne[0].id;
  const gateTwoId = gateTwo[0].id;
  const trackedId = tracked.id;
  const unlockCritterId = gateOne[0].parameters?.collectible_ids?.[0];
  check(unlockCritterId, "The published Gate 1 fixture must identify its required Critter.");

  await client.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=any($2::uuid[])", [userId, [gateOneId, gateTwoId, trackedId]]);

  const initialStates = (await client.query(
    "select * from public.collectible_challenge_states($1,'critter',$2)",
    [userId, targetId],
  )).rows;
  const initialGateOne = initialStates.find((state) => state.challenge_id === gateOneId);
  const initialGateTwo = initialStates.find((state) => state.challenge_id === gateTwoId);
  const initialTracked = initialStates.find((state) => state.challenge_id === trackedId);
  check(initialGateOne?.eligible && !initialGateOne.complete, "Gate 1 must be immediately eligible but incomplete before its raw goal is reached.");
  check(!initialGateTwo?.eligible && !initialGateTwo.complete && initialGateTwo.blocked_by_gate_order === 1, "A full-progress later Global gate must remain blocked by the incomplete Gate 1 group.");
  check(!initialTracked?.eligible && !initialTracked.complete && initialTracked.blocked_by_gate_order === 1, "Ungated challenges must wait for the complete gate sequence.");

  await expectDbError(client, "blocked_tracking", "CHALLENGE_GATED", () =>
    client.query("select public.track_collectible_challenge($1)", [trackedId]),
  );

  // Complete the published Gate 1 ownership requirement and the published
  // Gate 2 level requirement using rollback-safe player state.
  const requiredLevel = Number(gateTwo[0].required_level ?? gateTwo[0].parameters?.required_level ?? 1);
  await client.query(
    "insert into public.user_critters(user_id,critter_id,level) values($1,$2,$3) on conflict(user_id,critter_id) do update set level=greatest(public.user_critters.level,excluded.level)",
    [userId, unlockCritterId, requiredLevel],
  );
  await client.query(
    "insert into public.user_collectible_unlock_events(user_id,collectible_type,collectible_id) select $1,'critter',$2 where not exists(select 1 from public.user_collectible_unlock_events where user_id=$1 and collectible_type='critter' and collectible_id=$2)",
    [userId, unlockCritterId],
  );

  const eligibleStates = (await client.query(
    "select * from public.collectible_challenge_states($1,'critter',$2)",
    [userId, targetId],
  )).rows;
  check(eligibleStates.find((state) => state.challenge_id === gateOneId)?.complete, "Gate 1 must complete when its published ownership goal is reached.");
  check(eligibleStates.find((state) => state.challenge_id === gateTwoId)?.complete, "Gate 2 must complete when its published level goal is reached.");
  check(eligibleStates.find((state) => state.challenge_id === trackedId)?.eligible, "The tracked challenge must become eligible after every published gate completes.");

  const trackedRow = (await client.query("select public.track_collectible_challenge($1) as result", [trackedId])).rows[0].result;
  check(trackedRow.challenge_id === trackedId && trackedRow.slot_order === 1, "A newly eligible tracked challenge must occupy the first compacted slot.");

  await client.query(
    `insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at)
     values($1,$2,$3,now())
     on conflict(user_id,challenge_id) do update set progress=excluded.progress,completed_at=excluded.completed_at`,
    [userId, trackedId, Number(tracked.required_amount ?? tracked.parameters?.required_amount ?? 1)],
  );
  await client.query("select public.evaluate_all_collectible_unlocks_internal($1)", [userId]);
  check((await client.query("select public.collectible_is_unlocked($1,'critter',$2) as unlocked", [userId, targetId])).rows[0].unlocked, "The completed published gate sequence and tracked challenge must unlock the Critter exactly once.");

  console.log(`Gate challenge runtime tests passed for user ${userId} and Critter ${targetId}; all player fixture changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
