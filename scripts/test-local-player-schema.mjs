import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { parseEnv } from "./db-utils.mjs";

const env = { ...parseEnv(), ...process.env };
const connectionString = env.LOCAL_PLAYER_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const client = new pg.Client({ connectionString, ssl: false });
const requiredTables = [
  "profiles",
  "user_currencies",
  "user_rollcasters",
  "user_critters",
  "user_dungeon_progress",
  "dungeon_runs",
  "dungeon_run_commands",
  "player_game_sessions",
  "player_mutation_ledger",
];
const requiredFunctions = [
  "player_bootstrap_v1",
  "acquire_gameplay_session",
  "release_gameplay_session",
];

try {
  await client.connect();
  const tables = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])`,
    [requiredTables],
  );
  assert.deepEqual(new Set(tables.rows.map((row) => row.table_name)), new Set(requiredTables));

  const functions = await client.query(
    `select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1::text[])`,
    [requiredFunctions],
  );
  assert.deepEqual(new Set(functions.rows.map((row) => row.proname)), new Set(requiredFunctions));

  const release = await client.query(
    "select current_release_id from public.content_release_channels where channel='production'",
  );
  assert.equal(release.rows[0]?.current_release_id, "2026.08.26.2");
  const update = await client.query(`
    select version,catalog_release_id from public.game_updates
    where id=(select active_update_id from public.game_update_policy where singleton)
  `);
  assert.equal(update.rows[0]?.version, "1.0.8");
  assert.equal(update.rows[0]?.catalog_release_id, release.rows[0]?.current_release_id);

  const playerRows = await client.query("select count(*)::int as count from public.profiles");
  assert.equal(playerRows.rows[0].count, 0, "Player bootstrap must not copy Production player profiles.");
} finally {
  await client.end().catch(() => undefined);
}

const config = fs.readFileSync(path.join(process.cwd(), "supabase", "config.toml"), "utf8");
assert.match(config, /project_id\s*=\s*["']rollcasters-local-player["']/);
assert.match(config, /enabled\s*=\s*false/);
console.log("Local player schema contract passed.");
