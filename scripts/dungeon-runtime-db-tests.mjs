import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectError(client, savepoint, expected, action) {
  await client.query(`savepoint ${savepoint}`);
  let matched = false;
  try {
    await action();
  } catch (error) {
    matched = String(error?.message ?? error).includes(expected);
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  check(matched, `Expected database error ${expected}.`);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const userId = crypto.randomUUID();
  await client.query(`
    insert into auth.users(
      id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values($1,'authenticated','authenticated',$2,'{}','{}',now(),now())
  `, [userId, `dungeon-runtime-${userId}@example.com`]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("select public.ensure_user_game_state()");

  const startFunctionDefinition = (await client.query(`
    select pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='start_dungeon_run_v3'
      and pg_get_function_identity_arguments(p.oid)='p_dungeon_id text, p_request_id uuid'
  `)).rows[0]?.definition ?? "";
  check(
    startFunctionDefinition.includes("release_enemy_rollcasters_for_dungeon")
      && startFunctionDefinition.includes("release_dungeon_rows")
      && !startFunctionDefinition.includes("current_game_catalog_snapshot()"),
    "Dungeon start must use request-scoped release helpers instead of rescanning the full catalog.",
  );

  const starterRollcaster = (await client.query(`
    select rollcaster_id from public.starter_rollcaster_options
    where is_active order by sort_order,rollcaster_id limit 1
  `)).rows[0]?.rollcaster_id;
  const starterCritter = (await client.query(`
    select critter_id from public.starter_options
    where is_active order by sort_order,critter_id limit 1
  `)).rows[0]?.critter_id;
  check(starterRollcaster && starterCritter, "The development catalog needs active starter Rollcaster and Critter options.");
  await client.query("select public.select_starter_rollcaster($1)", [starterRollcaster]);
  await client.query("select public.select_starter_critter($1)", [starterCritter]);

  const owned = (await client.query(`
    select critter.id as user_critter_id,critter.xp as critter_xp,
      rollcaster.id as user_rollcaster_id,rollcaster.xp as rollcaster_xp
    from public.user_critters critter
    join public.profiles profile on profile.user_id=critter.user_id
    join public.user_rollcasters rollcaster on rollcaster.id=profile.active_rollcaster_id
    where critter.user_id=$1 and critter.critter_id=$2
  `, [userId, starterCritter])).rows[0];
  check(owned, "Starter ownership was not initialized.");

  const dungeon = (await client.query(`
    select dungeon.*
    from public.dungeons dungeon
    join public.user_dungeon_progress progress
      on progress.dungeon_id=dungeon.id and progress.user_id=$1 and progress.is_unlocked
    where dungeon.is_active and not dungeon.is_archived
    order by dungeon.id::numeric
    limit 1
  `, [userId])).rows[0];
  check(dungeon, "The player needs an unlocked active Dungeon.");

  const optimizedStartAt = performance.now();
  const optimizedStart = (await client.query(
    "select public.start_dungeon_run_v3($1,$2) as run",
    [dungeon.id, crypto.randomUUID()],
  )).rows[0].run;
  const optimizedStartMs = performance.now() - optimizedStartAt;
  check(
    optimizedStartMs < 2_000,
    `Release-scoped Dungeon start exceeded the 2 second readiness budget: ${Math.round(optimizedStartMs)} ms.`,
  );
  await client.query("select public.resolve_dungeon_run($1)", [optimizedStart.id]);

  const startRequest = crypto.randomUUID();
  const firstStart = (await client.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, startRequest],
  )).rows[0].run;
  const retriedStart = (await client.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, startRequest],
  )).rows[0].run;
  check(firstStart.id === retriedStart.id, "Retrying run creation must return the original run.");
  check(firstStart.effectiveMode === "regular", "The first active regular Dungeon must start in regular mode.");
  check(firstStart.battleFormat === dungeon.battle_format, "The run must snapshot its authored Battle Format.");
  check(firstStart.battleCount === dungeon.battle_count, "The regular run must use authored Battle Count.");
  check(
    firstStart.selectedOpponents.length === firstStart.battleCount * Number(dungeon.battle_format.split("v")[1]),
    "The server must preselect one opponent instance per battle slot.",
  );
  check(
    new Set(firstStart.selectedOpponents.map((opponent) => opponent.instanceId)).size === firstStart.selectedOpponents.length,
    "Every selected opponent needs a unique immutable instance ID.",
  );
  check(
    firstStart.selectedOpponents.every((opponent) =>
      Array.isArray(opponent.skills)
      && Array.isArray(opponent.relics)
      && Array.isArray(opponent.currencyDrops)
      && Array.isArray(opponent.itemDrops)
      && opponent.overrides
    ),
    "Selected opponents must include every normalized combat and reward child.",
  );
  const effectSnapshot = {
    effects: [],
    loadouts: { playerSkillSlots: [], playerAbilitySlots: [], playerRelicSlots: [], opponents: [] },
    statuses: [],
    seed: 1,
  };
  await client.query(
    "select public.snapshot_dungeon_run_effects($1,$2::jsonb)",
    [firstStart.id, JSON.stringify(effectSnapshot)],
  );
  await client.query(
    "select public.snapshot_dungeon_run_effects($1,$2::jsonb)",
    [firstStart.id, JSON.stringify(effectSnapshot)],
  );
  const storedEffectSnapshot = (await client.query(
    "select effect_snapshot from public.dungeon_runs where id=$1",
    [firstStart.id],
  )).rows[0]?.effect_snapshot;
  check(
    storedEffectSnapshot?.seed === effectSnapshot.seed
      && Array.isArray(storedEffectSnapshot?.effects)
      && storedEffectSnapshot.effects.length === 0
      && Array.isArray(storedEffectSnapshot?.statuses)
      && storedEffectSnapshot.statuses.length === 0,
    "A retried identical effect snapshot must remain idempotent.",
  );
  await expectError(client, "conflicting_effect_snapshot", "Effect snapshot already exists", () =>
    client.query(
      "select public.snapshot_dungeon_run_effects($1,$2::jsonb)",
      [firstStart.id, JSON.stringify({ ...effectSnapshot, seed: 2 })],
    ),
  );
  const saveRequest = crypto.randomUUID();
  const savedState = { phase: "event_playback", eventCursor: 0, marker: crypto.randomUUID() };
  const saved = (await client.query(
    "select public.save_dungeon_run_state($1,$2,$3::jsonb,$4) as response",
    [firstStart.id, firstStart.version, JSON.stringify(savedState), saveRequest],
  )).rows[0].response;
  const savedRetry = (await client.query(
    "select public.save_dungeon_run_state($1,$2,$3::jsonb,$4) as response",
    [firstStart.id, firstStart.version, JSON.stringify(savedState), saveRequest],
  )).rows[0].response;
  check(JSON.stringify(saved) === JSON.stringify(savedRetry), "A retried combat-state save must return the exact committed response.");
  check(saved.run.version === firstStart.version + 1, "A combat-state save must advance the optimistic state version once.");
  const activeRun = (await client.query("select public.get_active_dungeon_run_v2() as active")).rows[0].active;
  check(
    activeRun.run.id === firstStart.id
      && activeRun.run.version === saved.run.version
      && activeRun.combatState.phase === savedState.phase
      && activeRun.combatState.eventCursor === savedState.eventCursor
      && activeRun.combatState.marker === savedState.marker,
    "The active-run reader must reconstruct the latest versioned combat state for its owner.",
  );

  await expectError(client, "premature_win", "every opponent must be defeated", () =>
    client.query(
      "select public.record_dungeon_battle_result($1,1,'won',$2::text[],$3::uuid[],$4::jsonb,$5)",
      [firstStart.id, [], [owned.user_critter_id], JSON.stringify({ [owned.user_critter_id]: 1 }), crypto.randomUUID()],
    ),
  );

  let run = saved.run;
  let expectedCritterXp = 0;
  let expectedRollcasterXp = 0;
  let expectedCurrency = 0;
  for (let battleIndex = 1; battleIndex <= run.battleCount; battleIndex += 1) {
    const opponents = run.selectedOpponents.filter((opponent) => opponent.battleIndex === battleIndex);
    expectedCritterXp += opponents.reduce((sum, opponent) => sum + Number(opponent.critter_xp_reward), 0);
    expectedRollcasterXp += opponents.reduce((sum, opponent) => sum + Number(opponent.rollcaster_xp_reward), 0);
    expectedCurrency += opponents.flatMap((opponent) => opponent.currencyDrops)
      .filter((drop) => Number(drop.probability) === 1 && Number(drop.min_amount) === Number(drop.max_amount))
      .reduce((sum, drop) => sum + Number(drop.min_amount), 0);
    const requestId = crypto.randomUUID();
    const args = [
      run.id,
      battleIndex,
      opponents.map((opponent) => opponent.instanceId),
      [owned.user_critter_id],
      JSON.stringify({ [owned.user_critter_id]: Math.max(1, 100 - battleIndex) }),
      requestId,
    ];
    const result = (await client.query(
      "select public.record_dungeon_battle_result($1,$2,'won',$3::text[],$4::uuid[],$5::jsonb,$6) as result",
      args,
    )).rows[0].result;
    const retry = (await client.query(
      "select public.record_dungeon_battle_result($1,$2,'won',$3::text[],$4::uuid[],$5::jsonb,$6) as result",
      args,
    )).rows[0].result;
    check(JSON.stringify(result) === JSON.stringify(retry), "A retried battle command must return the exact committed response.");
    check(
      result.battleRewards.defeatedOpponentInstanceIds.length === opponents.length,
      "Each encounter must journal exactly its defeated opponent instances.",
    );
    run = result.run;
    if (battleIndex < run.battleCount) {
      check(run.status === "started" && run.battleIndex === battleIndex + 1, "A non-final win must advance exactly one encounter.");
    }
  }

  check(run.status === "won", "The final encounter must complete the Dungeon.");
  const final = (await client.query(`
    select
      (select xp from public.user_critters where id=$2) as critter_xp,
      (select xp from public.user_rollcasters where id=$3) as rollcaster_xp,
      (select balance::text from public.user_currencies where user_id=$1 and currency_id='coins') as coins,
      (select clear_count from public.user_dungeon_progress where user_id=$1 and dungeon_id=$4) as clear_count,
      (select count(*)::int from public.user_dungeon_progress progress
       join public.dungeons next on next.id=progress.dungeon_id
       where progress.user_id=$1 and progress.is_unlocked and progress.dungeon_id<>$4) as later_unlocked
  `, [userId, owned.user_critter_id, owned.user_rollcaster_id, dungeon.id])).rows[0];
  check(final.critter_xp === owned.critter_xp + expectedCritterXp, "Critter XP must be awarded once to the participating Critter.");
  check(final.rollcaster_xp === owned.rollcaster_xp + expectedRollcasterXp, "The active Rollcaster must receive the full defeated-opponent XP sum.");
  check(Number(final.coins) >= expectedCurrency, "Guaranteed normalized Currency drops must reach the player ledger.");
  check(final.clear_count === 1, "A final win must increment the Dungeon clear count once.");
  if (dungeon.next_dungeon_id) {
    check(final.later_unlocked >= 1, "A valid active Next Dungeon must unlock on first clear.");
  }

  const lossRun = (await client.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, crypto.randomUUID()],
  )).rows[0].run;
  const lossOpponents = lossRun.selectedOpponents.filter((opponent) => opponent.battleIndex === 1);
  const loss = (await client.query(
    "select public.record_dungeon_battle_result($1,1,'lost',$2::text[],$3::uuid[],$4::jsonb,$5) as result",
    [
      lossRun.id,
      lossOpponents.map((opponent) => opponent.instanceId),
      [owned.user_critter_id],
      JSON.stringify({ [owned.user_critter_id]: 0 }),
      crypto.randomUUID(),
    ],
  )).rows[0].result;
  check(loss.run.status === "lost", "A failed encounter must fail the run without clearing the Dungeon.");
  check(
    loss.battleRewards.defeatedOpponentInstanceIds.length === lossOpponents.length
      && !loss.battleRewards.entries.some((entry) => entry.kind === "critter_xp"),
    "Defeated-opponent drops must remain committed while Critter XP is withheld when the entire squad is knocked out.",
  );

  const emptyLossRun = (await client.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, crypto.randomUUID()],
  )).rows[0].run;
  const emptyLoss = (await client.query(
    "select public.record_dungeon_battle_result($1,1,'lost',$2::text[],$3::uuid[],$4::jsonb,$5) as result",
    [
      emptyLossRun.id,
      [],
      [owned.user_critter_id],
      JSON.stringify({ [owned.user_critter_id]: 0 }),
      crypto.randomUUID(),
    ],
  )).rows[0].result;
  check(
    emptyLoss.battleRewards.entries.length === 0,
    `A loss with no defeated opponents must grant no opponent rewards. Received: ${JSON.stringify(emptyLoss.battleRewards)}`,
  );

  const abandonRun = (await client.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, crypto.randomUUID()],
  )).rows[0].run;
  await client.query("select public.resolve_dungeon_run($1)", [abandonRun.id]);
  const abandoned = (await client.query(
    "select status,combat_state,effect_snapshot,resolved_at from public.dungeon_runs where id=$1",
    [abandonRun.id],
  )).rows[0];
  check(
    abandoned.status === "abandoned"
      && JSON.stringify(abandoned.combat_state) === "{}"
      && abandoned.effect_snapshot === null
      && abandoned.resolved_at !== null,
    "Abandoning an unfinished run must clear resumable state without granting rewards.",
  );
  check(
    (await client.query("select public.get_active_dungeon_run_v2() as active")).rows[0].active === null,
    "An abandoned Dungeon run must no longer be returned as active.",
  );

  const supersededRun = (await client.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, crypto.randomUUID()],
  )).rows[0].run;
  const replacementRun = (await client.query(
    "select public.start_dungeon_run_v2($1,$2) as run",
    [dungeon.id, crypto.randomUUID()],
  )).rows[0].run;
  const activeRunRows = (await client.query(
    "select id,status from public.dungeon_runs where user_id=$1 and status='started' order by started_at,id",
    [userId],
  )).rows;
  check(
    activeRunRows.length === 1 && activeRunRows[0].id === replacementRun.id,
    "Starting a new Dungeon must replace the previous active run instead of leaving multiple resumable rows.",
  );
  const supersededStatus = (await client.query(
    "select status from public.dungeon_runs where id=$1",
    [supersededRun.id],
  )).rows[0]?.status;
  check(supersededStatus === "abandoned", "Replacing an active Dungeon must abandon the superseded run.");
  await client.query("select public.resolve_dungeon_run($1)", [replacementRun.id]);
  check(
    (await client.query("select count(*)::int as count from public.dungeon_runs where user_id=$1 and status='started'", [userId])).rows[0].count === 0,
    "Abandoning the current Dungeon must clear every stale active row for the player.",
  );

  const executePrivileges = (await client.query(`
    select
      has_function_privilege('anon','public.start_dungeon_run_v2(text,uuid)','execute') as anon_start,
      has_function_privilege('authenticated','public.start_dungeon_run_v2(text,uuid)','execute') as authenticated_start,
      has_function_privilege('anon','public.record_dungeon_battle_result(uuid,integer,text,text[],uuid[],jsonb,uuid)','execute') as anon_result,
      has_function_privilege('authenticated','public.record_dungeon_battle_result(uuid,integer,text,text[],uuid[],jsonb,uuid)','execute') as authenticated_result,
      has_function_privilege('anon','public.save_dungeon_run_state(uuid,integer,jsonb,uuid)','execute') as anon_save,
      has_function_privilege('authenticated','public.save_dungeon_run_state(uuid,integer,jsonb,uuid)','execute') as authenticated_save,
      has_function_privilege('anon','public.get_active_dungeon_run_v2()','execute') as anon_resume,
      has_function_privilege('authenticated','public.get_active_dungeon_run_v2()','execute') as authenticated_resume,
      has_function_privilege('anon','public.resolve_dungeon_run(uuid)','execute') as anon_abandon,
      has_function_privilege('authenticated','public.resolve_dungeon_run(uuid)','execute') as authenticated_abandon
  `)).rows[0];
  check(
    !executePrivileges.anon_start
      && !executePrivileges.anon_result
      && !executePrivileges.anon_save
      && !executePrivileges.anon_resume
      && !executePrivileges.anon_abandon,
    "Anonymous callers must not execute Dungeon runtime or resume RPCs.",
  );
  check(
    executePrivileges.authenticated_start
      && executePrivileges.authenticated_result
      && executePrivileges.authenticated_save
      && executePrivileges.authenticated_resume
      && executePrivileges.authenticated_abandon,
    "Authenticated players need Dungeon runtime and resume RPCs.",
  );

  console.log("Dungeon runtime migration passed run creation, immutable encounter snapshots, versioned resume state, abandon handling, retry safety, per-battle XP/drops, completion, unlock, and failure checks; all changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
