import {
  critterElementIds,
  critterHasElement,
  critterStats,
  matchesSelectedElements,
  progressionFor,
} from "../src/lib/critter-calculations.js";
import type { Catalog, Critter, CritterProgression } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const dualElement = { element_1_id: "fire", element_2_id: "wind" };
check(JSON.stringify(critterElementIds(dualElement)) === JSON.stringify(["fire", "wind"]), "dual-element IDs should retain order");
check(critterHasElement(dualElement, "wind"), "secondary elements should match");
check(matchesSelectedElements(dualElement, new Set(["wind"])), "selected secondary elements should match");
check(!matchesSelectedElements(dualElement, new Set(["water"])), "unselected elements should not match");

const progression: CritterProgression[] = [
  { critter_id: "ramber", level: 3, hp_delta: -20, atk_delta: 2, def_delta: 0, spd_delta: 0, dice_min_delta: 0, dice_max_delta: 1, block_cost_delta: 0, swap_cost_delta: 0, total_unlocked_relic_slots: 2, total_required_xp: 100, grant_skill_points: 0 },
  { critter_id: "other", level: 1, hp_delta: 100, atk_delta: 100, def_delta: 100, spd_delta: 100, dice_min_delta: 100, dice_max_delta: 100, block_cost_delta: 100, swap_cost_delta: 100, total_unlocked_relic_slots: 9, total_required_xp: 100, grant_skill_points: 0 },
  { critter_id: "ramber", level: 2, hp_delta: 3, atk_delta: 1, def_delta: -10, spd_delta: 0, dice_min_delta: -2, dice_max_delta: 0, block_cost_delta: -20, swap_cost_delta: -20, total_unlocked_relic_slots: 1, total_required_xp: 50, grant_skill_points: 0 },
];
check(progressionFor(progression, "ramber", 3).map((row) => row.level).join(",") === "2,3", "progression should filter by critter and level, then sort ascending");

const critter = {
  id: "ramber",
  name: "Ramber",
  element_1_id: "fire",
  element_2_id: null,
  tag_ids: [],
  base_hp: 10,
  base_atk: 1,
  base_def: 2,
  base_spd: 3,
  base_dice_min: 1.8,
  base_dice_max: 1.2,
  base_block_cost: -1,
  base_swap_cost: -2,
} as Critter;
const catalog = { critterProgression: progression } as Catalog;
check(JSON.stringify(critterStats(catalog, critter, 3)) === JSON.stringify({ hp: 1, atk: 4, def: 1, spd: 3, diceMin: 1, diceMax: 2, blockCost: 0, swapCost: 0, relicSlots: 2 }), "critter stat aggregation should preserve deltas, bounds, and clamps");

console.log("Critter calculation tests passed.");
