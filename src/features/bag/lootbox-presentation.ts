import { challengesFor, collectibleName, currencyFor, safeBigInt, shardProgress } from "../../lib/collectibles.js";
import type { AppData, LootboxOpeningReceipt, LootboxPoolEntry } from "../../lib/types.js";

export function lootboxPoolEntryName(data: AppData, entry: LootboxPoolEntry): string {
  if (entry.reward_type === "currency") return currencyFor(data, entry.target_id)?.name ?? entry.target_id;
  if (entry.reward_type === "lootbox") return data.catalog.lootboxes.find((row) => row.id === entry.target_id)?.name ?? entry.target_id;
  if (entry.reward_type === "shard" && entry.target_category && entry.target_category !== "lootbox") return `${collectibleName(data,entry.target_category,entry.target_id)} Shards`;
  return collectibleName(data,"relic",entry.target_id);
}

export function lootboxRewardName(data: AppData, receipt: LootboxOpeningReceipt, winningEntry?: LootboxPoolEntry): string {
  if (winningEntry) return lootboxPoolEntryName(data, winningEntry);
  if (receipt.reward.type === "shard" && receipt.reward.targetCategory && receipt.reward.targetCategory !== "lootbox") {
    return `${receipt.reward.name} Shards`;
  }
  return receipt.reward.name;
}

export function lootboxQuantity(data: AppData, lootboxId: string): bigint {
  return safeBigInt(data.player?.collectibleSnapshot.lootboxes.find((row) => row.lootbox_id === lootboxId)?.quantity);
}

export type LootboxRewardProgressState = {
  kind: "shard" | "relic";
  current: bigint;
  max: bigint;
  final: bigint;
};

export function lootboxRewardProgress(data: AppData, reward: LootboxOpeningReceipt["reward"]): LootboxRewardProgressState | null {
  const granted = safeBigInt(reward.granted);
  if (reward.type === "shard" && reward.targetCategory && reward.targetCategory !== "lootbox") {
    const challenge = challengesFor(data, reward.targetCategory, reward.targetId).find((row) => row.challenge_type === "shop_shards");
    const max = safeBigInt(challenge?.required_amount);
    if (max <= 0n) return null;
    const current = shardProgress(data, reward.targetCategory, reward.targetId) > max
      ? max
      : shardProgress(data, reward.targetCategory, reward.targetId);
    return { kind: "shard", current, max, final: current + granted > max ? max : current + granted };
  }
  if (reward.type === "relic") {
    const max = safeBigInt(data.catalog.relics.find((relic) => relic.id === reward.targetId)?.max_owned);
    if (max <= 0n) return null;
    const owned = safeBigInt(data.player?.relicInventory.find((row) => row.relic_id === reward.targetId)?.quantity);
    const current = owned > max ? max : owned;
    return { kind: "relic", current, max, final: current + granted > max ? max : current + granted };
  }
  return null;
}
