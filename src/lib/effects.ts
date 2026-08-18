import type { CombatEffectRow, Critter, EffectOwnerType, EffectTarget, ResolvedEffectRef, Skill } from "./types.js";

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
  "critter_revival@1",
  "skill_usage_restriction@1",
  "swap_after_attack@1",
  "weighted_child_selector@1",
  "critter_xp_modifier@1",
]);

const TARGETS_BY_OWNER: Record<EffectOwnerType, ReadonlySet<EffectTarget>> = {
  skill: new Set(["self", "all_critters", "all_others", "selected_ally", "selected_healthy_ally", "selected_enemy", "all_allies", "all_friendlies", "all_enemies", "targets", "attacker_and_targets", "target_friendlies", "target_enemies", "attacker", "defender", "effect_owner"]),
  ability: new Set(["all_friendlies", "all_critters", "all_squad_friendlies", "all_enemies", "all_element_friendlies", "all_element_enemies", "active_ally", "active_enemy", "attacker", "attacker_and_targets", "defender", "effect_owner"]),
  relic: new Set(["equipped_critter", "equipped_allies", "equipped_friendlies", "all_squad_friendlies", "all_enemies", "active_ally", "active_enemy", "attacker", "attacker_and_targets", "defender", "effect_owner"]),
  status: new Set(["status_holder", "status_holder_allies_without_holder", "status_holder_allies_with_holder", "status_holder_enemies"]),
};

const CONDITIONAL_EFFECT_TARGETS_BY_OWNER: Record<EffectOwnerType, ReadonlySet<EffectTarget>> = {
  skill: new Set(["using_critter", "using_critter_allies_with_equipped", "using_critter_allies_without_equipped", "using_critter_enemies", "skill_targets"]),
  ability: TARGETS_BY_OWNER.ability,
  relic: new Set(["equipped_critter", "equipped_critter_allies_with_equipped", "equipped_critter_allies_without_equipped", "equipped_critter_enemies"]),
  status: TARGETS_BY_OWNER.status,
};

const CONDITIONAL_CONDITION_TARGETS_BY_OWNER: Record<EffectOwnerType, ReadonlySet<EffectTarget>> = {
  ...CONDITIONAL_EFFECT_TARGETS_BY_OWNER,
  relic: new Set([...CONDITIONAL_EFFECT_TARGETS_BY_OWNER.relic, "skill_targets"]),
};

const CRITTER_XP_RELIC_TARGETS = new Set<EffectTarget>([
  "equipped_critter",
  "equipped_critter_allies_with_equipped",
  "equipped_critter_allies_without_equipped",
]);

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
  const commonFilters = new Set([
    "target_critter_tag_ids", "source_critter_tag_ids", "source_skill_tag_ids",
    "effect_target_critter_tag_ids", "condition_target_critter_tag_ids", "skill_tag_ids",
  ]);
  const unknown = Object.keys(parameters).filter((key) => !allowed.includes(key) && !commonFilters.has(key));
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

function validateWeightedChildOutcomes(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one outcome.`);
  }
  let total = 0;
  let hasNothing = false;
  const selected = new Set<string>();
  value.forEach((candidate, index) => {
    const row = requireRecord(candidate, `${label}[${index}]`);
    if (!Object.prototype.hasOwnProperty.call(row, "effect_id")) {
      throw new Error(`${label}[${index}] must provide effect_id; use null for Nothing.`);
    }
    const effectId = row.effect_id;
    if (effectId === null) {
      if (hasNothing) throw new Error(`${label} may contain only one Nothing outcome.`);
      hasNothing = true;
    } else if (typeof effectId !== "string" || effectId.trim().length === 0) {
      throw new Error(`${label}[${index}] effect_id must be a Child-only Effect ID or null.`);
    } else if (selected.has(effectId)) {
      throw new Error(`${label} cannot reference Effect ${effectId} more than once.`);
    } else {
      selected.add(effectId);
    }
    const probability = requireFinite(row.probability, `${label}[${index}] probability`);
    if (probability < 0.01 || probability > 1) {
      throw new Error(`${label}[${index}] probability must be between 0.01 and 1.`);
    }
    total += probability;
  });
  if (total > 1.0000001) throw new Error(`${label} probabilities cannot total more than 1.`);
}

function validateElementIds(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`${label} must be a non-empty string array.`);
  }
}

function validateOptionalElementIds(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`${label} must be a string array when present.`);
  }
}

function validateOptionalTagIds(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id)) {
    throw new Error(`${label} must be a string array when present.`);
  }
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

function matchesAnyTag(tagIds: string[], required: string[]): boolean {
  return required.length === 0 || required.some((id) => tagIds.includes(id));
}

export function targetElementIds(effect: ResolvedEffectRef): string[] {
  return stringIds(effect.parameters.target_element_ids);
}

export function skillElementIds(parameters: Record<string, unknown>): string[] {
  return stringIds(parameters.skill_element_ids);
}

export function sourceElementIds(effect: ResolvedEffectRef): string[] {
  return stringIds(effect.parameters.source_element_ids);
}

export function targetCritterTagIds(effect: ResolvedEffectRef): string[] {
  return stringIds(effect.parameters.target_critter_tag_ids);
}

export function sourceCritterTagIds(effect: ResolvedEffectRef): string[] {
  return stringIds(effect.parameters.source_critter_tag_ids);
}

export function sourceSkillTagIds(effect: ResolvedEffectRef): string[] {
  return stringIds(effect.parameters.source_skill_tag_ids);
}

export function effectMatchesSourceCritter(
  effect: ResolvedEffectRef,
  critter: Pick<Critter, "element_1_id" | "element_2_id" | "tag_ids"> | undefined,
): boolean {
  const required = new Set(sourceElementIds(effect));
  const requiredTags = sourceCritterTagIds(effect);
  if (required.size === 0 && requiredTags.length === 0) return true;
  if (!critter) return false;
  const elementsMatch = required.size === 0 || required.has(critter.element_1_id) || Boolean(critter.element_2_id && required.has(critter.element_2_id));
  return elementsMatch && matchesAnyTag(critter.tag_ids ?? [], requiredTags);
}

export function effectMatchesSourceSkill(effect: ResolvedEffectRef, skill: Pick<Skill, "tag_ids"> | undefined): boolean {
  const required = sourceSkillTagIds(effect);
  return required.length === 0 || Boolean(skill && matchesAnyTag(skill.tag_ids ?? [], required));
}

export function normalizeEffectElementParameters(runtimeKind: string, input: Record<string, unknown>): Record<string, unknown> {
  const parameters = { ...input };
  // Older releases used one ambiguous element_ids field for both recipient
  // Critters and the Skill being priced. Normalize that shape at the catalog
  // seam so the combat runtime only needs the explicit contracts.
  if (parameters.element_ids !== undefined) {
    if (runtimeKind === "action_cost_modifier" && parameters.skill_element_ids === undefined) {
      parameters.skill_element_ids = parameters.element_ids;
    } else if (runtimeKind !== "action_cost_modifier" && parameters.target_element_ids === undefined) {
      parameters.target_element_ids = parameters.element_ids;
    }
    delete parameters.element_ids;
  }
  return parameters;
}

function normalizeEffectParameters(row: CombatEffectRow): Record<string, unknown> {
  const parameters = normalizeEffectElementParameters(row.runtime_kind, { ...requireRecord(row.parameters, `Effect ${row.id} parameters`) });
  if (row.runtime_kind === "conditional_effect") {
    const legacyTarget = typeof parameters.target === "string" ? parameters.target : undefined;
    if (parameters.effect_target === undefined && legacyTarget) parameters.effect_target = legacyTarget;
    if (parameters.condition_target === undefined && legacyTarget) parameters.condition_target = legacyTarget;
  }
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
  // Resource and Effect Copy/Transfer runtimes operate on squad state or
  // resolution context rather than directly selecting a Critter. Their
  // schemas intentionally do not include `target`; do not force them through
  // the owner-scoped Critter target vocabulary.
  const targetlessRuntimes = new Set(["effect_copy@1", "effect_transfer@1", "resource_gain_loss@1", "skill_usage_restriction@1", "weighted_child_selector@1"]);
  const target = parameters.target;
  if (runtimeKey === "critter_xp_modifier@1") {
    if (effect.ownerType === "skill" || effect.ownerType === "status") {
      throw new Error(`Effect ${effect.id} can only be owned by an Ability or Relic.`);
    }
    if (effect.ownerType === "ability" && target !== "all_friendlies") {
      throw new Error(`Effect ${effect.id} Ability XP Boosts must target all_friendlies.`);
    }
    if (effect.ownerType === "relic" && (!target || !CRITTER_XP_RELIC_TARGETS.has(target as EffectTarget))) {
      throw new Error(`Effect ${effect.id} Relic XP Boosts must target an equipped Critter friendly scope.`);
    }
    requireChoice(parameters.distribution_mode, ["active_only", "shared_with_inactive", "funnel_to_equipped"], `Effect ${effect.id} distribution_mode`);
    if (parameters.distribution_mode === "funnel_to_equipped" && (effect.ownerType !== "relic" || target !== "equipped_critter")) {
      throw new Error(`Effect ${effect.id} funnel_to_equipped requires a Relic targeting equipped_critter.`);
    }
    const modifierType = requireChoice(parameters.modifier_type, ["percentage", "flat"], `Effect ${effect.id} modifier_type`);
    const modifierValue = requireFinite(parameters.modifier_value, `Effect ${effect.id} modifier_value`);
    if (modifierValue < 0) throw new Error(`Effect ${effect.id} modifier_value must be nonnegative.`);
    if (modifierType === "flat" && !Number.isInteger(modifierValue)) throw new Error(`Effect ${effect.id} flat modifier_value must be an integer.`);
    if (parameters.source_element_ids !== undefined && stringIds(parameters.source_element_ids).length) {
      throw new Error(`Effect ${effect.id} XP Boosts use target filters, not source Element filters.`);
    }
    if (parameters.source_critter_tag_ids !== undefined && stringIds(parameters.source_critter_tag_ids).length) {
      throw new Error(`Effect ${effect.id} XP Boosts use target filters, not source Critter Tag filters.`);
    }
  }
  if (runtimeKey === "conditional_effect@1") {
    const explicitConditionalTargets = parameters.effect_target !== undefined || parameters.condition_target !== undefined;
    const allowedEffectTargets = explicitConditionalTargets ? CONDITIONAL_EFFECT_TARGETS_BY_OWNER[effect.ownerType] : TARGETS_BY_OWNER[effect.ownerType];
    const allowedConditionTargets = explicitConditionalTargets ? CONDITIONAL_CONDITION_TARGETS_BY_OWNER[effect.ownerType] : TARGETS_BY_OWNER[effect.ownerType];
    const effectTarget = requireChoice(
      parameters.effect_target ?? parameters.target,
      [...allowedEffectTargets],
      `Effect ${effect.id} Effect Target for ${effect.ownerType}`,
    );
    const conditionTarget = requireChoice(
      parameters.condition_target ?? parameters.effect_target ?? parameters.target,
      [...allowedConditionTargets],
      `Effect ${effect.id} Condition Target for ${effect.ownerType}`,
    );
    if (!allowedEffectTargets.has(effectTarget) || !allowedConditionTargets.has(conditionTarget)) {
      throw new Error(`Effect ${effect.id} has an unsupported conditional target.`);
    }
  } else if (runtimeKey !== "critter_xp_modifier@1" && (!targetlessRuntimes.has(runtimeKey) || parameters.target !== undefined)) {
    const validatedTarget = requireChoice(
      target,
      [...TARGETS_BY_OWNER[effect.ownerType]],
      `Effect ${effect.id} target for ${effect.ownerType}`,
    );
    if (!TARGETS_BY_OWNER[effect.ownerType].has(validatedTarget)) {
      throw new Error(`Effect ${effect.id} cannot target ${validatedTarget} as ${effect.ownerType}.`);
    }
  }
  if (parameters.target_element_ids !== undefined) {
    if (effect.ownerType === "status" || (parameters.target === undefined && !["weighted_child_selector@1", "conditional_effect@1"].includes(runtimeKey))) {
      throw new Error(`Effect ${effect.id} target_element_ids requires a Skill, Ability, or Relic target.`);
    }
    validateOptionalElementIds(parameters.target_element_ids, `Effect ${effect.id} target_element_ids`);
  }
  if (parameters.skill_element_ids !== undefined) {
    if (runtimeKey !== "action_cost_modifier@1" && !(runtimeKey === "stat_modifier@2" && effect.ownerType === "status" && parameters.stat === "skill_cost")) {
      throw new Error(`Effect ${effect.id} skill_element_ids requires a Skill cost modifier.`);
    }
    validateOptionalElementIds(parameters.skill_element_ids, `Effect ${effect.id} skill_element_ids`);
  }
  if (parameters.source_element_ids !== undefined) {
    if (effect.ownerType !== "skill" && effect.ownerType !== "relic") {
      throw new Error(`Effect ${effect.id} source_element_ids requires a Skill or Relic owner.`);
    }
    validateOptionalElementIds(parameters.source_element_ids, `Effect ${effect.id} source_element_ids`);
  }
  if (parameters.target_critter_tag_ids !== undefined) {
    if (effect.ownerType === "status" || (parameters.target === undefined && runtimeKey !== "conditional_effect@1")) {
      throw new Error(`Effect ${effect.id} target_critter_tag_ids requires a Critter-targeting effect.`);
    }
    validateOptionalTagIds(parameters.target_critter_tag_ids, `Effect ${effect.id} target_critter_tag_ids`);
  }
  if (parameters.source_critter_tag_ids !== undefined) {
    if (effect.ownerType !== "skill" && effect.ownerType !== "relic") {
      throw new Error(`Effect ${effect.id} source_critter_tag_ids requires a Skill or Relic owner.`);
    }
    validateOptionalTagIds(parameters.source_critter_tag_ids, `Effect ${effect.id} source_critter_tag_ids`);
  }
  if (parameters.source_skill_tag_ids !== undefined) {
    if (effect.ownerType !== "skill" && effect.ownerType !== "relic") {
      throw new Error(`Effect ${effect.id} source_skill_tag_ids requires a Skill or Relic owner.`);
    }
    if (effect.ownerType === "relic" && stringIds(parameters.source_skill_tag_ids).length && !["damage_modifier@1", "effect_amplification@1"].includes(runtimeKey)) {
      throw new Error(`Effect ${effect.id} source_skill_tag_ids requires a Relic Damage Modifier or Effect Amplification.`);
    }
    validateOptionalTagIds(parameters.source_skill_tag_ids, `Effect ${effect.id} source_skill_tag_ids`);
  }
  for (const key of ["effect_target_critter_tag_ids", "condition_target_critter_tag_ids"] as const) {
    if (parameters[key] === undefined) continue;
    if (runtimeKey !== "conditional_effect@1") {
      throw new Error(`Effect ${effect.id} ${key} requires a Conditional Effect.`);
    }
    validateOptionalTagIds(parameters[key], `Effect ${effect.id} ${key}`);
  }
  if (parameters.skill_tag_ids !== undefined) {
    const isSkillCost = runtimeKey === "action_cost_modifier@1"
      || (runtimeKey === "stat_modifier@2" && effect.ownerType === "status" && parameters.stat === "skill_cost");
    if (!isSkillCost) throw new Error(`Effect ${effect.id} skill_tag_ids requires a Skill cost modifier.`);
    validateOptionalTagIds(parameters.skill_tag_ids, `Effect ${effect.id} skill_tag_ids`);
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
    "effect_immunity@1", "effect_amplification@1", "critter_revival@1",
    "skill_usage_restriction@1",
    "swap_after_attack@1",
    "weighted_child_selector@1",
    "critter_xp_modifier@1",
  ]);
  if (expandedKey.has(runtimeKey)) {
    if (runtimeKey === "stat_modifier@2" && effect.classification === undefined && effect.execution === undefined) {
      throw new Error(`Unsupported effect runtime: ${runtimeKey}`);
    }
    if (effect.execution && !["root", "child"].includes(effect.execution)) {
      throw new Error(`Effect ${effect.id} has an invalid execution mode.`);
    }
    const childKeys = ["child_effect_ids", "true_effect_ids", "false_effect_ids", "output_effect_ids", "overheal_effect_ids"];
    const requiredChildKeys = new Set(["child_effect_ids", "true_effect_ids", "output_effect_ids"]);
    for (const childKey of childKeys) {
      if (parameters[childKey] === undefined) continue;
      if (childKey === "overheal_effect_ids" && parameters.overhealing_behavior !== "convert" && Array.isArray(parameters[childKey]) && parameters[childKey].length === 0) continue;
      if (!Array.isArray(parameters[childKey]) || (requiredChildKeys.has(childKey) && parameters[childKey].length === 0) || parameters[childKey].some((id) => typeof id !== "string" || !id)) {
        throw new Error(`Effect ${effect.id} ${childKey} must be a non-empty string array.`);
      }
    }
    if (parameters.chance !== undefined) validateChance(parameters.chance, `Effect ${effect.id} chance`);
    if (runtimeKey === "weighted_child_selector@1") {
      if (effect.ownerType !== "skill") throw new Error(`Effect ${effect.id} can only be owned by a skill.`);
      if (effect.execution !== "root") throw new Error(`Effect ${effect.id} must use Root execution.`);
      rejectUnknownKeys(parameters, ["outcome_rows", "source_element_ids", "target_element_ids"], `Effect ${effect.id}`);
      validateWeightedChildOutcomes(parameters.outcome_rows, `Effect ${effect.id} outcome_rows`);
    }
    if (runtimeKey === "resource_gain_loss@1") {
      validateChance(
        parameters.activation_chance === undefined ? 1 : parameters.activation_chance,
        `Effect ${effect.id} activation_chance`,
      );
      requireChoice(parameters.resource, ["squad_mana", "currency", "other"], `Effect ${effect.id} resource`);
      requireChoice(parameters.operation, ["gain", "lose", "set", "refund", "drain", "reserve"], `Effect ${effect.id} operation`);
      requireChoice(parameters.target_squad, ["user", "enemy", "owner"], `Effect ${effect.id} target_squad`);
      requireChoice(parameters.trigger_timing, ["immediate", "through_parent"], `Effect ${effect.id} trigger_timing`);
      const value = requireFinite(parameters.value, `Effect ${effect.id} value`);
      if (value < 0) throw new Error(`Effect ${effect.id} value must be nonnegative.`);
      const minimumRemaining = parameters.minimum_remaining_resource;
      if (minimumRemaining !== undefined && minimumRemaining !== null) {
        const minimum = requireFinite(minimumRemaining, `Effect ${effect.id} minimum_remaining_resource`);
        if (minimum < 0) throw new Error(`Effect ${effect.id} minimum_remaining_resource must be nonnegative.`);
      }
    }
    if (runtimeKey === "delayed_effect@1") {
      rejectUnknownKeys(
        parameters,
        [
          "target", "delay_type", "delay_value", "delay_timing", "child_effect_ids",
          "target_tracking", "cancel_condition", "visible_countdown", "repeat",
          "activation_chance", "allow_multiple_at_once", "trigger_description",
          "target_element_ids", "source_element_ids",
        ],
        `Effect ${effect.id}`,
      );
      validateChance(
        parameters.activation_chance === undefined ? 1 : parameters.activation_chance,
        `Effect ${effect.id} activation_chance`,
      );
      if (parameters.delay_value === undefined || parameters.delay_value === null) throw new Error(`Effect ${effect.id} delay_value is required.`);
      validateDuration(parameters.delay_value, `Effect ${effect.id} delay_value`);
      requireChoice(parameters.delay_type, ["turns", "rounds", "actions", "attacks_received", "skills_used", "blocks_performed", "swaps_performed"], `Effect ${effect.id} delay_type`);
      requireChoice(parameters.target_tracking, ["original", "new_valid"], `Effect ${effect.id} target_tracking`);
      requireChoice(parameters.cancel_condition, ["none", "source_defeated", "target_defeated", "target_leaves_active", "shield_breaks"], `Effect ${effect.id} cancel_condition`);
      if (parameters.delay_type === "turns") requireChoice(parameters.delay_timing === undefined ? "end_of_turn" : parameters.delay_timing, ["start_of_turn", "end_of_turn"], `Effect ${effect.id} delay_timing`);
      if (typeof parameters.visible_countdown !== "boolean") throw new Error(`Effect ${effect.id} visible_countdown must be boolean.`);
      if (typeof parameters.repeat !== "boolean") throw new Error(`Effect ${effect.id} repeat must be boolean.`);
      if (typeof parameters.allow_multiple_at_once !== "boolean") {
        if (parameters.allow_multiple_at_once !== undefined) throw new Error(`Effect ${effect.id} allow_multiple_at_once must be boolean.`);
      }
      if (parameters.trigger_description !== undefined && typeof parameters.trigger_description !== "string") throw new Error(`Effect ${effect.id} trigger_description must be text.`);
    }
    for (const key of ["delay_value", "repeat_interval", "initial_delay", "number_of_activations", "activation_limit", "usage_limit", "maximum_effects_copied", "required_occurrences"]) {
      if (parameters[key] !== undefined && parameters[key] !== null) validateDuration(parameters[key], `Effect ${effect.id} ${key}`);
    }
    if (runtimeKey === "stat_modifier@2") {
      const allowedStats = effect.ownerType === "status"
        ? ["atk", "def", "spd", "block_cost", "swap_cost", "mana_dice_min", "mana_dice_max", "skill_cost"]
        : ["hp", "atk", "def", "spd", "block_cost", "swap_cost", "relic_slots"];
      requireChoice(parameters.stat, allowedStats, `Effect ${effect.id} stat`);
      requireChoice(parameters.value_mode, ["flat", "percentage"], `Effect ${effect.id} value_mode`);
      if (parameters.stat === "relic_slots" && parameters.value_mode !== "flat") throw new Error(`Effect ${effect.id} relic_slots is flat only.`);
      const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
      if (effect.ownerType === "status") {
        if (parameters.value_mode === "flat" && !Number.isInteger(amount)) throw new Error(`Effect ${effect.id} flat amount must be an integer.`);
        validateChance(parameters.chance === undefined ? 1 : parameters.chance, `Effect ${effect.id} chance`);
        requireChoice(parameters.application_mode, ["single_application", "incremental"], `Effect ${effect.id} application_mode`);
        if (parameters.application_mode === "incremental") {
          requireChoice(parameters.timing, ["start_of_turn", "end_of_turn"], `Effect ${effect.id} timing`);
          const spacing = requireFinite(parameters.spacing === undefined ? 1 : parameters.spacing, `Effect ${effect.id} spacing`);
          if (!Number.isInteger(spacing) || spacing < 1) throw new Error(`Effect ${effect.id} spacing must be a positive integer.`);
          requireChoice(parameters.removal_behavior, ["expire_on_removal", "keep_after_removal"], `Effect ${effect.id} removal_behavior`);
        } else if (parameters.removal_behavior !== undefined) {
          throw new Error(`Effect ${effect.id} removal_behavior requires incremental application_mode.`);
        }
        if (parameters.stat === "skill_cost") {
          requireChoice(parameters.skill_scope, ["all", "attack", "support"], `Effect ${effect.id} skill_scope`);
          if (parameters.skill_element_ids !== undefined) validateOptionalElementIds(parameters.skill_element_ids, `Effect ${effect.id} skill_element_ids`);
        } else if (parameters.skill_scope !== undefined || parameters.skill_element_ids !== undefined) {
          throw new Error(`Effect ${effect.id} skill cost filters require stat skill_cost.`);
        }
      }
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
      validateChance(parameters.activation_chance === undefined ? 1 : parameters.activation_chance, `Effect ${effect.id} activation_chance`);
    }
    if (runtimeKey === "conditional_effect@1") {
      const condition = requireChoice(parameters.condition, ["hp_percent", "shield_present", "shield_value", "mana", "active_state", "has_status", "has_relic", "relic_count", "last_squad_member", "action_order", "ally_defeated", "enemy_defeated", "turn_interval", "round_interval", "element", "tags", "previous_action", "previous_mana_roll", "has_stat_modifier"], `Effect ${effect.id} condition`);
      const comparison = requireChoice(parameters.comparison, ["equal", "not_equal", "above", "below", "at_least", "at_most", "negative", "positive"], `Effect ${effect.id} comparison`);
      if (condition === "has_stat_modifier" && !["negative", "positive"].includes(comparison)) {
        throw new Error(`Effect ${effect.id} comparison ${comparison} is not valid for Has Stat Modifier.`);
      }
      if (["shield_present", "active_state", "has_status", "has_relic", "last_squad_member", "ally_defeated", "enemy_defeated", "element", "tags", "action_order", "previous_action"].includes(condition) && !["equal", "not_equal"].includes(comparison)) {
        throw new Error(`Effect ${effect.id} comparison ${comparison} is not valid for ${condition}.`);
      }
      const conditionValue = String(parameters.condition_value ?? "");
      if (!["has_status", "has_stat_modifier", "tags"].includes(condition) && !conditionValue) throw new Error(`Effect ${effect.id} condition_value must be configured.`);
      if (condition === "has_status") {
        const statusIds = stringIds(parameters.condition_status_ids);
        if (!statusIds.length) throw new Error(`Effect ${effect.id} condition_status_ids must contain at least one Status ID.`);
      }
      if (condition === "has_stat_modifier") {
        const stats = stringIds(parameters.condition_stats);
        const allowedStats = new Set(["any", "atk", "def", "spd", "mana_dice", "swap_cost", "block_cost", "skill_cost"]);
        if (!stats.length || stats.some((stat) => !allowedStats.has(stat))) throw new Error(`Effect ${effect.id} condition_stats must contain supported stat keys.`);
        if (stats.includes("any") && stats.length > 1) throw new Error(`Effect ${effect.id} condition_stats cannot combine any with individual stats.`);
      }
      if (condition === "tags" && !stringIds(parameters.condition_target_critter_tag_ids).length) {
        throw new Error(`Effect ${effect.id} condition_target_critter_tag_ids must contain at least one Critter Tag ID.`);
      }
      if (condition === "hp_percent") {
        const value = Number(conditionValue);
        if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Effect ${effect.id} hp_percent condition_value must be between 0 and 1 (or legacy percentage points 0 and 100).`);
      }
      if (condition === "action_order" && !["first_overall", "last_overall", "before_skill_target", "after_skill_target", "first", "last", "1", "0", "-1"].includes(conditionValue)) throw new Error(`Effect ${effect.id} action_order condition_value must be First Overall, Last Overall, Before Skill Target, or After Skill Target.`);
      requireChoice(parameters.check_timing, ["continuous", "turn_start", "turn_end", "when_applied", "before_action"], `Effect ${effect.id} check_timing`);
    }
    if (runtimeKey === "critter_revival@1") {
      if (effect.ownerType !== "skill") throw new Error(`Effect ${effect.id} can only be owned by a skill.`);
      requireChoice(parameters.target, ["target_friendlies", "all_allies", "all_friendlies"], `Effect ${effect.id} target`);
      const mode = requireChoice(parameters.value_mode, ["flat", "percent_max_hp"], `Effect ${effect.id} value_mode`);
      const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
      if (amount <= 0 || (mode === "flat" && !Number.isInteger(amount))) {
        throw new Error(`Effect ${effect.id} amount must be positive${mode === "flat" ? " whole HP" : ""}.`);
      }
      validateChance(parameters.chance, `Effect ${effect.id} chance`);
    }
    if (runtimeKey === "action_cost_modifier@1") {
      requireChoice(parameters.applicable_action, ["all_actions", "skills_all", "skills_support", "skills_attack", "blocks", "swaps", "matching_skills", "attacks"], `Effect ${effect.id} applicable_action`);
      requireChoice(parameters.modifier_type, ["flat", "percentage", "set", "minimum", "maximum"], `Effect ${effect.id} modifier_type`);
      requireFinite(parameters.modifier_value, `Effect ${effect.id} modifier_value`);
      for (const key of ["minimum_cost", "maximum_cost"] as const) {
        const value = parameters[key];
        if (value !== null && value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) {
          throw new Error(`Effect ${effect.id} ${key} must be a nonnegative integer when present.`);
        }
      }
      if (typeof parameters.minimum_cost === "number" && typeof parameters.maximum_cost === "number" && parameters.minimum_cost > parameters.maximum_cost) {
        throw new Error(`Effect ${effect.id} minimum_cost cannot exceed maximum_cost.`);
      }
    }
    if (runtimeKey === "skill_usage_restriction@1") {
      if (effect.ownerType !== "skill") throw new Error(`Effect ${effect.id} can only be owned by a skill.`);
      if (effect.execution === "child") throw new Error(`Effect ${effect.id} must use root execution.`);
      const rechargeChance = requireFinite(parameters.recharge_chance, `Effect ${effect.id} recharge_chance`);
      validateChance(rechargeChance, `Effect ${effect.id} recharge_chance`);
      const rechargeTurns = requireFinite(parameters.recharge_turns, `Effect ${effect.id} recharge_turns`);
      if (!Number.isInteger(rechargeTurns) || rechargeTurns < 0) throw new Error(`Effect ${effect.id} recharge_turns must be a nonnegative integer.`);
      if (parameters.usage_limit !== null && parameters.usage_limit !== undefined) {
        validateDuration(parameters.usage_limit, `Effect ${effect.id} usage_limit`);
        requireChoice(parameters.usage_limit_scope, ["encounter", "dungeon"], `Effect ${effect.id} usage_limit_scope`);
      }
      if (rechargeChance <= 0 && (parameters.usage_limit === null || parameters.usage_limit === undefined)) {
        throw new Error(`Effect ${effect.id} must enable recharge or a usage limit.`);
      }
    }
    if (runtimeKey === "swap_after_attack@1") {
      if (effect.ownerType !== "skill") throw new Error(`Effect ${effect.id} can only be owned by a skill.`);
      requireChoice(parameters.target, ["selected_healthy_ally"], `Effect ${effect.id} target`);
      if (effect.execution === "child") throw new Error(`Effect ${effect.id} must use root execution.`);
      validateChance(parameters.chance, `Effect ${effect.id} chance`);
    }
    return;
  }

  if (runtimeKey === "stat_modifier@1") {
    const allowed = effect.ownerType === "ability"
      ? ["stat", "value_mode", "amount", "target", "target_element_ids"]
      : effect.ownerType === "skill"
        ? ["stat", "value_mode", "amount", "chance", "target", "target_element_ids", "source_element_ids"]
        : ["stat", "value_mode", "amount", "target", "target_element_ids", "source_element_ids"];
    if (effect.ownerType === "status") throw new Error(`Effect ${effect.id} cannot use ${runtimeKey} as a status effect.`);
    rejectUnknownKeys(parameters, allowed, `Effect ${effect.id}`);
    requireChoice(parameters.stat, ["hp", "atk", "def", "spd"], `Effect ${effect.id} stat`);
    const valueMode = requireChoice(parameters.value_mode, ["flat", "percentage"], `Effect ${effect.id} value_mode`);
    const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
    if (valueMode === "flat" && !Number.isInteger(amount)) throw new Error(`Effect ${effect.id} flat amount must be an integer.`);
    if (effect.ownerType === "skill") validateChance(parameters.chance, `Effect ${effect.id} chance`);
    if (target === "all_element_friendlies" || target === "all_element_enemies") validateElementIds(parameters.target_element_ids, `Effect ${effect.id} target_element_ids`);
    return;
  }

  if (runtimeKey === "mana_dice_modifier@1") {
    if (effect.ownerType !== "ability" && effect.ownerType !== "relic") throw new Error(`Effect ${effect.id} cannot use ${runtimeKey} as a ${effect.ownerType} effect.`);
    // Older authored rows persisted the hidden element picker as an empty
    // array for Relics. It is inert unless the target is explicitly elemental.
    rejectUnknownKeys(parameters, ["minimum_delta", "maximum_delta", "target", "target_element_ids", "source_element_ids"], `Effect ${effect.id}`);
    const minimum = requireFinite(parameters.minimum_delta, `Effect ${effect.id} minimum_delta`);
    const maximum = requireFinite(parameters.maximum_delta, `Effect ${effect.id} maximum_delta`);
    if (!Number.isInteger(minimum) || !Number.isInteger(maximum)) throw new Error(`Effect ${effect.id} Mana deltas must be integers.`);
    if (minimum === 0 && maximum === 0) throw new Error(`Effect ${effect.id} must change at least one Mana bound.`);
    if (target === "all_element_friendlies" || target === "all_element_enemies") validateElementIds(parameters.target_element_ids, `Effect ${effect.id} target_element_ids`);
    return;
  }

  if (runtimeKey === "apply_status@1") {
    if (effect.ownerType !== "skill") throw new Error(`Effect ${effect.id} can only be owned by a skill.`);
    rejectUnknownKeys(parameters, ["status_id", "chance", "target", "target_element_ids", "source_element_ids", "indefinite", "turns"], `Effect ${effect.id}`);
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
    rejectUnknownKeys(parameters, ["value_mode", "amount", "chance", "target", "target_element_ids", "source_element_ids"], `Effect ${effect.id}`);
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
