import { createHash } from "node:crypto";

export const CATALOG_SCHEMA_VERSION = 2;
export const RUNTIME_CONTRACT_VERSION = 2;

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
    const parameters = { ...row.parameters };
    const usesElementTarget = row.owner_type === "ability"
      && ["all_element_friendlies", "all_element_enemies"].includes(parameters.target);
    if (!usesElementTarget) delete parameters.element_ids;
    const effect = {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      templateId: row.template_id,
      runtimeKind: row.runtime_kind,
      runtimeVersion: row.runtime_version,
      parameters,
      classification: row.classification,
      execution: row.execution,
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
  const challengeTemplateIds = ids(catalog.unlockChallengeTemplates ?? []);
  if (challengeTemplateIds.size !== 15) throw new Error(`Expected exactly 15 active Challenge Templates; found ${challengeTemplateIds.size}.`);
  requireUnique(catalog.unlockChallengeTemplates ?? [], "Challenge Template");
  requireUnique(catalog.collectibleUnlockChallenges, "Collectible Challenge");
  for (const challenge of catalog.collectibleUnlockChallenges) {
    if (!challengeTemplateIds.has(challenge.challenge_type)) throw new Error(`Challenge ${challenge.id} references missing template ${challenge.challenge_type}.`);
    if (!challenge.parameters || typeof challenge.parameters !== "object" || Array.isArray(challenge.parameters)) throw new Error(`Challenge ${challenge.id} has invalid parameters.`);
    const parameters = challenge.parameters;
    const goal = challenge.challenge_type === "level_up_critter" ? parameters.required_level
      : challenge.challenge_type === "collection_diversity" && parameters.diversity_mode === "specific_types" ? parameters.required_element_ids?.length
        : challenge.challenge_type === "collection_diversity" ? parameters.required_distinct_types ?? parameters.required_per_type
          : challenge.challenge_type === "squad_composition" ? parameters.required_completions
            : challenge.challenge_type === "dungeon_clear" ? parameters.required_clears
              : challenge.challenge_type === "dice_roll" ? parameters.required_occurrences
                : parameters.required_amount;
    if (!Number.isInteger(Number(goal)) || Number(goal) < 1) throw new Error(`Challenge ${challenge.id} has an invalid goal.`);
    if (challenge.challenge_type === "own_collectible") {
      const selected = Array.isArray(parameters.collectible_ids) ? parameters.collectible_ids : [];
      if (parameters.require_unique_collectibles === true && selected.length > 0 && Number(parameters.required_amount) > selected.length) {
        throw new Error(`Challenge ${challenge.id} requires more unique collectibles than its selected IDs provide.`);
      }
    }
  }
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
      const supported = new Set([
        "stat_modifier@1", "stat_modifier@2", "mana_dice_modifier@1", "apply_status@1", "restore_hp@1",
        "damage_over_time@1", "skip_action_chance@1", "shield_modifier@1", "reactive_trigger@1",
        "direct_health_modifier@1", "retaliation@1", "damage_modifier@1", "conditional_effect@1",
        "delayed_effect@1", "effect_duration@1", "effect_removal@1", "effect_copy@1", "effect_transfer@1",
        "damage_prevention@1", "action_cost_modifier@1", "resource_gain_loss@1", "resource_conversion@1",
        "effect_scaling@1", "repeating_effect@1", "effect_immunity@1", "effect_amplification@1",
      ]);
      if (!supported.has(`${effect.runtimeKind}@${effect.runtimeVersion}`)) throw new Error(`Unsupported ${ownerType} effect runtime ${effect.runtimeKind}@${effect.runtimeVersion}.`);
      if (!["positive", "negative", "mixed"].includes(effect.classification)) throw new Error(`Effect ${effect.id} has invalid classification.`);
      if (!["root", "child"].includes(effect.execution)) throw new Error(`Effect ${effect.id} has invalid execution mode.`);
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
      unlockChallengeTemplates: catalog.unlockChallengeTemplates ?? [],
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
