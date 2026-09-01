import type {
  AppData,
  CollectibleType,
  CollectibleUnlockChallenge,
  CurrencyDef,
  ShopEntry,
  UserTrackedCollectibleChallenge,
  UserCollectibleChallengeProgress,
} from "./types.js";
import { collectionDiversityGoal, collectionDiversityProgress } from "./collection-diversity.js";

const collectibleIdCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isDerivedChallengeType(challenge: CollectibleUnlockChallenge | undefined): boolean {
  return challenge?.challenge_type === "collection_diversity"
    || challenge?.challenge_type === "level_up_critter"
    || challenge?.challenge_type === "level_up_rollcaster"
    || challenge?.challenge_type === "shop_shards"
    || challenge?.challenge_type === "shop_relic"
    || challenge?.challenge_type === "own_collectible";
}

export function sortByCollectibleId<T extends { id: string }>(items: readonly T[]): T[];
export function sortByCollectibleId<T>(items: readonly T[], getId: (item: T) => string): T[];
export function sortByCollectibleId<T>(items: readonly T[], getId?: (item: T) => string): T[] {
  const resolveId = getId ?? ((item: T) => (item as T & { id: string }).id);
  return [...items].sort((left, right) => collectibleIdCollator.compare(resolveId(left), resolveId(right)));
}

export const TRACKED_CHALLENGE_TYPES = new Set([
  "knock_out_critters",
  "deal_damage",
  "take_damage",
  "use_skill",
  "squad_composition",
  "dungeon_clear",
  "resource_spending",
  "swap_action",
  "block_action",
  "dice_roll",
  "heal_hp",
  "defeat_rollcaster_type",
  "afflict_status",
  "stun_activation",
  "shields_shattered",
]);

export function safeBigInt(value: string | number | bigint | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

function safeUnknownBigInt(value: unknown): bigint {
  return typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? safeBigInt(value)
    : 0n;
}

export function formatAmount(value: string | number | bigint): string {
  return new Intl.NumberFormat().format(safeBigInt(value));
}

export function collectibleName(data: AppData, type: CollectibleType, id: string): string {
  const rows = type === "critter"
    ? data.catalog.critters
    : type === "rollcaster"
      ? data.catalog.rollcasters
      : data.catalog.relics;
  return rows.find((row) => row.id === id)?.name ?? id;
}

export function collectibleAssetPath(data: AppData, type: CollectibleType, id: string): string | null {
  const rows = type === "critter"
    ? data.catalog.critters
    : type === "rollcaster"
      ? data.catalog.rollcasters
      : data.catalog.relics;
  return rows.find((row) => row.id === id)?.asset_path ?? null;
}

export function collectibleIsOwned(data: AppData, type: CollectibleType, id: string): boolean {
  const player = data.player;
  if (!player) return false;
  if (type === "critter") return player.critters.some((row) => row.critter_id === id);
  if (type === "rollcaster") return player.rollcasters.some((row) => row.rollcaster_id === id);
  // Discovery is permanent ownership. Quantity answers whether a usable copy
  // exists, not whether a unique ownership challenge should still count it.
  return player.relicInventory.some((row) => row.relic_id === id && row.discovered_at !== null);
}

/**
 * Ownership can exist before a challenge-gated collectible is unlocked (for
 * example, when a Relic was granted by an older reward path). Keep that
 * inventory state separate from the permission to use the collectible.
 */
export function collectibleIsUnlocked(data: AppData, type: CollectibleType, id: string): boolean {
  if (!collectibleIsOwned(data, type, id)) return false;

  // The server records successful challenge grants permanently. This prevents
  // a later catalog goal increase from making an already-granted collectible
  // appear locked in the client while retaining the legacy pre-gate fallback
  // below for inventory rows that were never challenge-granted.
  if (data.player?.collectibleSnapshot.unlocked_collectibles.some(
    (row) => row.collectible_type === type && row.collectible_id === id,
  )) return true;

  const requirement = data.catalog.collectibleUnlockRequirements.find(
    (row) => row.collectible_type === type && row.collectible_id === id,
  );
  if (!requirement || requirement.required_challenges <= 0) return true;

  const challenges = challengesFor(data, type, id);
  if (challenges.length === 0) return false;
  const completed = challenges.filter((challenge) => progressFor(data, challenge.id).completed).length;
  return completed >= requirement.required_challenges;
}

/**
 * Challenge derivation must read the bootstrap's permanent identity
 * projection directly. Calling collectibleIsUnlocked from this helper would
 * re-enter progressFor for a gated ownership challenge and recurse forever.
 */
function permanentlyUnlockedForProjection(data: AppData, type: CollectibleType, id: string): boolean {
  if (data.player?.collectibleSnapshot.unlocked_collectibles.some(
    (row) => row.collectible_type === type && row.collectible_id === id,
  )) return true;
  const requirement = data.catalog.collectibleUnlockRequirements.find(
    (row) => row.collectible_type === type && row.collectible_id === id,
  );
  return (!requirement || requirement.required_challenges <= 0) && collectibleIsOwned(data, type, id);
}

export function challengesFor(data: AppData, type: CollectibleType, id: string): CollectibleUnlockChallenge[] {
  return data.catalog.collectibleUnlockChallenges
    .filter((row) => row.collectible_type === type && row.collectible_id === id)
    .sort((left, right) =>
      (left.gate_order ?? Number.MAX_SAFE_INTEGER) - (right.gate_order ?? Number.MAX_SAFE_INTEGER) ||
      left.sort_order - right.sort_order ||
      left.id.localeCompare(right.id),
    );
}

function inferredGateEligibility(data: AppData, challenge: CollectibleUnlockChallenge): boolean {
  const allChallenges = challengesFor(data, challenge.collectible_type, challenge.collectible_id);
  const priorGateOrders = [...new Set(allChallenges
    .filter((candidate) => candidate.gate_order != null && (
      challenge.gate_order == null || candidate.gate_order! < challenge.gate_order
    ))
    .map((candidate) => candidate.gate_order!))];

  return priorGateOrders.every((gateOrder) => allChallenges
    .filter((candidate) => candidate.gate_order === gateOrder)
    .every((candidate) => {
      if (candidate.challenge_type === "collection_diversity"
        || candidate.challenge_type === "shop_shards"
        || candidate.challenge_type === "shop_relic"
        || candidate.challenge_type === "own_collectible") {
        return derivedChallengeCurrent(data, candidate) >= challengeGoal(candidate);
      }
      const stored = data.player?.collectibleSnapshot.progress.find((row) => row.challenge_id === candidate.id);
      // Missing authoritative progress is unsafe to treat as a completed gate.
      return stored !== undefined && safeBigInt(stored.current) >= challengeGoal(candidate);
    }));
}

export function progressFor(data: AppData, challengeId: string): UserCollectibleChallengeProgress {
  const challenge = data.catalog.collectibleUnlockChallenges.find((row) => row.id === challengeId);
  const progress = data.player?.collectibleSnapshot.progress.find((row) => row.challenge_id === challengeId);
  const authoredGoal = challenge ? challengeGoal(challenge) : 0n;
  const gateEligible = challenge ? inferredGateEligibility(data, challenge) : true;
  if (!progress) {
    const current = challenge ? derivedChallengeCurrent(data, challenge) : 0n;
    const isDerived = isDerivedChallengeType(challenge);
    const goalReached = authoredGoal > 0n && current >= authoredGoal;
    return {
      challenge_id: challengeId,
      current: String(authoredGoal > 0n && current > authoredGoal ? authoredGoal : current),
      goal: String(authoredGoal),
      goal_reached: goalReached,
      eligible: gateEligible,
      completed: Boolean(isDerived && gateEligible && goalReached),
      blocked_by_gate_order: null,
      // A zero-progress row may be absent while a local candidate is ahead of
      // the active server projection. Derive the visible action from the
      // catalog definition and gate state; the tracking RPC remains the final
      // authority when the player selects it.
      trackable: gateEligible && Boolean(challenge && isTrackableChallenge(challenge, data.catalog.unlockChallengeTemplates)),
    };
  }

  const eligible = gateEligible && progress.eligible !== false;
  const isDerived = isDerivedChallengeType(challenge);
  const derived = isDerived && challenge ? derivedChallengeCurrent(data, challenge) : safeBigInt(progress.current);
  const current = challenge?.challenge_type === "own_collectible"
    ? (derived > safeBigInt(progress.current) ? derived : safeBigInt(progress.current))
    : derived;
  // The published challenge definition is the source of truth for derived
  // goals. A snapshot can outlive a catalog edit and still carry the old
  // compatibility-column goal.
  const normalizedGoal = authoredGoal > 0n ? authoredGoal : safeBigInt(progress.goal);
  const goalReached = normalizedGoal > 0n && current >= normalizedGoal;
  // A snapshot can briefly carry the raw goal and the completion flag from
  // different revisions. Treat a reached goal as complete once the challenge
  // is eligible so stale rows cannot consume a tracking slot.
  const completed = eligible && (isDerived
    ? (goalReached || challenge?.challenge_type === "own_collectible" && (progress.completed || progress.goal_reached === true))
    : (progress.completed || progress.goal_reached === true || goalReached));
  return {
    ...progress,
    current: String(current),
    goal: String(normalizedGoal),
    goal_reached: isDerived ? goalReached : progress.goal_reached ?? goalReached,
    eligible,
    completed,
    blocked_by_gate_order: progress.blocked_by_gate_order ?? null,
    trackable: eligible && !completed && progress.trackable !== false,
  };
}

/**
 * Tracking slots are a presentation order, not a stable identity. The server
 * can leave a slot number behind after an untrack, so the home display and
 * collection controls should always derive a compact active list.
 */
export function trackedChallengesForDisplay(data: AppData): UserTrackedCollectibleChallenge[] {
  const seen = new Set<string>();
  return data.player?.collectibleSnapshot.tracked
    .filter((trackedRow) => {
      if (seen.has(trackedRow.challenge_id)) return false;
      const progress = progressFor(data, trackedRow.challenge_id);
      const active = progress.eligible !== false && !progress.completed && progress.trackable !== false;
      if (active) seen.add(trackedRow.challenge_id);
      return active;
    })
    .sort((left, right) => left.slot_order - right.slot_order || left.challenge_id.localeCompare(right.challenge_id))
    .map((trackedRow, index) => ({ ...trackedRow, slot_order: index + 1 })) ?? [];
}

export function completedTrackedChallengeIds(previous: AppData | null, next: AppData): string[] {
  return [...new Set((previous?.player?.collectibleSnapshot.tracked ?? [])
    .filter((trackedRow) => progressFor(next, trackedRow.challenge_id).completed)
    .map((trackedRow) => trackedRow.challenge_id))];
}

export function challengeGateBadge(challenge: CollectibleUnlockChallenge): string | null {
  return challenge.gate_order == null ? null : `Gate ${challenge.gate_order}`;
}

export function challengeGateBlockMessage(
  challenge: CollectibleUnlockChallenge,
  progress: UserCollectibleChallengeProgress,
): string | null {
  if (progress.eligible !== false) return null;
  if (challenge.gate_order != null && progress.blocked_by_gate_order != null) {
    return `Waiting for Gate ${progress.blocked_by_gate_order}`;
  }
  return "Complete all above challenges first";
}

export function requirementFor(data: AppData, type: CollectibleType, id: string): number {
  return data.catalog.collectibleUnlockRequirements.find(
    (row) => row.collectible_type === type && row.collectible_id === id,
  )?.required_challenges ?? 0;
}

function stringParameters(parameters: Record<string, unknown>, key: string): string[] {
  const value = parameters[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function namesFor(data: AppData, type: CollectibleType | "element" | "skill" | "dungeon" | "status", ids: string[]): string[] {
  const rows = type === "critter"
    ? data.catalog.critters
    : type === "rollcaster"
      ? data.catalog.rollcasters
      : type === "relic"
        ? data.catalog.relics
        : type === "element"
          ? data.catalog.elements
          : type === "skill"
            ? data.catalog.skills
            : type === "dungeon"
              ? data.catalog.dungeons
              : data.catalog.statuses;
  return ids.map((id) => rows.find((row) => row.id === id)?.name ?? id);
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function challengeParameters(challenge: CollectibleUnlockChallenge): Record<string, unknown> {
  const current = challenge.parameters && typeof challenge.parameters === "object"
    ? challenge.parameters
    : {
      target_category: challenge.target_category,
      target_id: challenge.target_id,
      target_mode: challenge.target_mode,
      any_target: challenge.any_target,
      target_ids: challenge.target_ids,
      required_amount: challenge.required_amount == null ? undefined : Number(challenge.required_amount),
      required_level: challenge.required_level,
    };
  const normalized = { ...current };
  if (challenge.challenge_type === "level_up_critter" || challenge.challenge_type === "level_up_rollcaster") {
    const idsKey = challenge.challenge_type === "level_up_critter" ? "critter_ids" : "rollcaster_ids";
    const singularKey = challenge.challenge_type === "level_up_critter" ? "critter_id" : "rollcaster_id";
    const ids = stringParameters(current, idsKey);
    const singular = typeof current[singularKey] === "string" ? String(current[singularKey]) : challenge.target_id ?? "";
    normalized.level_target_mode = current.level_target_mode === "any" ? "any" : "specific";
    normalized[idsKey] = normalized.level_target_mode === "any" ? [] : ids.length ? ids : singular ? [singular] : [];
    normalized.required_level = current.required_level ?? challenge.required_level ?? 1;
    normalized.required_amount = current.required_amount ?? challenge.required_amount ?? 1;
  }
  if (["knock_out_critters", "deal_damage", "take_damage", "use_skill"].includes(challenge.challenge_type)) {
    const legacyMode = String(current.target_mode ?? current.mode ?? (challenge.challenge_type === "use_skill" ? "skill" : "species"));
    const legacyIds = stringParameters(current, "target_ids");
    const legacyAny = current.any_target === true || current.any === true;
    if (!legacyAny && legacyIds.length) {
      if (challenge.challenge_type === "use_skill") {
        if (legacyMode === "element" && stringParameters(current, "element_ids").length === 0) normalized.element_ids = legacyIds;
        if (legacyMode !== "element" && stringParameters(current, "skill_ids").length === 0) normalized.skill_ids = legacyIds;
      } else {
        if (legacyMode === "element" && stringParameters(current, "target_element_ids").length === 0) normalized.target_element_ids = legacyIds;
        if (legacyMode !== "element" && stringParameters(current, "target_critter_ids").length === 0) normalized.target_critter_ids = legacyIds;
      }
    }
  }
  if (challenge.challenge_type === "heal_hp") {
    const legacyIds = stringParameters(current, "target_ids");
    if (legacyIds.length && current.target_mode === "species" && stringParameters(current, "target_critter_ids").length === 0) normalized.target_critter_ids = legacyIds;
    if (legacyIds.length && current.target_mode === "element" && stringParameters(current, "target_element_ids").length === 0) normalized.target_element_ids = legacyIds;
  }
  return normalized;
}

export function challengeGoal(challenge: CollectibleUnlockChallenge): bigint {
  const parameters = challengeParameters(challenge);
  switch (challenge.challenge_type) {
    case "own_collectible":
      if (parameters.specific_collectible_mode === "all" && stringParameters(parameters, "collectible_ids").length > 0) return BigInt(new Set(stringParameters(parameters, "collectible_ids")).size);
      return safeUnknownBigInt(parameters.required_amount ?? challenge.required_amount);
    case "level_up_critter":
    case "level_up_rollcaster": {
      const ids = stringParameters(parameters, challenge.challenge_type === "level_up_critter" ? "critter_ids" : "rollcaster_ids");
      return parameters.level_target_mode === "any" || ids.length > 1
        ? safeUnknownBigInt(parameters.level_target_mode === "any" ? parameters.required_amount : ids.length)
        : safeUnknownBigInt(parameters.required_level ?? challenge.required_level);
    }
    case "collection_diversity": return collectionDiversityGoal(parameters);
    case "squad_composition": return safeUnknownBigInt(parameters.required_completions);
    case "dungeon_clear": return safeUnknownBigInt(parameters.required_clears);
    case "dice_roll": return safeUnknownBigInt(parameters.required_occurrences);
    case "heal_hp": return safeUnknownBigInt(parameters.required_amount);
    default: return safeUnknownBigInt(parameters.required_amount ?? challenge.required_amount);
  }
}

function derivedChallengeCurrent(data: AppData, challenge: CollectibleUnlockChallenge): bigint {
  const player = data.player;
  if (!player) return 0n;
  const parameters = challengeParameters(challenge);
  if (challenge.challenge_type === "own_collectible") {
    const type = String(parameters.collectible_category ?? challenge.target_category ?? "critter");
    const ids = new Set(Array.isArray(parameters.collectible_ids) ? parameters.collectible_ids.filter((id): id is string => typeof id === "string") : []);
    const tagIds = new Set(Array.isArray(parameters.critter_tag_ids) ? parameters.critter_tag_ids.filter((id): id is string => typeof id === "string") : []);
    const allowed = (id: string) => ids.size === 0 || ids.has(id);
    if (type === "critter") return BigInt(player.critters.filter((row) => {
      if (!permanentlyUnlockedForProjection(data, "critter", row.critter_id) || !allowed(row.critter_id)) return false;
      const critter = data.catalog.critters.find((candidate) => candidate.id === row.critter_id);
      return tagIds.size === 0 || Boolean(critter && Array.isArray(critter.tag_ids) && critter.tag_ids.some((tagId) => tagIds.has(tagId)));
    }).length);
    if (type === "rollcaster") return BigInt(player.rollcasters.filter((row) => permanentlyUnlockedForProjection(data, "rollcaster", row.rollcaster_id) && allowed(row.rollcaster_id)).length);
    const relics = player.relicInventory.filter((row) => permanentlyUnlockedForProjection(data, "relic", row.relic_id) && row.discovered_at !== null && allowed(row.relic_id));
    const specificMode = String(parameters.specific_collectible_mode ?? "");
    return specificMode === "quantity" || parameters.require_unique_collectibles === false
      ? BigInt(relics.reduce((sum, row) => sum + row.quantity, 0))
      : BigInt(relics.length);
  }
  if (challenge.challenge_type === "level_up_critter" || challenge.challenge_type === "level_up_rollcaster") {
    const isCritter = challenge.challenge_type === "level_up_critter";
    const ids = stringParameters(parameters, isCritter ? "critter_ids" : "rollcaster_ids");
    const threshold = safeUnknownBigInt(parameters.required_level ?? challenge.required_level);
    const levels = isCritter
      ? ids.map((id) => player.critters.find((row) => row.critter_id === id)?.level ?? 0)
      : ids.map((id) => player.rollcasters.find((row) => row.rollcaster_id === id)?.level ?? 0);
    if (parameters.level_target_mode === "any") {
      const rows = isCritter ? player.critters : player.rollcasters;
      return BigInt(rows.filter((row) => Number(row.level) >= Number(threshold)).length);
    }
    if (ids.length > 1) return BigInt(levels.filter((level) => BigInt(level) >= threshold).length);
    return BigInt(levels[0] ?? (isCritter ? player.critters.find((row) => row.critter_id === String(parameters.critter_id ?? challenge.target_id ?? ""))?.level : player.rollcasters.find((row) => row.rollcaster_id === String(parameters.rollcaster_id ?? challenge.target_id ?? ""))?.level) ?? 0);
  }
  if (challenge.challenge_type === "collection_diversity") {
    const candidates = player.critters.flatMap((owned) => {
      const critter = data.catalog.critters.find((row) => row.id === owned.critter_id);
      return critter ? [{ id: critter.id, elementIds: [critter.element_1_id, critter.element_2_id].filter((id): id is string => Boolean(id)) }] : [];
    });
    return collectionDiversityProgress(candidates, parameters);
  }
  if (challenge.challenge_type === "shop_shards") return shardProgress(data, challenge.collectible_type, challenge.collectible_id);
  if (challenge.challenge_type === "shop_relic") {
    const quantity = safeBigInt(player.relicInventory.find((row) => row.relic_id === challenge.collectible_id)?.quantity);
    const stored = safeBigInt(player.collectibleSnapshot.progress.find((row) => row.challenge_id === challenge.id)?.current);
    return quantity > stored ? quantity : stored;
  }
  return 0n;
}

export function challengeDescription(data: AppData, challenge: CollectibleUnlockChallenge): string {
  if (challenge.display_text?.trim()) return challenge.display_text.trim();
  const ownerName = collectibleName(data, challenge.collectible_type, challenge.collectible_id);
  const parameters = challengeParameters(challenge);
  if (challenge.challenge_type === "own_collectible") {
    const type = String(parameters.collectible_category ?? challenge.target_category ?? "critter") as CollectibleType;
    const ids = stringParameters(parameters, "collectible_ids");
    const names = namesFor(data, type, ids);
    const tagNames = stringParameters(parameters, "critter_tag_ids").map((id) => data.catalog.tags.find((tag) => tag.id === id)?.name ?? id);
    const goal = Number(parameters.required_amount ?? challenge.required_amount ?? 1);
    const tagDescription = tagNames.length ? ` tagged ${tagNames.join(" or ")}` : "";
    if (names.length && parameters.specific_collectible_mode === "all" && !tagDescription) return `Own ${names.join(" and ")}.`;
    if (names.length === 1 && goal === 1 && !tagDescription) return `Own ${names[0]}.`;
    if (names.length) return `Own ${goal} of: ${names.join(", ")}${tagDescription}.`;
    const label = type === "critter" ? "Critter" : type === "rollcaster" ? "Rollcaster" : "Relic";
    return `Own ${goal} ${parameters.require_unique_collectibles === true ? "different " : ""}${label}${goal === 1 ? "" : "s"}${tagDescription}.`;
  }
  const p = parameters;
  if (challenge.challenge_type === "collection_diversity") {
    if (p.diversity_mode === "amount_of_type") return `Own ${p.required_per_type} different ${namesFor(data, "element", stringParameters(p, "element_ids"))[0] ?? "Element"} Critters.`;
    if (p.diversity_mode === "different_types") return `Own Critters from ${p.required_distinct_types} different Element types.`;
    return `Own ${p.required_per_type} Critter${Number(p.required_per_type) === 1 ? "" : "s"} from each of: ${namesFor(data, "element", stringParameters(p, "required_element_ids")).join(", ") || "selected Elements"}.`;
  }
  if (challenge.challenge_type === "squad_composition") {
    const elementNames = namesFor(data, "element", stringParameters(p, "required_element_ids"));
    const uniqueCount = Number(p.required_matching_critters ?? 0);
    const composition = elementNames.length ? ` covering ${elementNames.join(" and ")}` : "";
    const unique = uniqueCount > 0 ? ` with ${uniqueCount} unique matching Critter${uniqueCount === 1 ? "" : "s"}` : "";
    return `${p.completion_event === "battle_win" ? "Win" : "Clear"} ${p.required_completions} ${p.completion_event === "battle_win" ? "battle" : "Dungeon"}${Number(p.required_completions) === 1 ? "" : "s"}${unique}${composition}.`;
  }
  if (challenge.challenge_type === "dungeon_clear") return `Clear ${p.dungeon_selection === "any_dungeon" ? "any Dungeon" : p.dungeon_selection === "specific_dungeon" ? namesFor(data, "dungeon", stringParameters(p, "dungeon_ids"))[0] ?? "the selected Dungeon" : `Dungeons ${stringParameters(p, "minimum_dungeon_ids")[0] ?? "—"}–${stringParameters(p, "maximum_dungeon_ids")[0] ?? "—"}`} ${p.required_clears} time${Number(p.required_clears) === 1 ? "" : "s"}.`;
  if (challenge.challenge_type === "resource_spending") return `Spend ${p.required_amount} ${humanize(String(p.resource_type))} ${p.tracking_scope === "lifetime" ? "in total" : humanize(String(p.tracking_scope))}.`;
  if (challenge.challenge_type === "swap_action") return `${humanize(String(p.tracked_action))} ${p.required_amount} time${Number(p.required_amount) === 1 ? "" : "s"}.`;
  if (challenge.challenge_type === "block_action") return `${humanize(String(p.tracked_action))}: ${p.required_amount}.`;
  if (challenge.challenge_type === "dice_roll") return `${humanize(String(p.tracked_result))} ${humanize(String(p.comparison))} ${p.target_value}, ${p.required_occurrences} time${Number(p.required_occurrences) === 1 ? "" : "s"}.`;
  if (challenge.challenge_type === "heal_hp") {
    const recipient = p.recipient_side === "friendly" ? "friendly" : p.recipient_side === "enemy" ? "enemy" : "";
    const critters = namesFor(data, "critter", stringParameters(p, "target_critter_ids"));
    const elements = namesFor(data, "element", stringParameters(p, "target_element_ids"));
    const tags = stringParameters(p, "target_critter_tag_ids").map((id) => data.catalog.tags.find((tag) => tag.id === id)?.name ?? id);
    const filters = [
      ...(critters.length ? [`species ${critters.join(" or ")}`] : []),
      ...(elements.length ? [`${elements.join(" or ")} Element`] : []),
      ...(tags.length ? [`${tags.join(" or ")} tagged`] : []),
    ];
    return `Heal ${p.required_amount} HP on ${recipient ? `${recipient} ` : ""}${filters.length ? filters.join(" and ") : "Critters"}.`;
  }
  if (challenge.challenge_type === "defeat_rollcaster_type") {
    const types = stringParameters(p, "rollcaster_types").map(humanize);
    const ranks = types.length ? types.join(" or ") : "selected";
    const goal = Number(p.required_amount ?? challenge.required_amount ?? 0);
    return `Defeat ${goal} ${ranks}-rank Rollcaster${goal === 1 ? "" : "s"}.`;
  }
  if (challenge.challenge_type === "afflict_status") {
    const statuses = namesFor(data, "status", stringParameters(p, "status_ids"));
    const statusLabel = statuses.length ? statuses.join(" or ") : "any Status";
    const target = p.target_side === "enemies" ? "enemies" : p.target_side === "friendlies" ? "friendlies" : "any Critter";
    const goal = Number(p.required_amount ?? challenge.required_amount ?? 0);
    if (p.affliction_mode === "afflicted_turns") return `Keep ${statusLabel} on ${target} for ${goal} afflicted turn${goal === 1 ? "" : "s"}.`;
    return `Afflict ${statusLabel} on ${target} ${goal} time${goal === 1 ? "" : "s"} from a fresh Status.`;
  }
  if (challenge.challenge_type === "stun_activation") {
    const target = p.target_side === "enemies" ? "enemy Critters" : p.target_side === "friendlies" ? "friendly Critters" : "any Critters";
    const goal = Number(p.required_amount ?? challenge.required_amount ?? 0);
    return `Stun ${target} ${goal} time${goal === 1 ? "" : "s"}.`;
  }
  if (challenge.challenge_type === "shields_shattered") {
    const side = p.shield_side === "enemies" ? "Enemy Shields" : p.shield_side === "friendlies" ? "Friendly Shields" : "Shields";
    const goal = Number(p.required_amount ?? challenge.required_amount ?? 0);
    return `Shatter ${goal} ${side}.`;
  }
  if (["knock_out_critters", "deal_damage", "take_damage", "use_skill"].includes(challenge.challenge_type)) {
    const sourceCritters = namesFor(data, "critter", stringParameters(p, "source_critter_ids"));
    const sourceElements = namesFor(data, "element", stringParameters(p, "source_element_ids"));
    const sourceTags = stringParameters(p, "source_critter_tag_ids").map((id) => data.catalog.tags.find((tag) => tag.id === id)?.name ?? id);
    const targetCritters = namesFor(data, "critter", stringParameters(p, "target_critter_ids"));
    const targetElements = namesFor(data, "element", stringParameters(p, "target_element_ids"));
    const targetTags = stringParameters(p, "target_critter_tag_ids").map((id) => data.catalog.tags.find((tag) => tag.id === id)?.name ?? id);
    const authoredSkillTagIds = p.skill_tag_ids ?? p.source_skill_tag_ids;
    const skillTags = (Array.isArray(authoredSkillTagIds) ? authoredSkillTagIds : [])
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .map((id) => data.catalog.tags.find((tag) => tag.id === id)?.name ?? id);
    if (challenge.challenge_type === "use_skill") {
      const skills = namesFor(data, "skill", stringParameters(p, "skill_ids"));
      const skillElements = namesFor(data, "element", stringParameters(p, "element_ids"));
      const skillFilters = [
        skills.length ? skills.join(" or ") : "",
        skillElements.length ? `${skillElements.join(" or ")} Element Skills` : "",
        skillTags.length ? `${skillTags.join(" or ")} tagged Skills` : "",
      ].filter(Boolean);
      const userFilters = [
        sourceCritters.length ? sourceCritters.join(" or ") : "",
        sourceElements.length ? `${sourceElements.join(" or ")} Element Critters` : "",
        sourceTags.length ? `${sourceTags.join(" or ")} tagged Critters` : "",
      ].filter(Boolean);
      return `Use ${skillFilters.length ? skillFilters.join(" and ") : "any Skill"}${userFilters.length ? ` with ${userFilters.join(" and ")}` : ""}.`;
    }
    const sourceFilters = [
      sourceCritters.length ? sourceCritters.join(" or ") : "",
      sourceElements.length ? `${sourceElements.join(" or ")} Element Critters` : "",
      sourceTags.length ? `${sourceTags.join(" or ")} tagged Critters` : "",
      skillTags.length ? `${skillTags.join(" or ")} tagged Skills` : "",
    ].filter(Boolean);
    const targetFilters = [
      targetCritters.length ? targetCritters.join(" or ") : "",
      targetElements.length ? `${targetElements.join(" or ")} Element Critters` : "",
      targetTags.length ? `${targetTags.join(" or ")} tagged Critters` : "",
    ].filter(Boolean);
    const damageMode = p.damage_mode === "hp_only" ? "HP " : p.damage_mode === "shield_only" ? "Shield " : "";
    if (challenge.challenge_type === "take_damage") {
      return `Take ${damageMode}damage as ${targetFilters.length ? targetFilters.join(" and ") : "any user Critter"}${sourceFilters.length ? ` from ${sourceFilters.join(" and ")}` : " from any enemy Critter"}.`;
    }
    const verb = challenge.challenge_type === "knock_out_critters" ? "Knock out" : "Deal damage to";
    return `${challenge.challenge_type === "deal_damage" ? `Deal ${damageMode}damage to` : verb} ${targetFilters.length ? targetFilters.join(" and ") : "any enemy Critter"}${sourceFilters.length ? ` using ${sourceFilters.join(" and ")}` : ""}.`;
  }
  if (challenge.challenge_type === "level_up_critter" || challenge.challenge_type === "level_up_rollcaster") {
    const isCritter = challenge.challenge_type === "level_up_critter";
    const ids = stringParameters(p, isCritter ? "critter_ids" : "rollcaster_ids");
    const names = namesFor(data, isCritter ? "critter" : "rollcaster", ids);
    const label = isCritter ? "Critter" : "Rollcaster";
    const level = p.required_level ?? challenge.required_level ?? 0;
    const amount = p.required_amount ?? challenge.required_amount ?? 0;
    if (p.level_target_mode === "any") return `Level up any ${amount} ${label}${Number(amount) === 1 ? "" : "s"} to level ${level}.`;
    return `Level up ${names.length ? names.join(" and ") : label} to level ${level}.`;
  }
  if (challenge.challenge_type === "shop_shards") return `Unlock ${ownerName} shards`;
  if (challenge.challenge_type === "shop_relic") return `Own ${ownerName}`;
  return "";
}

export function isTrackableChallenge(
  challenge: CollectibleUnlockChallenge,
  templates: AppData["catalog"]["unlockChallengeTemplates"] = [],
): boolean {
  const template = templates?.find((candidate) => candidate.id === challenge.challenge_type);
  const isTrackedEvent = template
    ? template.challenge_category === "tracked" && template.progress_mode === "tracked_event"
    : TRACKED_CHALLENGE_TYPES.has(challenge.challenge_type);
  return isTrackedEvent
    && challenge.parameters?.tracking_required !== false;
}

export function trackedSlotFor(data: AppData, challengeId: string): number | null {
  return trackedChallengesForDisplay(data).find((row) => row.challenge_id === challengeId)?.slot_order ?? null;
}

export function currencyFor(data: AppData, currencyId: string): CurrencyDef | undefined {
  return data.catalog.currencies.find((row) => row.id === currencyId && row.is_active && !row.is_archived);
}

export function orderedCurrencies(data: AppData): CurrencyDef[] {
  return data.catalog.currencies
    .filter((currency) => currency.is_active && !currency.is_archived)
    .sort((left, right) =>
      Number(right.is_default) - Number(left.is_default) ||
      left.sort_order - right.sort_order ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
    );
}

export function currencyBalance(data: AppData, currencyId: string): bigint {
  return safeBigInt(data.player?.collectibleSnapshot.currencies.find((row) => row.currency_id === currencyId)?.balance);
}

export function shardProgress(data: AppData, type: CollectibleType, id: string): bigint {
  return safeBigInt(data.player?.collectibleSnapshot.shards.find(
    (row) => row.collectible_type === type && row.collectible_id === id,
  )?.quantity);
}

export function collectibleTargetAvailable(data: AppData, type: CollectibleType, id: string): boolean {
  const rows = type === "critter" ? data.catalog.critters : type === "rollcaster" ? data.catalog.rollcasters : data.catalog.relics;
  const row = rows.find((candidate) => candidate.id === id);
  return Boolean(row && row.is_active !== false && row.is_archived !== true);
}

export type ShopAvailability = {
  enabled: boolean;
  code: string | null;
  reason: string | null;
  current: bigint;
  goal: bigint;
};

export function shopAvailability(data: AppData, entry: ShopEntry, purchaseQuantity = 1): ShopAvailability {
  const currency = currencyFor(data, entry.currency_id);
  const balance = currencyBalance(data, entry.currency_id);
  const count = Number.isSafeInteger(purchaseQuantity) && purchaseQuantity > 0 ? BigInt(purchaseQuantity) : 1n;
  const price = safeBigInt(entry.price) * count;
  const itemQuantity = safeBigInt(entry.quantity) * count;
  const unavailable = (code: string, reason: string, current = 0n, goal = 0n): ShopAvailability => ({
    enabled: false, code, reason, current, goal,
  });
  const targetAvailable = entry.shop_type === "lootbox"
    ? data.catalog.lootboxes.some((lootbox) => lootbox.id === entry.target_id && lootbox.is_active && !lootbox.is_archived)
    : collectibleTargetAvailable(data, entry.target_category, entry.target_id);
  if (!entry.is_active || entry.is_archived || !currency || !targetAvailable) {
    return unavailable("SHOP_ENTRY_UNAVAILABLE", "Offer unavailable");
  }

  if (entry.shop_type === "lootbox") {
    if (balance < price) return unavailable("INSUFFICIENT_FUNDS", `Need ${formatAmount(price-balance)} more ${currency.name}`);
    return { enabled: true, code: null, reason: null, current: 0n, goal: 0n };
  }

  if (entry.shop_type === "shard") {
    const challenge = challengesFor(data, entry.target_category, entry.target_id).find((row) => row.challenge_type === "shop_shards");
    const current = shardProgress(data, entry.target_category, entry.target_id);
    const goal = safeBigInt(challenge?.required_amount);
    if (collectibleIsUnlocked(data, entry.target_category, entry.target_id)) return unavailable("COLLECTIBLE_ALREADY_UNLOCKED", "Already unlocked", current, goal);
    if (!challenge) return unavailable("SHOP_SHARDS_CHALLENGE_MISSING", "Shard unlock not configured", current, goal);
    if (current >= goal) return unavailable("SHOP_SHARDS_CHALLENGE_COMPLETE", "Shard goal complete", current, goal);
    if (balance < price) return unavailable("INSUFFICIENT_FUNDS", `Need ${formatAmount(price - balance)} more ${currency.name}`, current, goal);
    return { enabled: true, code: null, reason: null, current, goal };
  }

  const relic = data.catalog.relics.find((row) => row.id === entry.target_id);
  const inventory = data.player?.relicInventory.find((row) => row.relic_id === entry.target_id);
  const current = safeBigInt(inventory?.quantity);
  const goal = safeBigInt(relic?.max_owned);
  const unlocked = collectibleIsUnlocked(data, "relic", entry.target_id);
  const challenge = challengesFor(data, "relic", entry.target_id).find((row) => row.challenge_type === "shop_relic");
  if (!unlocked && !challenge) return unavailable("SHOP_RELIC_CHALLENGE_MISSING", "Relic unlock not configured", current, goal);
  if (current + itemQuantity > goal) return unavailable("RELIC_MAX_OWNED_REACHED", "Maximum owned", current, goal);
  if (balance < price) return unavailable("INSUFFICIENT_FUNDS", `Need ${formatAmount(price - balance)} more ${currency.name}`, current, goal);
  return { enabled: true, code: null, reason: null, current, goal };
}

export function shopPurchaseQuantityLimit(data: AppData, entry: ShopEntry, absoluteMax = 99): number {
  const cap = Math.max(1, Math.min(99, Math.trunc(absoluteMax)));
  if (entry.shop_type === "lootbox") return cap;
  const status = shopAvailability(data, entry, 1);
  const remaining = status.goal > status.current ? status.goal - status.current : 0n;
  const bundleSize = safeBigInt(entry.quantity) > 0n ? safeBigInt(entry.quantity) : 1n;
  const bundles = remaining > 0n ? (remaining + bundleSize - 1n) / bundleSize : 0n;
  return Number(bundles > BigInt(cap) ? BigInt(cap) : bundles > 0n ? bundles : 1n);
}

export function shopErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error);
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Your session expired. Please sign in again.",
    SHOP_PURCHASE_PENDING: "Purchase pending—your balance will update automatically.",
    SHOP_ENTRY_UNAVAILABLE: "This offer is no longer available.",
    INSUFFICIENT_FUNDS: "You do not have enough currency for this purchase.",
    COLLECTIBLE_ALREADY_UNLOCKED: "This collectible is already unlocked.",
    SHOP_SHARDS_CHALLENGE_MISSING: "This shard unlock is not configured.",
    SHOP_SHARDS_CHALLENGE_COMPLETE: "This shard goal is already complete.",
    SHOP_RELIC_CHALLENGE_MISSING: "This Relic unlock is not configured.",
    RELIC_MAX_OWNED_REACHED: "This purchase would exceed Maximum owned.",
  };
  const code = Object.keys(messages).find((candidate) => raw.includes(candidate));
  return code ? messages[code] : "The purchase could not be completed.";
}
