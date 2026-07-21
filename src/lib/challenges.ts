import { critterElementIds } from "./game.js";
import { safeBigInt } from "./collectibles.js";
import type {
  AppData,
  CollectibleUnlockChallenge,
  Critter,
  PlayerState,
} from "./types.js";

export type ChallengeEventType =
  | "battle_completed"
  | "dungeon_completed"
  | "resource_spent"
  | "shop_purchase_committed"
  | "swap_completed"
  | "block_completed"
  | "dice_resolved"
  | "critter_knocked_out"
  | "hp_damage_dealt"
  | "hp_damage_taken"
  | "skill_resolved";

export type ChallengeEvent = {
  eventId: string;
  type: ChallengeEventType;
  catalogVersion?: string;
  battleId?: string;
  dungeonRunId?: string;
  dungeonId?: string;
  turn?: number;
  sourceCritterId?: string;
  targetCritterId?: string;
  sourceElementIds?: string[];
  targetElementIds?: string[];
  skillId?: string;
  abilityId?: string;
  rollcasterId?: string;
  amount?: number;
  payload?: Record<string, unknown>;
};

const trackedTypes = new Set([
  "knock_out_critters", "deal_damage", "take_damage", "use_skill",
  "squad_composition", "dungeon_clear", "resource_spending",
  "swap_action", "block_action", "dice_roll",
]);

function parametersOf(challenge: CollectibleUnlockChallenge): Record<string, unknown> {
  if (challenge.parameters && typeof challenge.parameters === "object") return challenge.parameters;
  return {
    target_category: challenge.target_category,
    target_id: challenge.target_id,
    target_mode: challenge.target_mode,
    any_target: challenge.any_target,
    target_ids: challenge.target_ids,
    required_amount: challenge.required_amount == null ? 0 : Number(challenge.required_amount),
    required_level: challenge.required_level,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))] : [];
}

function includesOrAny(filter: string[], value: string | undefined): boolean {
  return filter.length === 0 || (value !== undefined && filter.includes(value));
}

function eventTypeFor(challengeType: string): ChallengeEventType | null {
  return {
    knock_out_critters: "critter_knocked_out",
    deal_damage: "hp_damage_dealt",
    take_damage: "hp_damage_taken",
    use_skill: "skill_resolved",
    squad_composition: "battle_completed",
    dungeon_clear: "dungeon_completed",
    resource_spending: "resource_spent",
    swap_action: "swap_completed",
    block_action: "block_completed",
    dice_roll: "dice_resolved",
  }[challengeType] as ChallengeEventType | undefined ?? null;
}

function matchesLegacyTarget(challenge: CollectibleUnlockChallenge, event: ChallengeEvent): boolean {
  const parameters = parametersOf(challenge);
  const payload = event.payload ?? {};
  const anyTarget = parameters.any_target === true || challenge.any_target === true;
  if (anyTarget) return true;
  const targetMode = String(parameters.target_mode ?? challenge.target_mode ?? "");
  const ids = stringArray(parameters.target_ids ?? challenge.target_ids);
  if (!ids.length) return false;
  if (targetMode === "species") return Boolean(event.targetCritterId && ids.includes(event.targetCritterId));
  if (targetMode === "skill") return Boolean(event.skillId && ids.includes(event.skillId));
  if (targetMode === "element") {
    const targetElements = event.targetElementIds ?? stringArray(payload.target_element_ids);
    return ids.some((id) => targetElements.includes(id));
  }
  return false;
}

function compare(value: number, operator: string, target: number): boolean {
  if (operator === "equal") return value === target;
  if (operator === "greater_than") return value > target;
  if (operator === "greater_than_or_equal") return value >= target;
  if (operator === "less_than") return value < target;
  if (operator === "less_than_or_equal") return value <= target;
  return false;
}

export function challengeEventIncrement(challenge: CollectibleUnlockChallenge, event: ChallengeEvent): number {
  const type = challenge.challenge_type;
  const p = parametersOf(challenge);
  const expectedType = type === "squad_composition"
    ? String(p.completion_event ?? "battle_win") === "dungeon_clear" ? "dungeon_completed" : "battle_completed"
    : eventTypeFor(type);
  if (!expectedType || event.type !== expectedType) return 0;

  if (["knock_out_critters", "deal_damage", "take_damage", "use_skill"].includes(type)) {
    if (!matchesLegacyTarget(challenge, event)) return 0;
    return type === "knock_out_critters" || type === "use_skill" ? 1 : Math.max(0, Math.floor(event.amount ?? 0));
  }

  if (type === "resource_spending") {
    if (String(p.spending_context) !== String(event.payload?.spending_context ?? event.payload?.context)) return 0;
    if (String(p.resource_type) !== String(event.payload?.resource_type)) return 0;
    if (!includesOrAny(stringArray(p.dungeon_ids), event.dungeonId)) return 0;
    if (!includesOrAny(stringArray(p.ability_ids), event.abilityId)) return 0;
    if (!includesOrAny(stringArray(p.critter_ids), event.sourceCritterId)) return 0;
    if (!includesOrAny(stringArray(p.rollcaster_ids), event.rollcasterId)) return 0;
    return Math.max(0, Math.floor(event.amount ?? 0));
  }

  if (type === "swap_action") {
    const payload = event.payload ?? {};
    if (!includesOrAny(stringArray(p.dungeon_ids), event.dungeonId ?? String(payload.dungeon_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.critter_ids), event.sourceCritterId ?? String(payload.incoming_critter_id ?? ""))) return 0;
    const sourceElements = event.sourceElementIds ?? stringArray(payload.source_element_ids ?? payload.incoming_element_ids);
    if (!includesOrAny(stringArray(p.element_ids), sourceElements[0])) return 0;
    const action = String(p.tracked_action);
    if (action === "unique_critters_swapped_in") return payload.unique === true ? 1 : 0;
    if (action === "damage_avoided_by_swap") return Math.max(0, Math.floor(Number(payload.damage_avoided ?? event.amount ?? 0)));
    return action === "knockout_after_swap" ? (payload.knockout_after_swap === true ? 1 : 0) : 1;
  }

  if (type === "block_action") {
    if (!includesOrAny(stringArray(p.dungeon_ids), event.dungeonId)) return 0;
    if (!includesOrAny(stringArray(p.critter_ids), event.sourceCritterId)) return 0;
    if (!includesOrAny(stringArray(p.enemy_critter_ids), event.targetCritterId)) return 0;
    const action = String(p.tracked_action);
    if (action === "damage_prevented") return Math.max(0, Math.floor(Number(event.payload?.damage_prevented ?? event.amount ?? 0)));
    if (action === "attacks_fully_blocked") return event.payload?.fully_blocked === true ? 1 : 0;
    if (action === "survived_attack_after_block") return event.payload?.survived === true ? 1 : 0;
    return 1;
  }

  if (type === "dice_roll") {
    const payload = event.payload ?? {};
    if (!includesOrAny(stringArray(p.die_types), String(payload.die_type ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.ability_ids), event.abilityId)) return 0;
    if (!includesOrAny(stringArray(p.critter_ids), event.sourceCritterId)) return 0;
    const resultType = String(p.tracked_result);
    const value = resultType === "turn_mana_total"
      ? Number(payload.turn_mana_total ?? event.amount ?? 0)
      : Number(payload.modified_value ?? payload.natural_value ?? event.amount ?? 0);
    if (resultType === "matching_dice" && Number(payload.matching_count ?? 0) < Number(p.target_value ?? 0)) return 0;
    if (resultType === "maximum_die_result" && Number(payload.natural_value) !== Number(payload.natural_maximum)) return 0;
    return compare(value, String(p.comparison ?? "equal"), Number(p.target_value ?? 0)) ? 1 : 0;
  }

  if (type === "squad_composition") {
    if (event.payload?.won !== true) return 0;
    const squad = Array.isArray(event.payload?.squad) ? event.payload.squad as Array<Record<string, unknown>> : [];
    const includedCritters = new Set(squad.map((unit) => String(unit.critter_id ?? "")));
    if (!stringArray(p.required_critter_ids).every((id) => includedCritters.has(id))) return 0;
    const elements = new Set(squad.flatMap((unit) => stringArray(unit.element_ids)));
    if (!stringArray(p.required_element_ids).every((id) => elements.has(id))) return 0;
    const matching = squad.filter((unit) => stringArray(p.required_critter_ids).includes(String(unit.critter_id)) || stringArray(p.required_element_ids).some((id) => stringArray(unit.element_ids).includes(id))).length;
    if (p.required_matching_critters != null && matching < Number(p.required_matching_critters)) return 0;
    if (p.required_distinct_elements != null && elements.size < Number(p.required_distinct_elements)) return 0;
    if (p.all_squad_members_must_match === true && matching !== squad.length) return 0;
    if (p.require_survival === true && event.payload?.survivors_complete !== true) return 0;
    return 1;
  }

  if (type === "dungeon_clear") {
    if (event.type !== "dungeon_completed" || event.payload?.won !== true) return 0;
    const dungeonId = event.dungeonId ?? "";
    const selected = String(p.dungeon_selection ?? "any_dungeon");
    const dungeonIds = stringArray(p.dungeon_ids);
    if (!dungeonIds.length && typeof p.dungeon_id === "string") dungeonIds.push(p.dungeon_id);
    if (selected === "specific_dungeon" && !dungeonIds.includes(dungeonId)) return 0;
    if (selected === "dungeon_id_range") {
      const order = Number(event.payload?.dungeon_order ?? NaN);
      if (!Number.isFinite(order) || order < Number(p.minimum_dungeon_order ?? -Infinity) || order > Number(p.maximum_dungeon_order ?? Infinity)) return 0;
    }
    if (p.require_relic_activation === true && event.payload?.required_relics_activated !== true) return 0;
    return 1;
  }
  return 0;
}

export function applyChallengeEventIncrement(
  progress: number | bigint,
  goal: number | bigint,
  challenge: CollectibleUnlockChallenge,
  event: ChallengeEvent,
): bigint {
  const current = safeBigInt(progress);
  const target = safeBigInt(goal);
  const increment = BigInt(Math.max(0, Math.floor(challengeEventIncrement(challenge, event))));
  return increment > 0n ? (current + increment > target ? target : current + increment) : current;
}

function ownedCritters(data: AppData): Array<{ id: string; critter: Critter }> {
  return (data.player?.critters ?? []).flatMap((owned) => {
    const critter = data.catalog.critters.find((row) => row.id === owned.critter_id);
    return critter ? [{ id: owned.id, critter }] : [];
  });
}

export function derivedChallengeProgress(data: AppData, challenge: CollectibleUnlockChallenge): bigint {
  const p = parametersOf(challenge);
  const player = data.player;
  if (!player) return 0n;
  if (challenge.challenge_type === "level_up_critter") {
    const id = String(p.critter_id ?? challenge.target_id ?? "");
    return BigInt(player.critters.find((owned) => owned.critter_id === id)?.level ?? 0);
  }
  if (challenge.challenge_type === "own_collectible") {
    const category = String(p.collectible_category ?? challenge.target_category ?? "critter");
    const ids = stringArray(p.collectible_ids);
    if (category === "critter") return BigInt(player.critters.filter((owned) => ids.length === 0 || ids.includes(owned.critter_id)).length);
    if (category === "rollcaster") return BigInt(player.rollcasters.filter((owned) => ids.length === 0 || ids.includes(owned.rollcaster_id)).length);
    const rows = player.relicInventory.filter((owned) => (ids.length === 0 || ids.includes(owned.relic_id)) && owned.discovered_at !== null);
    return BigInt(p.require_unique_collectibles === false ? rows.reduce((sum, row) => sum + row.quantity, 0) : rows.filter((row) => row.quantity > 0).length);
  }
  if (challenge.challenge_type === "collection_diversity") {
    const buckets = new Map<string, Set<string>>();
    for (const { id, critter } of ownedCritters(data)) for (const element of critterElementIds(critter)) buckets.set(element, new Set([...(buckets.get(element) ?? []), id]));
    const requiredPerType = Number(p.required_per_type ?? 1);
    const mode = String(p.diversity_mode ?? "different_types");
    if (mode === "amount_of_type") return BigInt((buckets.get(stringArray(p.element_ids)[0]) ?? new Set()).size);
    const selected = mode === "specific_types" ? stringArray(p.required_element_ids) : [...buckets.keys()];
    return BigInt(selected.filter((element) => (buckets.get(element)?.size ?? 0) >= requiredPerType).length);
  }
  if (challenge.challenge_type === "shop_shards") return safeBigInt(player.collectibleSnapshot.shards.find((row) => row.collectible_type === challenge.collectible_type && row.collectible_id === challenge.collectible_id)?.quantity);
  if (challenge.challenge_type === "shop_relic") return safeBigInt(player.relicInventory.find((row) => row.relic_id === challenge.collectible_id)?.quantity);
  return safeBigInt(player.collectibleSnapshot.progress.find((row) => row.challenge_id === challenge.id)?.current);
}

export function isTrackedChallengeType(challenge: CollectibleUnlockChallenge): boolean {
  return trackedTypes.has(challenge.challenge_type);
}

export function trackedChallengesForPlayer(player: PlayerState, catalog: AppData["catalog"]): CollectibleUnlockChallenge[] {
  const trackedIds = new Set(player.collectibleSnapshot.tracked.map((row) => row.challenge_id));
  return catalog.collectibleUnlockChallenges.filter((challenge) => trackedIds.has(challenge.id) && isTrackedChallengeType(challenge));
}
