import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogDbClient, parseEnv } from "../../rollcaster-dev/scripts/db-utils.mjs";
import { buildGameCatalog, validateSnapshot } from "../../rollcaster-dev/scripts/catalog-release-core.mjs";
import { groupCombatEffectRows } from "../src/lib/effects.ts";
import {
  createInitialCombatState,
  resolveCombatActions,
  simApplyStatus,
  skillTargets,
} from "../src/lib/game.ts";

const RELEASE_ID = "2026.09.10.1";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function makePlayer(catalog, skillId, abilityId, relicId) {
  const ownedCritters = catalog.critters.slice(0, 3).map((critter, index) => ({
    id: `cert-critter-${index + 1}`,
    user_id: "cert-user",
    critter_id: critter.id,
    level: 99,
    xp: 0,
    skill_points: 0,
  }));
  const ownedRollcaster = {
    id: "cert-rollcaster",
    user_id: "cert-user",
    rollcaster_id: catalog.rollcasters[0]?.id,
    level: 99,
    xp: 0,
    ability_points: 0,
  };
  return {
    profile: {
      user_id: "cert-user",
      username: "certification",
      coins: 0,
      starter_rollcaster_selected_at: "certification",
      starter_selected_at: "certification",
      active_rollcaster_id: ownedRollcaster.id,
    },
    rollcasters: [ownedRollcaster],
    critters: ownedCritters,
    relicInventory: relicId ? [{ user_id: "cert-user", relic_id: relicId, quantity: 1, discovered_at: "certification" }] : [],
    squadSlots: ownedCritters.map((critter, index) => ({ user_id: "cert-user", slot_index: index + 1, user_critter_id: critter.id })),
    skillSlots: skillId ? [{ user_critter_id: ownedCritters[0]?.id, slot_index: 1, skill_id: skillId }] : [],
    abilitySlots: abilityId ? [{ user_rollcaster_id: ownedRollcaster.id, slot_index: 1, ability_id: abilityId }] : [],
    relicSlots: relicId ? [{ user_critter_id: ownedCritters[0]?.id, slot_index: 1, relic_id: relicId }] : [],
    unlockedSkillIdsByCritter: {},
    unlockedAbilityIdsByRollcaster: {},
    dungeonProgress: [],
    collectibleSnapshot: {
      currencies: [],
      shards: [],
      lootboxes: [],
      progress: [],
      tracked: [],
      unlock_events: [],
      unlocked_collectibles: [],
    },
  };
}

function firstDungeonAndOpponents(catalog) {
  const dungeon = catalog.dungeons.find((candidate) => catalog.dungeonOpponents.some((opponent) => opponent.dungeon_id === candidate.id));
  check(dungeon, "Catalog must contain a dungeon with at least one opponent for combat certification.");
  const available = catalog.dungeonOpponents.filter((opponent) => opponent.dungeon_id === dungeon.id);
  check(available.length > 0, `Dungeon ${dungeon.id} must have opponents for combat certification.`);
  const count = Math.max(1, dungeon.opponent_active_count ?? 1);
  return {
    dungeon,
    opponents: Array.from({ length: count }, (_, index) => available[index % available.length]),
  };
}

async function readRelease() {
  const devRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../rollcaster-dev");
  const db = createCatalogDbClient({ ...parseEnv(path.join(devRoot, ".env")), ...process.env });
  await db.connect();
  try {
    const release = (await db.query("select id,status from public.content_releases where id=$1", [RELEASE_ID])).rows[0];
    check(release, `Catalog Release ${RELEASE_ID} does not exist in the local Content Studio database.`);
    check(release.status === "published", `Catalog Release ${RELEASE_ID} must be published before certification; found ${release.status}.`);
    const snapshot = (await db.query("select snapshot from public.content_release_snapshots where release_id=$1", [RELEASE_ID])).rows[0]?.snapshot;
    check(snapshot, `Catalog Release ${RELEASE_ID} has no immutable snapshot.`);
    return snapshot;
  } finally {
    await db.end();
  }
}

const snapshot = await readRelease();
const releaseValidation = validateSnapshot(snapshot);
check(releaseValidation.errors.length === 0, `Catalog Release ${RELEASE_ID} has validation errors: ${releaseValidation.errors.join(" | ")}`);

const groupedRows = groupCombatEffectRows(snapshot.combatEffects);
const effectCount = snapshot.combatEffects.length;
check(effectCount === 292, `Catalog Release ${RELEASE_ID} expected 292 combat Effects, found ${effectCount}.`);
const catalog = buildGameCatalog(snapshot, { entries: [] }, new Date().toISOString());
const { dungeon, opponents } = firstDungeonAndOpponents(catalog);
const failures = [];
const covered = { skill: new Set(), ability: new Set(), relic: new Set(), status: new Set() };

for (const [ownerType, effectsByOwner] of Object.entries(groupedRows)) {
  for (const ownerId of Object.keys(effectsByOwner)) {
    check(effectsByOwner[ownerId].every((effect) => effect.ownerType === ownerType && effect.ownerId === ownerId), `Effect ownership metadata drifted for ${ownerType}:${ownerId}.`);
  }
}

for (const skill of catalog.skills) {
  if (!(catalog.effectsBySkill[skill.id] ?? []).length) continue;
  try {
    const state = createInitialCombatState(catalog, makePlayer(catalog, skill.id), dungeon, `effect-cert:${skill.id}`, opponents);
    const actor = state.playerUnits[0];
    const targets = skillTargets(state, actor.key, actor.skills.find((candidate) => candidate.id === skill.id));
    check(targets.length > 0, `Skill ${skill.id} has no valid target in the certification battle.`);
    resolveCombatActions(
      { ...state, phase: "selecting", playerMana: 1_000_000, opponentMana: 0 },
      [{ actorKey: actor.key, type: "skill", skillId: skill.id, targetKey: targets[0].key, cost: 0 }],
      [],
    );
    covered.skill.add(skill.id);
  } catch (error) {
    failures.push(`skill:${skill.id}: ${String(error)}`);
  }
}

for (const ability of catalog.rollcasterAbilities) {
  if (!(catalog.effectsByAbility[ability.id] ?? []).length) continue;
  try {
    createInitialCombatState(catalog, makePlayer(catalog, undefined, ability.id), dungeon, `effect-cert:${ability.id}`, opponents);
    covered.ability.add(ability.id);
  } catch (error) {
    failures.push(`ability:${ability.id}: ${String(error)}`);
  }
}

for (const relic of catalog.relics) {
  if (!(catalog.effectsByRelic[relic.id] ?? []).length) continue;
  try {
    createInitialCombatState(catalog, makePlayer(catalog, undefined, undefined, relic.id), dungeon, `effect-cert:${relic.id}`, opponents);
    covered.relic.add(relic.id);
  } catch (error) {
    failures.push(`relic:${relic.id}: ${String(error)}`);
  }
}

for (const status of catalog.statuses) {
  if (!(catalog.effectsByStatus[status.id] ?? []).length) continue;
  try {
    const state = createInitialCombatState(catalog, makePlayer(catalog), dungeon, `effect-cert:${status.id}`, opponents);
    simApplyStatus(state, status.id, state.playerUnits[0].key, null);
    covered.status.add(status.id);
  } catch (error) {
    failures.push(`status:${status.id}: ${String(error)}`);
  }
}

for (const ownerType of Object.keys(covered)) {
  const expected = new Set(Object.keys(groupedRows[ownerType] ?? {}));
  const missing = [...expected].filter((ownerId) => !covered[ownerType].has(ownerId));
  if (missing.length) failures.push(`${ownerType}: owner runtime coverage missing ${missing.join(", ")}`);
}

check(failures.length === 0, `Catalog Release ${RELEASE_ID} Effect certification failed (${failures.length}):\n${failures.join("\n")}`);
console.log(`Catalog ${RELEASE_ID} Effects certified: ${effectCount} rows; ${covered.skill.size} Skill owners, ${covered.ability.size} Ability owners, ${covered.relic.size} Relic owners, ${covered.status.size} Status owners.`);
