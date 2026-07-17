import { groupCombatEffectRows } from "../src/lib/effects.js";
import { createInitialCombatState, critterElementIds, critterHasElement, matchesSelectedElements, resolveTurn, roundHalfUp } from "../src/lib/game.js";
import type { Catalog, CombatAction, EffectOwnerType, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function effect(
  ownerType: EffectOwnerType,
  ownerId: string,
  id: string,
  runtimeKind: string,
  parameters: Record<string, unknown>,
  sortOrder = 0,
): ResolvedEffectRef {
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
    sortOrder,
  };
}

function makeCatalog(): Catalog {
  return {
    currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [],
    elements: [
      { id: "basic", name: "Basic", description: null, asset_path: null, sort_order: 0 },
      { id: "bloom", name: "Bloom", description: null, asset_path: null, sort_order: 1 },
      { id: "aqua", name: "Aqua", description: null, asset_path: null, sort_order: 2 },
    ],
    skills: [
      { id: "strike", name: "Strike", element_id: "basic", skill_type: "attack", power: 50, mana_cost: 5, targeting: "single_enemy", description: "Strike.", sort_order: 0 },
      { id: "mark", name: "Mark", element_id: "basic", skill_type: "support", power: 0, mana_cost: 2, targeting: "single_any", description: "Mark.", sort_order: 1 },
      { id: "ritual", name: "Ritual", element_id: "basic", skill_type: "support", power: 0, mana_cost: 0, targeting: "self_only", description: "Ritual.", sort_order: 2 },
      { id: "wave", name: "Wave", element_id: "basic", skill_type: "attack", power: 1, mana_cost: 0, targeting: "all_enemies", description: "Wave.", sort_order: 3 },
    ],
    critters: [
      { id: "p1", name: "Player One", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 25, base_def: 25, base_spd: 30, base_dice_min: 2, base_dice_max: 4, base_block_cost: 3, base_swap_cost: 4, asset_path: null, description: null, sort_order: 0 },
      { id: "p2", name: "Player Two", element_1_id: "bloom", element_2_id: "aqua", base_hp: 80, base_atk: 20, base_def: 20, base_spd: 20, base_dice_min: 1, base_dice_max: 3, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 1 },
      { id: "p3", name: "Player Three", element_1_id: "basic", element_2_id: null, base_hp: 90, base_atk: 22, base_def: 22, base_spd: 15, base_dice_min: 1, base_dice_max: 5, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 2 },
      { id: "o1", name: "Opponent One", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 24, base_def: 25, base_spd: 12, base_dice_min: 1, base_dice_max: 4, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 3 },
      { id: "o2", name: "Opponent Two", element_1_id: "bloom", element_2_id: "aqua", base_hp: 120, base_atk: 26, base_def: 20, base_spd: 10, base_dice_min: 2, base_dice_max: 5, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 4 },
    ],
    critterProgression: [],
    critterSkillUnlocks: [],
    rollcasters: [{ id: "rc", name: "Caster", asset_path: null, description: null, sort_order: 0 }],
    rollcasterProgression: [],
    rollcasterAbilities: [
      { id: "friendly-stat", name: "Friendly Stat", description: "Friendly Stat.", sort_order: 0 },
      { id: "enemy-stat", name: "Enemy Stat", description: "Enemy Stat.", sort_order: 1 },
      { id: "friendly-dice", name: "Friendly Dice", description: "Friendly Dice.", sort_order: 2 },
      { id: "enemy-dice", name: "Enemy Dice", description: "Enemy Dice.", sort_order: 3 },
    ],
    rollcasterAbilityUnlocks: [],
    relics: [
      { id: "carrier", name: "Carrier", description: "Carrier.", max_owned: 1, asset_path: null, sort_order: 0 },
      { id: "allies", name: "Allies", description: "Allies.", max_owned: 1, asset_path: null, sort_order: 1 },
      { id: "friendlies", name: "Friendlies", description: "Friendlies.", max_owned: 1, asset_path: null, sort_order: 2 },
      { id: "enemy", name: "Enemy", description: "Enemy.", max_owned: 1, asset_path: null, sort_order: 3 },
    ],
    dungeons: [{ id: "d", name: "Test", dungeon_type: "regular", difficulty: 1, battle_format: "2v2", player_active_count: 2, opponent_active_count: 2, encounter_count: 1, next_dungeon_id: null, sort_order: 0 }],
    dungeonOpponents: [
      { id: "opp1", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 0, probability: 1, critter_id: "o1", critter_level: 1, skill_ids: [], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [] },
      { id: "opp2", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 1, probability: 1, critter_id: "o2", critter_level: 1, skill_ids: [], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [] },
    ],
    starterRollcasterOptions: [],
    starterOptions: [],
    gameAssets: [],
    statuses: [
      { id: "finite", name: "Finite", description: "Finite.", asset_path: "status/finite.png", sort_order: 0, version: 1 },
      { id: "aura", name: "Aura", description: "Aura.", asset_path: null, sort_order: 1, version: 1 },
      { id: "stun", name: "Stun", description: "Stun.", asset_path: null, sort_order: 2, version: 1 },
    ],
    effectsBySkill: {},
    effectsByAbility: {},
    effectsByRelic: {},
    effectsByStatus: {},
    dungeonOpponentStatOverrides: [],
  };
}

function makePlayer(): PlayerState {
  return {
    profile: { user_id: "u", username: "u", coins: 0, starter_rollcaster_selected_at: "now", starter_selected_at: "now", active_rollcaster_id: "ur" },
    rollcasters: [{ id: "ur", user_id: "u", rollcaster_id: "rc", level: 1, xp: 0, ability_points: 0 }],
    critters: [
      { id: "up1", user_id: "u", critter_id: "p1", level: 1, xp: 0, skill_points: 0 },
      { id: "up2", user_id: "u", critter_id: "p2", level: 1, xp: 0, skill_points: 0 },
      { id: "up3", user_id: "u", critter_id: "p3", level: 1, xp: 0, skill_points: 0 },
    ],
    relicInventory: [],
    squadSlots: [
      { user_id: "u", slot_index: 1, user_critter_id: "up1" },
      { user_id: "u", slot_index: 2, user_critter_id: "up2" },
      { user_id: "u", slot_index: 3, user_critter_id: "up3" },
    ],
    skillSlots: ["up1", "up2", "up3"].flatMap((userCritterId) => [
      { user_critter_id: userCritterId, slot_index: 1, skill_id: "strike" },
      { user_critter_id: userCritterId, slot_index: 2, skill_id: "mark" },
      { user_critter_id: userCritterId, slot_index: 3, skill_id: "ritual" },
      { user_critter_id: userCritterId, slot_index: 4, skill_id: "wave" },
    ]),
    abilitySlots: [],
    relicSlots: [],
    unlockedSkillIdsByCritter: {},
    unlockedAbilityIdsByRollcaster: {},
    dungeonProgress: [],
    collectibleSnapshot: { currencies: [], shards: [], progress: [], tracked: [], unlock_events: [] },
  };
}

function battle(catalog: Catalog, player = makePlayer(), runId = "test-run") {
  return createInitialCombatState(catalog, player, catalog.dungeons[0], runId);
}

function takeTurn(state: ReturnType<typeof battle>, actions: CombatAction[], mana = 50) {
  return resolveTurn({ ...state, phase: "selecting", playerMana: mana }, actions);
}

const eventCatalog = makeCatalog();
check(critterElementIds(eventCatalog.critters[0]).join(",") === "basic", "A one-type Critter must expose only Element 1.");
check(critterElementIds(eventCatalog.critters[1]).join(",") === "bloom,aqua", "A two-type Critter must preserve Element 1 then Element 2.");
check(critterHasElement(eventCatalog.critters[1], "bloom") && critterHasElement(eventCatalog.critters[1], "aqua"), "Element membership must match either Critter slot.");
check(matchesSelectedElements(eventCatalog.critters[1], new Set(["aqua"])), "Flat filters must match Element 2.");
check(!matchesSelectedElements(eventCatalog.critters[1], new Set(["basic"])), "Flat filters must reject Critters with neither selected Element.");
let eventBattle = battle(eventCatalog, makePlayer(), "progress-events");
eventBattle.opponentMana = 0;
const eventTarget = eventBattle.opponentUnits[0];
const eventResult = takeTurn(eventBattle, [{ actorKey: eventBattle.playerUnits[0].key, type: "skill", skillId: "strike", targetKey: eventTarget.key, cost: 1 }]);
check(eventResult.turnEvents.some((event) => event.event_type === "use_skill" && event.skill_id === "strike" && event.source_critter_id === "p1"), "A successful player skill must emit a use_skill progress event.");
check(eventResult.turnEvents.some((event) => event.event_type === "deal_damage" && event.target_critter_id === eventTarget.critter.id && event.amount > 0), "Player damage must emit a positive deal_damage progress event.");
check(new Set(eventResult.turnEvents.map((event) => event.event_key)).size === eventResult.turnEvents.length, "Combat progress event keys must be unique within a turn.");

check(roundHalfUp(2.5) === 3 && roundHalfUp(-2.5) === -3, "Shared half-up rounding must round exact halves away from zero.");

const grouped = groupCombatEffectRows([
  { owner_type: "skill", owner_id: "strike", id: "later", name: "Later", description: "Later.", sort_order: 8, template_id: "skill-restore-hp", runtime_kind: "restore_hp", runtime_version: 1, parameters: { value_mode: "flat", amount: 1, chance: 1, target: "self" } },
  { owner_type: "skill", owner_id: "strike", id: "first", name: "First", description: "First.", sort_order: 1, template_id: "skill-restore-hp", runtime_kind: "restore_hp", runtime_version: 1, parameters: { value_mode: "flat", amount: 1, chance: 1, target: "self" } },
  { owner_type: "relic", owner_id: "carrier", id: "first", name: "Scoped ID", description: "Scoped.", sort_order: 0, template_id: "relic-stat-modifier", runtime_kind: "stat_modifier", runtime_version: 1, parameters: { stat: "atk", value_mode: "flat", amount: 1, target: "equipped_critter" } },
  { owner_type: "relic", owner_id: "002", id: "a597cea0-309a-4a70-9f49-bb691c38c111", name: "Lighter Roll", description: "Equipped Critter gains +1/+1 to its Mana rolls.", sort_order: 0, template_id: "relic-mana-dice-modifier", runtime_kind: "mana_dice_modifier", runtime_version: 1, parameters: { target: "equipped_critter", element_ids: [], maximum_delta: 1, minimum_delta: 1 } },
]);
check(grouped.skill.strike.map((item) => item.id).join(",") === "first,later", "combat_effects_v1 rows must group by owner and preserve ascending sort order.");
check(grouped.relic.carrier[0].id === "first", "Inline effect IDs may be reused by different owners without becoming shared definitions.");
check(!("element_ids" in grouped.relic["002"][0].parameters), "Hidden element picker defaults must be removed from non-element effect targets.");

const passiveCatalog = makeCatalog();
passiveCatalog.effectsByAbility = {
  "friendly-stat": [effect("ability", "friendly-stat", "friendly-stat", "stat_modifier", { stat: "def", value_mode: "percentage", amount: 0.1, target: "all_friendlies" })],
  "enemy-stat": [effect("ability", "enemy-stat", "enemy-stat", "stat_modifier", { stat: "atk", value_mode: "flat", amount: -2, target: "all_enemies" })],
  "friendly-dice": [effect("ability", "friendly-dice", "friendly-dice", "mana_dice_modifier", { minimum_delta: 1, maximum_delta: 2, target: "all_element_friendlies", element_ids: ["bloom"] })],
  "enemy-dice": [effect("ability", "enemy-dice", "enemy-dice", "mana_dice_modifier", { minimum_delta: 2, maximum_delta: 3, target: "all_element_enemies", element_ids: ["bloom"] })],
};
passiveCatalog.effectsByRelic = {
  carrier: [effect("relic", "carrier", "carrier", "stat_modifier", { stat: "hp", value_mode: "flat", amount: 10, target: "equipped_critter" })],
  allies: [effect("relic", "allies", "allies", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 3, target: "equipped_allies" })],
  friendlies: [effect("relic", "friendlies", "friendlies", "mana_dice_modifier", { minimum_delta: 1, maximum_delta: 1, target: "equipped_friendlies" })],
  enemy: [effect("relic", "enemy", "enemy", "stat_modifier", { stat: "spd", value_mode: "flat", amount: -2, target: "all_enemies" })],
};
const passivePlayer = makePlayer();
passivePlayer.abilitySlots = passiveCatalog.rollcasterAbilities.map((ability, index) => ({ user_rollcaster_id: "ur", slot_index: index + 1, ability_id: ability.id }));
passivePlayer.relicSlots = [
  { user_critter_id: "up1", slot_index: 1, relic_id: "carrier" },
  { user_critter_id: "up1", slot_index: 2, relic_id: "allies" },
  { user_critter_id: "up1", slot_index: 3, relic_id: "friendlies" },
  { user_critter_id: "up1", slot_index: 4, relic_id: "enemy" },
];
let passive = battle(passiveCatalog, passivePlayer, "passives");
check(passive.playerUnits[0].maxHp === 110, "equipped_critter must affect only the active Relic carrier.");
check(passive.playerUnits[0].stats.def === 28 && passive.playerUnits[1].stats.def === 22, "Ability all_friendlies percentage modifiers must use half-up delta rounding per recipient.");
check(passive.playerUnits[1].stats.atk === 23 && passive.playerUnits[0].stats.atk === 25, "equipped_allies must exclude the Relic carrier.");
check(passive.playerUnits[0].stats.diceMin === 3 && passive.playerUnits[1].stats.diceMin === 3 && passive.playerUnits[1].stats.diceMax === 6, "Existing primary-Element Ability targeting must remain unchanged for a dual-type Critter.");
check(passive.opponentUnits[0].stats.atk === 22 && passive.opponentUnits[1].stats.atk === 24, "Ability all_enemies must affect every active opponent.");
check(passive.opponentUnits[0].stats.spd === 10 && passive.opponentUnits[1].stats.spd === 8, "Relic all_enemies must resolve relative to its carrier.");
check(passive.opponentUnits[0].stats.diceMin === 1 && passive.opponentUnits[1].stats.diceMin === 4 && passive.opponentUnits[1].stats.diceMax === 8, "Ability element enemy targeting must filter active opponents by element.");
passive = takeTurn(passive, [{ actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }]);
check(passive.playerUnits[0].maxHp === 100 && passive.playerUnits[1].stats.atk === 20, "Every Relic effect must disappear when its carrier leaves active play.");
check(passive.playerUnits[2].stats.def === 24, "Active Rollcaster Ability effects must recompute for the Critter entering an active slot.");

const skillCatalog = makeCatalog();
skillCatalog.effectsBySkill = {
  ritual: [
    effect("skill", "ritual", "self", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 1, chance: 1, target: "self" }, 0),
    effect("skill", "ritual", "self-percent", "stat_modifier", { stat: "atk", value_mode: "percentage", amount: 0.1, chance: 1, target: "self" }, 1),
    effect("skill", "ritual", "allies", "stat_modifier", { stat: "def", value_mode: "flat", amount: 2, chance: 1, target: "all_allies" }, 2),
    effect("skill", "ritual", "friendlies", "stat_modifier", { stat: "spd", value_mode: "percentage", amount: -0.1, chance: 1, target: "all_friendlies" }, 3),
    effect("skill", "ritual", "enemies", "stat_modifier", { stat: "atk", value_mode: "flat", amount: -3, chance: 1, target: "all_enemies" }, 4),
    effect("skill", "ritual", "no-proc", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 99, chance: 0, target: "self" }, 5),
  ],
};
let skilled = takeTurn(battle(skillCatalog, makePlayer(), "skill-targets"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(skilled.playerUnits[0].stats.atk === 29, "Skill modifiers must apply in stored order and calculate percentage deltas from the stat at that effect's resolution point.");
check(skilled.playerUnits[1].stats.def === 22 && skilled.playerUnits[0].stats.def === 25, "Skill all_allies must exclude the user.");
check(skilled.playerUnits[0].stats.spd === 27 && skilled.playerUnits[1].stats.spd === 18, "Signed Skill percentages must round their deltas half-up for all_friendlies.");
check(skilled.opponentUnits[0].stats.atk === 21 && skilled.opponentUnits[1].stats.atk === 23, "Skill all_enemies must affect all active enemy slots.");

const statusCatalog = makeCatalog();
statusCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "finite-apply", "apply_status", { status_id: "finite", chance: 1, target: "self", indefinite: false, turns: 3 }),
];
let finite = takeTurn(battle(statusCatalog, makePlayer(), "finite-status"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(finite.statuses.length === 1 && finite.statuses[0].duration === 2, "Finite Status duration must come from its application and decrement after the application turn.");
const instanceId = finite.statuses[0].instanceId;
finite = takeTurn(finite, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(finite.statuses[0].instanceId === instanceId && finite.statuses[0].duration === 2, "Reapplying a Status must refresh the existing icon-bearing instance without duplicating it.");

const indefiniteCatalog = makeCatalog();
indefiniteCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "indefinite", "apply_status", { status_id: "finite", chance: 1, target: "self", indefinite: true })];
const indefinite = takeTurn(battle(indefiniteCatalog, makePlayer(), "indefinite-status"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(indefinite.statuses[0].duration === null, "Indefinite Status applications must not synthesize a Status-owned duration.");

const selectedCatalog = makeCatalog();
selectedCatalog.effectsBySkill.wave = [effect("skill", "wave", "target-status", "apply_status", { status_id: "finite", chance: 1, target: "target_enemies", indefinite: false, turns: 3 })];
const selected = takeTurn(battle(selectedCatalog, makePlayer(), "target-enemies"), [{ actorKey: "p1", type: "skill", skillId: "wave", cost: 0 }]);
check(selected.statuses.length === 2 && selected.statuses.every((item) => item.holderKey.startsWith("o")), "target_enemies must use every active enemy slot selected by the Skill.");

const healingCatalog = makeCatalog();
healingCatalog.effectsBySkill.strike = [effect("skill", "strike", "vampire", "restore_hp", { value_mode: "percent_damage_done", amount: 0.625, chance: 1, target: "self" })];
healingCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "flat-heal", "restore_hp", { value_mode: "flat", amount: 4, chance: 1, target: "self" }, 0),
  effect("skill", "ritual", "max-heal", "restore_hp", { value_mode: "percent_max_hp", amount: 0.025, chance: 1, target: "all_friendlies" }, 1),
  effect("skill", "ritual", "failed-heal", "restore_hp", { value_mode: "flat", amount: 90, chance: 0, target: "self" }, 2),
];
let healing = battle(healingCatalog, makePlayer(), "healing");
healing = { ...healing, playerUnits: healing.playerUnits.map((unit) => ({ ...unit, hp: unit.key === "p1" ? 50 : unit.key === "p2" ? 40 : unit.hp })) };
healing = takeTurn(healing, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(healing.playerUnits[0].hp === 57 && healing.playerUnits[1].hp === 42, "Flat and maximum-HP healing must execute in order, round half-up, and cap independently per target.");
const beforeVampire = healing.playerUnits[0].hp;
healing = takeTurn(healing, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }]);
check(healing.playerUnits[0].hp === beforeVampire + 3, "percent_damage_done healing must use the Skill's actual final damage and shared half-up rounding.");

const dotCatalog = makeCatalog();
dotCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "apply-aura", "apply_status", { status_id: "aura", chance: 1, target: "self", indefinite: true })];
dotCatalog.effectsByStatus.aura = [
  effect("status", "aura", "holder-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 1, chance: 1, target: "status_holder" }, 0),
  effect("status", "aura", "allies-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 2, chance: 1, target: "status_holder_allies" }, 1),
  effect("status", "aura", "friendlies-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 3, chance: 1, target: "status_holder_friendlies" }, 2),
  effect("status", "aura", "enemies-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 4, chance: 1, target: "status_holder_enemies" }, 3),
  effect("status", "aura", "failed-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 50, chance: 0, target: "status_holder" }, 4),
];
let dotted = takeTurn(battle(dotCatalog, makePlayer(), "status-targets"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(dotted.playerUnits[0].hp === 96 && dotted.playerUnits[1].hp === 75, "Status holder, allies, and friendlies scopes must resolve relative to the active holder.");
check(dotted.opponentUnits[0].hp === 96 && dotted.opponentUnits[1].hp === 116, "status_holder_enemies must resolve every active enemy relative to the holder.");
const inactiveHolderHp = dotted.playerUnits.map((unit) => unit.hp);
dotted = takeTurn(dotted, [{ actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }]);
check(dotted.playerUnits.every((unit, index) => unit.hp === inactiveHolderHp[index]) && dotted.opponentUnits[0].hp === 96, "Status effects must stop triggering while their holder is inactive.");

const skipCatalog = makeCatalog();
skipCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "apply-stun", "apply_status", { status_id: "stun", chance: 1, target: "self", indefinite: true })];
skipCatalog.effectsByStatus.stun = [effect("status", "stun", "skill-skip", "skip_action_chance", { chance: 1, combat_action: "skill", target: "status_holder" })];
let skipped = takeTurn(battle(skipCatalog, makePlayer(), "skip-refund"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }], 10);
skipped = takeTurn(skipped, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }], 10);
check(skipped.playerMana === 10 && skipped.opponentUnits[0].hp === 100, "A skipped Skill must perform no damage and refund all of its Mana cost.");
const blocked = takeTurn(skipped, [{ actorKey: "p1", type: "block", cost: 3 }], 10);
check(blocked.playerMana === 7 && blocked.playerUnits[0].blocking, "A skill-only skip effect must not cancel a Block action.");

const allySkipCatalog = makeCatalog();
allySkipCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "apply-ally-stun", "apply_status", { status_id: "stun", chance: 1, target: "self", indefinite: true })];
allySkipCatalog.effectsByStatus.stun = [effect("status", "stun", "ally-skip", "skip_action_chance", { chance: 1, combat_action: "all", target: "status_holder_allies" })];
let allySkipped = takeTurn(battle(allySkipCatalog, makePlayer(), "ally-skip"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }], 10);
allySkipped = takeTurn(allySkipped, [{ actorKey: "p2", type: "block", cost: 2 }], 10);
check(allySkipped.playerMana === 10 && !allySkipped.playerUnits[1].blocking, "Status skip targeting must resolve holder-relative recipients and treat all as Swap, Block, or Skill.");

const slotCatalog = makeCatalog();
let slotted = battle(slotCatalog, makePlayer(), "slot-following");
slotted = takeTurn(slotted, [
  { actorKey: "p2", type: "swap", swapToId: "up3", cost: 4 },
  { actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p2", cost: 2 },
]);
check(slotted.log.some((line) => line === "Player One used Mark on Player Three."), "A selected target must follow its battlefield slot when a Swap resolves before the Skill.");

const frozenCatalog = makeCatalog();
frozenCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "frozen", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 5, chance: 1, target: "self" })];
const frozen = battle(frozenCatalog, makePlayer(), "frozen");
frozenCatalog.effectsBySkill.ritual.length = 0;
const frozenResult = takeTurn(frozen, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(frozenResult.playerUnits[0].stats.atk === 30, "An active combat must resolve its frozen inline-effect registry after mutable catalog data changes.");
check(JSON.stringify(frozen.snapshot) === JSON.stringify(battle(makeCatalogWithFrozenEffect(), makePlayer(), "frozen").snapshot), "Effect snapshots must be deterministic for an identical run and inline catalog.");

function makeCatalogWithFrozenEffect(): Catalog {
  const catalog = makeCatalog();
  catalog.effectsBySkill.ritual = [effect("skill", "ritual", "frozen", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 5, chance: 1, target: "self" })];
  return catalog;
}

const invalidOwner = makeCatalog();
invalidOwner.effectsBySkill.ritual = [effect("skill", "different-skill", "wrong-owner", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 1, chance: 1, target: "self" })];
let ownerRejected = false;
try { battle(invalidOwner, makePlayer(), "invalid-owner"); } catch { ownerRejected = true; }
check(ownerRejected, "The runtime must reject an inline effect grouped under an owner it does not belong to.");

const invalidTarget = makeCatalog();
invalidTarget.effectsBySkill.ritual = [effect("skill", "ritual", "wrong-target", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 1, chance: 1, target: "equipped_critter" })];
let targetRejected = false;
try { battle(invalidTarget, makePlayer(), "invalid-target"); } catch { targetRejected = true; }
check(targetRejected, "Owner-specific target values must be rejected outside their category.");

const invalidVersion = makeCatalog();
invalidVersion.effectsBySkill.ritual = [{ ...effect("skill", "ritual", "future", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 1, chance: 1, target: "self" }), runtimeVersion: 2 }];
let versionRejected = false;
try { battle(invalidVersion, makePlayer(), "invalid-version"); } catch { versionRejected = true; }
check(versionRejected, "Unsupported runtime versions must fail encounter creation before combat starts.");

console.log("Inline effect combat runtime tests passed.");
