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

  const release = (await client.query("select public.current_game_catalog_release_id() as id")).rows[0]?.id;
  check(release, "A published production release is required.");

  const snapshotEffect = (
    await client.query(
      "select parameters from public.release_combat_effects_v2($1) where owner_type='relic' and owner_id='019' and runtime_kind='critter_xp_modifier'",
      [release],
    )
  ).rows[0]?.parameters;
  const liveEffect = (
    await client.query(
      "select parameters from public.combat_effects_v1 where owner_type='relic' and owner_id='019' and runtime_kind='critter_xp_modifier'",
    )
  ).rows[0]?.parameters;
  check(Number(snapshotEffect?.modifier_value) === 0.25, "The published Essence Canister snapshot should remain at 25%.");
  check(Number(liveEffect?.modifier_value) === 0.5, "The fixture must retain the unpublished 50% authoring edit.");

  const run = (await client.query("select id from public.dungeon_runs order by started_at desc nulls last limit 1")).rows[0];
  check(run, "A Dungeon run is required for the rollback-safe XP regression.");
  const userCritterId = crypto.randomUUID();
  await client.query(
    `update public.dungeon_runs
     set catalog_release_id=$2,
         random_seed=coalesce(random_seed,42),
         squad_snapshot=$3::jsonb
     where id=$1`,
    [
      run.id,
      release,
      JSON.stringify({
        activeRollcasterId: null,
        squad: [{ slotIndex: 1, userCritterId, critterId: "001", relicIds: ["019"] }],
      }),
    ],
  );

  const result = (
    await client.query(
      "select public.resolve_dungeon_critter_xp_distribution($1,1,100,$2::uuid[]) as result",
      [run.id, [userCritterId]],
    )
  ).rows[0].result;
  check(Number(result?.[userCritterId]) === 125, "Dungeon XP must use the released 25% Essence Canister value.");

  await client.query("rollback");
  began = false;
  console.log("Release content lockdown DB regression passed; fixture changes were rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
