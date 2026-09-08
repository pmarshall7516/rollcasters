import { createInitialCombatState, resolveCombatActions } from "../src/lib/game.js";
import type { Catalog, CombatAction, Dungeon, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function effect(ownerType: "skill" | "ability", ownerId: string, id: string, runtimeKind: string, parameters: Record<string, unknown>): ResolvedEffectRef {
  return { id, name: id, description: id, ownerType, ownerId, templateId: `${ownerType}-${runtimeKind}`, runtimeKind, runtimeVersion: 1, parameters, sortOrder: 0 };
}

const dungeon: Dungeon = {
  id: "d", name: "Test", description: "", dungeon_type: "regular", difficulty: 1,
  battle_format: "1v1", battle_count: 1, player_active_count: 1, opponent_active_count: 1,
  encounter_count: 1, next_dungeon_id: null, regular_logo_path: null, boss_logo_path: null,
  sort_order: 0, is_active: true, is_archived: false, version: 1,
};
const catalog: Catalog = {
  currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [],
  elements: [{ id: "basic", name: "Basic", description: null, asset_path: null, sort_order: 0 }],
  elementEffectiveness: [{ attacking_element_id: "basic", defending_element_id: "basic", multiplier: 1 }],
  tags: [],
  skills: [
    { id: "barrage", name: "Barrage", element_id: "basic", skill_type: "attack", power: 10, mana_cost: 0, targeting: "single_enemy", description: "Barrage.", sort_order: 0, tag_ids: [] },
    { id: "variable", name: "Variable", element_id: "basic", skill_type: "attack", power: 10, mana_cost: 0, targeting: "single_enemy", description: "Variable.", sort_order: 1, tag_ids: [] },
    { id: "support", name: "Support", element_id: "basic", skill_type: "support", power: 0, mana_cost: 0, targeting: "single_any", description: "Support.", sort_order: 2, tag_ids: [] },
  ],
  critters: [
    { id: "p1", name: "Player", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 25, base_def: 25, base_spd: 20, base_dice_min: 1, base_dice_max: 1, base_block_cost: 1, base_swap_cost: 1, asset_path: null, description: null, sort_order: 0, tag_ids: [] },
    { id: "o1", name: "Opponent", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 25, base_def: 25, base_spd: 10, base_dice_min: 1, base_dice_max: 1, base_block_cost: 1, base_swap_cost: 1, asset_path: null, description: null, sort_order: 1, tag_ids: [] },
  ],
  critterProgression: [], critterSkillUnlocks: [], rollcasters: [{ id: "rc", name: "Caster", asset_path: null, description: null, sort_order: 0 }], rollcasterProgression: [],
  rollcasterAbilities: [{ id: "loaded-dice", name: "Loaded Dice", description: "Loaded Dice.", sort_order: 0 }, { id: "support-trigger", name: "Support Trigger", description: "Support Trigger.", sort_order: 1 }], rollcasterAbilityUnlocks: [], relics: [], dungeons: [dungeon],
  dungeonOpponents: [{ id: "opp", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 0, probability: 1, critter_id: "o1", critter_level: 1, skill_ids: ["barrage"], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [], currencyDrops: [], itemDrops: [], overrides: {} }],
  dungeonCompletionDrops: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [], statuses: [],
  effectsBySkill: {
    barrage: [effect("skill", "barrage", "barrage-multi", "multi_hit", { minimum_hits: 2, maximum_hits: 2 })],
    variable: [effect("skill", "variable", "variable-multi", "multi_hit", { minimum_hits: 1, maximum_hits: 2 })],
    support: [effect("skill", "support", "support-multi", "multi_hit", { minimum_hits: 2, maximum_hits: 2 }), effect("skill", "support", "support-stat", "stat_modifier", { stat: "atk", value_mode: "flat", amount: -1, chance: 1, target: "targets" })],
  },
  effectsByAbility: {
    "loaded-dice": [effect("ability", "loaded-dice", "loaded-dice-multi", "multi_hit_modifier", { target: "all_friendlies", modifier_mode: "higher", additional_rolls: 1, affected_skill_category: "attack", affected_skill_element_ids: [], affected_skill_tag_ids: [], target_element_ids: [], target_critter_tag_ids: [], duration_type: "end_of_battle", duration_clock: "owner_turn" })],
    "support-trigger": [effect("ability", "support-trigger", "support-reactive", "reactive_trigger", { target: "all_friendlies", trigger_event: "owner_uses_support_skill", trigger_source: "self", activation_chance: 1, activation_limit: null, activation_limit_scope: "battle", cooldown_turns: 0, requires_hp_damage: false, requires_shield_damage: false, minimum_damage: null, child_effect_ids: ["support-reactive-stat"] }), { ...effect("ability", "support-trigger", "support-reactive-stat", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 1, target: "attacker" }), execution: "child" }],
  }, effectsByRelic: {}, effectsByStatus: {}, dungeonOpponentStatOverrides: [],
};
const player: PlayerState = {
  profile: { user_id: "u", username: "u", coins: 0, starter_rollcaster_selected_at: "now", starter_selected_at: "now", active_rollcaster_id: "ur" },
  rollcasters: [{ id: "ur", user_id: "u", rollcaster_id: "rc", level: 1, xp: 0, ability_points: 0 }],
  critters: [{ id: "up1", user_id: "u", critter_id: "p1", level: 1, xp: 0, skill_points: 0 }],
  relicInventory: [], squadSlots: [{ user_id: "u", slot_index: 1, user_critter_id: "up1" }],
  skillSlots: [{ user_critter_id: "up1", slot_index: 1, skill_id: "barrage" }, { user_critter_id: "up1", slot_index: 2, skill_id: "variable" }, { user_critter_id: "up1", slot_index: 3, skill_id: "support" }], abilitySlots: [], relicSlots: [], unlockedSkillIdsByCritter: {}, unlockedAbilityIdsByRollcaster: {},
  dungeonProgress: [], collectibleSnapshot: { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] },
};
const initial = createInitialCombatState(catalog, player, dungeon, "multi-hit-red");
const action: CombatAction = { actorKey: "p1", type: "skill", skillId: "barrage", targetKey: "o1", cost: 0 };
const result = resolveCombatActions({ ...initial, phase: "selecting", playerMana: 0, opponentMana: 0 }, [action], []);
check(result.presentationEvents.filter((event) => event.kind === "damage" && event.skillId === "barrage").length === 2, "A fixed Multi-Hit Skill must resolve exactly two damage hits.");
check(result.turnEvents.filter((event) => event.event_type === "skill_resolved" && event.skill_id === "barrage").length === 1, "A Multi-Hit Skill must emit one action-level skill_resolved event.");

const variableWithoutModifier = createInitialCombatState(catalog, player, dungeon, "variable-without-modifier");
const variableWithoutModifierResult = resolveCombatActions({ ...variableWithoutModifier, phase: "selecting", rngState: 5, playerMana: 0, opponentMana: 0 }, [{ actorKey: "p1", type: "skill", skillId: "variable", targetKey: "o1", cost: 0 }], []);
const modifierPlayer = structuredClone(player);
modifierPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "loaded-dice" }];
const variableWithModifier = createInitialCombatState(catalog, modifierPlayer, dungeon, "variable-with-modifier");
const variableWithModifierResult = resolveCombatActions({ ...variableWithModifier, phase: "selecting", rngState: 5, playerMana: 0, opponentMana: 0 }, [{ actorKey: "p1", type: "skill", skillId: "variable", targetKey: "o1", cost: 0 }], []);
const variableWithoutModifierHits = variableWithoutModifierResult.presentationEvents.filter((event) => event.kind === "damage" && event.skillId === "variable").length;
const variableWithModifierHits = variableWithModifierResult.presentationEvents.filter((event) => event.kind === "damage" && event.skillId === "variable").length;
check(variableWithoutModifierHits === 1, "A variable Multi-Hit Skill without a modifier must use its single base roll.");
check(variableWithModifierHits === 2, "A higher Multi-Hit Modifier must keep the highest of its independent rolls.");

const supportPlayer = structuredClone(player);
supportPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "support-trigger" }];
const supportInitial = createInitialCombatState(catalog, supportPlayer, dungeon, "support-multi-hit");
const supportResult = resolveCombatActions({ ...supportInitial, phase: "selecting", playerMana: 0, opponentMana: 0 }, [{ actorKey: "p1", type: "skill", skillId: "support", targetKey: "o1", cost: 0 }], []);
check(supportResult.opponentUnits.find((unit) => unit.key === "o1")?.stats.atk === 23, "A two-hit support Skill must apply its direct Skill Effect once per hit.");
check(supportResult.playerUnits.find((unit) => unit.key === "p1")?.stats.atk === 27, "A support Skill reactive Effect must trigger once per actual hit.");
console.log("Multi-Hit runtime tests passed.");
