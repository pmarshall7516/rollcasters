import { normalizeCompletionDrop, normalizeCritter, normalizeDungeonDrop, type RawDungeonCompletionDrop, type RawDungeonCurrencyDrop, type RawDungeonItemDrop } from "../src/lib/catalog-normalization.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const legacyCritter = normalizeCritter({ id: "ramber", element_id: "earth", element_2_id: "" });
check(legacyCritter.element_1_id === "earth" && legacyCritter.element_2_id === null && !("element_id" in legacyCritter), "legacy critter element fields should normalize to the canonical shape");

let repeatedElementRejected = false;
try {
  normalizeCritter({ id: "invalid", element_1_id: "earth", element_2_id: "earth" });
} catch {
  repeatedElementRejected = true;
}
check(repeatedElementRejected, "repeated critter elements should remain rejected");

const currencyDrop = normalizeDungeonDrop({
  id: "coins",
  opponent_id: "opponent",
  currency_id: "coins",
  min_amount: 2,
  max_amount: 5,
  probability: "0.25",
  sort_order: 1,
} satisfies RawDungeonCurrencyDrop);
check(JSON.stringify(currencyDrop) === JSON.stringify({ id: "coins", kind: "currency", targetId: "coins", minAmount: 2, maxAmount: 5, probability: 0.25 }), "currency drops should normalize their probability and fields");

const itemDrop = normalizeDungeonDrop({
  id: "shard",
  opponent_id: "opponent",
  drop_type: "shard",
  target_category: "critter",
  target_id: "ramber",
  min_amount: 1,
  max_amount: 3,
  probability: 0.5,
  dupe_currency_id: "coins",
  dupe_currency_amount: 10,
  sort_order: 2,
} satisfies RawDungeonItemDrop);
check(JSON.stringify(itemDrop) === JSON.stringify({ id: "shard", kind: "shard", targetCategory: "critter", targetId: "ramber", minAmount: 1, maxAmount: 3, probability: 0.5, dupeCurrencyId: "coins", dupeCurrencyAmount: 10 }), "item drops should retain duplicate-conversion fields");

const lootboxItemDrop = normalizeDungeonDrop({
  id: "lootbox",
  opponent_id: "opponent",
  drop_type: "lootbox",
  target_category: "lootbox",
  target_id: "001",
  min_amount: 1,
  max_amount: 2,
  probability: "0.25",
  dupe_currency_id: null,
  dupe_currency_amount: null,
  sort_order: 3,
} satisfies RawDungeonItemDrop);
check(JSON.stringify(lootboxItemDrop) === JSON.stringify({ id: "lootbox", kind: "lootbox", targetCategory: "lootbox", targetId: "001", minAmount: 1, maxAmount: 2, probability: 0.25 }), "Lootbox item drops should normalize without duplicate-conversion fields");

const completionDrop = normalizeCompletionDrop({
  id: "reward",
  dungeon_id: "dungeon",
  completion_phase: "regular",
  drop_type: "currency",
  target_category: null,
  target_id: "coins",
  min_amount: 4,
  max_amount: 4,
  probability: "1",
  dupe_currency_id: null,
  dupe_currency_amount: null,
  sort_order: 0,
} satisfies RawDungeonCompletionDrop);
check(completionDrop.id === "dungeon:reward" && completionDrop.phase === "regular" && completionDrop.targetCategory === undefined && completionDrop.dupeCurrencyId === undefined, "completion drops should preserve composite IDs and optional null fields");

const lootboxCompletionDrop = normalizeCompletionDrop({
  id: "lootbox-reward",
  dungeon_id: "dungeon",
  completion_phase: "first_time",
  drop_type: "lootbox",
  target_category: "lootbox",
  target_id: "001",
  min_amount: 1,
  max_amount: 1,
  probability: 1,
  dupe_currency_id: null,
  dupe_currency_amount: null,
  sort_order: 0,
} satisfies RawDungeonCompletionDrop);
check(JSON.stringify(lootboxCompletionDrop) === JSON.stringify({ id: "dungeon:lootbox-reward", phase: "first_time", kind: "lootbox", targetCategory: "lootbox", targetId: "001", minAmount: 1, maxAmount: 1, probability: 1 }), "Lootbox completion drops should normalize as guaranteed Lootbox rewards");

console.log("Catalog normalization tests passed.");
