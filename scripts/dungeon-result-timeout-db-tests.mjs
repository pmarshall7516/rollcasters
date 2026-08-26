import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const setup = createDbClient();
let userId;
let runId;

try {
  await setup.connect();
  await setup.query("begin");

  userId = crypto.randomUUID();
  await setup.query(
    `insert into auth.users(
      id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values($1,'authenticated','authenticated',$2,'{}','{}',now(),now())`,
    [userId, `dungeon-result-timeout-${userId}@example.com`],
  );
  await setup.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await setup.query("select public.ensure_user_game_state()");

  const starterRollcaster = (await setup.query(
    "select rollcaster_id from public.starter_rollcaster_options where is_active order by sort_order,rollcaster_id limit 1",
  )).rows[0]?.rollcaster_id;
  const starterCritter = (await setup.query(
    "select critter_id from public.starter_options where is_active order by sort_order,critter_id limit 1",
  )).rows[0]?.critter_id;
  check(starterRollcaster && starterCritter, "The database needs active starter options.");
  await setup.query("select public.select_starter_rollcaster($1)", [starterRollcaster]);
  await setup.query("select public.select_starter_critter($1)", [starterCritter]);
  const ownedCritterId = (await setup.query(
    "select id from public.user_critters where user_id=$1 and critter_id=$2 limit 1",
    [userId, starterCritter],
  )).rows[0]?.id;
  check(ownedCritterId, "The starter Critter ownership row was not created.");

  const dungeon = (await setup.query(`
    select dungeon.id
    from public.dungeons dungeon
    join public.user_dungeon_progress progress
      on progress.dungeon_id=dungeon.id and progress.user_id=$1 and progress.is_unlocked
    where dungeon.is_active and not dungeon.is_archived
    order by dungeon.id::numeric
    limit 1
  `, [userId])).rows[0];
  check(dungeon?.id, "The database needs an unlocked active Dungeon.");

  const run = (await setup.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, crypto.randomUUID()],
  )).rows[0]?.run;
  check(run?.id, "The test Dungeon run could not be created.");
  runId = run.id;
  await setup.query("commit");

  const progress = createDbClient();
  const result = createDbClient();
  try {
    await progress.connect();
    await progress.query("begin");
    await progress.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    await progress.query(
      "select public.submit_collectible_combat_events($1,$2,$3::jsonb)",
      [runId, 1, JSON.stringify([{
        event_key: `timeout-regression:${runId}`,
        event_type: "deal_damage",
        source_critter_id: starterCritter,
        target_critter_id: run.selectedOpponents[0]?.critter_id,
        skill_id: null,
        amount: 1,
      }])],
    );

    await result.connect();
    await result.query("begin");
    await result.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    await result.query("select set_config('statement_timeout','400ms',true)");

    const startedAt = performance.now();
    let response;
    try {
      response = (await result.query(
        `select public.record_dungeon_battle_result_v2(
          $1,1,'lost',$2::text[],$3::uuid[],$4::jsonb,$5
        ) as result`,
        [runId, [], [], "{}", crypto.randomUUID()],
      )).rows[0]?.result;
    } catch (error) {
      throw new Error(`Battle result timed out while collectible progress was queued: ${error.message}`);
    }
    const elapsedMs = performance.now() - startedAt;
    check(response?.run?.status === "lost", "The result RPC must commit the encounter outcome.");
    check(elapsedMs < 400, `Battle result exceeded the 400 ms readiness budget: ${Math.round(elapsedMs)} ms.`);

    await result.query("rollback");
    await progress.query("rollback");

    await setup.query("begin");
    await setup.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    const terminalRun = (await setup.query(
      "select public.start_dungeon_run_v2($1,$2) as run",
      [run.dungeonId, crypto.randomUUID()],
    )).rows[0]?.run;
    check(terminalRun?.id, "The terminal performance run could not be created.");
    await setup.query("commit");

    await result.query("begin");
    await result.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
    await result.query("select set_config('statement_timeout','2s',true)");
    const terminalStartedAt = performance.now();
    const terminalResponse = (await result.query(
      `select public.record_dungeon_battle_result_v2(
        $1,1,'won',$2::text[],$3::uuid[],$4::jsonb,$5
      ) as result`,
      [
        terminalRun.id,
        terminalRun.selectedOpponents.map((opponent) => opponent.instanceId),
        [ownedCritterId],
        JSON.stringify({ [ownedCritterId]: 1 }),
        crypto.randomUUID(),
      ],
    )).rows[0]?.result;
    const terminalElapsedMs = performance.now() - terminalStartedAt;
    check(terminalResponse?.run?.status === "won", "The terminal result RPC must commit the Dungeon clear.");
    check(terminalElapsedMs < 2_000, `Terminal Dungeon result exceeded the 2 second readiness budget: ${Math.round(terminalElapsedMs)} ms.`);
    await result.query("rollback");

    console.log(JSON.stringify({
      queuedProgressDoesNotBlockResult: true,
      elapsedMs: Math.round(elapsedMs),
      terminalClearUnderTwoSeconds: true,
      terminalElapsedMs: Math.round(terminalElapsedMs),
    }));
  } finally {
    await result.end().catch(() => undefined);
    await progress.end().catch(() => undefined);
  }
} finally {
  await setup.query("rollback").catch(() => undefined);
  if (userId) {
    const cleanup = createDbClient();
    try {
      await cleanup.connect();
      await cleanup.query("delete from auth.users where id=$1", [userId]);
    } finally {
      await cleanup.end().catch(() => undefined);
    }
  }
  await setup.end().catch(() => undefined);
}
