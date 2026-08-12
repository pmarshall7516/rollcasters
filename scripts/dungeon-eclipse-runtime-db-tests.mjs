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

  const userId = crypto.randomUUID();
  await client.query(`
    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'authenticated','authenticated',$2,'{}','{}',now(),now())
  `, [userId, `eclipse-runtime-${userId}@example.com`]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("select set_config('request.jwt.claim.role','authenticated',true)");
  await client.query("select public.ensure_user_game_state()");

  const abilityColumn = await client.query(`
    select exists(
      select 1 from information_schema.columns
      where table_schema='public' and table_name='dungeon_enemy_rollcaster_abilities'
        and column_name='rollcaster_ability_id'
    ) as present
  `);
  check(abilityColumn.rows[0]?.present === true, "Enemy Rollcaster Ability rows must use the rollcaster_ability_id foreign-key column.");

  const starterRollcaster = (await client.query(`select rollcaster_id from public.starter_rollcaster_options where is_active order by sort_order,rollcaster_id limit 1`)).rows[0]?.rollcaster_id;
  const starterCritter = (await client.query(`select critter_id from public.starter_options where is_active order by sort_order,critter_id limit 1`)).rows[0]?.critter_id;
  check(starterRollcaster && starterCritter, "Active starter options are required for the Eclipse runtime test.");
  await client.query("select public.select_starter_rollcaster($1)", [starterRollcaster]);
  await client.query("select public.select_starter_critter($1)", [starterCritter]);
  const ownedCritterId = (await client.query("select id from public.user_critters where user_id=$1 and critter_id=$2", [userId, starterCritter])).rows[0]?.id;
  check(ownedCritterId, "Starter Critter ownership was not initialized.");

  const requestId = crypto.randomUUID();
  const run = (await client.query("select public.start_dungeon_run_v3('001',$1) payload", [requestId])).rows[0].payload;
  const retried = (await client.query("select public.start_dungeon_run_v3('001',$1) payload", [requestId])).rows[0].payload;
  check(run.id === retried.id, "Retrying v3 run creation must return the original run.");
  check(run.selectedEnemyEncounters.length === run.battleCount, "Every battle must snapshot one enemy Rollcaster encounter.");
  check(new Set(run.selectedEnemyEncounters.map((row) => row.enemyRollcaster.id)).size === run.battleCount, "A run must not repeat an enemy Rollcaster.");
  check(run.selectedEnemyEncounters.every((row) => row.entryLine && row.victoryLine && row.defeatLine), "Every enemy Rollcaster encounter must snapshot all three dialogue moments.");
  check(run.selectedEnemyEncounters[0].enemyRollcaster.ability_ids.length === 1, "Dungeon 001 must equip its progression-balanced first Ability.");
  check(run.selectedOpponents.length === 1, "Dungeon 001's encounter plan must select one enemy Critter.");
  const storedSquad = (await client.query("select squad_snapshot from public.dungeon_runs where id=$1", [run.id])).rows[0]?.squad_snapshot;
  check(storedSquad?.squad?.length === 1, "The temporary player must persist its one-Critter squad snapshot.");

  const resultRequestId = crypto.randomUUID();
  const defeated = run.selectedOpponents.map((row) => row.instanceId);
  const result = (await client.query(
    "select public.record_dungeon_battle_result_v2($1,1,'won',$2::text[],$3::uuid[],$4::jsonb,$5) payload",
    [run.id, defeated, [ownedCritterId], JSON.stringify({ [ownedCritterId]: 1 }), resultRequestId],
  )).rows[0].payload;
  const resultRetry = (await client.query(
    "select public.record_dungeon_battle_result_v2($1,1,'won',$2::text[],$3::uuid[],$4::jsonb,$5) payload",
    [run.id, defeated, [ownedCritterId], JSON.stringify({ [ownedCritterId]: 1 }), resultRequestId],
  )).rows[0].payload;
  check(JSON.stringify(result) === JSON.stringify(resultRetry), "Retrying the v2 Rollcaster result wrapper must be idempotent.");
  const coinRewards = result.battleRewards.entries.filter((entry) => entry.kind === "currency" && entry.targetId === "coins");
  check(coinRewards.length === 1 && coinRewards[0].amount === 7, "Dungeon 001 must award its one 7-Coin enemy Rollcaster drop without duplicating legacy Critter currency.");
  check(result.run.status === "won", "Winning the only encounter must complete the Dungeon run.");

  await client.query("insert into public.user_dungeon_progress(user_id,dungeon_id,is_unlocked,clear_count) values($1,'005',true,0) on conflict(user_id,dungeon_id) do update set is_unlocked=true,clear_count=0", [userId]);
  const bossRun = (await client.query("select public.start_dungeon_run_v3('005',$1) payload", [crypto.randomUUID()])).rows[0].payload;
  check(bossRun.effectiveMode === "boss" && bossRun.selectedEnemyEncounters.length === 1, "An uncleared Boss Dungeon must use its fixed Boss encounter sequence.");
  check(bossRun.selectedOpponents.every((row) => row.pool_type === "boss_order"), "Boss mode must use only fixed Boss Order members.");
  check(bossRun.selectedOpponents.map((row) => row.battlefieldSlot).join(",") === "0,1,2", "Boss squad slots 1–3 must preserve authored lead order.");
  check(bossRun.selectedEnemyEncounters[0].squadMemberInstanceIds.join(",") === bossRun.selectedOpponents.map((row) => row.instanceId).join(","), "Boss encounter metadata must reference its ordered fixed squad.");

  console.log("Eclipse Dungeon runtime passed v3 regular and fixed Boss creation, unique Rollcaster/dialogue snapshots, encounter squad sizing, ordered Boss leads, idempotent results, and non-duplicated Rollcaster rewards; all changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
