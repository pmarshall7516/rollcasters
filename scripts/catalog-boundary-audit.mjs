import pg from "pg";
import { createDbClient, readEnv } from "./db-utils.mjs";

const env = readEnv();
const localPlayerUrl = env.LOCAL_PLAYER_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const catalogUrl = env.CATALOG_DB_URL ?? "postgresql://postgres:rollcasters-local-only@127.0.0.1:55432/rollcasters_catalog";
const catalogTables = [
  "ability_effects", "collectible_unlock_challenges", "collectible_unlock_requirements", "content_tags",
  "critter_level_progression", "critter_skill_unlocks", "critter_tag_assignments", "critters", "currencies",
  "dungeon_boss_encounter_members", "dungeon_boss_encounters", "dungeon_completion_drops",
  "dungeon_enemy_rollcaster_abilities", "dungeon_enemy_rollcaster_currency_drops", "dungeon_enemy_rollcaster_dialogue",
  "dungeon_enemy_rollcaster_item_drops", "dungeon_enemy_rollcasters", "dungeon_opponent_currency_drops",
  "dungeon_opponent_item_drops", "dungeon_opponent_relics", "dungeon_opponent_rewards", "dungeon_opponent_skills",
  "dungeon_opponent_stat_overrides", "dungeon_opponents", "dungeon_regular_encounters", "dungeons",
  "effect_templates", "element_chart_config", "element_effectiveness", "elements", "game_assets",
  "lootbox_pool_entries", "lootboxes", "relic_effects", "relics", "rollcaster_ability_families",
  "rollcaster_ability_unlocks", "rollcaster_abilities", "rollcaster_level_progression", "rollcasters",
  "shop_entries", "skill_effects", "skill_tag_assignments", "skills", "starter_options",
  "starter_rollcaster_options", "status_effects", "statuses", "unlock_challenge_templates",
];

async function audit(name, client) {
  await client.connect();
  try {
    const relations = await client.query(`
      select table_name,table_type
      from information_schema.tables
      where table_schema='public' and table_name=any($1::text[])
      order by table_name
    `, [catalogTables]);
    const counts = await client.query(`
      select
        (select count(*)::int from public.content_release_snapshots) as snapshots,
        (select count(*)::int from public.content_releases) as releases,
        (select count(*)::int from public.profiles) as profiles
    `).catch(() => ({ rows: [{ snapshots: null, releases: null, profiles: null }] }));
    return {
      database: name,
      catalogRelations: relations.rows,
      catalogBaseTableCount: relations.rows.filter((row) => row.table_type === "BASE TABLE").length,
      releaseAndPlayerCounts: counts.rows[0],
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const results = [];
results.push(await audit("Production", createDbClient(env)));
results.push(await audit("Local Game", new pg.Client({ connectionString: localPlayerUrl, ssl: false })));
results.push(await audit("Local Catalog", new pg.Client({ connectionString: catalogUrl, ssl: false })));
console.log(JSON.stringify(results, null, 2));
