import { createInitialCombatState, resolveCombatActions } from "../src/lib/game.js";
import type { Catalog, PlayerState } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const catalog = {
  currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [],
  elements: [{ id: "basic", name: "Basic", description: null, asset_path: null, sort_order: 0 }],
  tags: [], elementEffectiveness: [{ attacking_element_id: "basic", defending_element_id: "basic", multiplier: 1 }],
  skills: [{ id: "punch", name: "Punch", element_id: "basic", skill_type: "attack", power: 100, mana_cost: 0, targeting: "single_enemy", description: "Punch", sort_order: 0, tag_ids: [] }],
  critters: [
    { id: "player-critter", name: "Player", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 100, base_def: 10, base_spd: 100, base_dice_min: 1, base_dice_max: 1, base_block_cost: 0, base_swap_cost: 0, asset_path: null, description: null, sort_order: 0, tag_ids: [] },
    { id: "enemy-critter", name: "Enemy", element_1_id: "basic", element_2_id: null, base_hp: 1, base_atk: 1, base_def: 1, base_spd: 1, base_dice_min: 1, base_dice_max: 1, base_block_cost: 0, base_swap_cost: 0, asset_path: null, description: null, sort_order: 1, tag_ids: [] },
  ],
  critterProgression: [], critterSkillUnlocks: [],
  rollcasters: [{ id: "rollcaster", name: "Rollcaster", asset_path: null, description: null, sort_order: 0 }],
  rollcasterProgression: [], rollcasterAbilities: [], rollcasterAbilityUnlocks: [], relics: [],
  dungeons: [{ id: "dungeon", name: "Dungeon", description: "", dungeon_type: "regular", difficulty: 1, battle_format: "1v1", battle_count: 1, player_active_count: 1, opponent_active_count: 1, encounter_count: 1, next_dungeon_id: null, regular_logo_path: null, boss_logo_path: null, sort_order: 0, is_active: true, is_archived: false, version: 1 }],
  dungeonOpponents: [{ id: "opponent", dungeon_id: "dungeon", pool_type: "regular_pool", sequence_index: 0, probability: 1, critter_id: "enemy-critter", critter_level: 1, skill_ids: [], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [], currencyDrops: [], itemDrops: [], overrides: {} }],
  dungeonCompletionDrops: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {}, dungeonOpponentStatOverrides: [],
} as unknown as Catalog;

const player = {
  profile: { user_id: "user", username: "user", coins: 0, starter_rollcaster_selected_at: "now", starter_selected_at: "now", active_rollcaster_id: "owned-rollcaster" },
  rollcasters: [{ id: "owned-rollcaster", user_id: "user", rollcaster_id: "rollcaster", level: 1, xp: 0, ability_points: 0 }],
  critters: [{ id: "owned-critter", user_id: "user", critter_id: "player-critter", level: 1, xp: 0, skill_points: 0 }],
  relicInventory: [], squadSlots: [{ user_id: "user", slot_index: 1, user_critter_id: "owned-critter" }],
  skillSlots: [{ user_critter_id: "owned-critter", slot_index: 1, skill_id: "punch" }], abilitySlots: [], relicSlots: [],
  unlockedSkillIdsByCritter: {}, unlockedAbilityIdsByRollcaster: {}, dungeonProgress: [],
  collectibleSnapshot: { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] },
} as unknown as PlayerState;

const dungeon = catalog.dungeons[0];
const initial = createInitialCombatState(catalog, player, dungeon, "dungeon-run");
const state = resolveCombatActions(
  { ...initial, phase: "selecting", playerMana: 10, opponentMana: 0 },
  [{ actorKey: "p1", type: "skill", skillId: "punch", targetKey: "o1", cost: 0 }],
  [],
);
const finalEvent = state.turnEvents.find((event) => event.event_type === "final_knockout_attribution");
check(state.phase === "won", "The fixture must produce a player win.");
check(finalEvent?.payload?.battle_won === true, "A winning battle must emit final knockout attribution.");
check(finalEvent?.payload?.finisher_type === "skill" && finalEvent.skill_id === "punch", "The final knockout must identify its Skill finisher.");
check(finalEvent?.payload?.remaining_enemy_count === 0, "Final knockout attribution must report no remaining enemies.");

console.log("Closing Move runtime emission tests passed.");
