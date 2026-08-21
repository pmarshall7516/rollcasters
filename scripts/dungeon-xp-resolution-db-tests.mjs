import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();

try {
  await client.connect();
  const run = (await client.query("select id from public.dungeon_runs limit 1")).rows[0];
  check(run?.id, "The live database needs at least one Dungeon run for this resolver regression test.");

  const legacy = (await client.query(
    "select public.resolve_dungeon_critter_xp_distribution($1,1,1,$2::uuid[]) as result",
    [run.id, []],
  )).rows[0].result;
  const knockoutAware = (await client.query(
    "select public.resolve_dungeon_critter_xp_distribution($1,1,1,$2::uuid[],$3::uuid[]) as result",
    [run.id, [], []],
  )).rows[0].result;

  check(legacy && typeof legacy === "object" && !Array.isArray(legacy), "The legacy XP resolver must return an object.");
  check(knockoutAware && typeof knockoutAware === "object" && !Array.isArray(knockoutAware), "The knockout-aware XP resolver must return an object.");
  console.log(JSON.stringify({ legacyResolver: true, knockoutAwareResolver: true }));
} finally {
  await client.end().catch(() => undefined);
}
