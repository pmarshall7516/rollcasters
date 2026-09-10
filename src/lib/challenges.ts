import { critterElementIds } from "./game.js";
import { collectibleIsUnlocked, safeBigInt, TRACKED_CHALLENGE_TYPES } from "./collectibles.js";
import { collectionDiversityProgress } from "./collection-diversity.js";
import { maximumDistinctElementMatches } from "./element-matching.js";
import type {
  AppData,
  CollectibleUnlockChallenge,
  Critter,
  PlayerState,
  EffectivenessClass,
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
  | "effect_removed"
  | "stun_activated"
  | "shield_shattered"
  | "effectiveness_strike"
  | "effectiveness_skill_resolved"
  | "final_knockout_attribution"
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

type SkillTargetContext = {
  critterId: string;
  side: string;
  elementIds: string[];
  tagIds: string[];
};

function skillTargetContexts(event: ChallengeEvent): SkillTargetContext[] {
  const raw = event.payload?.target_contexts;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const context = value as Record<string, unknown>;
    const critterId = typeof context.critter_id === "string" ? context.critter_id : "";
    const side = typeof context.side === "string" ? context.side : "";
    if (!critterId || !side) return [];
    return [{
      critterId,
      side,
      elementIds: stringArray(context.element_ids),
      tagIds: stringArray(context.critter_tag_ids ?? context.tag_ids),
    }];
  });
}

function matchesUseSkillTargetFilters(challenge: CollectibleUnlockChallenge, event: ChallengeEvent): boolean {
  const p = parametersOf(challenge);
  const targetIds = stringArray(p.target_critter_ids);
  const targetElements = stringArray(p.target_element_ids);
  const targetTags = stringArray(p.target_critter_tag_ids);
  const hasTargetScope = Object.prototype.hasOwnProperty.call(p, "target_side")
    || targetIds.length > 0
    || targetElements.length > 0
    || targetTags.length > 0;
  if (!hasTargetScope) return true;
  const contexts = skillTargetContexts(event);
  if (contexts.length === 0 && !Object.prototype.hasOwnProperty.call(p, "target_side")) {
    const payload = event.payload ?? {};
    const declaredTargetIds = stringArray(payload.target_critter_ids);
    const resolvedTargetIds = [...(event.targetCritterId ? [event.targetCritterId] : []), ...declaredTargetIds];
    const filterGroupCount = [targetIds, targetElements, targetTags].filter((filter) => filter.length > 0).length;
    const singleTargetKnown = Boolean(event.targetCritterId)
      && (!Array.isArray(payload.target_critter_ids)
        || (declaredTargetIds.length === 1 && declaredTargetIds[0] === event.targetCritterId));
    if (filterGroupCount > 1 && !singleTargetKnown) return false;
    return matchesAnyFilter(targetIds, resolvedTargetIds)
      && matchesAnyFilter(targetElements, stringArray(payload.target_element_ids))
      && matchesAnyFilter(targetTags, stringArray(payload.target_critter_tag_ids));
  }
  const targetSide = String(p.target_side ?? "any");
  if (!["enemies", "friendlies", "any"].includes(targetSide)) return false;
  return contexts.some((target) => {
    if (target.side !== "player" && target.side !== "opponent") return false;
    if (targetSide === "enemies" && target.side !== "opponent") return false;
    if (targetSide === "friendlies" && target.side !== "player") return false;
    if (targetIds.length > 0 && !targetIds.includes(target.critterId)) return false;
    if (targetElements.length > 0 && !targetElements.some((id) => target.elementIds.includes(id))) return false;
    if (targetTags.length > 0 && !targetTags.some((id) => target.tagIds.includes(id))) return false;
    return true;
  });
}

function matchesCombatFilters(challenge: CollectibleUnlockChallenge, event: ChallengeEvent): boolean {
  const p = parametersOf(challenge);
  const payload = event.payload ?? {};
  const sourceElements = event.sourceElementIds ?? stringArray(payload.source_element_ids);
  const targetElements = event.targetElementIds ?? stringArray(payload.target_element_ids);
  const targetCritterIds = [
    ...(event.targetCritterId ? [event.targetCritterId] : []),
    ...stringArray(payload.target_critter_ids),
  ];
  const sourceTags = eventArray(event, "sourceCritterTagIds", "source_critter_tag_ids");
  const targetTags = eventArray(event, "targetCritterTagIds", "target_critter_tag_ids");
  const skillTags = eventArray(event, "skillTagIds", "skill_tag_ids");
  const skillType = event.skillType ?? (typeof payload.skill_type === "string" ? payload.skill_type : undefined);
  const exactSkillIds = stringArray(p.skill_ids);
  const exactSkillMatch = ["knock_out_critters", "deal_damage"].includes(challenge.challenge_type) && exactSkillIds.length > 0;
  if (!matchesAnyFilter(p.source_critter_ids, event.sourceCritterId)) return false;
  if (!matchesAnyFilter(p.source_element_ids, sourceElements)) return false;
  if (!matchesAnyFilter(p.source_critter_tag_ids, sourceTags)) return false;
  if (exactSkillMatch
    ? !matchesAnyFilter(exactSkillIds, event.skillId)
    : !matchesAnyFilter(p.source_skill_tag_ids, skillTags)) return false;
  if (challenge.challenge_type === "use_skill") {
    if (!matchesUseSkillTargetFilters(challenge, event)) return false;
  } else {
    if (!matchesAnyFilter(p.target_critter_ids, targetCritterIds)) return false;
    if (!matchesAnyFilter(p.target_element_ids, targetElements)) return false;
    if (!matchesAnyFilter(p.target_critter_tag_ids, targetTags)) return false;
  }
  if (challenge.challenge_type === "use_skill" || challenge.challenge_type === "effectiveness_strike" || challenge.challenge_type === "closing_move") {
    const selectedSkillType = String(p.skill_type ?? "any");
    if (selectedSkillType !== "any" && selectedSkillType !== skillType) return false;
    if (!matchesAnyFilter(p.skill_tag_ids, skillTags)) return false;
    if (!matchesAnyFilter(p.skill_ids, event.skillId)) return false;
    if (challenge.challenge_type === "effectiveness_strike"
      && !matchesAnyFilter(p.skill_element_ids, String(payload.skill_element_id ?? ""))) return false;
    if (challenge.challenge_type === "closing_move"
      && !matchesAnyFilter(p.skill_element_ids, String(payload.skill_element_id ?? ""))) return false;
    if (challenge.challenge_type === "use_skill" && !matchesAnyFilter(p.element_ids, [String(event.payload?.skill_element_id ?? "")])) return false;
  }
  return true;
}

export type SkillArsenalScopeState = {
  skillUseCounts: Record<string, number>;
  qualifiedSkillIds: string[];
};

export function matchesSkillArsenalEvent(challenge: CollectibleUnlockChallenge, event: ChallengeEvent): boolean {
  if (challenge.challenge_type !== "skill_arsenal" || event.type !== "skill_resolved" || !event.skillId) return false;
  const p = parametersOf(challenge);
  const payload = event.payload ?? {};
  const skillType = event.skillType ?? (typeof payload.skill_type === "string" ? payload.skill_type : undefined);
  const skillTags = eventArray(event, "skillTagIds", "skill_tag_ids");
  const skillElement = typeof payload.skill_element_id === "string" ? payload.skill_element_id : undefined;
  const selectedType = String(p.skill_type ?? "any");
  if (selectedType !== "any" && selectedType !== skillType) return false;
  if (!matchesAnyFilter(p.skill_ids, event.skillId)) return false;
  if (!matchesAnyFilter(p.skill_tag_ids, skillTags)) return false;
  if (!matchesAnyFilter(p.element_ids, skillElement)) return false;
  return true;
}

export function applySkillArsenalEvent(
  challenge: CollectibleUnlockChallenge,
  event: ChallengeEvent,
  state: Partial<SkillArsenalScopeState>,
): SkillArsenalScopeState {
  if (!matchesSkillArsenalEvent(challenge, event) || !event.skillId) return { skillUseCounts: state.skillUseCounts ?? {}, qualifiedSkillIds: state.qualifiedSkillIds ?? [] };
  const currentCounts = state.skillUseCounts ?? {};
  const nextCounts = { ...currentCounts, [event.skillId]: (currentCounts[event.skillId] ?? 0) + 1 };
  const minimumUses = Math.max(1, Math.floor(Number(parametersOf(challenge).minimum_uses_per_skill ?? 1)));
  const qualifiedSkillIds = Object.keys(nextCounts).filter((skillId) => nextCounts[skillId] >= minimumUses);
  return { skillUseCounts: nextCounts, qualifiedSkillIds };
}

function eventTypeFor(challengeType: string): ChallengeEventType | null {
  return {
    knock_out_critters: "critter_knocked_out",
    deal_damage: "hp_damage_dealt",
    take_damage: "hp_damage_taken",
    use_skill: "skill_resolved",
    skill_arsenal: "skill_resolved",
    squad_composition: "battle_completed",
    dungeon_clear: "dungeon_completed",
    resource_spending: "resource_spent",
    swap_action: "swap_completed",
    block_action: "block_completed",
    dice_roll: "dice_resolved",
    heal_hp: "hp_healed",
    afflict_status: "status_afflicted",
    status_removal: "effect_removed",
    stun_activation: "stun_activated",
    shields_shattered: "shield_shattered",
    effectiveness_strike: "effectiveness_strike",
    closing_move: "final_knockout_attribution",
  }[challengeType] as ChallengeEventType | undefined ?? null;
}

function effectivenessDamageAmount(parameters: Record<string, unknown>, hit: Record<string, unknown>): number {
  const hp = Math.max(0, Math.floor(Number(hit.hp_damage ?? 0)));
  const shield = Math.max(0, Math.floor(Number(hit.shield_damage ?? 0)));
  const total = Math.max(0, Math.floor(Number(hit.total_damage ?? hit.amount ?? hp + shield)));
  const mode = String(parameters.damage_mode ?? "total");
  if (mode === "hp" || mode === "hp_only") return hp;
  if (mode === "shield" || mode === "shield_only") return shield;
  return total;
}

function effectivenessClassFor(hit: Record<string, unknown>): EffectivenessClass | undefined {
  const value = hit.effectiveness_class;
  return typeof value === "string" ? value as EffectivenessClass : undefined;
}

function effectivenessHitMatches(
  challenge: CollectibleUnlockChallenge,
  event: ChallengeEvent,
  hit: Record<string, unknown>,
): boolean {
  const targetId = typeof hit.target_critter_id === "string" ? hit.target_critter_id : event.targetCritterId;
  const targetElements = stringArray(hit.target_element_ids ?? event.targetElementIds ?? event.payload?.target_element_ids);
  const targetTags = stringArray(hit.target_critter_tag_ids ?? event.targetCritterTagIds ?? event.payload?.target_critter_tag_ids);
  return matchesCombatFilters(challenge, {
    ...event,
    targetCritterId: targetId,
    targetElementIds: targetElements,
    targetCritterTagIds: targetTags,
    payload: {
      ...(event.payload ?? {}),
      ...hit,
      target_critter_id: targetId,
      target_critter_ids: targetId ? [targetId] : [],
      target_element_ids: targetElements,
      target_critter_tag_ids: targetTags,
    },
  });
}

function effectivenessHitIncrement(challenge: CollectibleUnlockChallenge, event: ChallengeEvent, hit: Record<string, unknown>): number {
  const p = parametersOf(challenge);
  const selectedClasses = stringArray(p.effectiveness_classes);
  const classification = effectivenessClassFor(hit);
  if (!classification || !selectedClasses.includes(classification)) return 0;
  if (!effectivenessHitMatches(challenge, event, hit)) return 0;
  const amount = effectivenessDamageAmount(p, hit);
  const knockedOut = hit.knocked_out === true;
  if (p.must_knock_out === true && !knockedOut) return 0;
  if (p.tracking_metric === "knockouts" && !knockedOut) return 0;
  return p.tracking_metric === "damage" ? amount : 1;
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

export function challengeEventIncrement(
  challenge: CollectibleUnlockChallenge,
  event: ChallengeEvent,
  dungeonOrders?: ReadonlyMap<string, number>,
): number {
  const type = challenge.challenge_type;
  const p = parametersOf(challenge);
  const expectedType = type === "squad_composition"
    ? String(p.completion_event ?? "battle_win") === "dungeon_clear" ? "dungeon_completed" : "battle_completed"
    : type === "defeat_rollcaster_type" ? "battle_completed"
    : type === "afflict_status" && String(p.affliction_mode ?? "fresh_afflictions") === "afflicted_turns" ? "status_turn_completed"
    : type === "effectiveness_strike" && String(p.tracking_metric ?? "damage") === "skills_hit" ? "effectiveness_skill_resolved"
    : eventTypeFor(type);
  if (!expectedType || event.type !== expectedType) return 0;

  if (type === "defeat_rollcaster_type") {
    const payload = event.payload ?? {};
    if (payload.won !== true) return 0;
    return stringArray(p.rollcaster_types).includes(String(payload.enemy_rollcaster_type ?? "")) ? 1 : 0;
  }

  if (type === "skill_arsenal") return matchesSkillArsenalEvent(challenge, event) ? 1 : 0;

  if (type === "effectiveness_strike") {
    if (event.type === "effectiveness_strike") return effectivenessHitIncrement(challenge, event, event.payload ?? {});
    if (event.type === "effectiveness_skill_resolved" && p.tracking_metric === "skills_hit") {
      return Array.isArray(event.payload?.effectiveness_hits)
        && event.payload.effectiveness_hits.some((hit): hit is Record<string, unknown> => Boolean(hit && typeof hit === "object" && !Array.isArray(hit)) && effectivenessHitIncrement(challenge, event, hit) > 0)
        ? 1
        : 0;
    }
    return 0;
  }

  if (type === "closing_move") {
    const payload = event.payload ?? {};
    if (event.type !== "final_knockout_attribution" || event.amount !== 1 || payload.battle_won !== true) return 0;
    if (String(p.failure_policy ?? "no_increment") !== "no_increment") return 0;
    const finisherType = String(payload.finisher_type ?? "");
    const configuredFinisher = String(p.finisher_type ?? "any");
    if (configuredFinisher !== "any" && configuredFinisher !== finisherType) return 0;
    const scope = String(p.final_knockout_scope ?? "end_of_encounter");
    if (scope === "end_of_encounter" && payload.is_end_of_encounter !== true) return 0;
    if (scope === "end_of_dungeon" && payload.is_end_of_dungeon !== true) return 0;
    if (!matchesAnyFilter(p.status_ids, String(payload.status_id ?? ""))) return 0;
    return matchesCombatFilters(challenge, event) ? 1 : 0;
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

  if (String(type) === "status_removal") {
    const payload = event.payload ?? {};
    const removalKind = String(p.removal_kind ?? "statuses");
    const eventKind = String(payload.removal_kind ?? "status");
    if (removalKind === "statuses" && eventKind !== "status") return 0;
    if (removalKind === "negative_stat_modifiers" && eventKind !== "negative_stat_modifier") return 0;
    if (removalKind === "either" && !["status", "negative_stat_modifier"].includes(eventKind)) return 0;

    const targetSide = String(p.target_side ?? "any");
    const eventTargetSide = String(payload.target_side ?? "");
    if (targetSide === "enemies" && eventTargetSide !== "opponent") return 0;
    if (targetSide === "friendlies" && eventTargetSide !== "player") return 0;

    if (eventKind === "status") {
      const selectedStatuses = stringArray(p.status_ids);
      if (selectedStatuses.length && !selectedStatuses.includes(String(payload.status_id ?? ""))) return 0;
      const classification = String(payload.status_classification ?? "mixed");
      const selectedClassification = String(p.status_classification ?? "any");
      if (selectedClassification !== "any" && classification !== selectedClassification) return 0;
    } else if (String(payload.modifier_polarity ?? "") !== "negative") {
      return 0;
    }

    const reason = String(p.removal_reason ?? "any");
    if (reason !== "any" && reason !== String(payload.removal_reason ?? "")) return 0;
    if (!matchesAnyFilter(p.source_critter_ids, event.sourceCritterId)) return 0;
    const sourceOwnerType = String(payload.source_owner_type ?? "");
    const sourceOwnerId = String(payload.source_owner_id ?? "");
    const skillId = event.skillId ?? (sourceOwnerType === "skill" ? sourceOwnerId : undefined);
    if (!matchesAnyFilter(p.skill_ids, skillId)) return 0;
    if (!matchesAnyFilter(p.skill_tag_ids, eventArray(event, "skillTagIds", "skill_tag_ids"))) return 0;
    if (!matchesAnyFilter(p.ability_ids, sourceOwnerType === "ability" ? sourceOwnerId : undefined)) return 0;
    if (!matchesAnyFilter(p.relic_ids, sourceOwnerType === "relic" ? sourceOwnerId : undefined)) return 0;
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
    const incomingCritterId = event.targetCritterId ?? String(payload.incoming_critter_id ?? "");
    if (!includesOrAny(stringArray(p.critter_ids), incomingCritterId)) return 0;
    const incomingElements = event.targetElementIds ?? stringArray(payload.target_element_ids ?? payload.incoming_element_ids);
    if (!matchesAnyFilter(p.element_ids, incomingElements)) return 0;
    const action = String(p.tracked_action);
    if (action === "unique_critters_swapped_in") return payload.unique === true ? 1 : 0;
    if (action === "damage_avoided_by_swap") return Math.max(0, Math.floor(Number(payload.damage_avoided ?? event.amount ?? 0)));
    if (action === "knockout_after_swap") {
      const allowedTurns = Number(p.allowed_turns_after_swap ?? Infinity);
      const turnsSinceSwap = Number(payload.turns_since_swap ?? Infinity);
      return payload.knockout_after_swap === true && turnsSinceSwap <= allowedTurns ? 1 : 0;
    }
    return 1;
  }

  if (type === "block_action") {
    const payload = event.payload ?? {};
    if (!includesOrAny(stringArray(p.dungeon_ids), event.dungeonId ?? String(payload.dungeon_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.critter_ids), event.sourceCritterId)) return 0;
    if (!matchesAnyFilter(p.element_ids, event.sourceElementIds ?? stringArray(payload.source_element_ids))) return 0;
    const enemyCritterIds = [
      ...(event.targetCritterId ? [event.targetCritterId] : []),
      ...stringArray(payload.target_critter_ids),
    ];
    if (!matchesAnyFilter(p.enemy_critter_ids, enemyCritterIds)) return 0;
    if (!matchesAnyFilter(p.enemy_element_ids, event.targetElementIds ?? stringArray(payload.target_element_ids))) return 0;
    const action = String(p.tracked_action);
    if (action === "damage_prevented") {
      if (payload.damage_prevented === undefined && payload.block_action === true) return 0;
      return Math.max(0, Math.floor(Number(payload.damage_prevented ?? event.amount ?? 0)));
    }
    if (action === "attacks_fully_blocked") return payload.fully_blocked === true ? 1 : 0;
    if (action === "survived_attack_after_block") return payload.survived === true ? 1 : 0;
    if (action === "blocks_performed") {
      if (payload.damage_prevented !== undefined || payload.fully_blocked !== undefined || payload.survived !== undefined) return 0;
      return payload.blocks_performed === true || payload.blocks_performed === 1 || payload.blocks_performed === undefined ? 1 : 0;
    }
    return 0;
  }

  if (type === "dice_roll") {
    const payload = event.payload ?? {};
    if (!includesOrAny(stringArray(p.die_types), String(payload.die_type ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.ability_ids), event.abilityId ?? String(payload.ability_id ?? ""))
      && !matchesAnyFilter(p.ability_ids, stringArray(payload.ability_ids))) return 0;
    if (!includesOrAny(stringArray(p.critter_ids), event.sourceCritterId)) return 0;
    if (!includesOrAny(stringArray(p.rollcaster_ids), event.rollcasterId ?? String(payload.rollcaster_id ?? ""))) return 0;
    if (!includesOrAny(stringArray(p.dungeon_ids), event.dungeonId ?? String(payload.dungeon_id ?? ""))) return 0;
    const resultType = String(p.tracked_result);
    if (resultType === "turn_mana_total" && payload.turn_mana_total_event === false) return 0;
    const includeModifiers = p.include_modifiers !== false;
    const value = resultType === "turn_mana_total"
      ? Number(payload.turn_mana_total ?? event.amount ?? 0)
      : Number((includeModifiers ? payload.modified_value : payload.natural_value) ?? event.amount ?? 0);
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
      const minimumId = stringArray(p.minimum_dungeon_ids)[0];
      const maximumId = stringArray(p.maximum_dungeon_ids)[0];
      const minimumOrder = p.minimum_dungeon_order != null
        ? Number(p.minimum_dungeon_order)
        : dungeonOrders?.get(minimumId ?? "") ?? NaN;
      const maximumOrder = p.maximum_dungeon_order != null
        ? Number(p.maximum_dungeon_order)
        : dungeonOrders?.get(maximumId ?? "") ?? NaN;
      if (!Number.isFinite(order) || !Number.isFinite(minimumOrder) || !Number.isFinite(maximumOrder)
        || order < minimumOrder || order > maximumOrder) return 0;
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
  dungeonOrders?: ReadonlyMap<string, number>,
): bigint {
  const current = safeBigInt(progress);
  const target = safeBigInt(goal);
  const increment = BigInt(Math.max(0, Math.floor(challengeEventIncrement(challenge, event, dungeonOrders))));
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
  if (challenge.challenge_type === "level_up_critter" || challenge.challenge_type === "level_up_rollcaster") {
    const isCritter = challenge.challenge_type === "level_up_critter";
    const idsKey = isCritter ? "critter_ids" : "rollcaster_ids";
    const singularKey = isCritter ? "critter_id" : "rollcaster_id";
    const ids = stringArray(p[idsKey]);
    const threshold = Number(p.required_level ?? challenge.required_level ?? 0);
    if (isCritter && p.level_target_mode === "any") return BigInt(player.critters.filter((owned) => Number(owned.level) >= threshold).length);
    if (!isCritter && p.level_target_mode === "any") return BigInt(player.rollcasters.filter((owned) => Number(owned.level) >= threshold).length);
    if (ids.length > 1 && isCritter) return BigInt(player.critters.filter((owned) => ids.includes(owned.critter_id) && Number(owned.level) >= threshold).length);
    if (ids.length > 1 && !isCritter) return BigInt(player.rollcasters.filter((owned) => ids.includes(owned.rollcaster_id) && Number(owned.level) >= threshold).length);
    const id = String(ids[0] ?? p[singularKey] ?? challenge.target_id ?? "");
    return isCritter
      ? BigInt(player.critters.find((owned) => owned.critter_id === id)?.level ?? 0)
      : BigInt(player.rollcasters.find((owned) => owned.rollcaster_id === id)?.level ?? 0);
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
  return TRACKED_CHALLENGE_TYPES.has(challenge.challenge_type)
    && parametersOf(challenge).tracking_required !== false;
}

export function trackedChallengesForPlayer(player: PlayerState, catalog: AppData["catalog"]): CollectibleUnlockChallenge[] {
  const trackedIds = new Set(player.collectibleSnapshot.tracked.map((row) => row.challenge_id));
  return catalog.collectibleUnlockChallenges.filter((challenge) => trackedIds.has(challenge.id) && isTrackedChallengeType(challenge));
}
