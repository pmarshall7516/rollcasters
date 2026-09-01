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
const forbiddenCatalogTables = [
  "ability_effects", "collectible_unlock_challenges", "collectible_unlock_requirements",
  "content_tags", "critter_level_progression", "critter_skill_unlocks",
  "critter_tag_assignments", "critters", "currencies", "dungeon_boss_encounter_members",
  "dungeon_boss_encounters", "dungeon_completion_drops", "dungeon_enemy_rollcaster_abilities",
  "dungeon_enemy_rollcaster_currency_drops", "dungeon_enemy_rollcaster_dialogue",
  "dungeon_enemy_rollcaster_item_drops", "dungeon_enemy_rollcasters",
  "dungeon_opponent_currency_drops", "dungeon_opponent_item_drops", "dungeon_opponent_relics",
  "dungeon_opponent_rewards", "dungeon_opponent_skills", "dungeon_opponent_stat_overrides",
  "dungeon_opponents", "dungeon_regular_encounters", "dungeons", "effect_templates",
  "element_chart_config", "element_effectiveness", "elements", "game_assets",
  "lootbox_pool_entries", "lootboxes", "relic_effects", "relics",
  "rollcaster_ability_families", "rollcaster_ability_unlocks", "rollcaster_abilities",
  "rollcaster_level_progression", "rollcasters", "shop_entries", "skill_effects",
  "skill_tag_assignments", "skills", "starter_options", "starter_rollcaster_options",
  "status_effects", "statuses", "unlock_challenge_templates",
];

try {
  await client.connect();
  const tables = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])`,
    [requiredTables],
  );
  assert.deepEqual(new Set(tables.rows.map((row) => row.table_name)), new Set(requiredTables));

  const forbidden = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' and table_name = any($1::text[])`,
    [forbiddenCatalogTables],
  );
  assert.deepEqual(
    forbidden.rows.map((row) => row.table_name),
    [],
    "Local Game-state DB must not contain copied Catalog authoring tables.",
  );

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
const bootstrap = fs.readFileSync(new URL("./bootstrap-local-player-db.mjs", import.meta.url), "utf8");
assert.doesNotMatch(bootstrap, /const catalogTables\s*=/, "Local Game bootstrap must not define a copied Catalog table list.");
assert.match(bootstrap, /releaseInfrastructureTables/, "Local Game bootstrap must retain release infrastructure explicitly.");
assert.doesNotMatch(bootstrap, /catalogRowsCopied/, "Local Game bootstrap output must not claim Catalog rows are copied.");
console.log("Local player schema contract passed.");
