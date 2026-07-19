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
]);

export function safeBigInt(value: string | number | bigint | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
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
  const progress = data.player?.collectibleSnapshot.progress.find((row) => row.challenge_id === challengeId);
  if (!progress) return {
    challenge_id: challengeId,
    current: "0",
    goal: "0",
    goal_reached: false,
    eligible: true,
    completed: false,
    blocked_by_gate_order: null,
    trackable: true,
  };

  const eligible = progress.eligible ?? true;
  const completed = eligible && progress.completed;
  return {
    ...progress,
    goal_reached: progress.goal_reached ?? safeBigInt(progress.current) >= safeBigInt(progress.goal),
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

function targetNames(data: AppData, challenge: CollectibleUnlockChallenge): string {
  if (challenge.any_target) {
    if (challenge.target_mode === "species") return "Any Species";
    if (challenge.target_mode === "element") return "Any Element";
    return "Any Skill";
  }
  return challenge.target_ids.map((id) => {
    if (challenge.target_mode === "species") return collectibleName(data, "critter", id);
    if (challenge.target_mode === "element") return data.catalog.elements.find((row) => row.id === id)?.name ?? id;
    return data.catalog.skills.find((row) => row.id === id)?.name ?? id;
  }).join(", ");
}

export function challengeDescription(data: AppData, challenge: CollectibleUnlockChallenge): string {
  const ownerName = collectibleName(data, challenge.collectible_type, challenge.collectible_id);
  switch (challenge.challenge_type) {
    case "own_collectible": {
      const type = challenge.target_category ?? "critter";
      const id = challenge.target_id ?? "";
      return `Unlock ${collectibleName(data, type, id)} (${id})`;
    }
    case "level_up_critter": {
      const id = challenge.target_id ?? "";
      return `Unlock level ${challenge.required_level ?? 1} for ${collectibleName(data, "critter", id)} (${id})`;
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
