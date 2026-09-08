import {
  createInitialCombatState,
  resolveTurn,
  simApplyStatus,
  startTurn,
} from "../src/lib/game.js";
import type { Catalog, EffectOwnerType, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function effect(ownerType: EffectOwnerType, ownerId: string, id: string, runtimeKind: string, parameters: Record<string, unknown>): ResolvedEffectRef {
  return {
    id,
    name: id,
    description: `${id} description`,
    ownerType,
    ownerId,
    templateId: `${ownerType}-${runtimeKind}`,
    runtimeKind,
    runtimeVersion: 1,
    parameters,
    sortOrder: 0,
  };
}

function catalog(): Catalog {
  return {
    currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [],
    elements: [{ id: "basic", name: "Basic", description: null, asset_path: null, sort_order: 0 }],
    tags: [],
    elementEffectiveness: [{ attacking_element_id: "basic", defending_element_id: "basic", multiplier: 1 }],
    skills: [
      { id: "ritual", name: "Ritual", element_id: "basic", skill_type: "support", power: 0, mana_cost: 0, targeting: "self_only", description: "Ritual.", sort_order: 0, tag_ids: [] },
      { id: "mark", name: "Mark", element_id: "basic", skill_type: "support", power: 0, mana_cost: 0, targeting: "single_any", description: "Mark.", sort_order: 1, tag_ids: [] },
    ],
    critters: [
      { id: "p1", name: "Player One", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 25, base_def: 25, base_spd: 30, base_dice_min: 1, base_dice_max: 1, base_block_cost: 0, base_swap_cost: 0, asset_path: null, description: null, sort_order: 0, tag_ids: [] },
      { id: "p2", name: "Player Two", element_1_id: "basic", element_2_id: null, base_hp: 80, base_atk: 20, base_def: 20, base_spd: 20, base_dice_min: 1, base_dice_max: 1, base_block_cost: 0, base_swap_cost: 0, asset_path: null, description: null, sort_order: 1, tag_ids: [] },
      { id: "o1", name: "Opponent One", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 24, base_def: 25, base_spd: 12, base_dice_min: 1, base_dice_max: 1, base_block_cost: 0, base_swap_cost: 0, asset_path: null, description: null, sort_order: 2, tag_ids: [] },
    ],
    critterProgression: [], critterSkillUnlocks: [],
    rollcasters: [{ id: "rc", name: "Caster", asset_path: null, description: null, sort_order: 0 }],
    rollcasterProgression: [], rollcasterAbilities: [], rollcasterAbilityUnlocks: [],
    relics: [], dungeons: [{ id: "d", name: "Test", description: "", dungeon_type: "regular", difficulty: 1, battle_format: "2v1", battle_count: 1, player_active_count: 2, opponent_active_count: 1, encounter_count: 1, next_dungeon_id: null, regular_logo_path: null, boss_logo_path: null, sort_order: 0, is_active: true, is_archived: false, version: 1 }],
    dungeonOpponents: [{ id: "opp1", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 0, probability: 1, critter_id: "o1", critter_level: 1, skill_ids: [], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [], currencyDrops: [], itemDrops: [], overrides: {} }],
    dungeonCompletionDrops: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [],
    statuses: [{ id: "aura", name: "Aura", description: "Aura.", asset_path: null, sort_order: 0, version: 1 }],
    effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {}, dungeonOpponentStatOverrides: [],
  };
}

function player(): PlayerState {
  return {
    profile: { user_id: "u", username: "u", coins: 0, starter_rollcaster_selected_at: "now", starter_selected_at: "now", active_rollcaster_id: "ur" },
    rollcasters: [{ id: "ur", user_id: "u", rollcaster_id: "rc", level: 1, xp: 0, ability_points: 0 }],
    critters: [
      { id: "up1", user_id: "u", critter_id: "p1", level: 1, xp: 0, skill_points: 0 },
      { id: "up2", user_id: "u", critter_id: "p2", level: 1, xp: 0, skill_points: 0 },
    ],
    relicInventory: [], squadSlots: [{ user_id: "u", slot_index: 1, user_critter_id: "up1" }, { user_id: "u", slot_index: 2, user_critter_id: "up2" }],
    skillSlots: [{ user_critter_id: "up1", slot_index: 1, skill_id: "ritual" }, { user_critter_id: "up1", slot_index: 2, skill_id: "mark" }],
    abilitySlots: [], relicSlots: [], unlockedSkillIdsByCritter: {}, unlockedAbilityIdsByRollcaster: {}, dungeonProgress: [],
    collectibleSnapshot: { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] },
  };
}

function battle(catalogue: Catalog, id: string) {
  return createInitialCombatState(catalogue, player(), catalogue.dungeons[0], id);
}

const hotCatalog = catalog();
hotCatalog.effectsByStatus.aura = [effect("status", "aura", "regrowth", "healing_over_time", { timing: "start_of_turn", value_mode: "percent_max_hp", amount: 0.2, chance: 1, target: "status_holder" })];
let hotState = simApplyStatus(battle(hotCatalog, "hot"), "aura", "p1", null);
hotState = { ...hotState, playerUnits: hotState.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 50 } : unit) };
const hotStarted = startTurn(hotState);
check(hotStarted.playerUnits.find((unit) => unit.key === "p1")?.hp === 70, "Healing Over Time must heal a status target at the configured turn timing.");

const modifierCatalog = catalog();
modifierCatalog.effectsByStatus.aura = [effect("status", "aura", "nullifier", "healing_modifier", { modifier_value: -1, target: "status_holder" })];
modifierCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "heal", "direct_health_modifier", {
  operation: "heal",
  value_type: "flat",
  value: 10,
  activation_chance: 1,
  target: "self",
  can_defeat_target: false,
  affected_by_shield: false,
  affected_by_healing_modifiers: false,
  overhealing_behavior: "discard",
  overheal_effect_ids: [],
})];
let blockedState = simApplyStatus(battle(modifierCatalog, "blocked"), "aura", "p1", null);
blockedState = { ...blockedState, playerUnits: blockedState.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 50 } : unit) };
const blocked = resolveTurn({ ...blockedState, phase: "selecting", playerMana: 50 }, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(blocked.playerUnits.find((unit) => unit.key === "p1")?.hp === 50, "A -1.00 Healing Modifier must stop Skill healing.");

modifierCatalog.effectsByStatus.aura = [effect("status", "aura", "doubler", "healing_modifier", { modifier_value: 1, target: "status_holder" })];
let doubledState = simApplyStatus(battle(modifierCatalog, "doubled"), "aura", "p1", null);
doubledState = { ...doubledState, playerUnits: doubledState.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 50 } : unit) };
const doubled = resolveTurn({ ...doubledState, phase: "selecting", playerMana: 50 }, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(doubled.playerUnits.find((unit) => unit.key === "p1")?.hp === 70, "A 1.00 Healing Modifier must double Skill healing.");

const revivalCatalog = catalog();
revivalCatalog.effectsByStatus.aura = [effect("status", "aura", "revival-nullifier", "healing_modifier", { modifier_value: -1, target: "status_holder" })];
revivalCatalog.effectsBySkill.mark = [effect("skill", "mark", "revive", "critter_revival", { target: "target_friendlies", value_mode: "percent_max_hp", amount: 0.5, chance: 1 })];
let revivalState = simApplyStatus(battle(revivalCatalog, "revival"), "aura", "p2", null);
revivalState = { ...revivalState, playerUnits: revivalState.playerUnits.map((unit) => unit.key === "p2" ? { ...unit, hp: 0 } : unit) };
const revived = resolveTurn({ ...revivalState, phase: "selecting", playerMana: 50 }, [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p2", cost: 0 }]);
check(revived.playerUnits.find((unit) => unit.key === "p2")?.hp === 40, "Healing Modifiers must not change Revival healing.");

console.log("Healing effect tests passed.");
