import { recoverLootboxOpening } from "../src/lib/lootbox.js";
import type { LootboxOpeningReceipt } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const calls: Array<{ lootboxId: string; requestId: string }> = [];
let attempts = 0;
const receipt: LootboxOpeningReceipt = {
  openingId: "opening-1",
  requestId: "request-1",
  lootboxId: "001",
  lootboxName: "Common Lootbox",
  closedAssetPath: null,
  openAssetPath: null,
  reward: {
    poolEntryId: "pool-1",
    type: "currency",
    targetCategory: null,
    targetId: "coins",
    name: "Coins",
    assetPath: null,
    amount: "30",
    granted: "30",
    discarded: "0",
    dupeCurrencyId: null,
    dupeCurrencyAmount: null,
    convertedCurrencyAmount: "0",
  },
  createdAt: "2026-08-26T00:00:00.000Z",
};

const recovered = await recoverLootboxOpening(
  async (lootboxId, requestId) => {
    calls.push({ lootboxId, requestId });
    attempts += 1;
    if (attempts === 1) {
      throw { code: "57014", message: "canceling statement due to statement timeout" };
    }
    return receipt;
  },
  "001",
  "request-1",
  { delay: async () => undefined },
);

check(recovered === receipt, "A retry must return the authoritative lootbox opening receipt.");
check(calls.length === 2, "A retryable opening failure must be retried.");
check(calls.every((call) => call.lootboxId === "001" && call.requestId === "request-1"), "Opening retries must reuse the same idempotency request ID.");

console.log("Lootbox reliability tests passed.");
