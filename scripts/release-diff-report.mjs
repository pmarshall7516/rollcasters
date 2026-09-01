import pg from "pg";

const fromId = process.argv.find((arg) => arg.startsWith("--from="))?.slice(7) ?? "2026.08.01.1";
const toId = process.argv.find((arg) => arg.startsWith("--to="))?.slice(5) ?? "2026.08.05.2";
const connectionString = process.env.DB_CONNECTION_STRING;
if (!connectionString) throw new Error("DB_CONNECTION_STRING is required.");

const db = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await db.connect();
const result = await db.query(
  "select release_id,snapshot_hash,snapshot from public.content_release_snapshots where release_id = any($1::text[])",
  [[fromid-toid]],
);
await db.end();
const snapshots = new Map(result.rows.map((row) => [row.release_id, row]));
if (!snapshots.has(fromId) || !snapshots.has(toId)) throw new Error(`Missing snapshot for ${fromId} or ${toId}.`);

const before = snapshots.get(fromId).snapshot;
const after = snapshots.get(toId).snapshot;
const summaryOnly = process.argv.includes("--summary");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function keyFor(category, row) {
  if (["critterUnlocks", "rollcasterUnlocks", "critterLevels", "rollcasterLevels", "collectRequirements"].includes(category)) {
    return `${row.critter_id ?? row.rollcaster_id ?? row.collectible_type}:${row.level ?? row.skill_id ?? row.ability_id ?? row.collectible_id}`;
  }
  if (category === "combatEffects") return `${row.owner_type}:${row.owner_id}:${row.id}`;
  if (category === "elementEffectiveness") return `${row.attacking_element_id}:${row.defending_element_id}`;
  if (category === "shopProducts") return `${row.shop_type}:${row.id}`;
  return String(row.id);
}

function ownerLabel(row) {
  return row.owner_type ? `${row.owner_type}:${row.owner_id} — ${row.name}` : `${row.id} — ${row.name ?? ""}`;
}

function compact(value) {
  return JSON.stringify(value, null, 2);
}

const categories = [
  "critters", "skills", "relics", "abilities", "rollcasters", "lootboxes", "shopProducts",
  "lootboxPoolEntries", "combatEffects", "skillEffects", "abilityEffects", "relicEffects",
  "critterLevels", "critterUnlocks", "rollcasterLevels", "rollcasterUnlocks", "collectChallenges",
  "collectRequirements", "assets", "dungeons", "dungeonOpponents", "completionDrops",
  "opponentItemDrops", "opponentCurrencyDrops", "effecttemplates", "unlockChallengetemplates",
];

console.log(`# Release diff ${fromId} → ${toId}`);
console.log(`\nSnapshot hashes: ${fromId}=${snapshots.get(fromId).snapshot_hash}, ${toId}=${snapshots.get(toId).snapshot_hash}`);
for (const category of categories) {
  const beforeRows = Array.isArray(before[category]) ? before[category] : [];
  const afterRows = Array.isArray(after[category]) ? after[category] : [];
  const oldMap = new Map(beforeRows.map((row) => [keyFor(category, row), row]));
  const newMap = new Map(afterRows.map((row) => [keyFor(category, row), row]));
  const added = [...newMap.keys()].filter((key) => !oldMap.has(key));
  const removed = [...oldMap.keys()].filter((key) => !newMap.has(key));
  const changed = [...newMap.keys()].filter((key) => oldMap.has(key) && JSON.stringify(stable(oldMap.get(key))) !== JSON.stringify(stable(newMap.get(key))));
  if (!added.length && !removed.length && !changed.length) continue;
  if (summaryOnly) {
    const label = (row) => row.owner_type ? `${row.owner_type}:${row.owner_id}/${row.name}` : `${row.name ?? row.id}`;
    console.log(`${category}: ${beforeRows.length} → ${afterRows.length}`);
    if (added.length) console.log(`  added: ${added.map((key) => label(newMap.get(key))).join(" | ")}`);
    if (removed.length) console.log(`  removed: ${removed.map((key) => label(oldMap.get(key))).join(" | ")}`);
    for (const key of changed) {
      const oldRow = oldMap.get(key);
      const newRow = newMap.get(key);
      const fields = [...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])].filter((field) => JSON.stringify(stable(oldRow[field])) !== JSON.stringify(stable(newRow[field])));
      console.log(`  changed: ${label(newRow)} [${fields.join(", ")}]`);
    }
    continue;
  }
  console.log(`\n## ${category} (${beforeRows.length} → ${afterRows.length})`);
  if (added.length) {
    console.log(`\n### Added (${added.length})`);
    for (const key of added) console.log(`\n#### ${key}\n${compact(newMap.get(key))}`);
  }
  if (removed.length) console.log(`\n### Removed (${removed.length})\n${removed.map((key) => `- ${key}`).join("\n")}`);
  if (changed.length) {
    console.log(`\n### Changed (${changed.length})`);
    for (const key of changed) {
      const oldRow = oldMap.get(key);
      const newRow = newMap.get(key);
      const fields = [...new Set([...Object.keys(oldRow), ...Object.keys(newRow)])].filter((field) => JSON.stringify(stable(oldRow[field])) !== JSON.stringify(stable(newRow[field])));
      console.log(`\n#### ${ownerLabel(newRow)}\nChanged fields: ${fields.join(", ")}`);
      for (const field of fields) console.log(`- ${field}: ${compact(oldRow[field])} → ${compact(newRow[field])}`);
    }
  }
}
