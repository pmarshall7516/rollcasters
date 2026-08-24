import { critterElementIds } from "./game.js";
import { collectibleIsUnlocked, safeBigInt } from "./collectibles.js";
import { collectionDiversityProgress } from "./collection-diversity.js";
import { maximumDistinctElementMatches } from "./element-matching.js";
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
  | "hp_healed"
  | "status_afflicted"
  | "status_turn_completed"
  | "stun_activated"
  | "shield_shattered"
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
  sourceCritterTagIds?: string[];
  targetCritterTagIds?: string[];
  skillTagIds?: string[];
  skillType?: "attack" | "support";
  skillId?: string;
  abilityId?: string;
  rollcasterId?: string;
  shopId?: string;
  purchasedCollectibleCategory?: string;
  amount?: number;
  payload?: Record<string, unknown>;
};

const trackedTypes = new Set([
  "knock_out_critters", "deal_damage", "take_damage", "use_skill",
  "squad_composition", "dungeon_clear", "resource_spending",
  "swap_action", "block_action", "dice_roll",
  "heal_hp", "afflict_status", "stun_activation",
  "shields_shattered",
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

function eventArray(event: ChallengeEvent, key: "sourceCritterTagIds" | "targetCritterTagIds" | "skillTagIds", payloadKey: string): string[] {
  return stringArray(event[key] ?? event.payload?.[payloadKey]);
}

function matchesAnyFilter(filter: unknown, values: string[] | string | undefined): boolean {
  const selected = stringArray(filter);
  const candidates = Array.isArray(values) ? values : values ? [values] : [];
  return selected.length === 0 || selected.some((value) => candidates.includes(value));
}

function matchesCombatFilters(challenge: CollectibleUnlockChallenge, event: ChallengeEvent): boolean {
  const p = parametersOf(challenge);
  const payload = event.payload ?? {};
  const sourceElements = event.sourceElementIds ?? stringArray(payload.source_element_ids);
  const targetElements = event.targetElementIds ?? stringArray(payload.target_element_ids);
  const sourceTags = eventArray(event, "sourceCritterTagIds", "source_critter_tag_ids");
  const targetTags = eventArray(event, "targetCritterTagIds", "target_critter_tag_ids");
  const skillTags = eventArray(event, "skillTagIds", "skill_tag_ids");
  const skillType = event.skillType ?? (typeof payload.skill_type === "string" ? payload.skill_type : undefined);
  if (!matchesAnyFilter(p.source_critter_ids, event.sourceCritterId)) return false;
  if (!matchesAnyFilter(p.source_element_ids, sourceElements)) return false;
  if (!matchesAnyFilter(p.source_critter_tag_ids, sourceTags)) return false;
  if (!matchesAnyFilter(p.source_skill_tag_ids, skillTags)) return false;
  if (!matchesAnyFilter(p.target_critter_ids, event.targetCritterId)) return false;
  if (!matchesAnyFilter(p.target_element_ids, targetElements)) return false;
  if (!matchesAnyFilter(p.target_critter_tag_ids, targetTags)) return false;
  if (challenge.challenge_type === "use_skill") {
    const selectedSkillType = String(p.skill_type ?? "any");
    if (selectedSkillType !== "any" && selectedSkillType !== skillType) return false;
    if (!matchesAnyFilter(p.skill_tag_ids, skillTags)) return false;
    if (!matchesAnyFilter(p.skill_ids, event.skillId)) return false;
    if (!matchesAnyFilter(p.element_ids, [String(event.payload?.skill_element_id ?? "")])) return false;
  }
  return true;
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
    heal_hp: "hp_healed",
    afflict_status: "status_afflicted",
    stun_activation: "stun_activated",
    shields_shattered: "shield_shattered",
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

function damageAmountFor(challenge: CollectibleUnlockChallenge, event: ChallengeEvent): number {
  const mode = String(parametersOf(challenge).damage_mode ?? "any");
  if (!["any", "hp_only", "shield_only"].includes(mode)) return 0;
  const payload = event.payload ?? {};
  const hasHpComponent = typeof payload.hp_damage === "number";
  const hasShieldComponent = typeof payload.shield_damage === "number";
  if (hasHpComponent !== hasShieldComponent) return 0;
  const hasComponents = hasHpComponent && hasShieldComponent;
  const eventAmount = Math.max(0, Math.floor(event.amount ?? 0));
  const hpDamage = typeof payload.hp_damage === "number" ? Math.max(0, Math.floor(payload.hp_damage)) : hasComponents ? 0 : eventAmount;
  const shieldDamage = typeof payload.shield_damage === "number" ? Math.max(0, Math.floor(payload.shield_damage)) : 0;
  const total = hasComponents ? hpDamage + shieldDamage : eventAmount;
  if (mode === "hp_only") return hpDamage;
  if (mode === "shield_only") return shieldDamage;
  return total;
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
    : type === "defeat_rollcaster_type" ? "battle_completed"
    : type === "afflict_status" && String(p.affliction_mode ?? "fresh_afflictions") === "afflicted_turns" ? "status_turn_completed"
    : eventTypeFor(type);
  if (!expectedType || event.type !== expectedType) return 0;

  if (type === "defeat_rollcaster_type") {
    const payload = event.payload ?? {};
    if (payload.won !== true) return 0;
    return stringArray(p.rollcaster_types).includes(String(payload.enemy_rollcaster_type ?? "")) ? 1 : 0;
  }

  if (["knock_out_critters", "deal_damage", "take_damage", "use_skill"].includes(type)) {
    const hasExpandedFilters = Object.keys(p).some((key) => key.endsWith("_tag_ids") || ["source_critter_ids", "source_element_ids", "target_critter_ids", "target_element_ids", "skill_ids", "element_ids", "skill_type", "tracking_scope", "damage_mode"].includes(key));
    if (hasExpandedFilters ? !matchesCombatFilters(challenge, event) : !matchesLegacyTarget(challenge, event)) return 0;
    return type === "knock_out_critters" || type === "use_skill" ? 1 : damageAmountFor(challenge, event);
  }

  if (type === "heal_hp") {
    const payload = event.payload ?? {};
    if (String(payload.source_side ?? "") !== "player") return 0;
    const recipientSide = String(p.recipient_side ?? "any");
    if (recipientSide !== "any" && recipientSide !== String(payload.recipient_side ?? "")) return 0;
    if (!matchesAnyFilter(p.target_critter_ids, event.targetCritterId)) return 0;
    if (!matchesAnyFilter(p.target_element_ids, event.targetElementIds ?? stringArray(payload.target_element_ids))) return 0;
    if (!matchesAnyFilter(p.source_critter_ids, event.sourceCritterId)) return 0;
    if (!matchesAnyFilter(p.source_element_ids, event.sourceElementIds ?? stringArray(payload.source_element_ids))) return 0;
    if (!matchesAnyFilter(p.source_critter_tag_ids, eventArray(event, "sourceCritterTagIds", "source_critter_tag_ids"))) return 0;
    if (!matchesAnyFilter(p.source_skill_tag_ids, eventArray(event, "skillTagIds", "skill_tag_ids"))) return 0;
    if (!matchesAnyFilter(p.target_critter_tag_ids, eventArray(event, "targetCritterTagIds", "target_critter_tag_ids"))) return 0;
    return Math.max(0, Math.floor(event.amount ?? 0));
  }

  if (type === "afflict_status") {
    const payload = event.payload ?? {};
    const mode = String(p.affliction_mode ?? "fresh_afflictions");
    const expectedEvent = mode === "afflicted_turns" ? "status_turn_completed" : "status_afflicted";
    if (event.type !== expectedEvent) return 0;
    const targetSide = String(p.target_side ?? "any");
    const eventTargetSide = String(payload.target_side ?? "");
    if (targetSide === "enemies" && eventTargetSide !== "opponent") return 0;
    if (targetSide === "friendlies" && eventTargetSide !== "player") return 0;
    const selectedStatuses = stringArray(p.status_ids);
    const eventStatuses = stringArray(payload.status_ids).concat(typeof payload.status_id === "string" ? [payload.status_id] : []);
    if (selectedStatuses.length && !selectedStatuses.some((statusId) => eventStatuses.includes(statusId))) return 0;
    if (mode === "fresh_afflictions" && payload.fresh !== true) return 0;
    return 1;
  }

  if (type === "stun_activation") {
    const targetSide = String(p.target_side ?? "any");
    const eventTargetSide = String(event.payload?.target_side ?? "");
    if (targetSide === "enemies" && eventTargetSide !== "opponent") return 0;
    if (targetSide === "friendlies" && eventTargetSide !== "player") return 0;
    return 1;
  }

  if (type === "shields_shattered") {
    if (event.type !== "shield_shattered" || event.amount !== 1 || event.payload?.shield_shattered !== true) return 0;
    const shieldSide = String(p.shield_side ?? "any");
    const targetSide = String(event.payload.target_side ?? "");
    if (shieldSide === "friendlies" && targetSide !== "player") return 0;
    if (shieldSide === "enemies" && targetSide !== "opponent") return 0;
    return 1;
  }

  if (type === "resource_spending") {
    const payload = event.payload ?? {};
    if (String(p.spending_context) !== String(payload.spending_context ?? payload.context)) return 0;
    if (String(p.resource_type) !== String(payload.resource_type)) return 0;
    if (p.resource_type === "custom_currency" && String(p.custom_currency_id) !== String(payload.custom_currency_id ?? payload.currency_id)) return 0;
    if (!includesOrAny(stringArray(p.dungeon_ids), event.dungeonId ?? String(payload.dungeon_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.ability_ids), event.abilityId ?? String(payload.ability_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.critter_ids), event.sourceCritterId ?? String(payload.critter_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.rollcaster_ids), event.rollcasterId ?? String(payload.rollcaster_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.shop_ids), event.shopId ?? String(payload.shop_id ?? payload.shop_entry_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.purchased_collectible_categories), event.purchasedCollectibleCategory ?? String(payload.purchased_collectible_category ?? ""))) return 0;
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
    const requiredCritterIds = stringArray(p.required_critter_ids);
    const requiredElementIds = stringArray(p.required_element_ids);
    const matchingRows = squad.filter((unit) => requiredCritterIds.includes(String(unit.critter_id)) || requiredElementIds.some((id) => stringArray(unit.element_ids).includes(id)));
    const matchingCritterIds = new Set(matchingRows.map((unit) => String(unit.critter_id ?? "")).filter(Boolean));
    if (p.required_matching_critters != null && matchingCritterIds.size < Number(p.required_matching_critters)) return 0;
    if (p.required_matching_critters != null && Number(p.required_matching_critters) >= requiredElementIds.length &&
      maximumDistinctElementMatches(squad.map((unit) => ({ id: String(unit.critter_id ?? ""), elementIds: stringArray(unit.element_ids) })), requiredElementIds) < requiredElementIds.length) return 0;
    if (p.required_distinct_elements != null && elements.size < Number(p.required_distinct_elements)) return 0;
    if (p.all_squad_members_must_match === true && matchingRows.length !== squad.length) return 0;
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
    if (category === "critter") return BigInt(player.critters.filter((owned) => collectibleIsUnlocked(data, "critter", owned.critter_id) && (ids.length === 0 || ids.includes(owned.critter_id))).length);
    if (category === "rollcaster") return BigInt(player.rollcasters.filter((owned) => collectibleIsUnlocked(data, "rollcaster", owned.rollcaster_id) && (ids.length === 0 || ids.includes(owned.rollcaster_id))).length);
    const rows = player.relicInventory.filter((owned) => collectibleIsUnlocked(data, "relic", owned.relic_id) && (ids.length === 0 || ids.includes(owned.relic_id)) && owned.discovered_at !== null);
    const specificMode = String(p.specific_collectible_mode ?? "");
    return BigInt(specificMode === "quantity" || p.require_unique_collectibles === false
      ? rows.reduce((sum, row) => sum + row.quantity, 0)
      : rows.length);
  }
  if (challenge.challenge_type === "collection_diversity") {
    return collectionDiversityProgress(
      ownedCritters(data).map(({ critter }) => ({ id: critter.id, elementIds: critterElementIds(critter) })),
      p,
    );
  }
  if (challenge.challenge_type === "shop_shards") return safeBigInt(player.collectibleSnapshot.shards.find((row) => row.collectible_type === challenge.collectible_type && row.collectible_id === challenge.collectible_id)?.quantity);
  if (challenge.challenge_type === "shop_relic") return safeBigInt(player.relicInventory.find((row) => row.relic_id === challenge.collectible_id)?.quantity);
  return safeBigInt(player.collectibleSnapshot.progress.find((row) => row.challenge_id === challenge.id)?.current);
}

export function isTrackedChallengeType(challenge: CollectibleUnlockChallenge): boolean {
  return trackedTypes.has(challenge.challenge_type)
    && parametersOf(challenge).tracking_required !== false;
}

export function trackedChallengesForPlayer(player: PlayerState, catalog: AppData["catalog"]): CollectibleUnlockChallenge[] {
  const trackedIds = new Set(player.collectibleSnapshot.tracked.map((row) => row.challenge_id));
  return catalog.collectibleUnlockChallenges.filter((challenge) => trackedIds.has(challenge.id) && isTrackedChallengeType(challenge));
}
