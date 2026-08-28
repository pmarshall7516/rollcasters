import { shardUnlockProgress } from "../src/features/shop/shop-presentation.js";
import type { AppData } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const data = {
  catalog: {
    collectibleUnlockChallenges: [{ id: "ward-shop", collectible_type: "relic", collectible_id: "ward", challenge_type: "shop_shards", required_amount: "5", sort_order: 0, is_active: true, is_archived: false, version: 1 }],
  },
} as unknown as AppData;
const authored = shardUnlockProgress(data, "relic", "ward", 2n);
check(authored.current === 2n && authored.goal === 5n, "shard progress should prefer a positive authored goal");
const missing = shardUnlockProgress(data, "relic", "missing", 0n);
check(missing.current === 0n && missing.goal === 0n, "missing shop challenges should use current progress as the goal");

console.log("Shop presentation tests passed.");
