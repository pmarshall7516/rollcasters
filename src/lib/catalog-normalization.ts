import type { Critter, DungeonCompletionDrop, DungeonDrop } from "./types.js";

export type RawDungeonCurrencyDrop = {
  id: string;
  opponent_id: string;
  currency_id: string;
  min_amount: number;
  max_amount: number;
  probability: number | string;
  sort_order: number;
};

export type RawDungeonItemDrop = {
  id: string;
  opponent_id: string;
  drop_type: "shard" | "relic" | "lootbox";
  target_category: "critter" | "rollcaster" | "relic" | "lootbox";
  target_id: string;
  min_amount: number;
  max_amount: number;
  probability: number | string;
  dupe_currency_id: string | null;
  dupe_currency_amount: number | null;
  sort_order: number;
};

export type RawDungeonCompletionDrop = {
  id: string;
  dungeon_id: string;
  completion_phase: "first_time" | "regular";
  drop_type: "currency" | "shard" | "relic" | "lootbox";
  target_category: "critter" | "rollcaster" | "relic" | "lootbox" | null;
  target_id: string;
  min_amount: number;
  max_amount: number;
  probability: number | string;
  dupe_currency_id: string | null;
  dupe_currency_amount: number | null;
  sort_order: number;
};

export function normalizeCritter(row: Record<string, unknown>): Critter {
  const element1Id = typeof row.element_1_id === "string"
    ? row.element_1_id
    : typeof row.element_id === "string"
      ? row.element_id
      : "";
  if (!element1Id) {
    throw new Error(`Critter ${String(row.id ?? "(unknown)")} is missing Element 1.`);
  }
  const element2Id = typeof row.element_2_id === "string" && row.element_2_id
    ? row.element_2_id
    : null;
  if (element2Id === element1Id) {
    throw new Error(`Critter ${String(row.id ?? "(unknown)")} repeats Element 1 in Element 2.`);
  }
  const { element_id: _deprecatedElementId, ...canonicalRow } = row;
  return {
    ...canonicalRow,
    element_1_id: element1Id,
    element_2_id: element2Id,
  } as Critter;
}

export function normalizeDungeonDrop(
  row: RawDungeonCurrencyDrop | RawDungeonItemDrop,
): DungeonDrop {
  if ("currency_id" in row) {
    return {
      id: row.id,
      kind: "currency",
      targetId: row.currency_id,
      minAmount: row.min_amount,
      maxAmount: row.max_amount,
      probability: Number(row.probability),
    };
  }
  return {
    id: row.id,
    kind: row.drop_type,
    targetCategory: row.target_category ?? undefined,
    targetId: row.target_id,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    probability: Number(row.probability),
    dupeCurrencyId: row.dupe_currency_id ?? undefined,
    dupeCurrencyAmount: row.dupe_currency_amount ?? undefined,
  };
}

export function normalizeCompletionDrop(row: RawDungeonCompletionDrop): DungeonCompletionDrop {
  return {
    id: `${row.dungeon_id}:${row.id}`,
    phase: row.completion_phase,
    kind: row.drop_type,
    targetCategory: row.target_category ?? undefined,
    targetId: row.target_id,
    minAmount: row.min_amount,
    maxAmount: row.max_amount,
    probability: Number(row.probability),
    dupeCurrencyId: row.dupe_currency_id ?? undefined,
    dupeCurrencyAmount: row.dupe_currency_amount ?? undefined,
  };
}
