import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const userResult = await client.query("select id from auth.users order by created_at limit 1");
  check(userResult.rowCount === 1, "The development database needs one auth user for the transactional purchase test.");
  const userId = userResult.rows[0].id;
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  const targetResult = await client.query(`
    select c.id
    from public.critters c
    where c.is_active and not c.is_archived
      and not exists(select 1 from public.user_critters uc where uc.user_id=$1 and uc.critter_id=c.id)
      and not exists(select 1 from public.collectible_unlock_requirements r where r.collectible_type='critter' and r.collectible_id=c.id)
    order by c.sort_order,c.id
    limit 1
  `, [userId]);
  check(targetResult.rowCount === 1, "The development catalog needs an unowned Critter without authored requirements for the transactional purchase test.");
  const targetId = targetResult.rows[0].id;
  const challengeId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const insufficientRequestId = crypto.randomUUID();

  await client.query(`
    insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
    values('critter',$1,1)
  `, [targetId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,required_amount,sort_order
    ) values($1,'critter',$2,'shop_shards',3,0)
  `, [challengeId, targetId]);
  await client.query(`
    insert into public.shop_entries(
      id,shop_type,name,description,target_category,target_id,quantity,currency_id,price,sort_order,is_active,is_archived
    ) values($1,'shard','Bigint safety probe','Rolled back after verification.','critter',$2,2,'coins',9007199254740993,0,true,false)
  `, [entryId, targetId]);

  const catalogResult = await client.query("select public.get_collectible_shop_catalog() as catalog");
  const serializedEntry = catalogResult.rows[0].catalog.shop_entries.find((entry) => entry.id === entryId);
  check(serializedEntry?.price === "9007199254740993", "Shop catalog prices must cross JSON as exact strings.");

  await client.query(`
    insert into public.user_currencies(user_id,currency_id,balance)
    values($1,'coins',100)
    on conflict(user_id,currency_id) do update set balance=excluded.balance
  `, [userId]);
  await client.query("savepoint insufficient_purchase");
  let insufficientRejected = false;
  try {
    await client.query("select public.purchase_shop_entry($1,$2)", [entryId, insufficientRequestId]);
  } catch (error) {
    insufficientRejected = String(error.message).includes("INSUFFICIENT_FUNDS");
    await client.query("rollback to savepoint insufficient_purchase");
  }
  check(insufficientRejected, "A server-side price above the locked balance must reject with INSUFFICIENT_FUNDS.");

  await client.query("insert into public.user_collectible_shards(user_id,collectible_type,collectible_id,quantity) values($1,'critter',$2,2)", [userId, targetId]);
  await client.query("update public.shop_entries set price=25 where id=$1", [entryId]);
  const first = (await client.query("select public.purchase_shop_entry($1,$2) as receipt", [entryId, requestId])).rows[0].receipt;
  const retry = (await client.query("select public.purchase_shop_entry($1,$2) as receipt", [entryId, requestId])).rows[0].receipt;
  check(JSON.stringify(first) === JSON.stringify(retry), "Retrying a purchase request ID must return the original receipt.");
  check(first.granted === "1" && first.discarded === "1" && first.price === "25" && first.balance === "75", "The receipt must report exact balance deduction plus capped/discarded final-bundle overflow.");
  check(Boolean(first.unlock_event_id), "Completing the shard goal must create an unlock event in the same transaction.");

  const state = await client.query(`
    select
      (select count(*)::int from public.shop_purchase_receipts where user_id=$1 and request_id=$2) as receipts,
      (select count(*)::int from public.user_critters where user_id=$1 and critter_id=$3) as owned,
      (select quantity::text from public.user_collectible_shards where user_id=$1 and collectible_type='critter' and collectible_id=$3) as shards,
      (select count(*)::int from public.user_collectible_unlock_events where user_id=$1 and collectible_type='critter' and collectible_id=$3) as events
  `, [userId, requestId, targetId]);
  check(state.rows[0].receipts === 1, "A retried purchase must persist exactly one receipt.");
  check(state.rows[0].owned === 1 && state.rows[0].shards === "3" && state.rows[0].events === 1, "Shard completion must atomically cap progress, grant the Critter, and create one notification event.");

  const combatTargetResult = await client.query(`
    select c.id
    from public.critters c
    where c.is_active and not c.is_archived
      and not exists(select 1 from public.user_critters uc where uc.user_id=$1 and uc.critter_id=c.id)
      and c.id<>$2
    order by c.sort_order,c.id
    limit 1
  `, [userId, targetId]);
  check(combatTargetResult.rowCount === 1, "The development catalog needs a second unowned Critter for combat progress verification.");
  const combatUnlockTargetId = combatTargetResult.rows[0].id;
  const combatChallengeId = crypto.randomUUID();
  await client.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await client.query("delete from public.collectible_unlock_requirements where collectible_type='critter' and collectible_id=$1", [combatUnlockTargetId]);
  await client.query(`
    insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
    values('critter',$1,1)
  `, [combatUnlockTargetId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,target_mode,any_target,target_ids,required_amount,sort_order
    ) values($1,'critter',$2,'deal_damage','species',true,'{}',5,0)
  `, [combatChallengeId, combatUnlockTargetId]);
  const tracked = (await client.query("select public.track_collectible_challenge($1) as result", [combatChallengeId])).rows[0].result;
  check(tracked.challenge_id === combatChallengeId && tracked.slot_order === 1, "A combat challenge must occupy the first available tracking slot.");

  const dungeonResult = await client.query(`
    select dungeon_id from public.user_dungeon_progress
    where user_id=$1 and is_unlocked
    order by dungeon_id limit 1
  `, [userId]);
  check(dungeonResult.rowCount === 1, "The development user needs one unlocked dungeon for combat progress verification.");
  const runId = (await client.query("select public.start_dungeon_run($1) as id", [dungeonResult.rows[0].dungeon_id])).rows[0].id;
  const runResult = await client.query("select selected_opponents from public.dungeon_runs where id=$1", [runId]);
  const opponentId = runResult.rows[0].selected_opponents[0]?.critter_id;
  check(Boolean(opponentId), "The test dungeon run must select at least one opponent.");
  const sourceId = (await client.query("select critter_id from public.user_critters where user_id=$1 order by critter_id limit 1", [userId])).rows[0].critter_id;

  const firstCombatEvent = [{
    event_key: "db-probe-damage-1",
    event_type: "deal_damage",
    source_critter_id: sourceId,
    target_critter_id: opponentId,
    skill_id: null,
    amount: 3,
  }];
  await client.query("select public.submit_collectible_combat_events($1,1,$2::jsonb)", [runId, JSON.stringify(firstCombatEvent)]);
  await client.query("select public.submit_collectible_combat_events($1,1,$2::jsonb)", [runId, JSON.stringify(firstCombatEvent)]);
  const afterRetry = await client.query("select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, combatChallengeId]);
  check(afterRetry.rows[0].progress === "3", "Retrying a combat event key must not increment tracked progress twice.");

  const finalCombatEvent = [{ ...firstCombatEvent[0], event_key: "db-probe-damage-2", amount: 2 }];
  const combatSnapshot = (await client.query("select public.submit_collectible_combat_events($1,1,$2::jsonb) as snapshot", [runId, JSON.stringify(finalCombatEvent)])).rows[0].snapshot;
  const combatEventCount = await client.query("select count(*)::int as count from public.collectible_combat_events where run_id=$1", [runId]);
  check(combatEventCount.rows[0].count === 2, "Only unique combat event keys must be persisted.");
  check(combatSnapshot.unlock_events.some((event) => event.collectible_type === "critter" && event.collectible_id === combatUnlockTargetId), "Completing tracked combat progress must return the new unlock notification.");
  check((await client.query("select count(*)::int as count from public.user_critters where user_id=$1 and critter_id=$2", [userId, combatUnlockTargetId])).rows[0].count === 1, "Completed combat progress must grant the target collectible.");

  const relic = (await client.query("select id,max_owned from public.relics where is_active and not is_archived order by sort_order,id limit 1")).rows[0];
  check(Boolean(relic), "The development catalog needs one active Relic for max-owned verification.");
  const cappedRelicEntryId = crypto.randomUUID();
  await client.query(`
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values($1,$2,$3,now())
    on conflict(user_id,relic_id) do update set quantity=excluded.quantity,discovered_at=excluded.discovered_at
  `, [userId, relic.id, relic.max_owned]);
  await client.query(`
    insert into public.shop_entries(
      id,shop_type,name,description,target_category,target_id,quantity,currency_id,price,sort_order,is_active,is_archived
    ) values($1,'relic','Max-owned probe','Rolled back after verification.','relic',$2,1,'coins',0,0,true,false)
  `, [cappedRelicEntryId, relic.id]);
  await client.query("savepoint max_owned_purchase");
  let maxOwnedRejected = false;
  try {
    await client.query("select public.purchase_shop_entry($1,$2)", [cappedRelicEntryId, crypto.randomUUID()]);
  } catch (error) {
    maxOwnedRejected = String(error.message).includes("RELIC_MAX_OWNED_REACHED");
    await client.query("rollback to savepoint max_owned_purchase");
  }
  check(maxOwnedRejected, "A Relic purchase above max_owned must be rejected transactionally.");

  const privileges = await client.query(`
    select
      has_function_privilege('authenticated','public.purchase_shop_entry(uuid)','execute') as legacy,
      has_function_privilege('authenticated','public.purchase_shop_entry(uuid,uuid)','execute') as retry_safe
  `);
  check(!privileges.rows[0].legacy && privileges.rows[0].retry_safe, "Authenticated clients must only execute the retry-safe purchase overload.");

  console.log(`Transactional shop and combat-progress tests passed for Critters ${targetId} and ${combatUnlockTargetId}; all changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
