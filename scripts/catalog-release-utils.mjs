import { createHash } from "node:crypto";

export const CATALOG_SCHEMA_VERSION = 1;
export const RUNTIME_CONTRACT_VERSION = 1;

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value))}\n`;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sriSha256(bytes) {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

export function groupRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = String(row[key]);
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return groups;
}

export function groupEffects(rows) {
  const grouped = { skill: {}, ability: {}, relic: {}, status: {} };
  for (const row of rows) {
    if (!grouped[row.owner_type]) throw new Error(`Unsupported effect owner: ${row.owner_type}.`);
    const effect = {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      templateId: row.template_id,
      runtimeKind: row.runtime_kind,
      runtimeVersion: row.runtime_version,
      parameters: row.parameters,
      sortOrder: row.sort_order,
    };
    const ownerRows = grouped[row.owner_type][row.owner_id] ?? [];
    if (ownerRows.some((candidate) => candidate.id === row.id)) {
      throw new Error(`Duplicate effect ${row.owner_type}:${row.owner_id}:${row.id}.`);
    }
    grouped[row.owner_type][row.owner_id] = [...ownerRows, effect];
  }
  return grouped;
}

function ids(rows) {
  return new Set(rows.map((row) => String(row.id)));
}

function requireUnique(rows, label) {
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`Duplicate ${label} ID: ${row.id}.`);
    seen.add(row.id);
  }
}

function requireReferences(rows, key, targets, label) {
  for (const row of rows) {
    if (row[key] != null && !targets.has(String(row[key]))) {
      throw new Error(`${label} references missing ${key} ${row[key]}.`);
    }
  }
}

export function validateCatalog(catalog) {
  for (const [label, rows] of [
    ["Element", catalog.elements], ["Skill", catalog.skills], ["Critter", catalog.critters],
    ["Rollcaster", catalog.rollcasters], ["Ability", catalog.rollcasterAbilities],
    ["Relic", catalog.relics], ["Dungeon", catalog.dungeons],
  ]) requireUnique(rows, label);

  const elementIds = ids(catalog.elements);
  const skillIds = ids(catalog.skills);
  const critterIds = ids(catalog.critters);
  const rollcasterIds = ids(catalog.rollcasters);
  const abilityIds = ids(catalog.rollcasterAbilities);
  const relicIds = ids(catalog.relics);
  const dungeonIds = ids(catalog.dungeons);
  requireReferences(catalog.skills, "element_id", elementIds, "Skill");
  requireReferences(catalog.critters, "element_1_id", elementIds, "Critter");
  requireReferences(catalog.critters.filter((row) => row.element_2_id), "element_2_id", elementIds, "Critter");
  requireReferences(catalog.critterProgression, "critter_id", critterIds, "Critter progression");
  requireReferences(catalog.critterSkillUnlocks, "critter_id", critterIds, "Critter Skill unlock");
  requireReferences(catalog.critterSkillUnlocks, "skill_id", skillIds, "Critter Skill unlock");
  requireReferences(catalog.rollcasterProgression, "rollcaster_id", rollcasterIds, "Rollcaster progression");
  requireReferences(catalog.rollcasterAbilityUnlocks, "rollcaster_id", rollcasterIds, "Rollcaster Ability unlock");
  requireReferences(catalog.rollcasterAbilityUnlocks, "ability_id", abilityIds, "Rollcaster Ability unlock");
  requireReferences(catalog.dungeonOpponents, "dungeon_id", dungeonIds, "Dungeon opponent");
  requireReferences(catalog.dungeonOpponents, "critter_id", critterIds, "Dungeon opponent");
  for (const opponent of catalog.dungeonOpponents) {
    for (const skillId of opponent.skill_ids) if (!skillIds.has(skillId)) throw new Error(`Dungeon opponent references missing Skill ${skillId}.`);
    for (const relicId of opponent.relic_ids) if (!relicIds.has(relicId)) throw new Error(`Dungeon opponent references missing Relic ${relicId}.`);
  }
  const matrix = new Set(catalog.elementEffectiveness.map((row) => `${row.attacking_element_id}\0${row.defending_element_id}`));
  for (const attack of elementIds) for (const defend of elementIds) {
    if (!matrix.has(`${attack}\0${defend}`)) throw new Error(`Element Chart is missing ${attack} -> ${defend}.`);
  }
  for (const [ownerType, owners] of Object.entries({
    skill: catalog.effectsBySkill,
    ability: catalog.effectsByAbility,
    relic: catalog.effectsByRelic,
    status: catalog.effectsByStatus,
  })) {
    for (const effects of Object.values(owners)) for (const effect of effects) {
      if (effect.runtimeVersion !== 1) throw new Error(`Unsupported ${ownerType} effect runtime ${effect.runtimeKind}@${effect.runtimeVersion}.`);
    }
  }
}

export function createPacks(catalog, catalogVersion) {
  const envelope = (pack, fields) => ({ schemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion, pack, ...fields });
  return {
    core: envelope("core", {
      currencies: catalog.currencies,
      elements: catalog.elements,
      elementEffectiveness: catalog.elementEffectiveness,
      starterRollcasterOptions: catalog.starterRollcasterOptions,
      starterOptions: catalog.starterOptions,
      gameAssets: catalog.gameAssets,
    }),
    combat: envelope("combat", {
      skills: catalog.skills,
      rollcasterAbilities: catalog.rollcasterAbilities,
      relics: catalog.relics,
      statuses: catalog.statuses,
      effectsBySkill: catalog.effectsBySkill,
      effectsByAbility: catalog.effectsByAbility,
      effectsByRelic: catalog.effectsByRelic,
      effectsByStatus: catalog.effectsByStatus,
    }),
    collectibles: envelope("collectibles", {
      collectibleUnlockRequirements: catalog.collectibleUnlockRequirements,
      collectibleUnlockChallenges: catalog.collectibleUnlockChallenges,
      shopEntries: catalog.shopEntries,
      critters: catalog.critters,
      critterProgression: catalog.critterProgression,
      critterSkillUnlocks: catalog.critterSkillUnlocks,
      rollcasters: catalog.rollcasters,
      rollcasterProgression: catalog.rollcasterProgression,
      rollcasterAbilityUnlocks: catalog.rollcasterAbilityUnlocks,
    }),
    dungeons: envelope("dungeons", {
      dungeons: catalog.dungeons,
      dungeonOpponents: catalog.dungeonOpponents,
      dungeonCompletionDrops: catalog.dungeonCompletionDrops,
      dungeonOpponentStatOverrides: catalog.dungeonOpponentStatOverrides,
    }),
  };
}
