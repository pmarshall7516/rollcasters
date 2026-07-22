import type { CombatEffectRow, EffectOwnerType, EffectTarget, ResolvedEffectRef } from "./types.js";

export const SUPPORTED_EFFECT_RUNTIMES = new Set([
  "stat_modifier@1",
  "stat_modifier@2",
  "shield_modifier@1",
  "reactive_trigger@1",
  "direct_health_modifier@1",
  "retaliation@1",
  "damage_modifier@1",
  "conditional_effect@1",
  "delayed_effect@1",
  "effect_duration@1",
  "effect_removal@1",
  "effect_copy@1",
  "effect_transfer@1",
  "damage_prevention@1",
  "action_cost_modifier@1",
  "resource_gain_loss@1",
  "resource_conversion@1",
  "effect_scaling@1",
  "repeating_effect@1",
  "effect_immunity@1",
  "effect_amplification@1",
  "mana_dice_modifier@1",
  "apply_status@1",
  "restore_hp@1",
  "damage_over_time@1",
  "skip_action_chance@1",
]);

const TARGETS_BY_OWNER: Record<EffectOwnerType, ReadonlySet<EffectTarget>> = {
  skill: new Set(["self", "selected_ally", "selected_enemy", "all_allies", "all_friendlies", "all_enemies", "target_enemies", "attacker", "defender", "effect_owner"]),
  ability: new Set(["all_friendlies", "all_squad_friendlies", "all_enemies", "all_element_friendlies", "all_element_enemies", "active_ally", "active_enemy", "attacker", "defender", "effect_owner"]),
  relic: new Set(["equipped_critter", "equipped_allies", "equipped_friendlies", "all_squad_friendlies", "all_enemies", "active_ally", "active_enemy", "attacker", "defender", "effect_owner"]),
  status: new Set(["status_holder", "status_holder_allies", "status_holder_friendlies", "status_holder_enemies"]),
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function requireChoice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${label} must be one of: ${choices.join(", ")}.`);
  }
  return value as T;
}

function rejectUnknownKeys(parameters: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(parameters).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported parameter(s): ${unknown.join(", ")}.`);
}

function validateDuration(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} must be a positive integer.`);
}

function validateChance(value: unknown, label: string): void {
  const chance = requireFinite(value, label);
  if (chance < 0 || chance > 1) throw new Error(`${label} must be between 0 and 1.`);
}

function validateElementIds(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`${label} must be a non-empty string array.`);
  }
}

function normalizeEffectParameters(row: CombatEffectRow): Record<string, unknown> {
  const parameters = { ...requireRecord(row.parameters, `Effect ${row.id} parameters`) };
  const target = parameters.target;
  const usesElementTarget = row.owner_type === "ability"
    && (target === "all_element_friendlies" || target === "all_element_enemies");

  // The Content Studio can persist its hidden element picker default on templates
  // that do not expose elemental targeting. It has no combat meaning there.
  if (!usesElementTarget) delete parameters.element_ids;
  return parameters;
}

export function assertEffectContract(effect: ResolvedEffectRef, expectedOwner?: EffectOwnerType): void {
  if (expectedOwner && effect.ownerType !== expectedOwner) {
    throw new Error(`Effect owner mismatch: ${effect.id} belongs to ${effect.ownerType}, not ${expectedOwner}.`);
  }

  const runtimeKey = `${effect.runtimeKind}@${effect.runtimeVersion}`;
  if (!SUPPORTED_EFFECT_RUNTIMES.has(runtimeKey)) {
    throw new Error(`Unsupported effect runtime: ${runtimeKey}`);
  }

  const parameters = requireRecord(effect.parameters, `Effect ${effect.id} parameters`);
  const target = requireChoice(
    parameters.target,
    [...TARGETS_BY_OWNER[effect.ownerType]],
    `Effect ${effect.id} target for ${effect.ownerType}`,
  );
  if (!TARGETS_BY_OWNER[effect.ownerType].has(target)) {
    throw new Error(`Effect ${effect.id} cannot target ${target} as ${effect.ownerType}.`);
  }

  // The expanded runtime contract is intentionally validated here as a
  // catalog boundary. Runtime handlers can then assume the common shape and
  // focus on resolution rather than accepting malformed authoring data.
  const expandedKey = new Set([
    "stat_modifier@2", "shield_modifier@1", "reactive_trigger@1",
    "direct_health_modifier@1", "retaliation@1", "damage_modifier@1",
    "conditional_effect@1", "delayed_effect@1", "effect_duration@1",
    "effect_removal@1", "effect_copy@1", "effect_transfer@1",
    "damage_prevention@1", "action_cost_modifier@1", "resource_gain_loss@1",
    "resource_conversion@1", "effect_scaling@1", "repeating_effect@1",
    "effect_immunity@1", "effect_amplification@1",
  ]);
  if (expandedKey.has(runtimeKey)) {
    if (runtimeKey === "stat_modifier@2" && effect.classification === undefined && effect.execution === undefined) {
      throw new Error(`Unsupported effect runtime: ${runtimeKey}`);
    }
    if (effect.execution && !["root", "child"].includes(effect.execution)) {
      throw new Error(`Effect ${effect.id} has an invalid execution mode.`);
    }
    const childKeys = ["child_effect_ids", "true_effect_ids", "false_effect_ids", "output_effect_ids", "overheal_effect_ids"];
    for (const childKey of childKeys) {
      if (parameters[childKey] === undefined) continue;
      if (childKey === "overheal_effect_ids" && parameters.overhealing_behavior !== "convert" && Array.isArray(parameters[childKey]) && parameters[childKey].length === 0) continue;
      if (!Array.isArray(parameters[childKey]) || parameters[childKey].length === 0 || parameters[childKey].some((id) => typeof id !== "string" || !id)) {
        throw new Error(`Effect ${effect.id} ${childKey} must be a non-empty string array.`);
      }
    }
    if (parameters.chance !== undefined) validateChance(parameters.chance, `Effect ${effect.id} chance`);
    for (const key of ["delay_value", "repeat_interval", "initial_delay", "number_of_activations", "activation_limit", "usage_limit", "maximum_effects_copied", "required_occurrences"]) {
      if (parameters[key] !== undefined && parameters[key] !== null) validateDuration(parameters[key], `Effect ${effect.id} ${key}`);
    }
    if (runtimeKey === "stat_modifier@2") {
      requireChoice(parameters.stat, ["hp", "atk", "def", "spd", "block_cost", "swap_cost", "relic_slots"], `Effect ${effect.id} stat`);
      requireChoice(parameters.value_mode, ["flat", "percentage"], `Effect ${effect.id} value_mode`);
      if (parameters.stat === "relic_slots" && parameters.value_mode !== "flat") throw new Error(`Effect ${effect.id} relic_slots is flat only.`);
    }
    if (runtimeKey === "shield_modifier@1") {
      requireChoice(parameters.operation, ["grant", "add", "subtract", "set", "destroy"], `Effect ${effect.id} operation`);
      if (parameters.operation !== "destroy") {
        const value = requireFinite(parameters.shield_value, `Effect ${effect.id} shield_value`);
        if (value < 0 || !Number.isInteger(value)) throw new Error(`Effect ${effect.id} shield_value must be a nonnegative integer.`);
      }
      if (parameters.can_stack === true && parameters.replace_existing_shield === true) throw new Error(`Effect ${effect.id} cannot stack and replace a Shield.`);
    }
    if (runtimeKey === "direct_health_modifier@1") {
      requireChoice(parameters.operation, ["heal", "lose_hp", "set_hp", "drain"], `Effect ${effect.id} operation`);
      requireChoice(parameters.value_type, ["flat", "percent_max_hp", "percent_current_hp", "percent_missing_hp", "percent_damage_dealt"], `Effect ${effect.id} value_type`);
    }
    return;
  }

  if (runtimeKey === "stat_modifier@1") {
    const allowed = effect.ownerType === "ability"
      ? ["stat", "value_mode", "amount", "target", "element_ids"]
      : effect.ownerType === "skill"
        ? ["stat", "value_mode", "amount", "chance", "target"]
        : ["stat", "value_mode", "amount", "target"];
    if (effect.ownerType === "status") throw new Error(`Effect ${effect.id} cannot use ${runtimeKey} as a status effect.`);
    rejectUnknownKeys(parameters, allowed, `Effect ${effect.id}`);
    requireChoice(parameters.stat, ["hp", "atk", "def", "spd"], `Effect ${effect.id} stat`);
    const valueMode = requireChoice(parameters.value_mode, ["flat", "percentage"], `Effect ${effect.id} value_mode`);
    const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
    if (valueMode === "flat" && !Number.isInteger(amount)) throw new Error(`Effect ${effect.id} flat amount must be an integer.`);
    if (effect.ownerType === "skill") validateChance(parameters.chance, `Effect ${effect.id} chance`);
    if (target === "all_element_friendlies" || target === "all_element_enemies") validateElementIds(parameters.element_ids, `Effect ${effect.id} element_ids`);
    return;
  }

  if (runtimeKey === "mana_dice_modifier@1") {
    if (effect.ownerType !== "ability" && effect.ownerType !== "relic") throw new Error(`Effect ${effect.id} cannot use ${runtimeKey} as a ${effect.ownerType} effect.`);
    // Older authored rows persisted the hidden element picker as an empty
    // array for Relics. It is inert unless the target is explicitly elemental.
    rejectUnknownKeys(parameters, ["minimum_delta", "maximum_delta", "target", "element_ids"], `Effect ${effect.id}`);
    const minimum = requireFinite(parameters.minimum_delta, `Effect ${effect.id} minimum_delta`);
    const maximum = requireFinite(parameters.maximum_delta, `Effect ${effect.id} maximum_delta`);
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) throw new Error(`Effect ${effect.id} Mana deltas must be integers.`);
    if (minimum === 0 && maximum === 0) throw new Error(`Effect ${effect.id} must change at least one Mana bound.`);
    if (target === "all_element_friendlies" || target === "all_element_enemies") validateElementIds(parameters.element_ids, `Effect ${effect.id} element_ids`);
    return;
  }

  if (runtimeKey === "apply_status@1") {
    if (effect.ownerType !== "skill") throw new Error(`Effect ${effect.id} can only be owned by a skill.`);
    rejectUnknownKeys(parameters, ["status_id", "chance", "target", "indefinite", "turns"], `Effect ${effect.id}`);
    if (typeof parameters.status_id !== "string" || !parameters.status_id) {
      throw new Error(`Effect ${effect.id} status_id must be a non-empty string.`);
    }
    validateChance(parameters.chance, `Effect ${effect.id} chance`);
    if (typeof parameters.indefinite !== "boolean") throw new Error(`Effect ${effect.id} indefinite must be boolean.`);
    if (!parameters.indefinite) {
      if (parameters.turns === undefined) throw new Error(`Effect ${effect.id} turns is required for a finite application.`);
      validateDuration(parameters.turns, `Effect ${effect.id} turns`);
    }
    return;
  }

  if (runtimeKey === "restore_hp@1") {
    if (effect.ownerType !== "skill") throw new Error(`Effect ${effect.id} can only be owned by a skill.`);
    rejectUnknownKeys(parameters, ["value_mode", "amount", "chance", "target"], `Effect ${effect.id}`);
    const mode = requireChoice(parameters.value_mode, ["flat", "percent_max_hp", "percent_damage_done"], `Effect ${effect.id} value_mode`);
    const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
    if (amount < 0) throw new Error(`Effect ${effect.id} amount is outside the allowed range.`);
    if (mode === "flat" && !Number.isInteger(amount)) throw new Error(`Effect ${effect.id} flat amount must be an integer.`);
    validateChance(parameters.chance, `Effect ${effect.id} chance`);
    return;
  }

  if (runtimeKey === "damage_over_time@1") {
    if (effect.ownerType !== "status") throw new Error(`Effect ${effect.id} can only be owned by a status.`);
    rejectUnknownKeys(parameters, ["timing", "value_mode", "amount", "chance", "target"], `Effect ${effect.id}`);
    requireChoice(parameters.timing, ["start_of_turn", "end_of_turn"], `Effect ${effect.id} timing`);
    const mode = requireChoice(parameters.value_mode, ["flat", "percent_max_hp"], `Effect ${effect.id} value_mode`);
    const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
    if (amount < 0) throw new Error(`Effect ${effect.id} amount is outside the allowed range.`);
    if (mode === "flat" && !Number.isInteger(amount)) throw new Error(`Effect ${effect.id} flat amount must be an integer.`);
    validateChance(parameters.chance, `Effect ${effect.id} chance`);
    return;
  }

  if (effect.ownerType !== "status") throw new Error(`Effect ${effect.id} can only be owned by a status.`);
  rejectUnknownKeys(parameters, ["chance", "combat_action", "target"], `Effect ${effect.id}`);
  validateChance(parameters.chance, `Effect ${effect.id} chance`);
  requireChoice(parameters.combat_action, ["swap", "block", "skill", "all"], `Effect ${effect.id} combat_action`);
}

export function groupCombatEffectRows(rows: CombatEffectRow[]): Record<EffectOwnerType, Record<string, ResolvedEffectRef[]>> {
  const grouped: Record<EffectOwnerType, Record<string, ResolvedEffectRef[]>> = { skill: {}, ability: {}, relic: {}, status: {} };
  for (const row of rows) {
    if (!grouped[row.owner_type]) throw new Error(`Unsupported effect owner: ${String(row.owner_type)}`);
    const effect: ResolvedEffectRef = {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerType: row.owner_type,
      ownerId: row.owner_id,
      templateId: row.template_id,
      runtimeKind: row.runtime_kind,
      runtimeVersion: row.runtime_version,
      parameters: normalizeEffectParameters(row),
      sortOrder: row.sort_order,
      classification: row.classification,
      execution: row.execution,
    };
    assertEffectContract(effect, row.owner_type);
    const ownerEffects = grouped[row.owner_type][row.owner_id] ?? [];
    if (ownerEffects.some((candidate) => candidate.id === effect.id)) {
      throw new Error(`Duplicate inline effect ${effect.id} for ${effect.ownerType} ${effect.ownerId}.`);
    }
    grouped[row.owner_type][row.owner_id] = [...ownerEffects, effect];
  }
  for (const owners of Object.values(grouped)) {
    for (const effects of Object.values(owners)) effects.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }
  return grouped;
}
