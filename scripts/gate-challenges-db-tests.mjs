import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDbClient, root } from "./db-utils.mjs";

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

const migrationPath = path.join(root, "supabase", "migrations", "012_gate_challenge_runtime.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;
  await client.query(migrationSql);

  const fixture = await client.query(`
    select
      player.id as user_id,
      owned.critter_id as owned_critter_id,
      target.collectible_type as target_type,
      target.id as target_id,
      dungeon.dungeon_id
    from auth.users player
    join lateral (
      select critter_id
      from public.user_critters
      where user_id=player.id
      order by unlocked_at,id
      limit 1
    ) owned on true
    join lateral (
      select candidate.collectible_type,candidate.id
      from (
        select 'critter'::text as collectible_type,critter.id,critter.sort_order
        from public.critters critter
        where critter.is_active and not critter.is_archived
          and not exists(
            select 1 from public.user_critters user_critter
            where user_critter.user_id=player.id and user_critter.critter_id=critter.id
          )
        union all
        select 'rollcaster',rollcaster.id,rollcaster.sort_order
        from public.rollcasters rollcaster
        where rollcaster.is_active and not rollcaster.is_archived
          and not exists(
            select 1 from public.user_rollcasters user_rollcaster
            where user_rollcaster.user_id=player.id and user_rollcaster.rollcaster_id=rollcaster.id
          )
        union all
        select 'relic',relic.id,relic.sort_order
        from public.relics relic
        where relic.is_active and not relic.is_archived
          and not exists(
            select 1 from public.user_relic_inventory inventory
            where inventory.user_id=player.id and inventory.relic_id=relic.id
              and inventory.discovered_at is not null and inventory.quantity>0
          )
      ) candidate
      order by case candidate.collectible_type when 'critter' then 1 when 'rollcaster' then 2 else 3 end,candidate.sort_order,candidate.id
      limit 1
    ) target on true
    join lateral (
      select dungeon_id
      from public.user_dungeon_progress
      where user_id=player.id and is_unlocked
      order by dungeon_id
      limit 1
    ) dungeon on true
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The development database needs a user with an owned Critter, an unowned collectible, and an unlocked dungeon.");

  const { user_id: userId, owned_critter_id: ownedCritterId, target_type: targetType, target_id: targetId, dungeon_id: dungeonId } = fixture.rows[0];
  const gateOneId = crypto.randomUUID();
  const gateTwoId = crypto.randomUUID();
  const trackedId = crypto.randomUUID();
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await client.query(`
    delete from public.collectible_unlock_requirements
    where collectible_type=$1 and collectible_id=$2
  `, [targetType, targetId]);

  await client.query(`
    insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
    values($1,$2,3)
  `, [targetType, targetId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,required_amount,sort_order,gate_order
    ) values($1,$2,$3,'shop_shards',1,2,1)
  `, [gateOneId, targetType, targetId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,target_category,target_id,required_amount,sort_order,gate_order
    ) values($1,$2,$3,'own_collectible','critter',$4,1,0,2)
  `, [gateTwoId, targetType, targetId, ownedCritterId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,target_mode,any_target,target_ids,required_amount,sort_order,gate_order
    ) values($1,$2,$3,'deal_damage','species',true,'{}',5,1,null)
  `, [trackedId, targetType, targetId]);
  await client.query("select public.assert_collectible_gate_integrity($1,$2)", [targetType, targetId]);

  await client.query(`
    insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at)
    values($1,$2,2,null)
  `, [userId, trackedId]);
  const aggregatePayload = (gateOneOrder, gateTwoOrder) => ({
    requiredChallenges: 3,
    challenges: [
      { id: gateTwoId, type: "own_collectible", targetCategory: "critter", targetId: ownedCritterId, requiredAmount: 1, sortOrder: 0, gateOrder: gateTwoOrder },
      { id: trackedId, type: "deal_damage", targetMode: "species", anyTarget: true, targetIds: [], requiredAmount: 5, sortOrder: 1 },
      { id: gateOneId, type: "shop_shards", requiredAmount: 1, sortOrder: 2, gateOrder: gateOneOrder },
    ],
  });
  await client.query("select public.replace_collectible_unlocks($1,$2,$3::jsonb)", [targetType, targetId, JSON.stringify(aggregatePayload(2, 1))]);
  await client.query("select public.replace_collectible_unlocks($1,$2,$3::jsonb)", [targetType, targetId, JSON.stringify(aggregatePayload(1, 2))]);
  check((await client.query(`
    select progress::text
    from public.user_collectible_challenge_progress
    where user_id=$1 and challenge_id=$2
  `, [userId, trackedId])).rows[0]?.progress === "2", "Gate and display-order edits must preserve stored numeric progress for the stable challenge ID.");

  const initialStates = (await client.query(
    "select * from public.collectible_challenge_states($1,$2,$3)",
    [userId, targetType, targetId],
  )).rows;
  const initialGateOne = initialStates.find((state) => state.challenge_id === gateOneId);
  const initialGateTwo = initialStates.find((state) => state.challenge_id === gateTwoId);
  const initialTracked = initialStates.find((state) => state.challenge_id === trackedId);
  check(initialGateOne.eligible && !initialGateOne.complete, "Gate 1 must be immediately eligible but incomplete before its raw goal is reached.");
  check(initialGateTwo.goal_reached && !initialGateTwo.eligible && !initialGateTwo.complete && initialGateTwo.blocked_by_gate_order === 1, "A full-progress later Global gate must remain blocked by Gate 1.");
  check(!initialTracked.eligible && !initialTracked.complete && initialTracked.blocked_by_gate_order === 1, "Ungated challenges must wait for the complete gate sequence.");

  await expectDbError(client, "blocked_tracking", "CHALLENGE_GATED", () =>
    client.query("select public.track_collectible_challenge($1)", [trackedId]),
  );

  await expectDbError(client, "gapped_catalog", "CONTENT_INTEGRITY", async () => {
    await client.query("update public.collectible_unlock_challenges set gate_order=3 where id=$1", [gateTwoId]);
    await client.query("select * from public.collectible_challenge_states($1,$2,$3)", [userId, targetType, targetId]);
  });
  await expectDbError(client, "threshold_bypass", "CONTENT_INTEGRITY", async () => {
    await client.query(`
      update public.collectible_unlock_requirements
      set required_challenges=1
      where collectible_type=$1 and collectible_id=$2
    `, [targetType, targetId]);
    await client.query("select public.assert_collectible_gate_integrity($1,$2)", [targetType, targetId]);
  });

  await client.query(`
    insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order)
    values($1,$2,1)
  `, [userId, trackedId]);
  const runId = (await client.query("select public.start_dungeon_run($1) as id", [dungeonId])).rows[0].id;
  const selected = (await client.query("select selected_opponents from public.dungeon_runs where id=$1", [runId])).rows[0].selected_opponents;
  const opponentId = selected[0]?.critter_id;
  check(Boolean(opponentId), "The gate test dungeon run must select an opponent.");
  const blockedEvent = [{
    event_key: "gate-blocked-damage",
    event_type: "deal_damage",
    source_critter_id: ownedCritterId,
    target_critter_id: opponentId,
    skill_id: null,
    amount: 5,
  }];
  await client.query("select public.submit_collectible_combat_events($1,1,$2::jsonb)", [runId, JSON.stringify(blockedEvent)]);
  check((await client.query(`
    select progress::text
    from public.user_collectible_challenge_progress
    where user_id=$1 and challenge_id=$2
  `, [userId, trackedId])).rows[0]?.progress === "2", "A stale blocked tracking row must not receive combat progress or replay the blocked event.");
  check((await client.query(`
    select count(*)::int as count
    from public.user_tracked_collectible_challenges
    where user_id=$1 and challenge_id=$2
  `, [userId, trackedId])).rows[0].count === 0, "Combat reconciliation must remove a stale blocked tracking row.");

  await client.query(`
    insert into public.user_collectible_shards(user_id,collectible_type,collectible_id,quantity)
    values($1,$2,$3,1)
  `, [userId, targetType, targetId]);
  const eligibleStates = (await client.query(
    "select * from public.collectible_challenge_states($1,$2,$3)",
    [userId, targetType, targetId],
  )).rows;
  check(eligibleStates.find((state) => state.challenge_id === gateOneId).complete, "Gate 1 must complete when its raw Shop goal is reached.");
  check(eligibleStates.find((state) => state.challenge_id === gateTwoId).complete, "A previously full Global Gate 2 must complete immediately after Gate 1.");
  check(eligibleStates.find((state) => state.challenge_id === trackedId).eligible, "The ungated Tracked challenge must become eligible after every gate completes.");

  const tracked = (await client.query("select public.track_collectible_challenge($1) as result", [trackedId])).rows[0].result;
  check(tracked.challenge_id === trackedId && tracked.slot_order === 1, "A newly eligible Tracked challenge must occupy the first compacted slot.");
  const eligibleEvent = [{ ...blockedEvent[0], event_key: "gate-eligible-damage" }];
  const finalSnapshot = (await client.query(
    "select public.submit_collectible_combat_events($1,2,$2::jsonb) as snapshot",
    [runId, JSON.stringify(eligibleEvent)],
  )).rows[0].snapshot;
  const finalProgress = finalSnapshot.progress.find((progress) => progress.challenge_id === trackedId);
  check(finalProgress.goal_reached && finalProgress.eligible && finalProgress.completed, "Only post-tracking combat must effectively complete the now-eligible challenge.");
  check((await client.query(`
    select public.collectible_is_unlocked($1,$2,$3) as unlocked
  `, [userId, targetType, targetId])).rows[0].unlocked, "Three effectively complete rows must unlock the collectible exactly once.");

  console.log(`Gate challenge runtime tests passed for user ${userId} and ${targetType} ${targetId}; all schema and fixture changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
