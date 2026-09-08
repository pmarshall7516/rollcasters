import {
  createInitialCombatState,
  resolveCombatActions,
  startTurn,
} from "../src/lib/game.js";
import type { Catalog, CombatAction, EffectOwnerType, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function effect(ownerType: EffectOwnerType, ownerId: string, id: string, runtimeKind: string, parameters: Record<string, unknown>): ResolvedEffectRef {
  return {
    id, name: id, description: id, ownerType, ownerId, templateId: `${ownerType}-${runtimeKind}`,
    runtimeKind, runtimeVersion: 1, parameters, sortOrder: 0, execution: "root", classification: "positive",
  };
}

function makeCatalog(): Catalog {
  const elements = ["basic", "frost", "aqua", "tera"].map((id, sort_order) => ({ id, name: id, description: null, asset_path: null, sort_order }));
  const elementEffectiveness = ["basic", "frost", "aqua", "tera"].flatMap((attacking_element_id) => [
    "basic", "frost", "aqua", "tera",
  ].map((defending_element_id) => ({
    attacking_element_id,
    defending_element_id,
    multiplier: attacking_element_id === "frost" && defending_element_id === "aqua" ? 0.5 : 1,
  })));
  return {
    currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [],
    elements, tags: [], elementEffectiveness,
    skills: [
      { id: "frost-hit", name: "Frost Hit", element_id: "frost", skill_type: "attack", power: 50, mana_cost: 0, targeting: "single_enemy", description: "Frost Hit", sort_order: 0, tag_ids: [] },
      { id: "tera-hit", name: "Tera Hit", element_id: "tera", skill_type: "attack", power: 50, mana_cost: 0, targeting: "single_enemy", description: "Tera Hit", sort_order: 1, tag_ids: [] },
    ],
    critters: [
      { id: "p1", name: "Player", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 25, base_def: 25, base_spd: 30, base_dice_min: 2, base_dice_max: 4, base_block_cost: 3, base_swap_cost: 4, asset_path: null, description: null, sort_order: 0, tag_ids: [] },
      { id: "aqua", name: "Aqua Enemy", element_1_id: "aqua", element_2_id: null, base_hp: 100, base_atk: 10, base_def: 25, base_spd: 1, base_dice_min: 1, base_dice_max: 1, base_block_cost: 3, base_swap_cost: 4, asset_path: null, description: null, sort_order: 1, tag_ids: [] },
    ],
    critterProgression: [], critterSkillUnlocks: [],
    rollcasters: [{ id: "rc", name: "Caster", asset_path: null, description: null, sort_order: 0 }], rollcasterProgression: [],
    rollcasterAbilities: [], rollcasterAbilityUnlocks: [],
    relics: [{ id: "frozen-core", name: "Frozen Core", description: "Frozen Core", max_owned: 1, asset_path: null, sort_order: 0 }, { id: "air-balloon", name: "Air Balloon", description: "Air Balloon", max_owned: 1, asset_path: null, sort_order: 1 }],
    dungeons: [{ id: "d", name: "Test", description: "", dungeon_type: "regular", difficulty: 1, battle_format: "1v1", battle_count: 1, player_active_count: 1, opponent_active_count: 1, encounter_count: 1, next_dungeon_id: null, regular_logo_path: null, boss_logo_path: null, sort_order: 0, is_active: true, is_archived: false, version: 1 }],
    dungeonOpponents: [{ id: "enemy", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 0, probability: 1, critter_id: "aqua", critter_level: 1, skill_ids: ["tera-hit"], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [], currencyDrops: [], itemDrops: [], overrides: {} }],
    dungeonCompletionDrops: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [], statuses: [],
    effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {}, dungeonOpponentStatOverrides: [],
  };
}

function makePlayer(relicId?: string): PlayerState {
  return {
    profile: { user_id: "u", username: "u", coins: 0, starter_rollcaster_selected_at: "now", starter_selected_at: "now", active_rollcaster_id: "ur" },
    rollcasters: [{ id: "ur", user_id: "u", rollcaster_id: "rc", level: 1, xp: 0, ability_points: 0 }],
    critters: [{ id: "up1", user_id: "u", critter_id: "p1", level: 1, xp: 0, skill_points: 0 }], relicInventory: [],
    squadSlots: [{ user_id: "u", slot_index: 1, user_critter_id: "up1" }],
    skillSlots: [{ user_critter_id: "up1", slot_index: 1, skill_id: "frost-hit" }, { user_critter_id: "up1", slot_index: 2, skill_id: "tera-hit" }],
    abilitySlots: [], relicSlots: relicId ? [{ user_critter_id: "up1", slot_index: 1, relic_id: relicId }] : [],
    unlockedSkillIdsByCritter: {}, unlockedAbilityIdsByRollcaster: {}, dungeonProgress: [],
    collectibleSnapshot: { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] },
  };
}

function run(catalog: Catalog, player: PlayerState, action: CombatAction, opponentActions: CombatAction[] = []): ReturnType<typeof createInitialCombatState> {
  const state = startTurn(createInitialCombatState(catalog, player, catalog.dungeons[0], "effectiveness-test"));
  return resolveCombatActions({ ...state, phase: "selecting", playerMana: 50, opponentMana: 50 }, action.type === "skip" ? [] : [action], opponentActions);
}

const skillCatalog = makeCatalog();
skillCatalog.effectsBySkill["frost-hit"] = [effect("skill", "frost-hit", "freeze-dry", "skill_effectiveness", {
  defender_element_rows: [{ element_id: "aqua", percent_delta: 1 }],
}), effect("skill", "frost-hit", "freeze-dry-bonus", "effectiveness_modifier", {
  tier_modifiers: [{ tier: "extra-effective", percent_delta: 0.5 }],
})];
const skillResult = run(skillCatalog, makePlayer(), { actorKey: "p1", type: "skill", skillId: "frost-hit", targetKey: "o1", cost: 0 });
const skillDamage = skillResult.presentationEvents.find((event) => event.kind === "damage");
check(skillDamage?.effectiveness === 3 && skillDamage.effectivenessClass === "mega-effective" && skillDamage.baseEffectiveness === 2 && skillDamage.baseEffectivenessClass === "extra-effective", "Skill Effectiveness must replace the selected Frost-to-Aqua chart cell before tier classification, then Effectiveness Modifier must change the final tier.");

const frozenCatalog = makeCatalog();
frozenCatalog.effectsByRelic["frozen-core"] = [effect("relic", "frozen-core", "frozen-core-effect", "skill_effectiveness", {
  target: "equipped_critter", direction: "dealt", affected_skill_element_ids: ["frost"], opposing_element_ids: ["aqua"], percent_delta: 1,
})];
const frozenResult = run(frozenCatalog, makePlayer("frozen-core"), { actorKey: "p1", type: "skill", skillId: "frost-hit", targetKey: "o1", cost: 0 });
const frozenDamage = frozenResult.presentationEvents.find((event) => event.kind === "damage");
check(frozenDamage?.effectiveness === 1 && frozenDamage.baseEffectiveness === 1, "Frozen Core must double the current Frost-versus-Aqua matchup without replacing the Element Chart.");

const balloonCatalog = makeCatalog();
balloonCatalog.effectsByRelic["air-balloon"] = [effect("relic", "air-balloon", "tera-immunity", "skill_effectiveness", {
  target: "equipped_critter", direction: "received", affected_skill_element_ids: ["tera"], percent_delta: -1,
})];
const balloonResult = run(balloonCatalog, makePlayer("air-balloon"), { actorKey: "p1", type: "skip", cost: 0 }, [{ actorKey: "o1", type: "skill", skillId: "tera-hit", targetKey: "p1", cost: 0 }]);
const balloonDamage = balloonResult.presentationEvents.find((event) => event.kind === "damage");
check(balloonDamage?.effectiveness === 0 && balloonDamage.effectivenessClass === "immune" && balloonDamage.hpChanges[0]?.before === balloonDamage.hpChanges[0]?.after, "Air Balloon must make incoming Tera Skills Immune and deal no damage.");

console.log("Effectiveness runtime tests passed.");
