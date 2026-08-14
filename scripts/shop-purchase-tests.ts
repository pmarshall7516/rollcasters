import { applyOptimisticShopPurchase, applyShopPurchaseReceipt, shopPurchaseItemQuantity, shopPurchasePrice } from "../src/lib/shop.js";
import type { AppData, ShopEntry, ShopPurchaseReceipt } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const shardEntry: ShopEntry = {
  id: "shard-entry",
  shop_type: "shard",
  name: "Shard bundle",
  description: "Test bundle",
  target_category: "critter",
  target_id: "001",
  quantity: 2,
  currency_id: "coins",
  price: "10",
  sort_order: 0,
  is_active: true,
  is_archived: false,
};

const baseData = {
  catalog: {},
  player: {
    profile: { user_id: "user-1" },
    relicInventory: [],
    collectibleSnapshot: {
      currencies: [{ currency_id: "coins", balance: "100" }],
      shards: [{ collectible_type: "critter", collectible_id: "001", quantity: "0" }],
      lootboxes: [],
    },
  },
} as unknown as AppData;

check(shopPurchasePrice(shardEntry, 3) === 30n, "Quantity pricing must multiply the catalog price exactly.");
check(shopPurchaseItemQuantity(shardEntry, 3) === 6n, "Quantity purchases must multiply the authored item bundle.");

const projected = applyOptimisticShopPurchase(baseData, shardEntry, 3);
check(projected.player?.collectibleSnapshot.currencies[0]?.balance === "70", "Optimistic purchase must reserve the full total price.");
check(projected.player?.collectibleSnapshot.shards[0]?.quantity === "6", "Optimistic purchase must project every item in the requested bundle.");

const receipt: ShopPurchaseReceipt = {
  request_id: "request-1",
  entry_id: shardEntry.id,
  shop_type: "shard",
  target_category: "critter",
  target_id: shardEntry.target_id,
  currency_id: "coins",
  price: "30",
  balance: "70",
  granted: "4",
  discarded: "2",
  unlock_event_id: null,
  created_at: "2026-08-14T00:00:00.000Z",
};
const settled = applyShopPurchaseReceipt(baseData, shardEntry, receipt);
check(settled.player?.collectibleSnapshot.currencies[0]?.balance === "70", "Receipt settlement must use the server balance.");
check(settled.player?.collectibleSnapshot.shards[0]?.quantity === "4", "Receipt settlement must use the server-granted quantity, not the requested quantity.");

console.log("Shop quantity projection tests passed.");
