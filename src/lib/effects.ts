import type { EffectOwnerType, EffectTarget, ResolvedEffectRef } from "./types.js";

export const SUPPORTED_EFFECT_RUNTIMES = new Set([
  "stat_modifier@1",
  "mana_dice_modifier@1",
  "apply_status@1",
  "restore_hp@1",
  "damage_over_time@1",
  "skip_action_chance@1",
]);

const TARGETS_BY_OWNER: Record<EffectOwnerType, ReadonlySet<EffectTarget>> = {
  skill: new Set(["skill_user", "selected_target", "all_enemies", "all_allies", "all_friendlies"]),
  ability: new Set(["all_friendly_critters", "all_enemies", "active_friendly_critter"]),
  relic: new Set(["equipped_critter", "all_friendly_critters"]),
  status: new Set(["status_holder"]),
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

  if (runtimeKey === "stat_modifier@1") {
    rejectUnknownKeys(parameters, ["stat", "mode", "amount", "target"], `Effect ${effect.id}`);
    requireChoice(parameters.stat, ["hp", "atk", "def", "spd"], `Effect ${effect.id} stat`);
    requireChoice(parameters.mode, ["flat", "percentage"], `Effect ${effect.id} mode`);
    requireFinite(parameters.amount, `Effect ${effect.id} amount`);
    return;
  }

  if (runtimeKey === "mana_dice_modifier@1") {
    rejectUnknownKeys(parameters, ["minimum_delta", "maximum_delta", "target"], `Effect ${effect.id}`);
    const minimum = parameters.minimum_delta === undefined ? 0 : requireFinite(parameters.minimum_delta, `Effect ${effect.id} minimum_delta`);
    const maximum = parameters.maximum_delta === undefined ? 0 : requireFinite(parameters.maximum_delta, `Effect ${effect.id} maximum_delta`);
    if (minimum === 0 && maximum === 0) throw new Error(`Effect ${effect.id} must change at least one Mana Dice bound.`);
    return;
  }

  if (runtimeKey === "apply_status@1") {
    rejectUnknownKeys(parameters, ["status_id", "chance", "target"], `Effect ${effect.id}`);
    if (typeof parameters.status_id !== "string" || !parameters.status_id) {
      throw new Error(`Effect ${effect.id} status_id must be a non-empty string.`);
    }
    const chance = requireFinite(parameters.chance, `Effect ${effect.id} chance`);
    if (chance < 0 || chance > 1) throw new Error(`Effect ${effect.id} chance must be between 0 and 1.`);
    return;
  }

  if (runtimeKey === "restore_hp@1") {
    rejectUnknownKeys(parameters, ["mode", "amount", "target"], `Effect ${effect.id}`);
    const mode = requireChoice(parameters.mode, ["flat", "percent_max_hp"], `Effect ${effect.id} mode`);
    const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
    if (amount < 0 || (mode === "percent_max_hp" && amount > 1)) {
      throw new Error(`Effect ${effect.id} amount is outside the allowed range.`);
    }
    return;
  }

  if (runtimeKey === "damage_over_time@1") {
    rejectUnknownKeys(parameters, ["timing", "mode", "amount", "duration", "target"], `Effect ${effect.id}`);
    requireChoice(parameters.timing, ["start_of_turn", "end_of_turn"], `Effect ${effect.id} timing`);
    const mode = requireChoice(parameters.mode, ["flat", "percent_max_hp"], `Effect ${effect.id} mode`);
    const amount = requireFinite(parameters.amount, `Effect ${effect.id} amount`);
    if (amount < 0 || (mode === "percent_max_hp" && amount > 1)) {
      throw new Error(`Effect ${effect.id} amount is outside the allowed range.`);
    }
    validateDuration(parameters.duration, `Effect ${effect.id} duration`);
    if (effect.ownerType === "skill" && parameters.duration === undefined) {
      throw new Error(`Skill effect ${effect.id} must snapshot a positive duration.`);
    }
    return;
  }

  rejectUnknownKeys(parameters, ["chance", "duration", "target"], `Effect ${effect.id}`);
  const chance = requireFinite(parameters.chance, `Effect ${effect.id} chance`);
  if (chance < 0 || chance > 1) throw new Error(`Effect ${effect.id} chance must be between 0 and 1.`);
  validateDuration(parameters.duration, `Effect ${effect.id} duration`);
}
