import type {
  AppData,
  CollectibleType,
  CollectibleUnlockChallenge,
  CurrencyDef,
  ShopEntry,
  UserCollectibleChallengeProgress,
} from "./types.js";

const collectibleIdCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

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
  return player.relicInventory.some((row) => row.relic_id === id && row.quantity > 0 && row.discovered_at !== null);
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

export function progressFor(data: AppData, challengeId: string): UserCollectibleChallengeProgress {
  const challenge = data.catalog.collectibleUnlockChallenges.find((row) => row.id === challengeId);
  const progress = data.player?.collectibleSnapshot.progress.find((row) => row.challenge_id === challengeId);
  const authoredGoal = challenge ? challengeGoal(challenge) : 0n;
  if (!progress) {
    const current = challenge ? derivedChallengeCurrent(data, challenge) : 0n;
    return {
      challenge_id: challengeId,
      current: String(authoredGoal > 0n && current > authoredGoal ? authoredGoal : current),
      goal: String(authoredGoal),
      goal_reached: authoredGoal > 0n && current >= authoredGoal,
      eligible: true,
      completed: false,
      blocked_by_gate_order: null,
      // A missing authoritative state usually means the published definition
      // is older than the live server definition. Do not allow tracking a row
      // the server cannot resolve.
      trackable: false,
    };
  }

  const eligible = progress.eligible ?? true;
  const completed = eligible && progress.completed;
  const normalizedGoal = safeBigInt(progress.goal) > 0n ? safeBigInt(progress.goal) : authoredGoal;
  return {
    ...progress,
    goal: String(normalizedGoal),
    goal_reached: progress.goal_reached ?? (normalizedGoal > 0n && safeBigInt(progress.current) >= normalizedGoal),
    eligible,
    completed,
    blocked_by_gate_order: progress.blocked_by_gate_order ?? null,
    trackable: progress.trackable ?? (eligible && !completed),
  };
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

function namesFor(data: AppData, type: CollectibleType | "element" | "skill" | "dungeon", ids: string[]): string[] {
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
            : data.catalog.dungeons;
  return ids.map((id) => rows.find((row) => row.id === id)?.name ?? id);
}

function targetNames(data: AppData, challenge: CollectibleUnlockChallenge): string {
  const parameters = challengeParameters(challenge);
  const mode = String(challenge.target_mode ?? parameters.target_mode ?? "species");
  const label = mode === "species" ? "Species" : mode === "element" ? "Element" : "Skill";
  const anyTarget = challenge.any_target || parameters.any_target === true;
  if (anyTarget) return `Any ${label}`;
  const ids = challenge.target_ids.length ? challenge.target_ids : stringParameters(parameters, "target_ids");
  return namesFor(data, mode === "species" ? "critter" : mode === "element" ? "element" : "skill", ids).join(", ") || `Choose ${label.toLowerCase()} targets`;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function challengeParameters(challenge: CollectibleUnlockChallenge): Record<string, unknown> {
  if (challenge.parameters && typeof challenge.parameters === "object") return challenge.parameters;
  return {
    target_category: challenge.target_category,
    target_id: challenge.target_id,
    target_mode: challenge.target_mode,
    any_target: challenge.any_target,
    target_ids: challenge.target_ids,
    required_amount: challenge.required_amount == null ? undefined : Number(challenge.required_amount),
    required_level: challenge.required_level,
  };
}

export function challengeGoal(challenge: CollectibleUnlockChallenge): bigint {
  const parameters = challengeParameters(challenge);
  switch (challenge.challenge_type) {
    case "level_up_critter": return safeUnknownBigInt(parameters.required_level ?? challenge.required_level);
    case "collection_diversity": return String(parameters.diversity_mode) === "specific_types"
      ? BigInt(Array.isArray(parameters.required_element_ids) ? parameters.required_element_ids.length : 0)
      : safeUnknownBigInt(parameters.required_distinct_types ?? parameters.required_per_type);
    case "squad_composition": return safeUnknownBigInt(parameters.required_completions);
    case "dungeon_clear": return safeUnknownBigInt(parameters.required_clears);
    case "dice_roll": return safeUnknownBigInt(parameters.required_occurrences);
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
    const allowed = (id: string) => ids.size === 0 || ids.has(id);
    if (type === "critter") return BigInt(player.critters.filter((row) => allowed(row.critter_id)).length);
    if (type === "rollcaster") return BigInt(player.rollcasters.filter((row) => allowed(row.rollcaster_id)).length);
    const relics = player.relicInventory.filter((row) => row.discovered_at !== null && row.quantity > 0 && allowed(row.relic_id));
    return parameters.require_unique_collectibles === false
      ? BigInt(relics.reduce((sum, row) => sum + row.quantity, 0))
      : BigInt(relics.length);
  }
  if (challenge.challenge_type === "level_up_critter") {
    const id = String(parameters.critter_id ?? challenge.target_id ?? "");
    return BigInt(player.critters.find((row) => row.critter_id === id)?.level ?? 0);
  }
  if (challenge.challenge_type === "collection_diversity") {
    const buckets = new Map<string, Set<string>>();
    for (const owned of player.critters) {
      const critter = data.catalog.critters.find((row) => row.id === owned.critter_id);
      if (!critter) continue;
      for (const elementId of [critter.element_1_id, critter.element_2_id]) {
        if (!elementId) continue;
        const bucket = buckets.get(elementId) ?? new Set<string>();
        bucket.add(owned.critter_id);
        buckets.set(elementId, bucket);
      }
    }
    const requiredPerType = Number(parameters.required_per_type ?? 1);
    if (parameters.diversity_mode === "amount_of_type") {
      const elementId = Array.isArray(parameters.element_ids) ? parameters.element_ids[0] : undefined;
      return BigInt(elementId && typeof elementId === "string" ? buckets.get(elementId)?.size ?? 0 : 0);
    }
    const selected = parameters.diversity_mode === "specific_types" && Array.isArray(parameters.required_element_ids)
      ? parameters.required_element_ids.filter((id): id is string => typeof id === "string")
      : [...buckets.keys()];
    return BigInt(selected.filter((id) => (buckets.get(id)?.size ?? 0) >= requiredPerType).length);
  }
  if (challenge.challenge_type === "shop_shards") return shardProgress(data, challenge.collectible_type, challenge.collectible_id);
  if (challenge.challenge_type === "shop_relic") return safeBigInt(player.relicInventory.find((row) => row.relic_id === challenge.collectible_id)?.quantity);
  return 0n;
}

export function challengeDescription(data: AppData, challenge: CollectibleUnlockChallenge): string {
  if (challenge.display_text?.trim()) return challenge.display_text.trim();
  const ownerName = collectibleName(data, challenge.collectible_type, challenge.collectible_id);
  const parameters = challengeParameters(challenge);
  switch (challenge.challenge_type) {
    case "own_collectible": {
      const type = (parameters.collectible_category as CollectibleType | undefined) ?? challenge.target_category ?? "critter";
      const ids = stringParameters(parameters, "collectible_ids");
      const names = namesFor(data, type, ids);
      const goal = Number(parameters.required_amount ?? challenge.required_amount ?? 1);
      if (names.length === 1 && goal === 1) return `Own ${names[0]}.`;
      if (names.length) return `Own ${goal} of: ${names.join(", ")}.`;
      const label = type === "critter" ? "Critter" : type === "rollcaster" ? "Rollcaster" : "Relic";
      return `Own ${goal} ${parameters.require_unique_collectibles === true ? "different " : ""}${label}${goal === 1 ? "" : "s"}.`;
    }
    case "collection_diversity": {
      if (parameters.diversity_mode === "amount_of_type") return `Own ${parameters.required_per_type} different ${namesFor(data, "element", stringParameters(parameters, "element_ids"))[0] ?? "Element"} Critters.`;
      if (parameters.diversity_mode === "different_types") return `Own Critters from ${parameters.required_distinct_types} different Element types.`;
      return `Own ${parameters.required_per_type} Critter${Number(parameters.required_per_type) === 1 ? "" : "s"} from each of: ${namesFor(data, "element", stringParameters(parameters, "required_element_ids")).join(", ") || "selected Elements"}.`;
    }
    case "squad_composition": return `${parameters.completion_event === "battle_win" ? "Win" : "Clear"} ${parameters.required_completions} ${parameters.completion_event === "battle_win" ? "battle" : "Dungeon"}${Number(parameters.required_completions) === 1 ? "" : "s"} with the configured squad.`;
    case "dungeon_clear": return `Clear ${parameters.dungeon_selection === "any_dungeon" ? "any Dungeon" : parameters.dungeon_selection === "specific_dungeon" ? namesFor(data, "dungeon", stringParameters(parameters, "dungeon_ids"))[0] ?? "the selected Dungeon" : `Dungeons ${stringParameters(parameters, "minimum_dungeon_ids")[0] ?? "—"}–${stringParameters(parameters, "maximum_dungeon_ids")[0] ?? "—"}`} ${parameters.required_clears} time${Number(parameters.required_clears) === 1 ? "" : "s"}.`;
    case "resource_spending": return `Spend ${parameters.required_amount} ${humanize(String(parameters.resource_type))} ${parameters.tracking_scope === "lifetime" ? "in total" : humanize(String(parameters.tracking_scope))}.`;
    case "swap_action": return `${humanize(String(parameters.tracked_action))} ${parameters.required_amount} time${Number(parameters.required_amount) === 1 ? "" : "s"}.`;
    case "block_action": return `${humanize(String(parameters.tracked_action))}: ${parameters.required_amount}.`;
    case "dice_roll": return `${humanize(String(parameters.tracked_result))} ${humanize(String(parameters.comparison))} ${parameters.target_value}, ${parameters.required_occurrences} time${Number(parameters.required_occurrences) === 1 ? "" : "s"}.`;
    case "level_up_critter": {
      const id = String(challenge.target_id ?? parameters.critter_id ?? "");
      return `Unlock level ${challenge.required_level ?? parameters.required_level ?? 0} for ${collectibleName(data, "critter", id)} (${id || "—"})`;
    }
    case "knock_out_critters": return `Knock out Critters (${targetNames(data, challenge)})`;
    case "deal_damage": return `Damage Critters (${targetNames(data, challenge)})`;
    case "take_damage": return `Receive Damage (${targetNames(data, challenge)})`;
    case "use_skill": return `Use Skill (${targetNames(data, challenge)})`;
    case "shop_shards": return `Unlock ${ownerName} shards`;
    case "shop_relic": return `Own ${ownerName}`;
  }
}

export function isTrackableChallenge(challenge: CollectibleUnlockChallenge): boolean {
  return TRACKED_CHALLENGE_TYPES.has(challenge.challenge_type);
}

export function trackedSlotFor(data: AppData, challengeId: string): number | null {
  return data.player?.collectibleSnapshot.tracked.find((row) => row.challenge_id === challengeId)?.slot_order ?? null;
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

export function shopAvailability(data: AppData, entry: ShopEntry): ShopAvailability {
  const currency = currencyFor(data, entry.currency_id);
  const balance = currencyBalance(data, entry.currency_id);
  const price = safeBigInt(entry.price);
  const unavailable = (code: string, reason: string, current = 0n, goal = 0n): ShopAvailability => ({
    enabled: false, code, reason, current, goal,
  });
  if (!entry.is_active || entry.is_archived || !currency || !collectibleTargetAvailable(data, entry.target_category, entry.target_id)) {
    return unavailable("SHOP_ENTRY_UNAVAILABLE", "Offer unavailable");
  }

  if (entry.shop_type === "shard") {
    const challenge = challengesFor(data, entry.target_category, entry.target_id).find((row) => row.challenge_type === "shop_shards");
    const current = shardProgress(data, entry.target_category, entry.target_id);
    const goal = safeBigInt(challenge?.required_amount);
    if (collectibleIsOwned(data, entry.target_category, entry.target_id)) return unavailable("COLLECTIBLE_ALREADY_UNLOCKED", "Already unlocked", current, goal);
    if (!challenge) return unavailable("SHOP_SHARDS_CHALLENGE_MISSING", "Shard unlock not configured", current, goal);
    if (current >= goal) return unavailable("SHOP_SHARDS_CHALLENGE_COMPLETE", "Shard goal complete", current, goal);
    if (balance < price) return unavailable("INSUFFICIENT_FUNDS", `Need ${formatAmount(price - balance)} more ${currency.name}`, current, goal);
    return { enabled: true, code: null, reason: null, current, goal };
  }

  const relic = data.catalog.relics.find((row) => row.id === entry.target_id);
  const inventory = data.player?.relicInventory.find((row) => row.relic_id === entry.target_id);
  const current = safeBigInt(inventory?.quantity);
  const goal = safeBigInt(relic?.max_owned);
  const unlocked = collectibleIsOwned(data, "relic", entry.target_id);
  const challenge = challengesFor(data, "relic", entry.target_id).find((row) => row.challenge_type === "shop_relic");
  if (!unlocked && !challenge) return unavailable("SHOP_RELIC_CHALLENGE_MISSING", "Relic unlock not configured", current, goal);
  if (current + safeBigInt(entry.quantity) > goal) return unavailable("RELIC_MAX_OWNED_REACHED", "Maximum owned", current, goal);
  if (balance < price) return unavailable("INSUFFICIENT_FUNDS", `Need ${formatAmount(price - balance)} more ${currency.name}`, current, goal);
  return { enabled: true, code: null, reason: null, current, goal };
}

export function shopErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error);
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Your session expired. Please sign in again.",
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
