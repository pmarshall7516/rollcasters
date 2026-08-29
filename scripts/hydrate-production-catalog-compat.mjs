import crypto from 'node:crypto'
import { createDbClient, readEnv } from './db-utils.mjs'

const env = readEnv()
const db = createDbClient(process.env.TARGET_DB_URL
  ? { ...env, SUPABASE_DB_URL: process.env.TARGET_DB_URL, SUPABASE_DB_SSL: process.env.TARGET_DB_SSL ?? 'false' }
  : env)
const releaseId = '2026.08.26.2'

const snapshotTables = {
  elements: 'elements', currencies: 'currencies', skills: 'skills', abilities: 'rollcaster_abilities',
  relics: 'relics', statuses: 'statuses', critters: 'critters', critterLevels: 'critter_level_progression',
  critterUnlocks: 'critter_skill_unlocks', rollcasters: 'rollcasters', rollcasterLevels: 'rollcaster_level_progression',
  rollcasterUnlocks: 'rollcaster_ability_unlocks', collectRequirements: 'collectible_unlock_requirements',
  unlockChallengeTemplates: 'unlock_challenge_templates', collectChallenges: 'collectible_unlock_challenges',
  shopProducts: 'shop_entries', lootboxes: 'lootboxes', lootboxPoolEntries: 'lootbox_pool_entries',
  dungeons: 'dungeons', dungeonOpponents: 'dungeon_opponents', dungeonEnemyRollcasters: 'dungeon_enemy_rollcasters',
  enemyRollcasterAbilities: 'dungeon_enemy_rollcaster_abilities', enemyRollcasterDialogue: 'dungeon_enemy_rollcaster_dialogue',
  enemyRollcasterCurrencyDrops: 'dungeon_enemy_rollcaster_currency_drops', enemyRollcasterItemDrops: 'dungeon_enemy_rollcaster_item_drops',
  dungeonRegularEncounters: 'dungeon_regular_encounters', dungeonBossEncounters: 'dungeon_boss_encounters',
  opponentSkills: 'dungeon_opponent_skills', opponentRelics: 'dungeon_opponent_relics', opponentOverrides: 'dungeon_opponent_stat_overrides',
  opponentCurrencyDrops: 'dungeon_opponent_currency_drops', opponentItemDrops: 'dungeon_opponent_item_drops',
  completionDrops: 'dungeon_completion_drops', starterRollcasterOptions: 'starter_rollcaster_options', starterOptions: 'starter_options',
  gameAssets: 'game_assets',
}

function quote(value) { return `"${String(value).replaceAll('"', '""')}"` }
function stableUuid(value) {
  const bytes = crypto.createHash('sha256').update(String(value)).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function insertRows(table, inputRows) {
  const columns = (await db.query(`
    select column_name,data_type from information_schema.columns
    where table_schema='public' and table_name=$1 and is_generated='NEVER' and is_identity='NO'
    order by ordinal_position
  `, [table])).rows
  if (!columns.length) return 0
  const types = new Map(columns.map((column) => [column.column_name, column.data_type]))
  const primary = (await db.query(`
    select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
    join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=$1 and i.indisprimary order by array_position(i.indkey,a.attnum)
  `, [table])).rows.map((row) => row.attname)
  const names = [...new Set(inputRows.flatMap((row) => Object.keys(row)))].filter((name) => types.has(name))
  if (!names.length) return 0
  const updates = names.filter((name) => !primary.includes(name))
  const conflict = primary.length && primary.every((name) => names.includes(name))
    ? updates.length
      ? ` on conflict (${primary.map(quote).join(',')}) do update set ${updates.map((name) => `${quote(name)}=excluded.${quote(name)}`).join(',')}`
      : ` on conflict (${primary.map(quote).join(',')}) do nothing`
    : ''
  let count = 0
  for (let offset = 0; offset < inputRows.length; offset += 200) {
    const batch = inputRows.slice(offset, offset + 200)
    const values = batch.flatMap((row) => names.map((name) => ['json', 'jsonb'].includes(types.get(name))
      ? row[name] == null ? null : JSON.stringify(row[name]) : row[name]))
    const rowPlaceholders = batch.map((_, rowIndex) => `(${names.map((_, columnIndex) => `$${rowIndex * names.length + columnIndex + 1}`).join(',')})`).join(',')
    await db.query(`insert into public.${quote(table)} (${names.map(quote).join(',')}) values ${rowPlaceholders}${conflict}`, values)
    count += batch.length
  }
  return count
}

await db.connect()
try {
  const release = (await db.query('select snapshot,snapshot_hash from public.content_release_snapshots where release_id=$1', [releaseId])).rows[0]
  if (!release?.snapshot) throw new Error(`Production release ${releaseId} has no immutable snapshot.`)
  const snapshot = release.snapshot
  const profileCountBefore = Number((await db.query('select count(*)::int as count from public.profiles')).rows[0].count)
  await db.query('set session_replication_role = replica')
  let imported = 0
  for (const [key, table] of Object.entries(snapshotTables)) {
    const rows = (Array.isArray(snapshot[key]) ? snapshot[key] : []).map((row) => {
      if (typeof row.id !== 'string' || !row.id.includes(':')) return row
      const parts = row.id.split(':')
      const uuid = parts.find((part) => /^[0-9a-f-]{36}$/i.test(part))
      if (!uuid) return row
      return {
        ...row,
        ...(key === 'completionDrops' && !row.dungeon_id ? { dungeon_id: parts[0] } : {}),
        id: key === 'gameAssets' ? stableUuid(row.id) : uuid,
      }
    })
    imported += await insertRows(table, rows)
  }
  for (const [key, table, ownerType] of [
    ['effectsBySkill', 'skill_effects', 'skill'], ['effectsByAbility', 'ability_effects', 'ability'],
    ['effectsByRelic', 'relic_effects', 'relic'], ['effectsByStatus', 'status_effects', 'status'],
  ]) {
    const rows = Object.entries(snapshot[key] || {}).flatMap(([ownerId, effects]) => effects.map((row) => ({
      [`${ownerType}_id`]: ownerId, id: row.id, name: row.name, description: row.description,
      template_id: row.templateId, parameters: row.parameters, sort_order: row.sortOrder,
      classification: row.classification, execution: row.execution,
    })))
    imported += await insertRows(table, rows)
  }
  await db.query('set session_replication_role = origin')
  const counts = (await db.query(`
    select (select count(*) from public.critters)::int critters,
      (select count(*) from public.dungeons)::int dungeons,
      (select count(*) from public.collectible_unlock_challenges)::int challenges,
      (select count(*) from public.game_assets)::int assets,
      (select count(*) from public.profiles)::int profiles
  `)).rows[0]
  if (counts.profiles !== profileCountBefore) throw new Error('Production player rows changed during catalog compatibility hydration.')
  console.log(JSON.stringify({ releaseId, snapshotHash: release.snapshot_hash, imported, counts }, null, 2))
} finally {
  await db.query('set session_replication_role = origin').catch(() => undefined)
  await db.end().catch(() => undefined)
}
