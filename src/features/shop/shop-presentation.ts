import { challengesFor, shardProgress } from "../../lib/collectibles.js";
import type { AppData, CollectibleType } from "../../lib/types.js";

export function shardUnlockProgress(data: AppData, type: CollectibleType, id: string, current = shardProgress(data, type, id)) {
  const challenge = challengesFor(data, type, id).find((row) => row.challenge_type === "shop_shards");
  const authoredGoal = challenge?.required_amount;
  const goal = authoredGoal && BigInt(authoredGoal) > 0n ? BigInt(authoredGoal) : current;
  return { current, goal };
}
