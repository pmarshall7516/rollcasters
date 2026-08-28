import type {
  Catalog,
  Critter,
  CritterProgression,
  ElementDef,
  PlayerState,
  UserCritter,
} from "./types.js";
import type { StatBlock } from "./game.js";
import { normalizeManaDiceBounds } from "./combat-calculations.js";

export function byId<T extends { id: string }>(items: T[], id: string | null | undefined): T | undefined {
  if (!id) return undefined;
  return items.find((item) => item.id === id);
}

export function elementName(catalog: Catalog, elementId: string): string {
  return byId<ElementDef>(catalog.elements, elementId)?.name ?? elementId;
}

export function critterElementIds(
  critter: Pick<Critter, "element_1_id" | "element_2_id">,
): string[] {
  return critter.element_2_id
    ? [critter.element_1_id, critter.element_2_id]
    : [critter.element_1_id];
}

export function critterTagIds(critter: Pick<Critter, "tag_ids">): string[] {
  return Array.isArray(critter.tag_ids) ? critter.tag_ids : [];
}

export function critterHasElement(
  critter: Pick<Critter, "element_1_id" | "element_2_id">,
  elementId: string,
): boolean {
  return critter.element_1_id === elementId || critter.element_2_id === elementId;
}

export function matchesSelectedElements(
  critter: Pick<Critter, "element_1_id" | "element_2_id">,
  selectedIds: Set<string>,
): boolean {
  return selectedIds.size === 0
    || critterElementIds(critter).some((elementId) => selectedIds.has(elementId));
}

export function progressionFor(
  rows: CritterProgression[],
  critterId: string,
  level: number,
): CritterProgression[] {
  return rows
    .filter((row) => row.critter_id === critterId && row.level <= level)
    .sort((a, b) => a.level - b.level);
}

export function critterStats(catalog: Catalog, critter: Critter, level: number): StatBlock {
  const rows = progressionFor(catalog.critterProgression, critter.id, level);
  const total = rows.reduce(
    (acc, row) => ({
      hp: acc.hp + row.hp_delta,
      atk: acc.atk + row.atk_delta,
      def: acc.def + row.def_delta,
      spd: acc.spd + row.spd_delta,
      diceMin: acc.diceMin + row.dice_min_delta,
      diceMax: acc.diceMax + row.dice_max_delta,
      blockCost: acc.blockCost + row.block_cost_delta,
      swapCost: acc.swapCost + row.swap_cost_delta,
      relicSlots: row.total_unlocked_relic_slots,
    }),
    {
      hp: critter.base_hp,
      atk: critter.base_atk,
      def: critter.base_def,
      spd: critter.base_spd,
      diceMin: critter.base_dice_min,
      diceMax: critter.base_dice_max,
      blockCost: critter.base_block_cost,
      swapCost: critter.base_swap_cost,
      relicSlots: 1,
    },
  );

  const { diceMin, diceMax } = normalizeManaDiceBounds(total.diceMin, total.diceMax, Math.floor);

  return {
    hp: Math.max(1, total.hp),
    atk: Math.max(1, total.atk),
    def: Math.max(1, total.def),
    spd: Math.max(1, total.spd),
    diceMin,
    diceMax,
    blockCost: Math.max(0, total.blockCost),
    swapCost: Math.max(0, total.swapCost),
    relicSlots: Math.max(0, total.relicSlots),
  };
}

export function equippedSkillIds(player: PlayerState, userCritterId: string): string[] {
  return player.skillSlots
    .filter((slot) => slot.user_critter_id === userCritterId && slot.skill_id)
    .sort((a, b) => a.slot_index - b.slot_index)
    .map((slot) => slot.skill_id!)
    .filter(Boolean);
}

export function squadCritters(player: PlayerState): UserCritter[] {
  return player.squadSlots
    .slice()
    .sort((a, b) => a.slot_index - b.slot_index)
    .map((slot) => player.critters.find((critter) => critter.id === slot.user_critter_id))
    .filter((critter): critter is UserCritter => Boolean(critter));
}
