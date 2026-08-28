import { lootboxPoolEntryName, lootboxQuantity, lootboxRewardName, lootboxRewardProgress } from "../src/features/bag/lootbox-presentation.js";
import type { AppData, LootboxOpeningReceipt, LootboxPoolEntry, LootboxReward } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const data = {
  catalog: {
    lootboxes: [{ id: "starter", name: "Starter Box" }],
    relics: [{ id: "ward", name: "Ward", description: "", asset_path: null, max_owned: "3", sort_order: 0, is_active: true, is_archived: false, version: 1 }],
    currencies: [{ id: "coins", name: "Coins", description: "", asset_path: null, sort_order: 0, is_active: true, is_archived: false, version: 1 }],
    collectibleUnlockChallenges: [{ id: "ward-shards", collectible_type: "relic", collectible_id: "ward", challenge_type: "shop_shards", required_amount: "5", sort_order: 0, is_active: true, is_archived: false, version: 1 }],
  },
  player: {
    collectibleSnapshot: { lootboxes: [{ lootbox_id: "starter", quantity: "2" }] },
    relicInventory: [{ relic_id: "ward", quantity: "1" }],
  },
} as unknown as AppData;

const currencyEntry = { id: "coins", lootbox_id: "starter", reward_type: "currency", target_category: null, target_id: "coins", min_amount: 5, max_amount: 5, probability: 1, dupe_currency_id: null, dupe_currency_amount: null, sort_order: 0 } as LootboxPoolEntry;
check(lootboxPoolEntryName(data, currencyEntry) === "Coins", "currency pool entries should use currency names");
const shardReward: LootboxReward = { poolEntryId: "ward-shards", type: "shard", targetCategory: "relic", targetId: "ward", name: "Ward", assetPath: null, amount: "2", granted: "2", discarded: "0", dupeCurrencyId: null, dupeCurrencyAmount: null, convertedCurrencyAmount: "0" };
check(lootboxRewardName(data, { reward: shardReward } as LootboxOpeningReceipt) === "Ward Shards", "shard rewards should use the existing pluralized label");
check(lootboxQuantity(data, "starter") === 2n, "lootbox quantity should read the collectible snapshot");
const progress = lootboxRewardProgress(data, { ...shardReward, type: "relic", targetCategory: null, granted: "4" });
check(progress?.kind === "relic" && progress.current === 1n && progress.max === 3n && progress.final === 3n, "relic reward progress should preserve current and capped final values");
check(lootboxRewardProgress(data, { ...shardReward, type: "currency", targetCategory: null, targetId: "coins", granted: "5" }) === null, "non-progress rewards should not produce progress state");

console.log("Lootbox presentation tests passed.");
