import { calculateLoadoutStats } from "../src/lib/loadout.js";
import { relicSlotUnlocks, xpProgress } from "../src/lib/progression.js";
import type { AppData, Catalog, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const thresholds = [
  { level: 1, total_required_xp: 0 },
  { level: 2, total_required_xp: 80 },
  { level: 3, total_required_xp: 180 },
];
const beforeLevel = xpProgress(thresholds, 1, 79);
check(beforeLevel.current === 79 && beforeLevel.needed === 80, "Level-one progress must show 79 / 80.");
const afterLevel = xpProgress(thresholds, 2, 100);
check(afterLevel.current === 20 && afterLevel.needed === 100, "Level-two progress must carry over and show 20 / 100.");
check(xpProgress(thresholds, 3, 180).isMaxLevel, "The final progression row must display max level.");

const relicUnlocks = relicSlotUnlocks([
  { critter_id: "hero", level: 1, total_unlocked_relic_slots: 1 },
  { critter_id: "hero", level: 3, total_unlocked_relic_slots: 2 },
  { critter_id: "hero", level: 5, total_unlocked_relic_slots: 3 },
], "hero");
check(relicUnlocks.length === 10, "The home loadout must expose a fixed 10-cell Relic matrix.");
check(relicUnlocks.slice(0, 3).map((slot) => slot.unlockLevel).join(",") === "1,3,5", "Relic cells must retain the first level that unlocks each slot.");
check(relicUnlocks.slice(3).length === 7 && relicUnlocks.slice(3).every((slot) => slot.unlockLevel === null), "Relic cells beyond the lifetime maximum must remain null slots.");

function effect(
  ownerType: "relic" | "ability",
  ownerId: string,
  id: string,
  runtimeKind: "stat_modifier" | "mana_dice_modifier",
  parameters: Record<string, unknown>,
  sortOrder: number,
): ResolvedEffectRef {
  return {
    id,
    name: id,
    description: id,
    ownerType,
    ownerId,
    templateId: `${runtimeKind}-template`,
    runtimeKind,
    runtimeVersion: 1,
    parameters,
    sortOrder,
  };
}

const catalog = {
  elements: [{ id: "ember", name: "Ember", description: null, asset_path: null, sort_order: 1 }],
  skills: [],
  critters: [
    { id: "hero", name: "Hero", element_id: "ember", base_hp: 30, base_atk: 25, base_def: 20, base_spd: 15, base_dice_min: 1, base_dice_max: 6, base_block_cost: 2, base_swap_cost: 2, asset_path: null, description: null, sort_order: 1 },
    { id: "ally", name: "Ally", element_id: "ember", base_hp: 20, base_atk: 20, base_def: 20, base_spd: 20, base_dice_min: 1, base_dice_max: 6, base_block_cost: 2, base_swap_cost: 2, asset_path: null, description: null, sort_order: 2 },
  ],
  critterProgression: [
    { critter_id: "hero", level: 1, total_required_xp: 0, grant_skill_points: 0, hp_delta: 0, atk_delta: 0, def_delta: 0, spd_delta: 0, dice_min_delta: 0, dice_max_delta: 0, block_cost_delta: 0, swap_cost_delta: 0, total_unlocked_relic_slots: 1 },
    { critter_id: "ally", level: 1, total_required_xp: 0, grant_skill_points: 0, hp_delta: 0, atk_delta: 0, def_delta: 0, spd_delta: 0, dice_min_delta: 0, dice_max_delta: 0, block_cost_delta: 0, swap_cost_delta: 0, total_unlocked_relic_slots: 1 },
  ],
  critterSkillUnlocks: [], rollcasters: [], rollcasterProgression: [], rollcasterAbilities: [
    { id: "high-roll", name: "High Roll", description: "High Roll", sort_order: 1 },
  ], rollcasterAbilityUnlocks: [], relics: [
    { id: "guard", name: "Guard Charm", description: "Guard Charm", max_owned: 1, asset_path: null, sort_order: 1 },
    { id: "ally-aura", name: "Ally Aura", description: "Ally Aura", max_owned: 1, asset_path: null, sort_order: 2 },
  ], dungeons: [], dungeonOpponents: [], starterOptions: [], gameAssets: [], statuses: [],
  effectsBySkill: {},
  effectsByAbility: {
    "high-roll": [
      effect("ability", "high-roll", "Maximum Roll", "mana_dice_modifier", { target: "all_friendlies", minimum_delta: 0, maximum_delta: 3 }, 0),
      effect("ability", "high-roll", "Defense Cost", "stat_modifier", { target: "all_friendlies", stat: "def", value_mode: "flat", amount: -2 }, 1),
    ],
  },
  effectsByRelic: {
    guard: [
      effect("relic", "guard", "Guard", "stat_modifier", { target: "equipped_critter", stat: "def", value_mode: "flat", amount: 3 }, 0),
      effect("relic", "guard", "Weight", "stat_modifier", { target: "equipped_critter", stat: "atk", value_mode: "flat", amount: -1 }, 1),
    ],
    "ally-aura": [effect("relic", "ally-aura", "Aura", "stat_modifier", { target: "equipped_allies", stat: "hp", value_mode: "flat", amount: 2 }, 0)],
  },
  effectsByStatus: {}, dungeonOpponentStatOverrides: [],
} as Catalog;

const player = {
  profile: { user_id: "user", username: "Test", coins: 0, starter_selected_at: "now", active_rollcaster_id: "owned-rollcaster" },
  rollcasters: [{ id: "owned-rollcaster", user_id: "user", rollcaster_id: "001", level: 1, xp: 0, ability_points: 0 }],
  critters: [
    { id: "owned-hero", user_id: "user", critter_id: "hero", level: 1, xp: 0, skill_points: 0 },
    { id: "owned-ally", user_id: "user", critter_id: "ally", level: 1, xp: 0, skill_points: 0 },
  ],
  relicInventory: [],
  squadSlots: [
    { user_id: "user", slot_index: 1, user_critter_id: "owned-hero" },
    { user_id: "user", slot_index: 2, user_critter_id: "owned-ally" },
  ],
  skillSlots: [],
  abilitySlots: [{ user_rollcaster_id: "owned-rollcaster", slot_index: 1, ability_id: "high-roll" }],
  relicSlots: [
    { user_critter_id: "owned-hero", slot_index: 1, relic_id: "guard" },
    { user_critter_id: "owned-ally", slot_index: 1, relic_id: "ally-aura" },
  ],
  unlockedSkillIdsByCritter: {}, unlockedAbilityIdsByRollcaster: {}, dungeonProgress: [],
} as PlayerState;

const calculated = calculateLoadoutStats({ catalog, player } as AppData, player.critters[0]);
check(calculated.stats.hp === 32, "An ally Relic must affect the selected squad Critter.");
check(calculated.stats.atk === 24, "The equipped Relic ATK penalty must be reflected on the home card.");
check(calculated.stats.def === 21, "Positive and negative DEF deltas must combine into the combat value.");
check(calculated.stats.diceMin === 1 && calculated.stats.diceMax === 9, "Only the modified Mana maximum must change.");
check(calculated.breakdowns.def?.sources.map((source) => source.amount).join(",") === "3,-2", "The DEF tooltip must retain positive and negative source deltas in resolution order.");

console.log("Collection progression and loadout stat tests passed.");
