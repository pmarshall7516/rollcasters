import { groupCombatEffectRows } from "../src/lib/effects.js";
import {
  calculateActionCost,
  calculateSkillDamage,
  classifyEffectiveness,
  chooseRandomEnemyActions,
  combatEffectSummaries,
  createInitialCombatState,
  critterElementIds,
  critterHasElement,
  elementEffectiveness,
  isActorRecharging,
  matchesSelectedElements,
  orderedActiveCombatUnits,
  resolveTurn,
  simApplyStatus,
  startTurn,
  refreshSetupRuntimeEffects,
  roundHalfUp,
  rollDamagePercent,
  rollManaDie,
  resolveCombatActions,
  MULTI_TARGET_DAMAGE_MULTIPLIER,
  skillTargets,
  skillAvailability,
} from "../src/lib/game.js";
import {
  advanceDungeonEvent,
  confirmDungeonLeads,
  continueAfterRoll,
  continueDungeonDialogue,
  createDungeonRunState,
  applyDungeonBattleResult,
  currentDungeonDialogue,
  outcomePhaseForBattle,
  currentDungeonEvent,
  revealDungeonSwapEvent,
  rollDungeonDice,
  type DungeonRunState,
} from "../src/lib/dungeon-run.js";
import { battlefieldSlotsForCount, effectiveDungeon, parseBattleFormat, sortDungeonsNaturally } from "../src/lib/dungeons.js";
import { applyDungeonXpRewards } from "../src/lib/progression.js";
import type { BattleFormat, Catalog, CombatAction, DungeonOpponent, DungeonRunSnapshot, EffectOwnerType, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

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
    currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [],
    elements: [
      { id: "basic", name: "Basic", description: null, asset_path: null, sort_order: 0 },
      { id: "bloom", name: "Bloom", description: null, asset_path: null, sort_order: 1 },
      { id: "aqua", name: "Aqua", description: null, asset_path: null, sort_order: 2 },
    ],
    tags: [
      { id: "first-stage", name: "First Stage", description: null, tag_type: "critter", sort_order: 10 },
      { id: "middle-stage", name: "Middle Stage", description: null, tag_type: "critter", sort_order: 20 },
      { id: "final-stage", name: "Final Stage", description: null, tag_type: "critter", sort_order: 30 },
      { id: "contact", name: "Contact", description: null, tag_type: "skill", sort_order: 10 },
      { id: "pulse", name: "Pulse", description: null, tag_type: "skill", sort_order: 20 },
      { id: "burst", name: "Burst", description: null, tag_type: "skill", sort_order: 30 },
    ],
    elementEffectiveness: ["basic", "bloom", "aqua"].flatMap((attacking_element_id) =>
      ["basic", "bloom", "aqua"].map((defending_element_id) => ({
        attacking_element_id,
        defending_element_id,
        multiplier: attacking_element_id === "bloom" && defending_element_id === "aqua"
          ? 2
          : attacking_element_id === "aqua" && defending_element_id === "bloom"
            ? 0.5
            : 1,
      })),
    ),
    skills: [
      { id: "strike", name: "Strike", element_id: "basic", skill_type: "attack", power: 50, mana_cost: 5, targeting: "single_enemy", description: "Strike.", sort_order: 0, tag_ids: ["contact"] },
      { id: "mark", name: "Mark", element_id: "basic", skill_type: "support", power: 0, mana_cost: 2, targeting: "single_any", description: "Mark.", sort_order: 1, tag_ids: ["pulse"] },
      { id: "ritual", name: "Ritual", element_id: "basic", skill_type: "support", power: 0, mana_cost: 0, targeting: "self_only", description: "Ritual.", sort_order: 2, tag_ids: ["burst"] },
      { id: "wave", name: "Wave", element_id: "basic", skill_type: "attack", power: 1, mana_cost: 0, targeting: "all_enemies", description: "Wave.", sort_order: 3, tag_ids: [] },
    ],
    critters: [
      { id: "p1", name: "Player One", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 25, base_def: 25, base_spd: 30, base_dice_min: 2, base_dice_max: 4, base_block_cost: 3, base_swap_cost: 4, asset_path: null, description: null, sort_order: 0, tag_ids: ["first-stage"] },
      { id: "p2", name: "Player Two", element_1_id: "bloom", element_2_id: "aqua", base_hp: 80, base_atk: 20, base_def: 20, base_spd: 20, base_dice_min: 1, base_dice_max: 3, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 1, tag_ids: ["middle-stage"] },
      { id: "p3", name: "Player Three", element_1_id: "basic", element_2_id: null, base_hp: 90, base_atk: 22, base_def: 22, base_spd: 15, base_dice_min: 1, base_dice_max: 5, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 2, tag_ids: ["first-stage"] },
      { id: "o1", name: "Opponent One", element_1_id: "basic", element_2_id: null, base_hp: 100, base_atk: 24, base_def: 25, base_spd: 12, base_dice_min: 1, base_dice_max: 4, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 3, tag_ids: ["final-stage"] },
      { id: "o2", name: "Opponent Two", element_1_id: "bloom", element_2_id: "aqua", base_hp: 120, base_atk: 26, base_def: 20, base_spd: 10, base_dice_min: 2, base_dice_max: 5, base_block_cost: 2, base_swap_cost: 4, asset_path: null, description: null, sort_order: 4, tag_ids: ["final-stage"] },
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
    dungeons: [{ id: "d", name: "Test", description: "", dungeon_type: "regular", difficulty: 1, battle_format: "2v2", battle_count: 1, player_active_count: 2, opponent_active_count: 2, encounter_count: 1, next_dungeon_id: null, regular_logo_path: null, boss_logo_path: null, sort_order: 0, is_active: true, is_archived: false, version: 1 }],
    dungeonOpponents: [
      { id: "opp1", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 0, probability: 1, critter_id: "o1", critter_level: 1, skill_ids: [], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [], currencyDrops: [], itemDrops: [], overrides: {} },
      { id: "opp2", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 1, probability: 1, critter_id: "o2", critter_level: 1, skill_ids: [], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [], currencyDrops: [], itemDrops: [], overrides: {} },
    ],
    dungeonCompletionDrops: [],
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
    collectibleSnapshot: { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] },
  };
}

function battle(catalog: Catalog, player = makePlayer(), runId = "test-run") {
  return createInitialCombatState(catalog, player, catalog.dungeons[0], runId);
}

function takeTurn(state: ReturnType<typeof battle>, actions: CombatAction[], mana = 50) {
  return resolveTurn({ ...state, phase: "selecting", playerMana: mana }, actions);
}

function runPlayerSkill(
  catalog: Catalog,
  player: PlayerState,
  runId: string,
  skillId: string,
  rngState: number,
  targetKey = "o1",
) {
  const ready = startTurn({ ...battle(catalog, player, runId), phase: "ready" });
  return resolveCombatActions(
    { ...ready, phase: "selecting", playerMana: 50, opponentMana: 0, rngState },
    [{ actorKey: "p1", type: "skill", skillId, targetKey, cost: 0 }],
    [],
  );
}

function stunEvents(state: ReturnType<typeof battle>) {
  return state.turnEvents.filter((event) => event.event_type === "stun_activated");
}

const randomPolicyBase = battle(makeCatalog(), makePlayer(), "random-policy");
const randomPolicyState = {
  ...randomPolicyBase,
  enemyPolicyKey: "random_action_v1",
  opponentMana: 99,
  opponentUnits: randomPolicyBase.opponentUnits.map((unit) => ({ ...unit, skills: [makeCatalog().skills[0]] })),
};
const randomPolicyTypes = new Set<CombatAction["type"]>();
for (let rngState = 1; rngState <= 64; rngState += 1) {
  for (const action of chooseRandomEnemyActions({ ...randomPolicyState, rngState })) randomPolicyTypes.add(action.type);
}
check(randomPolicyTypes.has("skill") && !randomPolicyTypes.has("block") && !randomPolicyTypes.has("swap"), "Random Action must use affordable Skills only and never Block or Swap.");
const randomNoMana = chooseRandomEnemyActions({ ...randomPolicyState, opponentMana: 0, rngState: 1 });
check(randomNoMana.every((action) => action.type === "skip"), "Random Action must wait when no Skill can be afforded.");

const eventCatalog = makeCatalog();
eventCatalog.effectsBySkill.mark = [effect(
  "skill",
  "mark",
  "mark-status",
  "apply_status",
  { status_id: "finite", chance: 1, target: "targets", indefinite: true },
)];
check(critterElementIds(eventCatalog.critters[0]).join(",") === "basic", "A one-type Critter must expose only Element 1.");
check(critterElementIds(eventCatalog.critters[1]).join(",") === "bloom,aqua", "A two-type Critter must preserve Element 1 then Element 2.");
check(critterHasElement(eventCatalog.critters[1], "bloom") && critterHasElement(eventCatalog.critters[1], "aqua"), "Element membership must match either Critter slot.");
check(matchesSelectedElements(eventCatalog.critters[1], new Set(["aqua"])), "Flat filters must match Element 2.");
check(!matchesSelectedElements(eventCatalog.critters[1], new Set(["basic"])), "Flat filters must reject Critters with neither selected Element.");
let eventBattle = battle(eventCatalog, makePlayer(), "progress-events");
eventBattle.opponentMana = 0;
const eventTarget = eventBattle.opponentUnits[0];
const eventResult = takeTurn(eventBattle, [{ actorKey: eventBattle.playerUnits[0].key, type: "skill", skillId: "strike", targetKey: eventTarget.key, cost: 1 }]);
check(eventResult.turnEvents.some((event) => event.event_type === "skill_resolved" && event.skill_id === "strike" && event.source_critter_id === "p1"), "A successful player skill must emit one normalized skill_resolved progress event.");
check(eventResult.turnEvents.some((event) => event.event_type === "resource_spent" && event.amount === 5 && event.payload?.spending_context === "combat" && event.payload?.resource_type === "mana" && event.source_critter_id === "p1"), "A successful player action must emit its actual Mana spend for Resource Spending challenges.");
check(eventResult.turnEvents.some((event) => event.event_type === "hp_damage_dealt" && event.target_critter_id === eventTarget.critter.id && event.amount > 0 && event.payload?.hp_damage === event.amount && event.payload?.shield_damage === 0), "Unshielded player damage must emit HP-only normalized damage components.");
check(!eventResult.turnEvents.some((event) => ["use_skill", "deal_damage"].includes(event.event_type)), "A skill resolution must not emit legacy aliases that would double-count the same challenge event.");
check(new Set(eventResult.turnEvents.map((event) => event.event_key)).size === eventResult.turnEvents.length, "Combat progress event keys must be unique within a turn.");
const statusBattle = battle(eventCatalog, makePlayer(), "status-progress-events");
const statusTarget = statusBattle.opponentUnits[0];
const statusResult = takeTurn(statusBattle, [{ actorKey: statusBattle.playerUnits[0].key, type: "skill", skillId: "mark", targetKey: statusTarget.key, cost: 1 }]);
check(statusResult.turnEvents.some((event) => event.event_type === "status_afflicted" && event.target_critter_id === statusTarget.critter.id && Array.isArray(event.payload?.status_ids) && event.payload.status_ids.includes("finite") && event.payload?.target_side === "opponent" && event.payload?.fresh === true), "A player Skill must emit a fresh Status affliction event with the authoritative target side.");
check(statusResult.turnEvents.some((event) => event.event_type === "status_turn_completed" && event.target_critter_id === statusTarget.critter.id && Array.isArray(event.payload?.status_ids) && event.payload.status_ids.includes("finite") && event.payload?.target_side === "opponent"), "A Status present at the end of a turn must emit one afflicted-turn progress event.");
const reappliedStatusResult = takeTurn(startTurn(statusResult), [{ actorKey: statusBattle.playerUnits[0].key, type: "skill", skillId: "mark", targetKey: statusTarget.key, cost: 1 }]);
check(!reappliedStatusResult.turnEvents.some((event) => event.event_type === "status_afflicted"), "Reapplying an existing Status must not count as a fresh affliction.");
check(reappliedStatusResult.turnEvents.some((event) => event.event_type === "status_turn_completed" && Array.isArray(event.payload?.status_ids) && event.payload.status_ids.includes("finite")), "Reapplying an existing Status must continue to count its completed afflicted turn.");

const stunEventCatalog = makeCatalog();
stunEventCatalog.effectsBySkill.mark = [effect(
  "skill",
  "mark",
  "mark-stun",
  "stun_chance",
  { target: "targets", chance: 1 },
)];
const playerStunBattle = { ...battle(stunEventCatalog, makePlayer(), "player-stun-progress-events"), opponentMana: 0 };
const playerStunTarget = playerStunBattle.opponentUnits[0];
const playerStunResult = takeTurn(playerStunBattle, [{ actorKey: playerStunBattle.playerUnits[0].key, type: "skill", skillId: "mark", targetKey: playerStunTarget.key, cost: 2 }]);
check(
  playerStunResult.turnEvents.some((event) => event.event_type === "stun_activated" && event.source_critter_id === "p1" && event.target_critter_id === "o1" && event.payload?.target_side === "opponent" && event.payload?.stun_activated === true),
  "A player Stun Chance activation must emit a server-matchable enemy-target Stun event.",
);
const enemyStunBase = battle(stunEventCatalog, makePlayer(), "enemy-stun-progress-events");
const enemyStunActor = enemyStunBase.opponentUnits[0];
const enemyStunTarget = enemyStunBase.playerUnits[0];
const enemyStunResult = resolveCombatActions(
  { ...enemyStunBase, playerMana: 0, opponentMana: 50, opponentUnits: enemyStunBase.opponentUnits.map((unit) => unit.key === enemyStunActor.key ? { ...unit, skills: [stunEventCatalog.skills.find((skill) => skill.id === "mark")!] } : unit) },
  [{ actorKey: enemyStunTarget.key, type: "skip", cost: 0 }],
  [{ actorKey: enemyStunActor.key, type: "skill", skillId: "mark", targetKey: enemyStunTarget.key, cost: 2 }],
);
check(
  enemyStunResult.turnEvents.some((event) => event.event_type === "stun_activated" && event.source_critter_id === "o1" && event.target_critter_id === "p1" && event.payload?.target_side === "player"),
  "An enemy Stun Chance activation must emit a friendly-target Stun event.",
);

const cycloneBaseCatalog = makeCatalog();
const cyclone = { ...cycloneBaseCatalog.skills[0], id: "cyclone", name: "Cyclone", element_id: "basic", power: 100, mana_cost: 0, targeting: "single_enemy" as const };
cycloneBaseCatalog.skills = [...cycloneBaseCatalog.skills, cyclone];
const cyclonePlayer = makePlayer();
cyclonePlayer.skillSlots = cyclonePlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: "cyclone" } : slot
));
const cycloneConditionalId = "cyclone-conditional";
const cycloneDamageModifierId = "cyclone-damage-modifier";
cycloneBaseCatalog.effectsBySkill.cyclone = [
  effect("skill", "cyclone", cycloneConditionalId, "conditional_effect", {
    target: "self",
    condition: "action_order",
    comparison: "equal",
    condition_value: "first_overall",
    true_effect_ids: [cycloneDamageModifierId],
    false_effect_ids: [],
    check_timing: "continuous",
    remove_effects_when_false: true,
  }),
  { ...effect("skill", "cyclone", cycloneDamageModifierId, "damage_modifier", {
    target: "self",
    direction: "dealt",
    modifier_type: "percentage",
    modifier_value: 0.25,
    minimum_final_damage: null,
    maximum_final_damage: null,
    usage_limit: null,
    applicable_source: "skill",
    applicable_target: "any",
    condition: "none",
    duration_type: "current_action",
    duration_clock: "owner_turn",
  }, 1), execution: "child" },
];
const cycloneBaselineCatalog = structuredClone(cycloneBaseCatalog);
cycloneBaselineCatalog.effectsBySkill.cyclone = [];
const cycloneProbeBattle = battle(cycloneBaseCatalog, cyclonePlayer, "cyclone-target");
const cycloneActorKey = cycloneProbeBattle.playerUnits[0].key;
const cycloneTargetKey = cycloneProbeBattle.opponentUnits[0].key;
const cycloneActions = [{ actorKey: cycloneActorKey, type: "skill" as const, skillId: "cyclone", targetKey: cycloneTargetKey, cost: 0 }];
const cycloneWithEffect = takeTurn(battle(cycloneBaseCatalog, cyclonePlayer, "cyclone-effect"), cycloneActions, 0);
const cycloneWithoutEffect = takeTurn(battle(cycloneBaselineCatalog, cyclonePlayer, "cyclone-baseline"), cycloneActions, 0);
const cycloneWithEffectDamage = 100 - cycloneWithEffect.opponentUnits[0].hp;
const cycloneWithoutEffectDamage = 100 - cycloneWithoutEffect.opponentUnits[0].hp;
check(cycloneWithEffectDamage > cycloneWithoutEffectDamage, `Cyclone's first-action conditional should increase damage (got ${cycloneWithEffectDamage} vs ${cycloneWithoutEffectDamage}).`);
check(cycloneWithEffect.runtimeEffects.every((instance) => instance.sourceEffectId !== cycloneDamageModifierId), "Cyclone's current-action damage modifier must expire after its Skill resolves.");

const taggedConditionalCatalog = structuredClone(cycloneBaseCatalog);
taggedConditionalCatalog.effectsBySkill.cyclone[0].parameters = {
  ...taggedConditionalCatalog.effectsBySkill.cyclone[0].parameters,
  effect_target: "using_critter",
  condition_target: "skill_targets",
  condition: "tags",
  comparison: "equal",
  condition_target_critter_tag_ids: ["final-stage"],
  effect_target_critter_tag_ids: ["first-stage"],
};
const taggedConditionalResult = takeTurn(battle(taggedConditionalCatalog, cyclonePlayer, "tagged-conditional"), cycloneActions, 0);
const taggedConditionalDamage = 100 - taggedConditionalResult.opponentUnits[0].hp;
check(taggedConditionalDamage > cycloneWithoutEffectDamage, "A Tags Conditional Effect must activate when the condition target has the selected Critter Tag and the effect target passes its tag filter.");
const nonMatchingTaggedPlayer = makePlayer();
nonMatchingTaggedPlayer.critters[0] = { ...nonMatchingTaggedPlayer.critters[0], critter_id: "p2" };
const nonMatchingTaggedResult = takeTurn(battle(taggedConditionalCatalog, nonMatchingTaggedPlayer, "tagged-conditional-miss"), cycloneActions, 0);
const nonMatchingBaselineCatalog = structuredClone(cycloneBaselineCatalog);
const nonMatchingBaselineResult = takeTurn(battle(nonMatchingBaselineCatalog, nonMatchingTaggedPlayer, "tagged-conditional-miss-baseline"), cycloneActions, 0);
check(100 - nonMatchingTaggedResult.opponentUnits[0].hp === 100 - nonMatchingBaselineResult.opponentUnits[0].hp, "A Tags Conditional Effect must skip child resolution when the Effect Target does not carry one of its selected Critter Tags.");

const inverseTaggedConditionalCatalog = structuredClone(taggedConditionalCatalog);
inverseTaggedConditionalCatalog.effectsBySkill.cyclone[0].parameters = {
  ...inverseTaggedConditionalCatalog.effectsBySkill.cyclone[0].parameters,
  comparison: "not_equal",
  condition_target_critter_tag_ids: ["first-stage"],
};
const inverseTaggedResult = takeTurn(battle(inverseTaggedConditionalCatalog, cyclonePlayer, "tagged-conditional-inverse"), cycloneActions, 0);
check(100 - inverseTaggedResult.opponentUnits[0].hp > cycloneWithoutEffectDamage, "A Tags Conditional Effect with Not Equal must evaluate nonmatching Condition Targets instead of filtering them out before comparison.");

const shieldConditionalCatalog = structuredClone(cycloneBaseCatalog);
shieldConditionalCatalog.effectsBySkill.cyclone[0].parameters = {
  ...shieldConditionalCatalog.effectsBySkill.cyclone[0].parameters,
  target: "targets",
  condition: "shield_present",
  comparison: "equal",
  condition_value: "true",
};
const shieldBattle = battle(shieldConditionalCatalog, cyclonePlayer, "cyclone-shield");
const shieldBaselineBattle = battle(cycloneBaselineCatalog, cyclonePlayer, "cyclone-shield-baseline");
const withShield = (state: ReturnType<typeof battle>, shield = 10) => ({
  ...state,
  opponentUnits: state.opponentUnits.map((unit) => unit.key === state.opponentUnits[0].key ? { ...unit, shield, maxShield: shield } : unit),
});
const shieldedResult = takeTurn(withShield(shieldBattle), cycloneActions, 0);
const unmodifiedShieldedResult = takeTurn(withShield(shieldBaselineBattle), cycloneActions, 0);
check(
  shieldedResult.opponentUnits[0].shield < unmodifiedShieldedResult.opponentUnits[0].shield,
  "A Conditional Effect targeting the Skill's selected enemy must detect Shield presence before damage and amplify the hit.",
);

const icebreakerCatalog = makeCatalog();
const icebreaker = { ...icebreakerCatalog.skills[0], id: "icebreaker", name: "Icebreaker", element_id: "basic", power: 70, mana_cost: 0, targeting: "single_enemy" as const };
icebreakerCatalog.skills = [...icebreakerCatalog.skills, icebreaker];
const icebreakerPlayer = makePlayer();
icebreakerPlayer.skillSlots = icebreakerPlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: icebreaker.id } : slot
));
const icebreakerModifierId = "icebreaker-damage-modifier";
icebreakerCatalog.effectsBySkill[icebreaker.id] = [
  effect("skill", icebreaker.id, "icebreaker-condition", "conditional_effect", {
    target: "targets",
    condition: "shield_present",
    comparison: "equal",
    condition_value: "true",
    true_effect_ids: [icebreakerModifierId],
    false_effect_ids: [],
    check_timing: "continuous",
    remove_effects_when_false: true,
  }),
  { ...effect("skill", icebreaker.id, icebreakerModifierId, "damage_modifier", {
    target: "self",
    direction: "dealt",
    modifier_type: "percentage",
    modifier_value: 0.25,
    minimum_final_damage: null,
    maximum_final_damage: null,
    usage_limit: null,
    applicable_source: "skill",
    applicable_target: "any",
    condition: "none",
    duration_type: "current_action",
    duration_clock: "owner_turn",
  }, 1), execution: "child" },
];
const icebreakerBaselineCatalog = structuredClone(icebreakerCatalog);
icebreakerBaselineCatalog.effectsBySkill[icebreaker.id][1].parameters = {
  ...icebreakerBaselineCatalog.effectsBySkill[icebreaker.id][1].parameters,
  modifier_value: 0,
};
const icebreakerAction = (state: ReturnType<typeof battle>) => [{ actorKey: state.playerUnits[0].key, type: "skill" as const, skillId: icebreaker.id, targetKey: state.opponentUnits[0].key, cost: 0 }];
const icebreakerShield = 100;
const icebreakerBattle = battle(icebreakerCatalog, icebreakerPlayer, "icebreaker-shield");
const icebreakerBaselineBattle = battle(icebreakerBaselineCatalog, icebreakerPlayer, "icebreaker-shield");
const icebreakerWithShield = takeTurn(withShield(icebreakerBattle, icebreakerShield), icebreakerAction(icebreakerBattle), 0);
const icebreakerWithoutEffect = takeTurn(withShield(icebreakerBaselineBattle, icebreakerShield), icebreakerAction(icebreakerBaselineBattle), 0);
const icebreakerShieldDamage = icebreakerShield - icebreakerWithShield.opponentUnits[0].shield;
const icebreakerBaselineShieldDamage = icebreakerShield - icebreakerWithoutEffect.opponentUnits[0].shield;
check(
  icebreakerShieldDamage === icebreakerBaselineShieldDamage + roundHalfUp(icebreakerBaselineShieldDamage * 0.25),
  `Icebreaker must deal exactly 25% more damage to a shielded target (got ${icebreakerShieldDamage} vs ${icebreakerBaselineShieldDamage}).`,
);
const icebreakerUnshielded = takeTurn(battle(icebreakerCatalog, icebreakerPlayer, "icebreaker-unshielded"), icebreakerAction(battle(icebreakerCatalog, icebreakerPlayer, "icebreaker-unshielded-action")), 0);
const icebreakerUnshieldedBaseline = takeTurn(battle(icebreakerBaselineCatalog, icebreakerPlayer, "icebreaker-unshielded"), icebreakerAction(battle(icebreakerBaselineCatalog, icebreakerPlayer, "icebreaker-unshielded-action")), 0);
check(
  icebreakerUnshielded.opponentUnits[0].hp === icebreakerUnshieldedBaseline.opponentUnits[0].hp,
  "Icebreaker's shield conditional must not increase damage against an unshielded target.",
);
check(
  icebreakerWithShield.effectActivations.includes("icebreaker-condition"),
  "Icebreaker's conditional event must activate when the target has a shield.",
);
check(
  !icebreakerUnshielded.effectActivations.includes("icebreaker-condition"),
  "Icebreaker's conditional event must not activate when the target has no shield.",
);
check(icebreakerWithShield.runtimeEffects.every((instance) => instance.sourceEffectId !== icebreakerModifierId), "Icebreaker's current-action modifier must expire after the Skill resolves.");

const lastActionCatalog = structuredClone(cycloneBaseCatalog);
lastActionCatalog.effectsBySkill.cyclone[0].parameters = { ...lastActionCatalog.effectsBySkill.cyclone[0].parameters, condition_value: "last_overall" };
const lastActionResult = takeTurn(battle(lastActionCatalog, cyclonePlayer, "cyclone-last"), cycloneActions, 0);
check(100 - lastActionResult.opponentUnits[0].hp > cycloneWithoutEffectDamage, "Action Order conditionals must also resolve the last overall Skill action.");

const setSpeed = (state: ReturnType<typeof battle>, playerSpeed: number, opponentSpeed: number) => ({
  ...state,
  playerUnits: state.playerUnits.map((unit) => unit.key === "p1"
    ? { ...unit, baseStats: { ...unit.baseStats, spd: playerSpeed }, persistentStats: { ...unit.persistentStats, spd: playerSpeed }, stats: { ...unit.stats, spd: playerSpeed } }
    : unit),
  opponentUnits: state.opponentUnits.map((unit) => unit.key === "o1"
    ? { ...unit, baseStats: { ...unit.baseStats, spd: opponentSpeed }, persistentStats: { ...unit.persistentStats, spd: opponentSpeed }, stats: { ...unit.stats, spd: opponentSpeed } }
    : unit),
});
const beforeTargetCatalog = structuredClone(cycloneBaseCatalog);
beforeTargetCatalog.effectsBySkill.cyclone[0].parameters = { ...beforeTargetCatalog.effectsBySkill.cyclone[0].parameters, condition_value: "before_skill_target" };
const beforeTargetBattle = setSpeed(battle(beforeTargetCatalog, cyclonePlayer, "cyclone-before-target"), 100, 1);
const beforeTargetBaseline = setSpeed(battle(cycloneBaselineCatalog, cyclonePlayer, "cyclone-before-target-baseline"), 100, 1);
const beforeTargetResult = takeTurn(beforeTargetBattle, cycloneActions, 0);
const beforeTargetBaselineResult = takeTurn(beforeTargetBaseline, cycloneActions, 0);
check(100 - beforeTargetResult.opponentUnits[0].hp > 100 - beforeTargetBaselineResult.opponentUnits[0].hp, "Before Skill Target must match when Cyclone acts before its target.");

const afterTargetCatalog = structuredClone(cycloneBaseCatalog);
afterTargetCatalog.effectsBySkill.cyclone[0].parameters = { ...afterTargetCatalog.effectsBySkill.cyclone[0].parameters, condition_value: "after_skill_target" };
const afterTargetBattle = setSpeed(battle(afterTargetCatalog, cyclonePlayer, "cyclone-after-target"), 1, 100);
const afterTargetBaseline = setSpeed(battle(cycloneBaselineCatalog, cyclonePlayer, "cyclone-after-target-baseline"), 1, 100);
const afterTargetResult = takeTurn(afterTargetBattle, cycloneActions, 0);
const afterTargetBaselineResult = takeTurn(afterTargetBaseline, cycloneActions, 0);
check(100 - afterTargetResult.opponentUnits[0].hp > 100 - afterTargetBaselineResult.opponentUnits[0].hp, "After Skill Target must match when Cyclone acts after its target.");

const lowHpCatalog = structuredClone(cycloneBaseCatalog);
lowHpCatalog.effectsBySkill.cyclone[0].parameters = {
  ...lowHpCatalog.effectsBySkill.cyclone[0].parameters,
  target: "targets",
  condition: "hp_percent",
  comparison: "below",
  condition_value: "0.5",
};
const lowHpBattle = battle(lowHpCatalog, cyclonePlayer, "cyclone-low-hp");
const lowHpBaselineBattle = battle(cycloneBaselineCatalog, cyclonePlayer, "cyclone-low-hp-baseline");
const woundTarget = lowHpBattle.opponentUnits[0].key;
const wounded = (state: ReturnType<typeof battle>) => ({
  ...state,
  opponentUnits: state.opponentUnits.map((unit) => unit.key === woundTarget ? { ...unit, hp: 20 } : unit),
});
const lowHpResult = takeTurn(wounded(lowHpBattle), cycloneActions, 0);
const lowHpBaselineResult = takeTurn(wounded(lowHpBaselineBattle), cycloneActions, 0);
check(
  20 - lowHpResult.opponentUnits[0].hp > 20 - lowHpBaselineResult.opponentUnits[0].hp,
  "HP percentage conditionals must compare against a decimal fraction threshold before the hit.",
);

const mightyFuryCatalog = makeCatalog();
const mightyFury = { ...mightyFuryCatalog.skills[0], id: "mighty-fury", name: "Mighty Fury", power: 50, mana_cost: 0, targeting: "single_enemy" as const };
mightyFuryCatalog.skills = [...mightyFuryCatalog.skills, mightyFury];
const mightyFuryPlayer = makePlayer();
mightyFuryPlayer.skillSlots = mightyFuryPlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: mightyFury.id } : slot
));
const mightyFuryModifierId = "mighty-fury-modifier";
mightyFuryCatalog.effectsBySkill[mightyFury.id] = [
  effect("skill", mightyFury.id, "mighty-fury-condition", "conditional_effect", {
    target: "self",
    condition: "hp_percent",
    comparison: "below",
    condition_value: "0.25",
    true_effect_ids: [mightyFuryModifierId],
    false_effect_ids: [],
    check_timing: "continuous",
    remove_effects_when_false: true,
  }),
  { ...effect("skill", mightyFury.id, mightyFuryModifierId, "damage_modifier", {
    target: "self",
    direction: "dealt",
    modifier_type: "percentage",
    modifier_value: 1,
    applicable_source: "skill",
    applicable_target: "any",
    condition: "none",
    duration_type: "current_action",
    duration_clock: "owner_turn",
  }, 1), execution: "child" },
];
const mightyFuryBaselineCatalog = structuredClone(mightyFuryCatalog);
mightyFuryBaselineCatalog.effectsBySkill[mightyFury.id] = [];
const mightyFuryAction = (state: ReturnType<typeof battle>) => [{ actorKey: state.playerUnits[0].key, type: "skill" as const, skillId: mightyFury.id, targetKey: state.opponentUnits[0].key, cost: 0 }];
const lowMightyFuryBattle = battle(mightyFuryCatalog, mightyFuryPlayer, "mighty-fury-low");
const lowMightyFuryBaselineBattle = battle(mightyFuryBaselineCatalog, mightyFuryPlayer, "mighty-fury-low-baseline");
const lowMightyFury = { ...lowMightyFuryBattle, playerUnits: lowMightyFuryBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 20 } : unit) };
const lowMightyFuryBaseline = { ...lowMightyFuryBaselineBattle, playerUnits: lowMightyFuryBaselineBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 20 } : unit) };
const mightyFuryLowResult = takeTurn(lowMightyFury, mightyFuryAction(lowMightyFury), 0);
const mightyFuryLowBaselineResult = takeTurn(lowMightyFuryBaseline, mightyFuryAction(lowMightyFuryBaseline), 0);
const mightyFuryLowDamage = 100 - mightyFuryLowResult.opponentUnits[0].hp;
const mightyFuryLowBaselineDamage = 100 - mightyFuryLowBaselineResult.opponentUnits[0].hp;
check(mightyFuryLowDamage === mightyFuryLowBaselineDamage * 2, `Mighty Fury must double damage below 25% HP (got ${mightyFuryLowDamage} vs ${mightyFuryLowBaselineDamage}).`);
check(mightyFuryLowResult.runtimeEffects.every((instance) => instance.sourceEffectId !== mightyFuryModifierId), "Mighty Fury's current-action damage modifier must not persist or stack across Skills.");
const thresholdMightyFuryBattle = battle(mightyFuryCatalog, mightyFuryPlayer, "mighty-fury-threshold");
const thresholdMightyFuryBaseline = battle(mightyFuryBaselineCatalog, mightyFuryPlayer, "mighty-fury-threshold");
const thresholdMightyFury = { ...thresholdMightyFuryBattle, playerUnits: thresholdMightyFuryBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 25 } : unit) };
const thresholdMightyFuryBaselineState = { ...thresholdMightyFuryBaseline, playerUnits: thresholdMightyFuryBaseline.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 25 } : unit) };
const thresholdMightyFuryResult = takeTurn(thresholdMightyFury, mightyFuryAction(thresholdMightyFury), 0);
const thresholdMightyFuryBaselineResult = takeTurn(thresholdMightyFuryBaselineState, mightyFuryAction(thresholdMightyFuryBaselineState), 0);
check(100 - thresholdMightyFuryResult.opponentUnits[0].hp === 100 - thresholdMightyFuryBaselineResult.opponentUnits[0].hp, `Mighty Fury's below-25% condition must not activate at exactly 25% HP (got ${100 - thresholdMightyFuryResult.opponentUnits[0].hp} vs ${100 - thresholdMightyFuryBaselineResult.opponentUnits[0].hp}; actor ${thresholdMightyFury.playerUnits[0].hp}/${thresholdMightyFury.playerUnits[0].maxHp}).`);

const counterPunchCatalog = makeCatalog();
counterPunchCatalog.tags.push({ id: "punch", name: "Punch", description: "Punch Skills.", tag_type: "skill", sort_order: 40 });
const counterPunch = { ...counterPunchCatalog.skills[0], id: "counter-punch", name: "Counter Punch", power: 55, mana_cost: 0, targeting: "single_enemy" as const, tag_ids: ["contact", "punch"] };
counterPunchCatalog.skills = [...counterPunchCatalog.skills, counterPunch];
counterPunchCatalog.relics = [...counterPunchCatalog.relics, { id: "knucklebusters", name: "Knucklebusters", description: "Punch damage.", max_owned: 1, asset_path: null, sort_order: 4 }];
const counterPunchPlayer = makePlayer();
counterPunchPlayer.skillSlots = counterPunchPlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: counterPunch.id } : slot
));
counterPunchPlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "knucklebusters" }];
counterPunchCatalog.effectsBySkill[counterPunch.id] = [effect("skill", counterPunch.id, "harder-hit", "damage_modifier", {
  target: "self", direction: "dealt", modifier_type: "percentage", modifier_value: 0.5,
  applicable_source: "skill", applicable_target: "any", condition: "source_below_half_hp", duration_type: "current_action", duration_clock: "target_turn",
})];
counterPunchCatalog.effectsByRelic.knucklebusters = [effect("relic", "knucklebusters", "punch-out", "damage_modifier", {
  target: "equipped_critter", direction: "dealt", modifier_type: "percentage", modifier_value: 0.5,
  applicable_source: "skill", applicable_target: "any", condition: "none", source_skill_tag_ids: ["punch"], duration_type: "current_action", duration_clock: "owner_turn",
})];
const counterPunchBaselineCatalog = structuredClone(counterPunchCatalog);
counterPunchBaselineCatalog.effectsBySkill[counterPunch.id] = [];
counterPunchBaselineCatalog.effectsByRelic.knucklebusters = [];
const setActorHp = (state: ReturnType<typeof battle>, hp: number) => ({
  ...state,
  playerUnits: state.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp } : unit),
});
const counterPunchAction = [{ actorKey: "p1", type: "skill" as const, skillId: counterPunch.id, targetKey: "o1", cost: 0 }];
const counterPunchBaseResult = takeTurn(setActorHp(battle(counterPunchBaselineCatalog, counterPunchPlayer, "counter-punch-stack"), 100), counterPunchAction, 0);
const counterPunchBelowHalfResult = takeTurn(setActorHp(battle(counterPunchCatalog, { ...counterPunchPlayer, relicSlots: [] }, "counter-punch-stack"), 49), counterPunchAction, 0);
const counterPunchStackedResult = takeTurn(setActorHp(battle(counterPunchCatalog, counterPunchPlayer, "counter-punch-stack"), 49), counterPunchAction, 0);
const counterPunchBaseDamage = 100 - counterPunchBaseResult.opponentUnits[0].hp;
const counterPunchBelowHalfDamage = 100 - counterPunchBelowHalfResult.opponentUnits[0].hp;
const counterPunchStackedDamage = 100 - counterPunchStackedResult.opponentUnits[0].hp;
check(counterPunchBelowHalfDamage > counterPunchBaseDamage * 1.4, `Counter Punch must gain its below-half-HP 50% modifier (got ${counterPunchBaseDamage} vs ${counterPunchBelowHalfDamage}).`);
check(counterPunchStackedDamage > counterPunchBelowHalfDamage * 1.4, `Knucklebusters must add a second 50% Punch Skill modifier (got ${counterPunchBelowHalfDamage} vs ${counterPunchStackedDamage}).`);

const manaForceCatalog = makeCatalog();
const manaForce = { ...manaForceCatalog.skills[0], id: "mana-force", name: "Mana Force", skill_type: "support" as const, power: 0, mana_cost: 0, targeting: "single_enemy" as const };
manaForceCatalog.skills = [...manaForceCatalog.skills, manaForce];
const manaForcePlayer = makePlayer();
manaForcePlayer.skillSlots = manaForcePlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: manaForce.id } : slot
));
const manaForceParameters = {
  resource: "squad_mana",
  resource_id: "",
  operation: "drain",
  value: 1,
  target_squad: "enemy",
  can_exceed_maximum: false,
  minimum_remaining_resource: 0,
  activation_chance: 0.5,
  trigger_timing: "immediate",
};
manaForceCatalog.effectsBySkill[manaForce.id] = [effect("skill", manaForce.id, "mana-force-drain", "resource_gain_loss", manaForceParameters)];
const manaForceAction = (state: ReturnType<typeof battle>) => [{ actorKey: state.playerUnits[0].key, type: "skill" as const, skillId: manaForce.id, targetKey: state.opponentUnits[0].key, cost: 0 }];
let manaForceActivated = false;
let manaForceSkipped = false;
for (let seedIndex = 0; seedIndex < 100 && (!manaForceActivated || !manaForceSkipped); seedIndex += 1) {
  const seeded = battle(manaForceCatalog, manaForcePlayer, `mana-force-${seedIndex}`);
  const noEnemyAction = { ...seeded, opponentMana: 3, opponentUnits: seeded.opponentUnits.map((unit) => ({ ...unit, stats: { ...unit.stats, blockCost: 99 }, persistentStats: { ...unit.persistentStats, blockCost: 99 } })) };
  const result = takeTurn(noEnemyAction, manaForceAction(noEnemyAction), 5);
  manaForceActivated ||= result.playerMana === 6 && result.opponentMana === 2;
  manaForceSkipped ||= result.playerMana === 5 && result.opponentMana === 3;
}
check(manaForceActivated && manaForceSkipped, "Mana Force's 50% activation chance must produce both transfer and no-transfer outcomes.");
const guaranteedManaForceCatalog = structuredClone(manaForceCatalog);
guaranteedManaForceCatalog.effectsBySkill[manaForce.id][0].parameters = { ...manaForceParameters, activation_chance: 0 };
const guaranteedSeed = battle(guaranteedManaForceCatalog, manaForcePlayer, "mana-force-zero");
const guaranteedNoEnemyAction = { ...guaranteedSeed, opponentMana: 3, opponentUnits: guaranteedSeed.opponentUnits.map((unit) => ({ ...unit, stats: { ...unit.stats, blockCost: 99 }, persistentStats: { ...unit.persistentStats, blockCost: 99 } })) };
const guaranteedManaForce = takeTurn(guaranteedNoEnemyAction, manaForceAction(guaranteedNoEnemyAction), 5);
check(guaranteedManaForce.playerMana === 5 && guaranteedManaForce.opponentMana === 3, "Mana Force activation chance zero must not transfer Mana.");

const voltSwitchCatalog = makeCatalog();
const voltSwitch = { ...voltSwitchCatalog.skills[0], id: "volt-switch", name: "Volt Switch", power: 50, mana_cost: 0, targeting: "single_enemy" as const };
voltSwitchCatalog.skills = [...voltSwitchCatalog.skills, voltSwitch];
const voltSwitchPlayer = makePlayer();
voltSwitchPlayer.skillSlots = voltSwitchPlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: voltSwitch.id } : slot
));
voltSwitchCatalog.effectsBySkill[voltSwitch.id] = [effect("skill", voltSwitch.id, "volt-switch-effect", "swap_after_attack", {
  target: "selected_healthy_ally",
  chance: 1,
})];
const voltSwitchBattle = battle(voltSwitchCatalog, voltSwitchPlayer, "volt-switch");
const voltSwitchResult = takeTurn(voltSwitchBattle, [{ actorKey: "p1", type: "skill", skillId: voltSwitch.id, targetKey: "o1", swapTargetKey: "p3", cost: 0 }], 0);
check(voltSwitchResult.playerUnits.find((unit) => unit.key === "p1")?.active === false, "Swap After Attack must bench the Skill user after its attack resolves.");
check(voltSwitchResult.playerUnits.find((unit) => unit.key === "p3")?.active === true, "Swap After Attack must activate the selected healthy friendly Critter.");
check(voltSwitchResult.playerUnits.find((unit) => unit.key === "p3")?.battlefieldSlot === 0, "Swap After Attack must preserve the outgoing Critter's battlefield slot.");
check(voltSwitchResult.presentationEvents.findIndex((event) => event.kind === "damage") < voltSwitchResult.presentationEvents.findIndex((event) => event.kind === "swap"), "Swap After Attack must present the attack before the forced swap.");
const voltSwitchWithoutTarget = takeTurn(voltSwitchBattle, [{ actorKey: "p1", type: "skill", skillId: voltSwitch.id, targetKey: "o1", cost: 0 }], 0);
check(voltSwitchWithoutTarget.playerUnits.find((unit) => unit.key === "p1")?.active === true, "Swap After Attack must not swap when no healthy reserve is selected.");
check(!voltSwitchWithoutTarget.presentationEvents.some((event) => event.kind === "swap"), "Swap After Attack must not emit a swap presentation without a valid reserve target.");
const voltSwitchNoHealthyReserve = {
  ...voltSwitchBattle,
  playerUnits: voltSwitchBattle.playerUnits.map((unit) => unit.key === "p3" ? { ...unit, hp: 0 } : unit),
};
const noHealthyReserveResult = takeTurn(voltSwitchNoHealthyReserve, [{ actorKey: "p1", type: "skill", skillId: voltSwitch.id, targetKey: "o1", cost: 0 }], 0);
check(noHealthyReserveResult.playerUnits.find((unit) => unit.key === "p1")?.active === true, "Swap After Attack must leave the attacker active when every reserve is knocked out.");

const mechanicalPressCatalog = makeCatalog();
const mechanicalPress = { ...mechanicalPressCatalog.skills[0], id: "mechanical-press", name: "Mechanical Press" };
mechanicalPressCatalog.skills = [...mechanicalPressCatalog.skills, mechanicalPress];
mechanicalPressCatalog.effectsBySkill[mechanicalPress.id] = [effect("skill", mechanicalPress.id, "shield-smash", "shield_modifier", {
  target: "targets",
  operation: "destroy",
  shield_value: 1,
  can_stack: false,
  replace_existing_shield: false,
})];
const mechanicalPressPlayer = makePlayer();
mechanicalPressPlayer.skillSlots = mechanicalPressPlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: mechanicalPress.id } : slot
));
let mechanicalPressBattle = battle(mechanicalPressCatalog, mechanicalPressPlayer, "mechanical-press");
mechanicalPressBattle = {
  ...mechanicalPressBattle,
  opponentUnits: mechanicalPressBattle.opponentUnits.map((unit) => unit.key === "o1" ? { ...unit, shield: 10, maxShield: 10 } : unit),
};
const pressTargetBefore = mechanicalPressBattle.opponentUnits[0];
const mechanicalPressResult = takeTurn(mechanicalPressBattle, [{ actorKey: "p1", type: "skill", skillId: mechanicalPress.id, targetKey: "o1", cost: 0 }]);
const pressTargetAfter = mechanicalPressResult.opponentUnits[0];
check(pressTargetAfter.shield === 0 && pressTargetAfter.hp < pressTargetBefore.hp, "Mechanical Press must destroy the enemy Shield before its attack damage is applied to HP.");
check(!mechanicalPressResult.presentationEvents.some((event) => event.kind === "damage" && event.targetKeys.includes("o1") && event.message.includes("Shield absorbed")), "An attack Skill that destroys Shield must not report its damage as Shield-absorbed.");

const allCrittersSkill = { ...eventCatalog.skills[0], id: "all-critters", name: "All Critters", power: 1, targeting: "all_critters" as const };
const allOthersSkill = { ...allCrittersSkill, id: "all-others", name: "All Others", targeting: "all_others" as const };
const allCrittersBattle = {
  ...eventBattle,
  playerUnits: eventBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, skills: [...unit.skills, allCrittersSkill] } : unit),
};
const withUserTargets = skillTargets(allCrittersBattle, "p1", allCrittersSkill);
const withoutUserTargets = skillTargets(allCrittersBattle, "p1", allOthersSkill);
check(withUserTargets.length === 4 && withUserTargets.some((unit) => unit.key === "p1") && withUserTargets.some((unit) => unit.side === "opponent"), "All critters (with user) must include every active friendly and enemy Critter, including the user.");
check(withoutUserTargets.length === 3 && !withoutUserTargets.some((unit) => unit.key === "p1") && withoutUserTargets.some((unit) => unit.side === "player") && withoutUserTargets.some((unit) => unit.side === "opponent"), "All critters (no user) must include active friendlies and enemies while excluding the user.");
const allCrittersResult = takeTurn(allCrittersBattle, [{ actorKey: "p1", type: "skill", skillId: allCrittersSkill.id, cost: 1 }]);
check(allCrittersResult.presentationEvents.some((event) => event.kind === "skill" && event.targetKeys.length === 4 && event.targetKeys.includes("p1") && event.targetKeys.includes("o1")), "All critters (with user) must resolve the Skill against every active Critter in combat.");

const perTargetChanceCatalog = makeCatalog();
perTargetChanceCatalog.effectsBySkill.wave = [
  effect("skill", "wave", "per-target-defense-break", "stat_modifier", { stat: "def", value_mode: "flat", amount: -5, chance: 0.5, target: "target_enemies" }),
];
let foundMixedPerTargetChanceResult: ReturnType<typeof battle> | undefined;
for (let seedIndex = 0; seedIndex < 100 && !foundMixedPerTargetChanceResult; seedIndex += 1) {
  const result = takeTurn(battle(perTargetChanceCatalog, makePlayer(), `per-target-chance-${seedIndex}`), [
    { actorKey: "p1", type: "skill", skillId: "wave", cost: 0 },
  ]);
  const reducedEnemies = result.opponentUnits.filter((unit) => unit.stats.def < unit.baseStats.def);
  if (reducedEnemies.length === 1) foundMixedPerTargetChanceResult = result;
}
check(foundMixedPerTargetChanceResult, "A chance-based multi-target Skill Effect must roll independently and be able to affect exactly one of two targets.");

const globalHealingCatalog = makeCatalog();
globalHealingCatalog.skills = globalHealingCatalog.skills.map((skill) => skill.id === "ritual" ? { ...skill, targeting: "all_critters" as const } : skill);
globalHealingCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "global-heal", "restore_hp", { value_mode: "percent_max_hp", amount: 0.3, chance: 1, target: "targets" }),
  effect("skill", "ritual", "friendly-follow-up", "restore_hp", { value_mode: "percent_max_hp", amount: 0.1, chance: 1, target: "target_friendlies" }, 1),
  effect("skill", "ritual", "enemy-follow-up", "restore_hp", { value_mode: "percent_max_hp", amount: 0.1, chance: 1, target: "target_enemies" }, 2),
];
let globalHealingBattle = battle(globalHealingCatalog, makePlayer(), "global-healing");
globalHealingBattle = {
  ...globalHealingBattle,
  playerUnits: globalHealingBattle.playerUnits.map((unit) => ({ ...unit, hp: Math.floor(unit.maxHp / 2) })),
  opponentUnits: globalHealingBattle.opponentUnits.map((unit) => ({ ...unit, hp: Math.floor(unit.maxHp / 2) })),
};
const globalHealingResult = takeTurn(globalHealingBattle, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(globalHealingResult.playerUnits[0].hp === 90 && globalHealingResult.playerUnits[1].hp === 72 && globalHealingResult.opponentUnits[0].hp === 90 && globalHealingResult.opponentUnits[1].hp === 108, "Skill Effects targeting targets, target_friendlies, and target_enemies must follow the Skill's resolved recipients and each target's own maximum HP percentage.");

const reducedGlobalHealingCatalog = makeCatalog();
reducedGlobalHealingCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "enemy-healing-reduction", "effect_amplification", { target: "all_enemies", affected_effect_category: "healing", direction: "received", modifier_type: "percentage", modifier_value: -0.75, chance: 1 }),
  effect("skill", "ritual", "reduced-global-heal", "restore_hp", { value_mode: "percent_max_hp", amount: 0.3, chance: 1, target: "all_critters" }, 1),
];
let reducedGlobalHealingBattle = battle(reducedGlobalHealingCatalog, makePlayer(), "reduced-global-healing");
reducedGlobalHealingBattle = {
  ...reducedGlobalHealingBattle,
  playerUnits: reducedGlobalHealingBattle.playerUnits.map((unit) => ({ ...unit, hp: Math.floor(unit.maxHp / 2) })),
  opponentUnits: reducedGlobalHealingBattle.opponentUnits.map((unit) => ({ ...unit, hp: Math.floor(unit.maxHp / 2) })),
};
const reducedGlobalHealingResult = takeTurn(reducedGlobalHealingBattle, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(reducedGlobalHealingResult.playerUnits[0].hp === 80 && reducedGlobalHealingResult.playerUnits[1].hp === 64 && reducedGlobalHealingResult.opponentUnits[0].hp === 58 && reducedGlobalHealingResult.opponentUnits[1].hp === 69, "A negative received-healing amplification on all_enemies must reduce only enemy healing while friendly Critters receive the full global heal.");

const failedAmplificationCatalog = makeCatalog();
failedAmplificationCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "failed-enemy-healing-reduction", "effect_amplification", { target: "all_enemies", affected_effect_category: "healing", direction: "received", modifier_type: "percentage", modifier_value: -0.75, chance: 0 }),
  effect("skill", "ritual", "unreduced-global-heal", "restore_hp", { value_mode: "percent_max_hp", amount: 0.3, chance: 1, target: "all_critters" }, 1),
];
let failedAmplificationBattle = battle(failedAmplificationCatalog, makePlayer(), "failed-amplification");
failedAmplificationBattle = {
  ...failedAmplificationBattle,
  playerUnits: failedAmplificationBattle.playerUnits.map((unit) => ({ ...unit, hp: Math.floor(unit.maxHp / 2) })),
  opponentUnits: failedAmplificationBattle.opponentUnits.map((unit) => ({ ...unit, hp: Math.floor(unit.maxHp / 2) })),
};
const failedAmplificationResult = takeTurn(failedAmplificationBattle, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(failedAmplificationResult.opponentUnits[0].hp === 80 && failedAmplificationResult.opponentUnits[1].hp === 96, "An Effect Amplification with zero activation chance must not reduce the Skill's healing.");

const durationCatalog = makeCatalog();
durationCatalog.effectsBySkill.strike = [effect("skill", "strike", "temporary-enemy-healing-reduction", "effect_amplification", {
  target: "target_enemies",
  affected_effect_category: "healing",
  direction: "received",
  modifier_type: "percentage",
  modifier_value: -0.5,
  chance: 1,
  duration_type: "turns",
  duration_clock: "target_turn",
  duration_value: 3,
})];
let durationBattle = battle(durationCatalog, makePlayer(), "amplification-duration");
durationBattle = takeTurn(durationBattle, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }]);
const durationInstance = durationBattle.runtimeEffects.find((instance) => instance.sourceEffectId === "temporary-enemy-healing-reduction");
check(durationInstance?.remaining === 3, "A target-turn Effect Amplification applied after the target acts must retain all three target turns.");
durationBattle = takeTurn(durationBattle, [{ actorKey: "p1", type: "skip", cost: 0 }]);
check(durationBattle.runtimeEffects.some((instance) => instance.sourceEffectId === "temporary-enemy-healing-reduction" && instance.remaining === 2), "A target-turn Effect Amplification must lose one remaining turn when the target acts.");
durationBattle = takeTurn(durationBattle, [{ actorKey: "p1", type: "skip", cost: 0 }]);
check(durationBattle.runtimeEffects.some((instance) => instance.sourceEffectId === "temporary-enemy-healing-reduction" && instance.remaining === 1), "A target-turn Effect Amplification must continue tracking the target's remaining turns.");
durationBattle = takeTurn(durationBattle, [{ actorKey: "p1", type: "skip", cost: 0 }]);
check(!durationBattle.runtimeEffects.some((instance) => instance.sourceEffectId === "temporary-enemy-healing-reduction"), "A temporary Effect Amplification must expire after its configured duration.");

const reactiveCatalog = makeCatalog();
reactiveCatalog.dungeonOpponents[0].skill_ids = ["strike"];
reactiveCatalog.dungeonOpponents[1].skill_ids = ["strike"];
reactiveCatalog.effectsByRelic["spiky"] = [
  effect("relic", "spiky", "thorns", "direct_health_modifier", {
    value: 0.05,
    target: "attacker",
    operation: "lose_hp",
    value_type: "percent_max_hp",
    can_defeat_target: true,
    affected_by_shield: false,
  }),
];
reactiveCatalog.effectsByRelic["gambler"] = [
  effect("relic", "gambler", "give-and-take", "reactive_trigger", {
    target: "equipped_critter",
    trigger_event: "owner_attacked",
    activation_limit: null,
    activation_chance: 1,
    requires_hp_damage: true,
    child_effect_ids: ["mana-trade", "rage"],
  }),
  { ...effect("relic", "gambler", "mana-trade", "resource_gain_loss", {
    value: 3,
    resource: "squad_mana",
    operation: "lose",
    target_squad: "owner",
    trigger_timing: "through_parent",
  }, 1), execution: "child" },
  { ...effect("relic", "gambler", "rage", "stat_modifier", {
    stat: "atk",
    amount: 0.1,
    target: "equipped_critter",
    value_mode: "percentage",
  }, 2), execution: "child" },
];
reactiveCatalog.effectsByRelic["stim"] = [effect("relic", "stim", "health-booster", "effect_amplification", {
  target: "equipped_critter",
  affected_effect_category: "healing",
  direction: "received",
  modifier_type: "percentage",
  modifier_value: 0.2,
  duration_type: "while_relic_equipped",
  duration_clock: "target_turn",
  duration_value: null,
})];
const reactivePlayer = makePlayer();
reactivePlayer.relicSlots = [
  { user_critter_id: "up1", slot_index: 1, relic_id: "spiky" },
  { user_critter_id: "up1", slot_index: 2, relic_id: "gambler" },
  { user_critter_id: "up1", slot_index: 3, relic_id: "stim" },
];
let reactiveBattle = battle(reactiveCatalog, reactivePlayer, "reactive-relics");
reactiveBattle = { ...reactiveBattle, playerMana: 10, opponentMana: 10 };
const reactiveResult = resolveTurn(reactiveBattle, [
  { actorKey: "p1", type: "skip", cost: 0 },
  { actorKey: "p2", type: "skip", cost: 0 },
]);
check(reactiveResult.playerUnits[0].hp < reactiveBattle.playerUnits[0].hp, "The equipped reactive-relic target must take damage from the enemy hit.");
check(reactiveResult.opponentUnits[0].hp === reactiveBattle.opponentUnits[0].hp - 5, "Spiky Shield must immediately deal 5% max-HP retaliation damage to its attacker.");
check(reactiveResult.playerMana === 4, "Gambler's Rune must immediately remove 3 squad Mana after each HP-damaging hit.");
check(reactiveResult.presentationEvents.some((event) => event.message === "You lost 3 mana."), "Gambler's Rune must narrate the actual squad Mana lost.");
check(reactiveResult.playerUnits[0].stats.atk === 31, "Gambler's Rune must immediately apply its +10% ATK boost after each HP-damaging hit.");
const gamblerDamageIndex = reactiveResult.presentationEvents.findIndex((event) => event.kind === "damage" && event.targetKeys.includes("p1"));
const gamblerEffectIndex = reactiveResult.presentationEvents.findIndex((event) => event.kind === "status" && event.targetKeys.includes("p1") && event.message.includes("+3 ATK"));
check(gamblerDamageIndex >= 0 && gamblerEffectIndex > gamblerDamageIndex, "Gambler's Rune must present after the equipped Critter's damage event.");
const nextActionIndex = reactiveResult.presentationEvents.findIndex((event, index) => index > gamblerEffectIndex && event.kind === "skill");
const attackStatsAtDamage = reactiveResult.presentationEvents[gamblerDamageIndex]?.state?.units.find((unit) => unit.key === "p1")?.stats.atk;
const attackStatsAfterRune = reactiveResult.presentationEvents[gamblerEffectIndex]?.state?.units.find((unit) => unit.key === "p1")?.stats.atk;
const attackStatsBeforeNextAction = reactiveResult.presentationEvents[nextActionIndex]?.state?.units.find((unit) => unit.key === "p1")?.stats.atk;
check(attackStatsAtDamage === 25 && attackStatsAfterRune === 28 && attackStatsBeforeNextAction === 28, "Gambler's Rune's staged combat state must be active before the next action begins.");
const thornsDamageIndex = reactiveResult.presentationEvents.findIndex((event) => event.kind === "damage" && event.targetKeys.includes("o1") && event.message.includes("thorns"));
const incomingDamageIndex = reactiveResult.presentationEvents.findIndex((event) => event.kind === "damage" && event.targetKeys.includes("p1"));
check(thornsDamageIndex >= 0 && incomingDamageIndex >= 0 && thornsDamageIndex > incomingDamageIndex, "Spiky Shield retaliation must present after the incoming damage event.");
check(reactiveResult.presentationEvents[thornsDamageIndex]?.message === "The enemy Opponent One took 5 damage from thorns.", "Spiky Shield must name the attacker, actual damage, and Effect source.");

const skillTypeReactiveCatalog = makeCatalog();
skillTypeReactiveCatalog.rollcasterAbilities.push({ id: "quick-link", name: "Quick Link", description: "Spiritbond Skill reaction.", sort_order: 10 });
skillTypeReactiveCatalog.effectsByAbility["quick-link"] = [
  effect("ability", "quick-link", "attack-trigger", "reactive_trigger", {
    target: "all_friendlies",
    trigger_event: "owner_uses_attack_skill",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "battle",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["attack-speed"],
  }),
  { ...effect("ability", "quick-link", "attack-speed", "stat_modifier", {
    target: "attacker",
    stat: "spd",
    value_mode: "percentage",
    amount: 0.1,
  }), execution: "child" },
  effect("ability", "quick-link", "support-trigger", "reactive_trigger", {
    target: "all_friendlies",
    trigger_event: "owner_uses_support_skill",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "battle",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["support-speed"],
  }, 2),
  { ...effect("ability", "quick-link", "support-speed", "stat_modifier", {
    target: "attacker",
    stat: "spd",
    value_mode: "percentage",
    amount: 0.2,
  }, 3), execution: "child" },
];
const skillTypeReactivePlayer = makePlayer();
skillTypeReactivePlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "quick-link" }];
let skillTypeReactiveBattle = battle(skillTypeReactiveCatalog, skillTypeReactivePlayer, "quick-link-skill-types");
skillTypeReactiveBattle = { ...skillTypeReactiveBattle, playerMana: 5, opponentMana: 0 };
const attackReaction = resolveTurn(skillTypeReactiveBattle, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }]);
check(attackReaction.playerUnits[0].stats.spd === 33, "An attack-only Reactive Trigger must raise the attacking Critter's SPD after an attack Skill.");
check(attackReaction.playerUnits[0].stats.spd === 33, "A support-only Reactive Trigger must not run after an attack Skill.");
const supportReaction = resolveTurn({ ...attackReaction, playerMana: 0, opponentMana: 0 }, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(supportReaction.playerUnits[0].stats.spd === 39, "A support-only Reactive Trigger must raise the Critter's SPD after a support Skill.");

const toxicologyCatalog = makeCatalog();
toxicologyCatalog.elements.push({ id: "vile", name: "Vile", description: null, asset_path: null, sort_order: 3 });
toxicologyCatalog.statuses.push({ id: "toxic", name: "Toxic", description: "Toxic.", asset_path: null, sort_order: 3, version: 1 });
toxicologyCatalog.critters = toxicologyCatalog.critters.map((critter) => critter.id === "p1" ? { ...critter, element_1_id: "vile" } : critter);
toxicologyCatalog.rollcasterAbilities.push(
  { id: "toxicology-2", name: "Toxicology II", description: "High Potency.", sort_order: 11 },
  { id: "toxicology-5", name: "Toxicology V", description: "Venomous.", sort_order: 12 },
);
toxicologyCatalog.effectsByAbility["toxicology-2"] = [effect("ability", "toxicology-2", "high-potency", "status_duration_modifier", {
  target: "all_critters",
  status_id: "toxic",
  duration_bonus: 2,
  fresh_only: true,
  target_element_ids: [],
})];
const highPotencyPlayer = makePlayer();
highPotencyPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "toxicology-2" }];
const highPotencyBattle = battle(toxicologyCatalog, highPotencyPlayer, "toxicology-high-potency");
const highPotencyFresh = simApplyStatus(highPotencyBattle, "toxic", "o1", 2);
check(highPotencyFresh.statuses.find((status) => status.holderKey === "o1")?.duration === 4, "High Potency must add two turns to a fresh Toxic affliction on any active Critter.");
const highPotencyRefresh = simApplyStatus(highPotencyFresh, "toxic", "o1", 2);
check(highPotencyRefresh.statuses.find((status) => status.holderKey === "o1")?.duration === 4, "High Potency must not change the counter when a duplicate Toxic application is rejected.");
const highPotencyInactive = simApplyStatus(highPotencyBattle, "toxic", "p3", 2);
check(highPotencyInactive.statuses.find((status) => status.holderKey === "p3")?.duration === 2, "High Potency must target active Critters only.");

const venomousSkill = { ...toxicologyCatalog.skills[0], id: "venomous-strike", name: "Venomous Strike", mana_cost: 0, skill_type: "attack" as const, power: 1, targeting: "single_enemy" as const };
toxicologyCatalog.skills = [...toxicologyCatalog.skills, venomousSkill];
toxicologyCatalog.effectsByAbility["toxicology-5"] = [
  effect("ability", "toxicology-5", "venomous", "reactive_trigger", {
    target: "all_friendlies",
    target_element_ids: ["vile"],
    trigger_event: "owner_uses_attack_skill",
    trigger_source: "self",
    activation_chance: 0.3,
    activation_limit: null,
    activation_limit_scope: "battle",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["venomous-toxic"],
  }),
  { ...effect("ability", "toxicology-5", "venomous-toxic", "apply_status", {
    target: "defender",
    status_id: "toxic",
    chance: 1,
    indefinite: false,
    turns: 2,
    target_element_ids: [],
  }), execution: "child" },
];
const venomousPlayer = makePlayer();
venomousPlayer.skillSlots = venomousPlayer.skillSlots.map((slot) => slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: venomousSkill.id } : slot);
venomousPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "toxicology-5" }];
let venomousApplied = false;
let venomousMissed = false;
for (let seed = 1; seed <= 100 && (!venomousApplied || !venomousMissed); seed += 1) {
  const result = takeTurn({ ...battle(toxicologyCatalog, venomousPlayer, `toxicology-venomous-${seed}`), rngState: seed, opponentMana: 0 }, [{ actorKey: "p1", type: "skill", skillId: venomousSkill.id, targetKey: "o1", cost: 0 }], 0);
  const toxic = result.statuses.find((status) => status.holderKey === "o1" && status.statusId === "toxic");
  venomousApplied ||= toxic?.duration === 1 && toxic.turnsElapsed === 1;
  venomousMissed ||= !toxic;
}
check(venomousApplied && venomousMissed, "Venomous must afflict Toxic for two authored turns when its chance succeeds and do nothing when it misses.");
const nonVileCatalog = structuredClone(toxicologyCatalog);
nonVileCatalog.critters = nonVileCatalog.critters.map((critter) => critter.id === "p1" ? { ...critter, element_1_id: "basic" } : critter);
const nonVileResult = takeTurn({ ...battle(nonVileCatalog, venomousPlayer, "toxicology-non-vile"), opponentMana: 0 }, [{ actorKey: "p1", type: "skill", skillId: venomousSkill.id, targetKey: "o1", cost: 0 }], 0);
check(!nonVileResult.statuses.some((status) => status.holderKey === "o1" && status.statusId === "toxic"), "Venomous must not trigger for a non-Vile Skill user.");

let lowManaReactive = battle(reactiveCatalog, reactivePlayer, "reactive-relics");
lowManaReactive = { ...lowManaReactive, playerMana: 1, opponentMana: 10 };
const lowManaReactiveResult = resolveTurn(lowManaReactive, [
  { actorKey: "p1", type: "skip", cost: 0 },
  { actorKey: "p2", type: "skip", cost: 0 },
]);
check(lowManaReactiveResult.presentationEvents.some((event) => event.message === "You lost 1 mana."), "Mana-loss narration must clamp to the squad's remaining Mana.");

const shieldProjectorCatalog = makeCatalog();
shieldProjectorCatalog.dungeonOpponents[0].skill_ids = ["strike"];
shieldProjectorCatalog.effectsByRelic["projector"] = [
  effect("relic", "projector", "defensive-reaction", "reactive_trigger", {
    target: "equipped_critter",
    trigger_event: "owner_attacked",
    cooldown_turns: 0,
    minimum_damage: null,
    trigger_source: "self",
    activation_limit: 1,
    child_effect_ids: ["shield-i"],
    activation_chance: 0.25,
    requires_hp_damage: true,
    activation_limit_scope: "turn",
    requires_shield_damage: false,
  }),
  { ...effect("relic", "projector", "shield-i", "shield_modifier", {
    target: "equipped_critter",
    can_stack: true,
    operation: "grant",
    shield_value: 10,
    duration_type: "end_of_battle",
    duration_clock: "target_turn",
    duration_value: null,
    maximum_shield: null,
    replace_existing_shield: false,
  }, 1), execution: "child" },
];
let projectorActivations = 0;
let shieldedProjectorBattle: ReturnType<typeof battle> | null = null;
for (let seedIndex = 0; seedIndex < 100 && projectorActivations === 0; seedIndex += 1) {
  const projectorPlayer = makePlayer();
  projectorPlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "projector" }];
  let projectorBattle = battle(shieldProjectorCatalog, projectorPlayer, `shield-projector-${seedIndex}`);
  check(projectorBattle.runtimeEffects.some((instance) => instance.sourceEffectId === "defensive-reaction"), "Shield Projector's reactive parent must be installed at battle start.");
  projectorBattle = { ...projectorBattle, playerMana: 10, opponentMana: 10 };
  const projectorResult = resolveTurn(projectorBattle, [
    { actorKey: "p1", type: "skip", cost: 0 },
    { actorKey: "p2", type: "skip", cost: 0 },
  ]);
  check(projectorResult.playerUnits[0].hp < projectorBattle.playerUnits[0].hp, "Shield Projector regression must receive an actual enemy attack.");
  if (projectorResult.playerUnits[0].shield > 0) {
    projectorActivations += 1;
    shieldedProjectorBattle = projectorResult;
    check(projectorResult.playerUnits[0].shield === 10, "Shield Projector must grant exactly 10 Shield when its reaction activates.");
  }
}
check(projectorActivations > 0, "Shield Projector must activate in a deterministic sample of 100 damaged attacks.");
const shieldHitResult = resolveTurn({ ...shieldedProjectorBattle!, phase: "selecting", playerMana: 0, opponentMana: 10 }, [
  { actorKey: "p1", type: "skip", cost: 0 },
  { actorKey: "p2", type: "skip", cost: 0 },
]);
const shieldRemainingAfterHit = shieldHitResult.playerUnits[0].shield;
check(
  shieldRemainingAfterHit > 0
    && shieldRemainingAfterHit < 10
    && shieldHitResult.playerUnits[0].hp === shieldedProjectorBattle!.playerUnits[0].hp,
  "A hit against a 10-point Shield must reduce it by the incoming damage without reducing HP.",
);
const shieldHitEvent = shieldHitResult.presentationEvents.find((event) => event.kind === "damage" && event.targetKeys.includes("p1"));
check(
  shieldHitEvent?.message === `Your Player One's Shield absorbed ${10 - shieldRemainingAfterHit} damage.`,
  "Shield damage must narrate the absorbed amount instead of reporting 0 HP damage.",
);
const shieldProgressEvent = shieldHitResult.turnEvents.find((event) => event.event_type === "hp_damage_taken" && event.target_critter_id === "p1" && event.payload?.shield_damage === event.amount);
check(
  shieldProgressEvent?.amount === 10 - shieldRemainingAfterHit
    && shieldProgressEvent.payload?.hp_damage === 0
    && shieldProgressEvent.payload?.shield_damage === shieldProgressEvent.amount,
  "Shield-only combat damage must emit a normalized HP/Shield progress event for Take Damage challenges.",
);
check(!shieldHitResult.turnEvents.some((event) => event.event_type === "shield_shattered"), "Partial Shield damage must not emit a Shields Shattered progress event.");
check(!shieldHitResult.presentationEvents.some((event) => event.message.includes("took 0 damage")), "Shield-only damage must not produce a 0-damage HP narration.");
let shieldBreakResult = shieldHitResult;
for (let hit = 0; hit < 4 && shieldBreakResult.playerUnits[0].shield > 0; hit += 1) {
  shieldBreakResult = resolveTurn({ ...shieldBreakResult, phase: "selecting", playerMana: 0, opponentMana: 10 }, [
    { actorKey: "p1", type: "skip", cost: 0 },
    { actorKey: "p2", type: "skip", cost: 0 },
  ]);
}
check(shieldBreakResult.playerUnits[0].shield === 0, "A second hit must break the remaining Shield.");
const shieldBreakEvent = shieldBreakResult.presentationEvents.find((event) => event.message === "Your Player One's Shield broke.");
check(shieldBreakEvent?.kind === "status" && shieldBreakEvent.effectPolarity === "negative", "Shield break must get its own negative status presentation event.");
const shieldShatteredEvent = shieldBreakResult.turnEvents.find((event) => event.event_type === "shield_shattered");
check(
  shieldShatteredEvent?.amount === 1
    && shieldShatteredEvent.payload?.shield_shattered === true
    && shieldShatteredEvent.payload?.target_side === "player"
    && shieldShatteredEvent.target_critter_id === "p1",
  "A completed Shield break must emit one side-classified Shields Shattered progress event.",
);

const selectedLeadBattle = battle(reactiveCatalog, reactivePlayer, "selected-lead-runtime");
const activatedLeadBattle = refreshSetupRuntimeEffects({
  ...selectedLeadBattle,
  playerUnits: selectedLeadBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, active: false } : unit),
});
const reactivatedLeadBattle = refreshSetupRuntimeEffects({
  ...activatedLeadBattle,
  playerUnits: activatedLeadBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, active: true } : unit),
});
check(
  reactivatedLeadBattle.runtimeEffects.some((instance) => instance.sourceEffectId === "thorns")
    && reactivatedLeadBattle.runtimeEffects.some((instance) => instance.sourceEffectId === "health-booster"),
  "Activating Dungeon leads must reinstall equipped Relic runtime Effects after the initial inactive formation.",
);

const swapReactivePlayer = makePlayer();
swapReactivePlayer.relicSlots = [{ user_critter_id: "up3", slot_index: 1, relic_id: "spiky" }];
let swapReactiveBattle = battle(reactiveCatalog, swapReactivePlayer, "swap-in-reactive-relic");
swapReactiveBattle = { ...swapReactiveBattle, playerMana: 10, opponentMana: 5 };
const swapReactiveResult = resolveTurn(swapReactiveBattle, [
  { actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 },
  { actorKey: "p2", type: "skip", cost: 0 },
]);
check(swapReactiveResult.playerUnits.find((unit) => unit.key === "p3")?.hp! < swapReactiveBattle.playerUnits.find((unit) => unit.key === "p3")?.hp!, "A Critter swapped into an attacked slot must take the incoming damage.");
check(swapReactiveResult.opponentUnits[0].hp === swapReactiveBattle.opponentUnits[0].hp - 5, "A Critter swapped into an attacked slot must immediately trigger its Spiky Shield retaliation.");
check(
  swapReactiveResult.presentationEvents.some((event) => event.kind === "damage" && event.targetKeys.includes("p3"))
    && swapReactiveResult.presentationEvents.some((event) => event.kind === "damage" && event.targetKeys.includes("o1") && event.message.includes("thorns")),
  "Swap-in Relic damage and retaliation must both be staged in combat order.",
);

let blockFailure: ReturnType<typeof battle> | null = null;
for (let seedIndex = 0; seedIndex < 1000 && !blockFailure; seedIndex += 1) {
  const first = takeTurn(battle(makeCatalog(), makePlayer(), `block-odds-${seedIndex}`), [{ actorKey: "p1", type: "block", cost: 3 }], 10);
  const second = takeTurn(first, [{ actorKey: "p1", type: "block", cost: 3 }], 10);
  if (!second.playerUnits[0].blocking && second.playerUnits[0].blockStreak === 0) blockFailure = second;
}
check(blockFailure, "The deterministic combat RNG must expose a reproducible second-block failure for odds regression coverage.");
check(
  blockFailure!.presentationEvents.filter((event) => event.kind === "block").map((event) => event.message).join("|") === "Your Player One blocks.|Player One's block failed.",
  "A failed consecutive Block must first present the declaration and then show concise failure narration on the next event.",
);
const resetBlock = takeTurn(blockFailure!, [{ actorKey: "p1", type: "block", cost: 3 }], 10);
check(resetBlock.playerUnits[0].blocking && resetBlock.playerUnits[0].blockStreak === 1, "A failed Block must reset the next Block odds to 1/1 and allow it to succeed.");
check(resetBlock.presentationEvents.some((event) => event.kind === "block" && event.message === "Your Player One blocks."), "A reset successful Block must use the concise success narration.");

const nonConsecutiveBlock = takeTurn(
  takeTurn(
    takeTurn(battle(makeCatalog(), makePlayer(), "non-consecutive-block"), [{ actorKey: "p1", type: "block", cost: 3 }], 10),
    [{ actorKey: "p1", type: "skip", cost: 0 }],
    10,
  ),
  [{ actorKey: "p1", type: "block", cost: 3 }],
  10,
);
check(nonConsecutiveBlock.playerUnits[0].blocking && nonConsecutiveBlock.playerUnits[0].blockStreak === 1, "A non-Block action must reset the next Block to full odds.");

let enemyBlockFailure: ReturnType<typeof battle> | null = null;
for (let seedIndex = 0; seedIndex < 1000 && !enemyBlockFailure; seedIndex += 1) {
  const base = battle(makeCatalog(), makePlayer(), `enemy-block-odds-${seedIndex}`);
  const enemyOnly = {
    ...base,
    opponentMana: 10,
    opponentUnits: base.opponentUnits.map((unit, index) => index === 0 ? { ...unit, skills: [] } : { ...unit, active: false, battlefieldSlot: null, skills: [] }),
  };
  const first = takeTurn(enemyOnly, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
  const second = takeTurn(first, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
  const enemy = second.opponentUnits[0];
  if (!enemy.blocking && enemy.blockStreak === 0) enemyBlockFailure = second;
}
check(enemyBlockFailure, "The legacy main-game enemy policy must submit Blocks and expose consecutive-block failure odds.");
check(
  enemyBlockFailure!.presentationEvents.filter((event) => event.kind === "block" && event.actorKey === "o1").map((event) => event.message).join("|") === "The enemy Opponent One blocks.|Opponent One's block failed.",
  "Enemy Block declarations and failures must use the same presentation sequence as user Blocks.",
);

const knockoutCatalog = makeCatalog();
knockoutCatalog.dungeonOpponents[0].skill_ids = ["strike"];
let playerKnockoutBattle = battle(knockoutCatalog, makePlayer(), "player-knockout-refund");
playerKnockoutBattle = {
  ...playerKnockoutBattle,
  opponentMana: 5,
  playerUnits: playerKnockoutBattle.playerUnits.map((unit) => (
    unit.key === "p1"
      ? {
          ...unit,
          hp: 1,
          baseStats: { ...unit.baseStats, spd: 1 },
          persistentStats: { ...unit.persistentStats, spd: 1 },
          stats: { ...unit.stats, spd: 1 },
        }
      : unit
  )),
  opponentUnits: playerKnockoutBattle.opponentUnits.map((unit) => (
    unit.key === "o1"
      ? {
          ...unit,
          baseStats: { ...unit.baseStats, spd: 100 },
          persistentStats: { ...unit.persistentStats, spd: 100 },
          stats: { ...unit.stats, spd: 100 },
        }
      : unit
  )),
};
const playerKnockoutResult = takeTurn(
  playerKnockoutBattle,
  [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }],
  10,
);
check(
  playerKnockoutResult.playerUnits[0].hp === 0
    && playerKnockoutResult.playerMana === 10
    && playerKnockoutResult.opponentUnits[0].hp === playerKnockoutBattle.opponentUnits[0].hp
    && playerKnockoutResult.presentationEvents.some((event) => event.kind === "mana_refund" && event.manaRefund?.side === "player" && event.manaRefund.amount === 5)
    && !playerKnockoutResult.log.some((line) => line.includes("reserved mana")),
  "A player Critter knocked out before its queued action must recover that action's reserved Mana without refund narration.",
);

let opponentKnockoutBattle = battle(knockoutCatalog, makePlayer(), "opponent-knockout-refund");
opponentKnockoutBattle = {
  ...opponentKnockoutBattle,
  opponentMana: 5,
  playerUnits: opponentKnockoutBattle.playerUnits.map((unit) => (
    unit.key === "p1"
      ? {
          ...unit,
          baseStats: { ...unit.baseStats, spd: 100 },
          persistentStats: { ...unit.persistentStats, spd: 100 },
          stats: { ...unit.stats, spd: 100 },
        }
      : unit
  )),
  opponentUnits: opponentKnockoutBattle.opponentUnits.map((unit) => (
    unit.key === "o1"
      ? {
          ...unit,
          hp: 1,
          baseStats: { ...unit.baseStats, spd: 1 },
          persistentStats: { ...unit.persistentStats, spd: 1 },
          stats: { ...unit.stats, spd: 1 },
        }
      : unit
  )),
};
const opponentKnockoutResult = takeTurn(
  opponentKnockoutBattle,
  [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }],
  10,
);
check(
  opponentKnockoutResult.opponentUnits[0].hp === 0
    && opponentKnockoutResult.opponentMana === 5
    && opponentKnockoutResult.playerUnits[0].hp === opponentKnockoutBattle.playerUnits[0].hp
    && opponentKnockoutResult.presentationEvents.some((event) => event.kind === "mana_refund" && event.manaRefund?.side === "opponent" && event.manaRefund.amount === 5)
    && !opponentKnockoutResult.log.some((line) => line.includes("reserved mana")),
  "An opposing Critter knocked out before its queued action must recover that action's reserved Mana without refund narration.",
);

check(roundHalfUp(2.5) === 3 && roundHalfUp(-2.5) === -3, "Shared half-up rounding must round exact halves away from zero.");

const allBattleFormats: BattleFormat[] = ["1v1", "1v2", "1v3", "2v1", "2v2", "2v3", "3v1", "3v2", "3v3"];
for (const format of allBattleFormats) {
  const parsed = parseBattleFormat(format);
  check(
    `${parsed.playerActiveCount}v${parsed.opponentActiveCount}` === format,
    `Battle Format ${format} must preserve both authored active counts.`,
  );
}
check(
  sortDungeonsNaturally([
    { ...eventCatalog.dungeons[0], id: "010" },
    { ...eventCatalog.dungeons[0], id: "2" },
    { ...eventCatalog.dungeons[0], id: "001" },
  ]).map((dungeon) => dungeon.id).join(",") === "001,2,010",
  "Dungeon IDs must use natural numeric ordering.",
);

const bossDungeon = {
  ...eventCatalog.dungeons[0],
  id: "boss",
  dungeon_type: "boss" as const,
  battle_format: "2v3" as const,
  battle_count: 4,
  regular_logo_path: "regular.png",
  boss_logo_path: "boss.png",
};
const opponentBase = eventCatalog.dungeonOpponents[0];
const bossOpponents: DungeonOpponent[] = [
  ...[2, 4, 6, 8, 10, 12].map((level, index) => ({
    ...opponentBase,
    id: `boss-${index}`,
    dungeon_id: "boss",
    pool_type: "boss_order" as const,
    sequence_index: index,
    probability: null,
    critter_level: level,
  })),
  ...[5, 9].map((level, index) => ({
    ...opponentBase,
    id: `regular-${index}`,
    dungeon_id: "boss",
    pool_type: "regular_pool" as const,
    sequence_index: index,
    probability: 0.5,
    critter_level: level,
  })),
];
const bossProgress = { user_id: "u", dungeon_id: "boss", is_unlocked: true, completed_at: null, clear_count: 0 };
const firstClearDungeon = effectiveDungeon(bossDungeon, bossOpponents, bossProgress, makePlayer());
check(
  firstClearDungeon.mode === "boss"
    && firstClearDungeon.logoPath === "boss.png"
    && firstClearDungeon.battleCount === 2
    && firstClearDungeon.difficulty === 12
    && !firstClearDungeon.encounterPoolRevealed,
  "An uncleared Boss Dungeon must derive its lineup, count, logo, and maximum difficulty from ordered Boss rows while hiding its encounter identities.",
);
const repeatDungeon = effectiveDungeon(
  bossDungeon,
  bossOpponents,
  { ...bossProgress, completed_at: "now", clear_count: 1 },
  { ...makePlayer(), dungeonRunHistory: [{ dungeon_id: "boss", status: "won" }] },
);
check(
  repeatDungeon.mode === "regular"
    && repeatDungeon.logoPath === "regular.png"
    && repeatDungeon.battleCount === 4
    && repeatDungeon.difficulty === 9
    && repeatDungeon.encounterPoolRevealed,
  "A cleared Boss Dungeon must switch to its authored regular pool, use its maximum difficulty, and reveal identities after a completed run.",
);
const lostDungeon = effectiveDungeon(
  bossDungeon,
  bossOpponents,
  bossProgress,
  { ...makePlayer(), dungeonRunHistory: [{ dungeon_id: "boss", status: "lost" }] },
);
check(
  lostDungeon.encounterPoolRevealed
    && !effectiveDungeon(
    bossDungeon,
    bossOpponents,
    bossProgress,
    { ...makePlayer(), dungeonRunHistory: [{ dungeon_id: "boss", status: "abandoned" }] },
  ).encounterPoolRevealed
    && !effectiveDungeon(
      bossDungeon,
      bossOpponents,
      { ...bossProgress, is_unlocked: false },
      { ...makePlayer(), dungeonRunHistory: [{ dungeon_id: "boss", status: "lost" }] },
    ).encounterPoolRevealed,
  "Abandoned runs and locked Dungeons must not reveal encounter identities.",
);

check(
  battlefieldSlotsForCount(1).join(",") === "1"
    && battlefieldSlotsForCount(2).join(",") === "0,2"
    && battlefieldSlotsForCount(3).join(",") === "0,1,2",
  "One-active formations must use center, two-active formations top/bottom, and three-active formations every slot.",
);

const actionOrderBattle = battle(eventCatalog, makePlayer(), "action-order");
const swappedActionOrder = orderedActiveCombatUnits([
  { ...actionOrderBattle.playerUnits[0], active: false, battlefieldSlot: null },
  { ...actionOrderBattle.playerUnits[1], active: true, battlefieldSlot: 2 },
  { ...actionOrderBattle.playerUnits[2], active: true, battlefieldSlot: 0 },
]);
check(
  swappedActionOrder.map((unit) => unit.battlefieldSlot).join(",") === "0,2",
  "Player action selection must always follow top-to-bottom battlefield slots after a Swap, regardless of squad-array order.",
);

check(
  elementEffectiveness(eventCatalog, "bloom", eventCatalog.critters[4]) === 2,
  "Dual-type Element effectiveness must multiply the chart cell for both defending Elements.",
);
check(
  elementEffectiveness(eventCatalog, "aqua", eventCatalog.critters[4]) === 0.5,
  "Dual-type resistance must multiply into the final effectiveness value.",
);
check(
  classifyEffectiveness(2).classification === "extra-effective"
    && classifyEffectiveness(1.999).classification === "effective"
    && classifyEffectiveness(1).classification === "neutral"
    && classifyEffectiveness(0.999).classification === "resisted"
    && classifyEffectiveness(0.5).classification === "extra-resisted",
  "Effectiveness narration must honor the exact 2×, 1×, and 0.5× boundaries.",
);
const damageState = battle(eventCatalog, makePlayer(), "damage-formula");
const matchingSkill = { ...eventCatalog.skills[0], element_id: "bloom", power: 50 };
const nonMatchingSkill = { ...matchingSkill, element_id: "basic" };
const stabDamage = calculateSkillDamage(eventCatalog, damageState.playerUnits[1], damageState.opponentUnits[0], matchingSkill);
const plainDamage = calculateSkillDamage(eventCatalog, damageState.playerUnits[1], damageState.opponentUnits[0], nonMatchingSkill);
check(stabDamage.stab && !plainDamage.stab && stabDamage.damage === 4 && plainDamage.damage === 3, "STAB must apply 1.5× to Skill Power before the final damage floor.");
check(rollDamagePercent(() => 0) === 85 && rollDamagePercent(() => 0.999) === 100, "Damage rolls must stay within the inclusive 85–100% range.");
const minimumDamageRoll = calculateSkillDamage(eventCatalog, damageState.playerUnits[1], damageState.opponentUnits[0], nonMatchingSkill, () => 0);
const maximumDamageRoll = calculateSkillDamage(eventCatalog, damageState.playerUnits[1], damageState.opponentUnits[0], nonMatchingSkill, () => 0.999);
check(
  minimumDamageRoll.damageRollPercent === 85
    && maximumDamageRoll.damageRollPercent === 100
    && minimumDamageRoll.maxDamage === maximumDamageRoll.maxDamage
    && minimumDamageRoll.damage <= maximumDamageRoll.damage,
  "The same Skill against the same Critter must use one bounded damage maximum with a variable percentage roll.",
);
const singleTargetPower = calculateSkillDamage(eventCatalog, damageState.playerUnits[1], damageState.opponentUnits[0], nonMatchingSkill, () => 0.999, 1);
const spreadTargetPower = calculateSkillDamage(eventCatalog, damageState.playerUnits[1], damageState.opponentUnits[0], nonMatchingSkill, () => 0.999, 2);
const threeTargetPower = calculateSkillDamage(eventCatalog, damageState.playerUnits[1], damageState.opponentUnits[0], nonMatchingSkill, () => 0.999, 3);
check(
  singleTargetPower.spreadMultiplier === 1
    && spreadTargetPower.spreadMultiplier === MULTI_TARGET_DAMAGE_MULTIPLIER
    && threeTargetPower.spreadMultiplier === MULTI_TARGET_DAMAGE_MULTIPLIER
    && singleTargetPower.damage >= spreadTargetPower.damage
    && singleTargetPower.maxDamage >= spreadTargetPower.maxDamage
    && spreadTargetPower.maxDamage === threeTargetPower.maxDamage,
  "A multi-target Skill must use Pokémon's 75% spread modifier, while a single living target keeps full power.",
);
const spreadSkill = { ...nonMatchingSkill, id: "spread-strike", targeting: "all_enemies" as const };
const spreadTargets = skillTargets(damageState, damageState.playerUnits[1].key, spreadSkill);
const oneTargetState = {
  ...damageState,
  opponentUnits: damageState.opponentUnits.map((unit, index) => index === 1 ? { ...unit, hp: 0 } : unit),
};
const remainingTargets = skillTargets(oneTargetState, oneTargetState.playerUnits[1].key, spreadSkill);
check(spreadTargets.length === 2 && remainingTargets.length === 1, "Spread damage must count only the living valid targets at the moment the Skill resolves.");
const immuneCatalog = makeCatalog();
immuneCatalog.elementEffectiveness = immuneCatalog.elementEffectiveness.map((cell) =>
  cell.attacking_element_id === "basic" && cell.defending_element_id === "basic"
    ? { ...cell, multiplier: 0 }
    : cell
);
const immuneState = battle(immuneCatalog, makePlayer(), "immunity");
check(
  calculateSkillDamage(immuneCatalog, immuneState.playerUnits[0], immuneState.opponentUnits[0], immuneCatalog.skills[0]).damage === 0,
  "A zero Element multiplier must remain zero rather than being raised by minimum-damage protection.",
);

const grouped = groupCombatEffectRows([
  { owner_type: "skill", owner_id: "strike", id: "later", name: "Later", description: "Later.", sort_order: 8, template_id: "skill-restore-hp", runtime_kind: "restore_hp", runtime_version: 1, parameters: { value_mode: "flat", amount: 1, chance: 1, target: "self" } },
  { owner_type: "skill", owner_id: "strike", id: "first", name: "First", description: "First.", sort_order: 1, template_id: "skill-restore-hp", runtime_kind: "restore_hp", runtime_version: 1, parameters: { value_mode: "flat", amount: 1, chance: 1, target: "self" } },
  { owner_type: "relic", owner_id: "carrier", id: "first", name: "Scoped ID", description: "Scoped.", sort_order: 0, template_id: "relic-stat-modifier", runtime_kind: "stat_modifier", runtime_version: 1, parameters: { stat: "atk", value_mode: "flat", amount: 1, target: "equipped_critter" } },
  { owner_type: "relic", owner_id: "002", id: "a597cea0-309a-4a70-9f49-bb691c38c111", name: "Lighter Roll", description: "Equipped Critter gains +1/+1 to its Mana rolls.", sort_order: 0, template_id: "relic-mana-dice-modifier", runtime_kind: "mana_dice_modifier", runtime_version: 1, parameters: { target: "equipped_critter", element_ids: [], maximum_delta: 1, minimum_delta: 1 } },
]);
check(grouped.skill.strike.map((item) => item.id).join(",") === "first,later", "combat_effects_v1 rows must group by owner and preserve ascending sort order.");
check(grouped.relic.carrier[0].id === "first", "Inline effect IDs may be reused by different owners without becoming shared definitions.");
check(Array.isArray(grouped.relic["002"][0].parameters.target_element_ids) && grouped.relic["002"][0].parameters.element_ids === undefined, "Legacy element filters must normalize to explicit target Critter filters.");
const xpBoostRows = groupCombatEffectRows([
  { owner_type: "ability", owner_id: "friendly-stat", id: "ability-xp", name: "Ability XP", description: "", sort_order: 0, template_id: "ability-critter-xp-modifier", runtime_kind: "critter_xp_modifier", runtime_version: 1, parameters: { target: "all_friendlies", distribution_mode: "shared_with_inactive", modifier_type: "percentage", modifier_value: 0.5, target_element_ids: ["bloom"], target_critter_tag_ids: [] } },
  { owner_type: "relic", owner_id: "carrier", id: "relic-xp", name: "Relic XP", description: "", sort_order: 0, template_id: "relic-critter-xp-modifier", runtime_kind: "critter_xp_modifier", runtime_version: 1, parameters: { target: "equipped_critter_allies_without_equipped", distribution_mode: "shared_with_inactive", modifier_type: "percentage", modifier_value: 0.5, target_element_ids: [], target_critter_tag_ids: [] } },
]);
check(xpBoostRows.ability["friendly-stat"][0].runtimeKind === "critter_xp_modifier" && xpBoostRows.relic.carrier[0].runtimeKind === "critter_xp_modifier", "Critter XP Boosts must load for Ability and Relic owners.");
let skillXpRejected = false;
try {
  groupCombatEffectRows([
    { owner_type: "skill", owner_id: "strike", id: "skill-xp", name: "Skill XP", description: "", sort_order: 0, template_id: "skill-critter-xp-modifier", runtime_kind: "critter_xp_modifier", runtime_version: 1, parameters: { target: "self", distribution_mode: "active_only", modifier_type: "percentage", modifier_value: 0.5 } },
  ]);
} catch {
  skillXpRejected = true;
}
check(skillXpRejected, "Critter XP Boosts must be rejected for Skill owners.");

const composableElementCatalog = makeCatalog();
composableElementCatalog.effectsByAbility = {
  "friendly-stat": [effect("ability", "friendly-stat", "bloom-friendly", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 7, target: "all_friendlies", target_element_ids: ["bloom"] })],
  "enemy-stat": [effect("ability", "enemy-stat", "aqua-enemy", "stat_modifier", { stat: "def", value_mode: "flat", amount: -4, target: "all_enemies", target_element_ids: ["aqua"] })],
};
composableElementCatalog.effectsByRelic = {
  carrier: [effect("relic", "carrier", "aqua-carrier", "stat_modifier", { stat: "hp", value_mode: "flat", amount: 10, target: "equipped_critter", target_element_ids: ["aqua"] })],
};
composableElementCatalog.effectsBySkill.wave = [
  effect("skill", "wave", "aqua-target-defense", "stat_modifier", { stat: "def", value_mode: "flat", amount: -5, chance: 1, target: "target_enemies", target_element_ids: ["aqua"] }),
];
const composablePlayer = makePlayer();
composablePlayer.abilitySlots = [
  { user_rollcaster_id: "ur", slot_index: 1, ability_id: "friendly-stat" },
  { user_rollcaster_id: "ur", slot_index: 2, ability_id: "enemy-stat" },
];
composablePlayer.relicSlots = [{ user_critter_id: "up2", slot_index: 1, relic_id: "carrier" }];
const composableBattle = battle(composableElementCatalog, composablePlayer, "composable-element-filters");
check(composableBattle.playerUnits[0].stats.atk === 25 && composableBattle.playerUnits[1].stats.atk === 27, "An Ability element filter must apply a friendly stat modifier only to matching Critters.");
check(composableBattle.opponentUnits[0].stats.def === 25 && composableBattle.opponentUnits[1].stats.def === 16, "An Ability element filter must apply an enemy stat modifier only to matching Critters.");
check(composableBattle.playerUnits[1].maxHp === 90 && composableBattle.playerUnits[0].maxHp === 100, "A Relic element filter must apply only when its equipped Critter matches the selected Elements.");
const composableSkillResult = takeTurn(composableBattle, [{ actorKey: "p1", type: "skill", skillId: "wave", cost: 0 }]);
check(composableSkillResult.opponentUnits[0].stats.def === 25 && composableSkillResult.opponentUnits[1].stats.def === 11, "A Skill Effect element filter must compose with its target selection and affect only matching enemy recipients.");

const passiveConditionalCatalog = makeCatalog();
passiveConditionalCatalog.effectsByRelic.carrier = [
  effect("relic", "carrier", "passive-gate", "conditional_effect", {
    target: "equipped_critter",
    condition: "active_state",
    comparison: "equal",
    condition_value: "active",
    true_effect_ids: ["passive-boost"],
    false_effect_ids: [],
    check_timing: "continuous",
    remove_effects_when_false: true,
  }),
  effect("relic", "carrier", "passive-boost", "damage_modifier", {
    target: "equipped_critter",
    direction: "dealt",
    modifier_type: "percentage",
    modifier_value: 0.25,
    applicable_source: "skill",
    applicable_target: "any",
    condition: "none",
    duration_type: "end_of_battle",
    duration_clock: "global_round",
  }, 1),
];
const passiveConditionalPlayer = makePlayer();
passiveConditionalPlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "carrier" }];
const passiveConditionalBaseline = takeTurn(battle(makeCatalog(), makePlayer(), "passive-conditional-baseline"), [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 0 }], 50);
const passiveConditionalResult = takeTurn(battle(passiveConditionalCatalog, passiveConditionalPlayer, "passive-conditional"), [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 0 }], 50);
check(
  100 - passiveConditionalResult.opponentUnits[0].hp > 100 - passiveConditionalBaseline.opponentUnits[0].hp,
  "A continuously active Relic Conditional Effect must install its true child before the Skill hit.",
);

const splitTargetStatCatalog = makeCatalog();
splitTargetStatCatalog.effectsByStatus.aura = [
  { ...effect("status", "aura", "negative-defense", "stat_modifier", { stat: "def", value_mode: "flat", amount: -5, chance: 1, application_mode: "single_application", target: "status_holder" }), runtimeVersion: 2, classification: "negative", execution: "root" },
];
splitTargetStatCatalog.effectsBySkill.strike = [
  effect("skill", "strike", "hollow-rot-style-check", "conditional_effect", {
    effect_target: "using_critter",
    condition_target: "skill_targets",
    condition: "has_stat_modifier",
    comparison: "negative",
    condition_stats: ["atk", "def", "spd"],
    true_effect_ids: ["hollow-rot-style-damage"],
    false_effect_ids: [],
    check_timing: "continuous",
    remove_effects_when_false: true,
  }),
  { ...effect("skill", "strike", "hollow-rot-style-damage", "damage_modifier", {
    target: "self", direction: "dealt", modifier_type: "percentage", modifier_value: 0.25,
    applicable_source: "skill", applicable_target: "any", condition: "none", duration_type: "current_action", duration_clock: "owner_turn",
  }, 1), execution: "child", classification: "positive" },
];
const splitTargetWithDebuff = simApplyStatus(battle(splitTargetStatCatalog, makePlayer(), "split-target-stat-debuff"), "aura", "o1", null);
const splitTargetWithoutDebuff = battle(splitTargetStatCatalog, makePlayer(), "split-target-stat-clean");
const splitTargetAction = [{ actorKey: "p1", type: "skill" as const, skillId: "strike", targetKey: "o1", cost: 5 }];
const splitTargetBoosted = takeTurn(splitTargetWithDebuff, splitTargetAction, 50);
const splitTargetBase = takeTurn(splitTargetWithoutDebuff, splitTargetAction, 50);
check(
  100 - splitTargetBoosted.opponentUnits[0].hp > 100 - splitTargetBase.opponentUnits[0].hp,
  "Has Stat Modifier must inspect Skill Targets while applying its child damage modifier to the independent Effect Target.",
);

const multiStatusConditionalCatalog = makeCatalog();
multiStatusConditionalCatalog.effectsByRelic.carrier = [
  effect("relic", "carrier", "boost-status-gate", "conditional_effect", {
    effect_target: "equipped_critter",
    condition_target: "equipped_critter",
    condition: "has_status",
    comparison: "equal",
    condition_status_ids: ["finite", "aura"],
    true_effect_ids: ["boost-status-damage"],
    false_effect_ids: [],
    check_timing: "continuous",
    remove_effects_when_false: true,
  }),
  { ...effect("relic", "carrier", "boost-status-damage", "damage_modifier", {
    target: "equipped_critter", direction: "dealt", modifier_type: "percentage", modifier_value: 0.25,
    applicable_source: "skill", applicable_target: "any", condition: "none", duration_type: "end_of_battle", duration_clock: "global_round",
  }, 1), execution: "child", classification: "positive" },
];
const multiStatusPlayer = makePlayer();
multiStatusPlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "carrier" }];
const multiStatusActive = simApplyStatus(battle(multiStatusConditionalCatalog, multiStatusPlayer, "has-status-multi-select"), "aura", "p1", null);
const multiStatusBase = battle(makeCatalog(), multiStatusPlayer, "has-status-multi-select-base");
const multiStatusBoosted = takeTurn(multiStatusActive, splitTargetAction, 50);
const multiStatusUnboosted = takeTurn(multiStatusBase, splitTargetAction, 50);
check(
  100 - multiStatusBoosted.opponentUnits[0].hp > 100 - multiStatusUnboosted.opponentUnits[0].hp,
  "Has Status must treat any selected Status as satisfying Equal to and keep the relic's Effect Target separate.",
);

const sourceGateCatalog = makeCatalog();
sourceGateCatalog.effectsBySkill.wave = [
  effect("skill", "wave", "attuned-pressure", "stat_modifier", {
    stat: "def", value_mode: "flat", amount: -5, chance: 1, target: "all_enemies",
    source_element_ids: ["bloom", "aqua"], target_element_ids: ["basic"],
  }),
];
const inactiveSourceResult = takeTurn(
  battle(sourceGateCatalog, makePlayer(), "inactive-skill-source-gate"),
  [{ actorKey: "p1", type: "skill", skillId: "wave", cost: 0 }],
);
check(inactiveSourceResult.opponentUnits[0].stats.def === 25, "A source-gated Skill Effect must remain inactive for a non-matching user without preventing the Skill action.");
const activeSourceResult = takeTurn(
  battle(sourceGateCatalog, makePlayer(), "active-skill-source-gate"),
  [{ actorKey: "p2", type: "skill", skillId: "wave", cost: 0 }],
);
check(
  activeSourceResult.opponentUnits[0].stats.def === 20 && activeSourceResult.opponentUnits[1].stats.def === 20,
  "A dual-element Skill user matching both source requirements must activate the Effect once, and only Basic enemy targets may receive it.",
);

const relicSourceCatalog = makeCatalog();
relicSourceCatalog.effectsByRelic.carrier = [
  effect("relic", "carrier", "rising-current", "mana_dice_modifier", {
    minimum_delta: 1, maximum_delta: 2, target: "equipped_critter",
    source_element_ids: ["bloom", "aqua"], target_element_ids: ["bloom", "aqua"],
  }),
];
const inactiveRelicPlayer = makePlayer();
inactiveRelicPlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "carrier" }];
const inactiveRelicBattle = battle(relicSourceCatalog, inactiveRelicPlayer, "inactive-relic-source-gate");
check(inactiveRelicBattle.playerUnits[0].stats.diceMin === 2 && inactiveRelicBattle.playerUnits[0].stats.diceMax === 4, "A Relic Effect must remain inactive when its bearer misses the equipped-Critter Element requirement.");
const activeRelicPlayer = makePlayer();
activeRelicPlayer.relicSlots = [{ user_critter_id: "up2", slot_index: 1, relic_id: "carrier" }];
const activeRelicBattle = battle(relicSourceCatalog, activeRelicPlayer, "active-relic-source-gate");
check(
  activeRelicBattle.playerUnits[1].stats.diceMin === 2 && activeRelicBattle.playerUnits[1].stats.diceMax === 5,
  "A dual-element Relic bearer matching both requirements must receive the Mana-die Effect exactly once.",
);

const allCrittersAbilityCatalog = makeCatalog();
allCrittersAbilityCatalog.rollcasterAbilities.push({ id: "global-stat", name: "Global Stat", description: "Global Stat.", sort_order: 4 });
allCrittersAbilityCatalog.effectsByAbility["global-stat"] = [
  effect("ability", "global-stat", "global-stat", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 1, target: "all_critters" }),
];
const allCrittersAbilityPlayer = makePlayer();
allCrittersAbilityPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "global-stat" }];
const allCrittersAbilityBattle = battle(allCrittersAbilityCatalog, allCrittersAbilityPlayer, "all-critters-ability");
check(
  allCrittersAbilityBattle.playerUnits[0].stats.atk === 26
    && allCrittersAbilityBattle.playerUnits[1].stats.atk === 21
    && allCrittersAbilityBattle.opponentUnits[0].stats.atk === 25
    && allCrittersAbilityBattle.opponentUnits[1].stats.atk === 27
    && allCrittersAbilityBattle.playerUnits[2].stats.atk === 22,
  "An Ability targeting all_critters must affect every living active Critter on both sides while excluding the inactive bench.",
);

const attackerAndTargetsCatalog = makeCatalog();
attackerAndTargetsCatalog.effectsBySkill.wave = [
  effect("skill", "wave", "attacker-and-targets", "stat_modifier", {
    stat: "atk", value_mode: "flat", amount: 1, chance: 1, target: "attacker_and_targets",
  }),
];
const attackerAndTargetsBattle = takeTurn(
  battle(attackerAndTargetsCatalog, makePlayer(), "attacker-and-targets"),
  [{ actorKey: "p1", type: "skill", skillId: "wave", cost: 0 }],
);
check(
  attackerAndTargetsBattle.playerUnits[0].stats.atk === 26
    && attackerAndTargetsBattle.playerUnits[1].stats.atk === 20
    && attackerAndTargetsBattle.opponentUnits[0].stats.atk === 25
    && attackerAndTargetsBattle.opponentUnits[1].stats.atk === 27,
  "An Effect targeting attacker_and_targets must affect the Skill attacker and every Critter hit by the Skill exactly once.",
);

const passiveCatalog = makeCatalog();
passiveCatalog.effectsByAbility = {
  "friendly-stat": [effect("ability", "friendly-stat", "friendly-stat", "stat_modifier", { stat: "def", value_mode: "percentage", amount: 0.1, target: "all_friendlies" })],
  "enemy-stat": [effect("ability", "enemy-stat", "enemy-stat", "stat_modifier", { stat: "atk", value_mode: "flat", amount: -2, target: "all_enemies" })],
  "friendly-dice": [effect("ability", "friendly-dice", "friendly-dice", "mana_dice_modifier", { minimum_delta: 1, maximum_delta: 2, target: "all_element_friendlies", target_element_ids: ["bloom"] })],
  "enemy-dice": [effect("ability", "enemy-dice", "enemy-dice", "mana_dice_modifier", { minimum_delta: 2, maximum_delta: 3, target: "all_element_enemies", target_element_ids: ["bloom"] })],
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

const enemyAbilityCatalog = makeCatalog();
enemyAbilityCatalog.effectsByAbility = {
  "friendly-stat": [effect("ability", "friendly-stat", "enemy-owned-friendly-stat", "stat_modifier", { stat: "def", value_mode: "percentage", amount: 0.1, target: "all_friendlies" })],
  "enemy-stat": [effect("ability", "enemy-stat", "enemy-owned-enemy-stat", "stat_modifier", { stat: "atk", value_mode: "flat", amount: -2, target: "all_enemies" })],
};
const enemyAbilityState = createInitialCombatState(
  enemyAbilityCatalog,
  makePlayer(),
  enemyAbilityCatalog.dungeons[0],
  "enemy-ability-relative-targets",
  undefined,
  "enemy-ability-relative-targets",
  { eclipse_order_type: "acolyte", ability_ids: ["friendly-stat", "enemy-stat"] },
);
check(
  enemyAbilityState.opponentUnits[0].stats.def === 28 && enemyAbilityState.opponentUnits[1].stats.def === 22,
  "An enemy Rollcaster Ability targeting all_friendlies must affect the enemy Critters, not the player's side.",
);
check(
  enemyAbilityState.playerUnits[0].stats.atk === 23 && enemyAbilityState.playerUnits[1].stats.atk === 18,
  "An enemy Rollcaster Ability targeting all_enemies must affect the player's Critters; ownership must never restrict an Ability to its own side.",
);
check(
  enemyAbilityState.playerUnits[0].stats.def === 25 && enemyAbilityState.opponentUnits[0].stats.atk === 24,
  "Enemy Rollcaster targeting must follow only the authored target selector and must not leak across sides.",
);

const mechCoreCatalog = makeCatalog();
mechCoreCatalog.elements.push(
  { id: "mechanical", name: "Mechanical", description: null, asset_path: null, sort_order: 3 },
  { id: "thunder", name: "Thunder", description: null, asset_path: null, sort_order: 4 },
);
mechCoreCatalog.elementEffectiveness = mechCoreCatalog.elements.flatMap((attacking) =>
  mechCoreCatalog.elements.map((defending) => ({ attacking_element_id: attacking.id, defending_element_id: defending.id, multiplier: 1 })),
);
mechCoreCatalog.critters = mechCoreCatalog.critters.map((critter) => (
  critter.id === "p1" ? { ...critter, element_1_id: "mechanical" }
    : critter.id === "p2" ? { ...critter, element_1_id: "thunder", element_2_id: null }
      : critter
));
mechCoreCatalog.effectsByRelic["mech-core"] = [
  effect("relic", "mech-core", "healthy-heart", "shield_modifier", {
    target: "equipped_critter",
    operation: "grant",
    shield_value: 10,
    can_stack: false,
    replace_existing_shield: false,
    source_element_ids: ["mechanical"],
  }),
  {
    ...effect("relic", "mech-core", "power-surge", "stat_modifier", {
      target: "equipped_critter",
      stat: "atk",
      value_mode: "percentage",
      amount: 0.1,
      source_element_ids: ["mechanical", "thunder"],
    }),
    runtimeVersion: 2,
    classification: "positive",
    execution: "root",
  },
];
const mechCorePlayer = makePlayer();
mechCorePlayer.relicSlots = [
  { user_critter_id: "up1", slot_index: 1, relic_id: "mech-core" },
  { user_critter_id: "up2", slot_index: 1, relic_id: "mech-core" },
];
const mechCoreBattle = battle(mechCoreCatalog, mechCorePlayer, "mech-core");
check(mechCoreBattle.playerUnits[0].shield === 10, "Mech Core must grant exactly 10 Shield to a Mechanical Critter at encounter setup.");
check(mechCoreBattle.playerUnits[0].stats.atk === 28, "Mech Core must grant a rounded 10% ATK boost to a Mechanical Critter.");
check(mechCoreBattle.playerUnits[1].shield === 0 && mechCoreBattle.playerUnits[1].stats.atk === 22, "Mech Core must boost a Thunder Critter's ATK without granting it the Mechanical-only Shield.");
const mechCoreExistingShield = refreshSetupRuntimeEffects({
  ...mechCoreBattle,
  playerUnits: mechCoreBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, shield: 15, maxShield: 15 } : unit),
}, { applyRootShields: true });
check(mechCoreExistingShield.playerUnits[0].shield === 15, "A non-stacking Shield grant must not reduce an existing Shield of 10 or more.");
const mechCorePartialShield = refreshSetupRuntimeEffects({
  ...mechCoreBattle,
  playerUnits: mechCoreBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, shield: 6, maxShield: 6 } : unit),
}, { applyRootShields: true });
check(mechCorePartialShield.playerUnits[0].shield === 10, "A non-stacking Shield grant must raise a smaller existing Shield to its authored value.");
const mechCoreSwappedOut = refreshSetupRuntimeEffects({
  ...mechCoreBattle,
  playerUnits: mechCoreBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, active: false, shield: 0, maxShield: 0 } : unit),
});
const mechCoreSwappedBack = refreshSetupRuntimeEffects({
  ...mechCoreSwappedOut,
  playerUnits: mechCoreSwappedOut.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, active: true } : unit),
});
check(mechCoreSwappedBack.playerUnits[0].shield === 0, "A Shield Relic must not reapply when its Critter is swapped back in during the same encounter.");
const mechRun = {
  id: "mech-run",
  dungeonId: "d",
  dungeonVersion: 1,
  effectiveMode: "regular",
  battleFormat: "2v2",
  battleCount: 1,
  battleIndex: 0,
  selectedOpponents: mechCoreCatalog.dungeonOpponents.map((opponent, index) => ({
    ...opponent,
    instanceId: `mech-opponent-${index}`,
    battleIndex: 0,
    battlefieldSlot: index + 1,
  })),
  selectedEnemyEncounters: [{
    battleIndex: 0,
    enemyRollcaster: {
      id: "eclipse-test", dungeon_id: "d", sequence_index: 0, name: "Acolyte Test", eclipse_order_type: "acolyte",
      asset_path: "eclipse-order/001-acolyte-1.png", selection_weight: 1, policy_key: "random_action_v1", policy_revision: 1,
      policy_artifact_id: null, ability_ids: [], dialogue_lines: [], currencyDrops: [], itemDrops: [],
    },
    entryLine: { id: "entry", enemy_rollcaster_id: "eclipse-test", moment: "entry", line_text: "Face the Order.", sequence_index: 0 },
    victoryLine: { id: "victory", enemy_rollcaster_id: "eclipse-test", moment: "victory", line_text: "Your squad falls.", sequence_index: 0 },
    defeatLine: { id: "defeat", enemy_rollcaster_id: "eclipse-test", moment: "defeat", line_text: "This is not over.", sequence_index: 0 },
    squadMemberInstanceIds: ["mech-opponent-0", "mech-opponent-1"],
  }],
  randomSeed: "mech-run-seed",
  randomCursor: 0,
  status: "started",
  version: 1,
  rewards: {},
} as DungeonRunSnapshot;
const mechDungeonState = createDungeonRunState(mechCoreCatalog, mechCorePlayer, mechCoreCatalog.dungeons[0], mechRun);
check(mechDungeonState.battle.playerUnits.every((unit) => unit.shield === 0), "Dungeon lead selection must not apply a Shield before the encounter starts.");
const confirmedMechDungeon = confirmDungeonLeads({ ...mechDungeonState, selectedLeadIds: ["up1", "up2"] });
check(confirmedMechDungeon.battle.playerUnits[0].shield === 10 && confirmedMechDungeon.battle.playerUnits[1].shield === 0, "Dungeon encounter start must apply Mech Core only to the selected Mechanical lead.");
check(confirmedMechDungeon.phase === "entry_dialogue" && currentDungeonDialogue(confirmedMechDungeon)?.line === "Face the Order.", "Entry dialogue must gate the first Mana roll after lead selection.");
check(continueDungeonDialogue(confirmedMechDungeon).phase === "await_roll", "Clicking through a fully displayed Entry line must start the encounter.");

const carryCatalog = structuredClone(mechCoreCatalog);
carryCatalog.effectsByStatus.aura = [{
  ...effect(
    "status",
    "aura",
    "carry-atk",
    "stat_modifier",
    { stat: "atk", value_mode: "flat", amount: 5, chance: 1, application_mode: "single_application", target: "status_holder" },
  ),
  runtimeVersion: 2,
  execution: "root",
}];
const carryRun = {
  ...mechRun,
  id: "carry-run",
  battleCount: 2,
  selectedOpponents: mechRun.selectedOpponents.map((opponent) => ({ ...opponent, battleIndex: 0 })),
};
const carryRunState = createDungeonRunState(carryCatalog, mechCorePlayer, carryCatalog.dungeons[0], carryRun);
const confirmedCarryRun = confirmDungeonLeads({ ...carryRunState, selectedLeadIds: ["up1", "up2"] });
const carryBattle = simApplyStatus(
  simApplyStatus(
    { ...confirmedCarryRun.battle, playerUnits: confirmedCarryRun.battle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 77 } : unit) },
    "finite",
    "p1",
    3,
  ),
  "aura",
  "p1",
  null,
);
const nextCarryRun = {
  ...carryRun,
  battleIndex: 1,
  selectedOpponents: carryRun.selectedOpponents.map((opponent) => ({ ...opponent, battleIndex: 1 })),
};
const carriedDungeon = applyDungeonBattleResult(
  { ...confirmedCarryRun, run: carryRun, battle: carryBattle },
  {
    run: nextCarryRun,
    battleRewards: { entries: [], defeatedOpponentInstanceIds: [], critterXp: {}, rollcasterXp: 0 },
  },
  carryCatalog,
  mechCorePlayer,
);
check(
  carriedDungeon.phase === "encounter_rewards"
    && carriedDungeon.battle.playerUnits.find((unit) => unit.key === "p1")?.hp === 77
    && carriedDungeon.battle.statuses.some((status) => status.holderKey === "p1" && status.statusId === "finite" && status.duration === 3)
    && carriedDungeon.battle.statuses.some((status) => status.holderKey === "p1" && status.statusId === "aura" && status.duration === null)
    && carriedDungeon.battle.playerUnits.find((unit) => unit.key === "p1")?.stats.atk === 33,
  "Dungeon encounters must carry surviving finite and indefinite Statuses, their current HP, and their attached modifiers into the next encounter.",
);

const levelUpCatalog = structuredClone(mechCoreCatalog);
levelUpCatalog.critterProgression = [
  {
    critter_id: "p1", level: 1, total_required_xp: 0, grant_skill_points: 0,
    hp_delta: 0, atk_delta: 0, def_delta: 0, spd_delta: 0, dice_min_delta: 0, dice_max_delta: 0,
    block_cost_delta: 0, swap_cost_delta: 0, total_unlocked_relic_slots: 1,
  },
  {
    critter_id: "p1", level: 2, total_required_xp: 100, grant_skill_points: 1,
    hp_delta: 25, atk_delta: 3, def_delta: 2, spd_delta: 1, dice_min_delta: 0, dice_max_delta: 1,
    block_cost_delta: 0, swap_cost_delta: 0, total_unlocked_relic_slots: 1,
  },
];
const levelUpPlayer = makePlayer();
levelUpPlayer.critters = levelUpPlayer.critters.map((owned) => owned.id === "up1" ? { ...owned, xp: 90 } : owned);
const levelUpRun = {
  ...mechRun,
  id: "level-up-run",
  battleCount: 2,
  selectedOpponents: mechRun.selectedOpponents.map((opponent) => ({ ...opponent, battleIndex: 0 })),
};
const levelUpState = createDungeonRunState(levelUpCatalog, levelUpPlayer, levelUpCatalog.dungeons[0], levelUpRun);
const levelUpStateWithDamage = {
  ...levelUpState,
  battle: {
    ...levelUpState.battle,
    playerUnits: levelUpState.battle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 77 } : unit),
  },
};
const levelUpPlayerAfterRewards = applyDungeonXpRewards(
  levelUpPlayer,
  { critterXp: { up1: 10 }, rollcasterXp: 0 },
  levelUpCatalog.critterProgression,
  levelUpCatalog.rollcasterProgression,
);
const levelUpNextRun = {
  ...levelUpRun,
  battleIndex: 1,
  selectedOpponents: levelUpRun.selectedOpponents.map((opponent) => ({ ...opponent, battleIndex: 1 })),
};
const levelUpNextEncounter = applyDungeonBattleResult(
  levelUpStateWithDamage,
  {
    run: levelUpNextRun,
    battleRewards: { entries: [], defeatedOpponentInstanceIds: [], critterXp: { up1: 10 }, rollcasterXp: 0 },
  },
  levelUpCatalog,
  levelUpPlayerAfterRewards,
);
const leveledUnit = levelUpNextEncounter.battle.playerUnits.find((unit) => unit.key === "p1");
check(
  leveledUnit?.level === 2
    && leveledUnit.baseStats.hp === 125
    && leveledUnit.stats.hp === 125
    && leveledUnit.maxHp === 125
    && leveledUnit.hp === 77,
  "A Critter that levels up after an encounter must keep its new level and level-derived base stats in the next encounter while preserving current HP.",
);
const enemyDefeatedDialogue = { ...confirmedMechDungeon, phase: "outcome_dialogue" as const, dialogueMoment: "defeat" as const };
check(currentDungeonDialogue(enemyDefeatedDialogue)?.line === "This is not over." && continueDungeonDialogue(enemyDefeatedDialogue).phase === "battle_result", "A user victory must show the enemy Defeat line before encounter results.");
const enemyVictoryDialogue = { ...confirmedMechDungeon, phase: "outcome_dialogue" as const, dialogueMoment: "victory" as const };
check(currentDungeonDialogue(enemyVictoryDialogue)?.line === "Your squad falls.", "A user defeat must show the enemy Victor line.");
const noOutcomeDialogue = {
  ...confirmedMechDungeon,
  run: {
    ...confirmedMechDungeon.run,
    selectedEnemyEncounters: confirmedMechDungeon.run.selectedEnemyEncounters?.map((encounter) => ({
      ...encounter,
      victoryLine: null,
      defeatLine: null,
    })),
  },
};
check(outcomePhaseForBattle(noOutcomeDialogue, "defeat").phase === "battle_result", "An encounter without authored outcome dialogue must skip the extra Continue step.");
const opponentReserve = { ...confirmedMechDungeon.battle.opponentUnits[1], key: "opponent-reserve", active: false, battlefieldSlot: null };
const opponentAfterKnockout = confirmedMechDungeon.battle.opponentUnits
  .map((unit, index) => index === 0 ? { ...unit, hp: 0 } : unit)
  .concat(opponentReserve);
const forcedEnemyReplacement = advanceDungeonEvent({
  ...confirmedMechDungeon,
  phase: "event_playback",
  pendingBattle: { ...confirmedMechDungeon.battle, opponentUnits: opponentAfterKnockout },
  events: [],
  eventCursor: -1,
});
check(
  forcedEnemyReplacement.phase === "event_playback"
    && forcedEnemyReplacement.dialogueMoment === null
    && currentDungeonDialogue(forcedEnemyReplacement) === null
    && forcedEnemyReplacement.events[0]?.message === "Acolyte Test sent out Opponent Two.",
  "An automatic enemy replacement must use named send-out narration without replaying the enemy entry line.",
);
const revealedForcedEnemyReplacement = revealDungeonSwapEvent(forcedEnemyReplacement);
check(
  revealedForcedEnemyReplacement.battle.opponentUnits.find((unit) => unit.key === "opponent-reserve")?.active
    && revealedForcedEnemyReplacement.battle.opponentUnits.find((unit) => unit.key === "opponent-reserve")?.battlefieldSlot === 0,
  "A healthy enemy reserve must automatically replace a knocked-out active Critter in the vacated battlefield slot.",
);
const confirmedPlayerReplacement = confirmDungeonLeads({
  ...confirmedMechDungeon,
  phase: "forced_replacements",
  requiredLeadCount: 2,
  selectedLeadIds: ["up1", "up3"],
  fixedLeadIds: ["up1"],
  dialogueMoment: null,
  battle: {
    ...confirmedMechDungeon.battle,
    playerUnits: confirmedMechDungeon.battle.playerUnits.map((unit) => unit.key === "p2" ? { ...unit, hp: 0 } : unit),
  },
});
check(
  confirmedPlayerReplacement.phase === "event_playback"
    && confirmedPlayerReplacement.dialogueMoment === null
    && currentDungeonDialogue(confirmedPlayerReplacement) === null
    && confirmedPlayerReplacement.events[0]?.message === "You sent in Player Three.",
  "Confirming a knocked-out player's replacement must use send-in narration without replaying the enemy entry line.",
);
const cappedDiceCatalog = makeCatalog();
cappedDiceCatalog.effectsByAbility["capped-dice"] = [
  effect("ability", "capped-dice", "capped-dice", "mana_dice_modifier", { minimum_delta: 10, maximum_delta: 0, target: "all_friendlies" }),
];
cappedDiceCatalog.rollcasterAbilities.push({ id: "capped-dice", name: "Capped Dice", description: "Capped Dice.", sort_order: 4 });
const cappedDicePlayer = makePlayer();
cappedDicePlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "capped-dice" }];
const cappedDiceBattle = battle(cappedDiceCatalog, cappedDicePlayer, "capped-dice");
check(
  cappedDiceBattle.playerUnits.slice(0, 2).every((unit) => unit.stats.diceMin === unit.stats.diceMax)
    && cappedDiceBattle.playerUnits[0].stats.diceMin === 4
    && cappedDiceBattle.playerUnits[1].stats.diceMin === 3,
  "A Mana minimum boost above the maximum must cap the minimum at the maximum for every affected Critter.",
);
check(rollManaDie(10, 4, () => 0) === 4, "Combat die rolls must also cap an over-maximum minimum instead of raising the maximum.");
const passiveSwapSlot = passive.playerUnits[0].battlefieldSlot;
passive = takeTurn(passive, [{ actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }]);
check(passive.playerUnits[0].maxHp === 110 && passive.playerUnits[1].stats.atk === 23, "Equipped Relic stat effects must remain sourced from the equipped Critter after it leaves active play.");
check(passive.playerUnits[2].stats.def === 24, "Active Rollcaster Ability effects must recompute for the Critter entering an active slot.");
const passiveSwapEvent = passive.presentationEvents.find((event) => event.kind === "swap" && event.actorKey === "p1");
check(
  passiveSwapEvent?.swap?.outgoingKey === "p1"
    && passiveSwapEvent.swap.incomingKey === "p3"
    && passiveSwapEvent.swap.battlefieldSlot === passiveSwapSlot
    && passiveSwapEvent.message === "You sent in Player Three.",
  "Swap presentation must identify the outgoing Critter, incoming Critter, preserved battlefield slot, and send-in narration.",
);
passive = takeTurn(passive, [{ actorKey: "p3", type: "swap", swapToId: "up1", cost: 4 }]);
check(
  passive.playerUnits[0].maxHp === 110
    && passive.playerUnits[0].stats.def === 28
    && passive.playerUnits[1].stats.atk === 23,
  "Returning to an equipped Critter must restore its setup stats exactly once rather than stacking another copy.",
);
const swapPlaybackBefore = {
  ...battle(passiveCatalog, passivePlayer, "swap-playback"),
  phase: "selecting" as const,
  playerMana: 50,
  opponentMana: 0,
};
const swapPlaybackResolved = resolveTurn(
  swapPlaybackBefore,
  [{ actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }],
);
const swapPlaybackEvents = swapPlaybackResolved.presentationEvents.map((event, index) => ({
  ...event,
  id: `swap-playback:${index}`,
  turn: 1,
  phase: "resolution",
  requiresAdvance: true,
}));
check(
  swapPlaybackEvents[0]?.kind === "swap" && swapPlaybackEvents.length > 1,
  "The staged Swap regression requires a Swap followed by another combat event.",
);
const swapPlayback = {
  phase: "event_playback",
  battle: swapPlaybackBefore,
  pendingBattle: swapPlaybackResolved,
  events: swapPlaybackEvents,
  eventCursor: 0,
} as unknown as DungeonRunState;
check(
  swapPlayback.battle.playerUnits.find((unit) => unit.key === "p1")?.active
    && !swapPlayback.battle.playerUnits.find((unit) => unit.key === "p3")?.active,
  "Swap playback must begin with the outgoing Critter visible and the incoming Critter benched.",
);
const revealedSwapPlayback = revealDungeonSwapEvent(swapPlayback);
check(
  !revealedSwapPlayback.battle.playerUnits.find((unit) => unit.key === "p1")?.active
    && revealedSwapPlayback.battle.playerUnits.find((unit) => unit.key === "p3")?.active
    && revealedSwapPlayback.battle.playerUnits.find((unit) => unit.key === "p3")?.battlefieldSlot === passiveSwapSlot,
  "Revealing the Swap event must place the incoming Critter and its recomputed information in the outgoing battlefield slot.",
);
const advancedSwapPlayback = advanceDungeonEvent(swapPlayback);
check(
  advancedSwapPlayback.eventCursor === 1
    && !advancedSwapPlayback.battle.playerUnits.find((unit) => unit.key === "p1")?.active
    && advancedSwapPlayback.battle.playerUnits.find((unit) => unit.key === "p3")?.active,
  "Advancing to a later combat event must commit the Swap first, even if the visual reveal helper was not called.",
);
const legacySwapPlayback = {
  ...swapPlayback,
  events: swapPlayback.events.map((event, index) => index === 0 ? { ...event, swap: undefined } : event),
};
const legacySwapEvent = currentDungeonEvent(legacySwapPlayback);
check(
  legacySwapEvent?.swap?.outgoingKey === "p1"
    && legacySwapEvent.swap.incomingKey === "p3"
    && legacySwapEvent.swap.battlefieldSlot === passiveSwapSlot,
  "Restored pre-animation Swap events must reconstruct their handoff metadata for backward-compatible playback.",
);

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

const revivalCatalog = makeCatalog();
revivalCatalog.effectsBySkill.mark = [
  effect("skill", "mark", "second-wind", "critter_revival", {
    target: "target_friendlies",
    value_mode: "percent_max_hp",
    amount: 0.5,
    chance: 1,
  }),
];
let revivalBattle = battle(revivalCatalog, makePlayer(), "revival-percent");
revivalBattle = {
  ...revivalBattle,
  playerUnits: revivalBattle.playerUnits.map((unit) => unit.key === "p3" ? { ...unit, hp: 0 } : unit),
};
check(
  skillTargets(revivalBattle, "p1", revivalBattle.playerUnits[0].skills.find((skill) => skill.id === "mark")!)
    .some((unit) => unit.key === "p3"),
  "A single-target revival Skill must expose knocked-out friendly bench Critters as legal targets.",
);
const revived = takeTurn(revivalBattle, [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p3", cost: 2 }]);
check(
  revived.playerUnits.find((unit) => unit.key === "p3")?.hp === 45
    && revived.playerUnits.find((unit) => unit.key === "p3")?.active === false,
  "Percentage revival must restore the configured maximum-HP percentage without forcing a benched Critter active.",
);
check(
  revived.presentationEvents.some((event) => event.kind === "heal" && event.targetKeys.includes("p3") && event.hpChanges.some((change) => change.before === 0 && change.after === 45)),
  "Revival must publish a visible HP-change presentation event.",
);

const flatRevivalCatalog = makeCatalog();
flatRevivalCatalog.effectsBySkill.mark = [
  effect("skill", "mark", "flat-revive", "critter_revival", {
    target: "target_friendlies",
    value_mode: "flat",
    amount: 17,
    chance: 1,
  }),
];
let flatRevivalBattle = battle(flatRevivalCatalog, makePlayer(), "revival-flat");
flatRevivalBattle = {
  ...flatRevivalBattle,
  playerUnits: flatRevivalBattle.playerUnits.map((unit) => unit.key === "p2" ? { ...unit, hp: 0 } : unit),
};
const flatRevived = takeTurn(flatRevivalBattle, [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p2", cost: 2 }]);
check(flatRevived.playerUnits.find((unit) => unit.key === "p2")?.hp === 17, "Flat revival must restore exactly the authored HP amount.");

const failedRevivalCatalog = makeCatalog();
failedRevivalCatalog.effectsBySkill.mark = [
  effect("skill", "mark", "failed-revive", "critter_revival", {
    target: "target_friendlies",
    value_mode: "percent_max_hp",
    amount: 1,
    chance: 0,
  }),
];
let failedRevivalBattle = battle(failedRevivalCatalog, makePlayer(), "revival-failure");
failedRevivalBattle = {
  ...failedRevivalBattle,
  playerUnits: failedRevivalBattle.playerUnits.map((unit) => unit.key === "p2" ? { ...unit, hp: 0 } : unit),
};
const failedRevival = takeTurn(failedRevivalBattle, [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p2", cost: 2 }]);
check(failedRevival.playerUnits.find((unit) => unit.key === "p2")?.hp === 0, "A failed revival chance roll must leave the target knocked out.");

const rechargeCatalog = makeCatalog();
rechargeCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "recharge", "skill_usage_restriction", {
    recharge_chance: 1,
    recharge_turns: 1,
    usage_limit: null,
    usage_limit_scope: "encounter",
  }),
];
let recharging = takeTurn(battle(rechargeCatalog, makePlayer(), "skill-recharge"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(isActorRecharging(recharging, "p1") && recharging.turn === 2, "A one-turn recharge must lock the Skill user on the following turn.");
const hpBeforeRecharge = recharging.opponentUnits[0].hp;
recharging = takeTurn(recharging, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }], 10);
check(
  recharging.opponentUnits[0].hp === hpBeforeRecharge
    && recharging.playerMana === 10
    && recharging.presentationEvents.some((event) => event.message.includes("must recharge")),
  "A recharging Critter must be forced to wait without spending Mana even if a stale action submits a Skill.",
);
check(!isActorRecharging(recharging, "p1") && recharging.turn === 3, "Recharge must expire after exactly the configured number of following turns.");

const encounterLimitCatalog = makeCatalog();
encounterLimitCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "encounter-limit", "skill_usage_restriction", {
    recharge_chance: 0,
    recharge_turns: 0,
    usage_limit: 1,
    usage_limit_scope: "encounter",
  }),
];
let encounterLimited = takeTurn(battle(encounterLimitCatalog, makePlayer(), "encounter-limit"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(
  !skillAvailability(encounterLimited, "p1", "ritual").valid
    && skillAvailability(encounterLimited, "p1", "ritual").reason === "Encounter use limit reached.",
  "An exhausted encounter use cap must make the Skill invalid with a player-facing reason.",
);
const encounterUseCount = encounterLimited.skillUsage.encounter["p1:ritual"];
encounterLimited = takeTurn(encounterLimited, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(encounterLimited.skillUsage.encounter["p1:ritual"] === encounterUseCount, "A forged use of an exhausted Skill must not increment usage or resolve the Skill again.");

const dungeonLimitCatalog = makeCatalog();
dungeonLimitCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "dungeon-limit", "skill_usage_restriction", {
    recharge_chance: 0,
    recharge_turns: 0,
    usage_limit: 2,
    usage_limit_scope: "dungeon",
  }),
];
const firstDungeonUse = takeTurn(battle(dungeonLimitCatalog, makePlayer(), "dungeon-limit-1"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
let nextEncounter = battle(dungeonLimitCatalog, makePlayer(), "dungeon-limit-2");
nextEncounter = {
  ...nextEncounter,
  skillUsage: { encounter: {}, dungeon: { ...firstDungeonUse.skillUsage.dungeon } },
};
check(
  skillAvailability(nextEncounter, "p1", "ritual").valid
    && skillAvailability(nextEncounter, "p1", "ritual").remainingUses === 1,
  "Dungeon use counts must remain applicable after encounter counters reset.",
);
nextEncounter = takeTurn(nextEncounter, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(
  !skillAvailability(nextEncounter, "p1", "ritual").valid
    && skillAvailability(nextEncounter, "p1", "ritual").reason === "Dungeon use limit reached.",
  "A Dungeon-scoped cap must disable the Skill after its final use across encounters.",
);

const selfCostCatalog = makeCatalog();
selfCostCatalog.effectsBySkill.strike = [
  effect("skill", "strike", "quick-retreat", "action_cost_modifier", {
    applicable_action: "swaps",
    cost_type: "swap",
    modifier_type: "flat",
    modifier_value: -1,
    target: "self",
  }),
];
const selfCostApplied = takeTurn(
  battle(selfCostCatalog, makePlayer(), "self-action-cost"),
  [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }],
);
check(
  selfCostApplied.runtimeEffects.some((instance) => instance.sourceEffectId === "quick-retreat" && instance.targetCritterKey === "p1")
    && calculateActionCost(selfCostApplied, { actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }) === 3
    && calculateActionCost(selfCostApplied, { actorKey: "p2", type: "swap", swapToId: "up3", cost: 4 }) === 4,
  "A self-targeted Skill action-cost modifier must bind to its user rather than the Skill's selected defender.",
);

const filteredCostCatalog = makeCatalog();
filteredCostCatalog.effectsBySkill.strike = [
  effect("skill", "strike", "basic-attacks", "action_cost_modifier", {
    applicable_action: "skills_attack",
    skill_element_ids: ["basic"],
    modifier_type: "flat",
    modifier_value: -1,
    minimum_cost: 1,
    target: "self",
  }),
  effect("skill", "strike", "basic-support", "action_cost_modifier", {
    applicable_action: "skills_support",
    skill_element_ids: ["basic"],
    modifier_type: "flat",
    modifier_value: -1,
    minimum_cost: 0,
    target: "self",
  }, 1),
  effect("skill", "strike", "bloom-attacks", "action_cost_modifier", {
    applicable_action: "skills_attack",
    skill_element_ids: ["bloom"],
    modifier_type: "flat",
    modifier_value: -1,
    minimum_cost: 0,
    target: "self",
  }, 2),
];
const filteredCostState = battle(filteredCostCatalog, makePlayer(), "filtered-action-cost");
filteredCostState.playerUnits = filteredCostState.playerUnits.map((unit) => unit.key === "p1"
  ? { ...unit, skills: [...unit.skills, { ...unit.skills[0], id: "bloom-strike", name: "Bloom Strike", element_id: "bloom", mana_cost: 4 }] }
  : unit);
const filteredCostApplied = takeTurn(
  filteredCostState,
  [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }],
);
check(
  calculateActionCost(filteredCostApplied, { actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }) === 4
    && calculateActionCost(filteredCostApplied, { actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p1", cost: 2 }) === 1
    && calculateActionCost(filteredCostApplied, { actorKey: "p1", type: "skill", skillId: "bloom-strike", targetKey: "o1", cost: 4 }) === 3
    && calculateActionCost(filteredCostApplied, { actorKey: "p1", type: "skill", skillId: "wave", cost: 0 }) === 0
    && calculateActionCost(filteredCostApplied, { actorKey: "p1", type: "block", cost: 3 }) === 3,
  "Action Cost Modifier must match Skill action category and Skill Element without affecting other Skill categories or Block.",
);

const basicOpeningCatalog = makeCatalog();
basicOpeningCatalog.rollcasterAbilities.push({ id: "false-opening", name: "False Opening", description: "False Opening.", sort_order: 4 });
basicOpeningCatalog.effectsByAbility["false-opening"] = [
  effect("ability", "false-opening", "familiar-rhythm", "action_cost_modifier", {
    applicable_action: "skills_all", skill_element_ids: ["basic"], modifier_type: "flat",
    modifier_value: -1, minimum_cost: 0, maximum_cost: null, target: "all_enemies",
    target_element_ids: ["basic"],
  }),
  effect("ability", "false-opening", "open-guard", "stat_modifier", {
    stat: "def", value_mode: "percentage", amount: -0.1, target: "all_enemies",
    target_element_ids: ["basic"],
  }, 1),
];
const basicOpeningPlayer = makePlayer();
basicOpeningPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "false-opening" }];
const basicOpeningState = battle(basicOpeningCatalog, basicOpeningPlayer, "basic-opening");
basicOpeningState.opponentUnits = basicOpeningState.opponentUnits.map((unit) => ({
  ...unit,
  skills: [...unit.skills, basicOpeningCatalog.skills[0], { ...basicOpeningCatalog.skills[0], id: "bloom-strike", element_id: "bloom", mana_cost: 4 }],
}));
check(
  basicOpeningState.opponentUnits[0].stats.def < 25
    && basicOpeningState.opponentUnits[1].stats.def === 20
    && calculateActionCost(basicOpeningState, { actorKey: "o1", type: "skill", skillId: "strike", targetKey: "p1", cost: 5 }) === 4
    && calculateActionCost(basicOpeningState, { actorKey: "o1", type: "skill", skillId: "wave", targetKey: "p1", cost: 0 }) === 0
    && calculateActionCost(basicOpeningState, { actorKey: "o1", type: "skill", skillId: "bloom-strike", targetKey: "p1", cost: 4 }) === 4
    && calculateActionCost(basicOpeningState, { actorKey: "o2", type: "skill", skillId: "strike", targetKey: "p1", cost: 5 }) === 5,
  "A Basic-targeting Ability must modify DEF and Basic Skill costs only for Basic enemy Critters, while respecting a zero minimum cost.",
);

const forestTotemCatalog = makeCatalog();
forestTotemCatalog.effectsByRelic.carrier = [
  effect("relic", "carrier", "forest-discount", "action_cost_modifier", {
    applicable_action: "skills_all", skill_element_ids: ["bloom"], modifier_type: "flat",
    modifier_value: -2, minimum_cost: 1, maximum_cost: null, target: "equipped_critter",
  }),
];
const forestTotemPlayer = makePlayer();
forestTotemPlayer.relicSlots = [{ user_critter_id: "up2", slot_index: 1, relic_id: "carrier" }];
const forestTotemState = battle(forestTotemCatalog, forestTotemPlayer, "forest-minimum");
forestTotemState.playerUnits = forestTotemState.playerUnits.map((unit) => unit.key === "p2"
  ? { ...unit, skills: [...unit.skills, { ...unit.skills[0], id: "bloom-strike", element_id: "bloom", mana_cost: 2 }] }
  : unit);
check(
  calculateActionCost(forestTotemState, { actorKey: "p2", type: "skill", skillId: "bloom-strike", targetKey: "o1", cost: 2 }) === 1,
  "Forest Totem-style Skill discounts must honor the authored minimum cost after applying their flat modifier.",
);

const stackingCatalog = makeCatalog();
stackingCatalog.effectsBySkill.ritual = [
  {
    ...effect("skill", "ritual", "stacking-glare", "stat_modifier", { stat: "def", value_mode: "percentage", amount: -0.1, chance: 1, target: "all_enemies" }),
    classification: "positive",
  },
  effect("skill", "ritual", "tiny-buff", "stat_modifier", { stat: "atk", value_mode: "percentage", amount: 0.01, chance: 1, target: "self" }, 1),
  effect("skill", "ritual", "tiny-debuff", "stat_modifier", { stat: "spd", value_mode: "percentage", amount: -0.01, chance: 1, target: "self" }, 2),
];
let stacked = takeTurn(battle(stackingCatalog, makePlayer(), "stacking-percentages"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(
  stacked.opponentUnits[0].stats.def === 22
    && stacked.playerUnits[0].stats.atk === 26
    && stacked.playerUnits[0].stats.spd === 29,
  "Percentage modifiers must round from their unchanged reference stat and apply a signed one-point minimum for nonzero sub-one changes.",
);
stacked = takeTurn(stacked, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
const stackedGlareRows = combatEffectSummaries(stacked, stacked.opponentUnits[0].key)
  .filter((row) => row.sourceOwnerType === "skill" && row.sourceOwnerId === "ritual" && row.amountLabel?.includes("DEF"));
check(
  stacked.opponentUnits[0].stats.def === 19
    && stacked.playerUnits[0].stats.atk === 27
    && stacked.playerUnits[0].stats.spd === 28,
  "Repeated percentage modifiers must reuse the pre-temporary-effect stat instead of shrinking against the current modified value.",
);
check(
  stackedGlareRows.length === 1 && stackedGlareRows[0].amountLabel === "−6 DEF",
  "Repeated modifiers from the same Skill and stat must appear as one accumulated tooltip total.",
);
check(
  stackedGlareRows[0].classification === "negative",
  "A negative resolved DEF delta must render as a negative combat effect even when its source classification is positive for the effect owner.",
);
check(
  stacked.presentationEvents.some((event) => event.message === "The enemy Opponent One lost −3 DEF from Ritual."),
  "Each repeated percentage application must narrate the exact base-referenced amount applied on that turn.",
);

const costPolarityCatalog = makeCatalog();
costPolarityCatalog.effectsBySkill.ritual = [
  {
    ...effect("skill", "ritual", "block-discount", "stat_modifier", { stat: "block_cost", value_mode: "flat", amount: -1, target: "self" }),
    runtimeVersion: 2,
    classification: "negative",
  },
  {
    ...effect("skill", "ritual", "swap-surcharge", "stat_modifier", { stat: "swap_cost", value_mode: "flat", amount: 1, target: "self" }, 1),
    runtimeVersion: 2,
    classification: "positive",
  },
  {
    ...effect("skill", "ritual", "skill-discount", "action_cost_modifier", { applicable_action: "skills_all", modifier_type: "flat", modifier_value: -2, minimum_cost: null, maximum_cost: null, target: "self" }, 2),
    classification: "negative",
  },
  {
    ...effect("skill", "ritual", "skill-surcharge", "action_cost_modifier", { applicable_action: "skills_all", modifier_type: "flat", modifier_value: 1, minimum_cost: null, maximum_cost: null, target: "self" }, 3),
    classification: "positive",
  },
];
const costPolarityState = takeTurn(battle(costPolarityCatalog, makePlayer(), "cost-polarity"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
const costPolarityRows = combatEffectSummaries(costPolarityState, "p1");
check(
  costPolarityRows.some((row) => row.amountLabel === "−1 BLOCK COST" && row.classification === "positive")
    && costPolarityRows.some((row) => row.amountLabel === "+1 SWAP COST" && row.classification === "negative")
    && costPolarityRows.some((row) => row.name === "skill-discount" && row.classification === "positive")
    && costPolarityRows.some((row) => row.name === "skill-surcharge" && row.classification === "negative"),
  `Cost modifiers must invert numeric polarity for combat effect colors: ${JSON.stringify(costPolarityRows)}`,
);

const temporarySwapCatalog = makeCatalog();
temporarySwapCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "temporary-defense", "stat_modifier", { stat: "def", value_mode: "flat", amount: 5, chance: 1, target: "self" }),
];
let temporarySwap = takeTurn(battle(temporarySwapCatalog, makePlayer(), "temporary-swap"), [
  { actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 },
]);
check(temporarySwap.playerUnits[0].stats.def === 30, "A Skill stat modifier must apply to its active Critter.");
temporarySwap = takeTurn(temporarySwap, [{ actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }]);
check(
  temporarySwap.playerUnits[0].stats.def === 25
    && !temporarySwap.modifiers.some((modifier) => modifier.holderKey === "p1"),
  "Skill stat modifiers must be removed when their Critter swaps out.",
);
temporarySwap = takeTurn(temporarySwap, [{ actorKey: "p3", type: "swap", swapToId: "up1", cost: 4 }]);
check(temporarySwap.playerUnits[0].stats.def === 25, "A swapped-out Skill stat modifier must not return when the Critter comes back in.");

const temporaryKnockoutCatalog = makeCatalog();
temporaryKnockoutCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "temporary-enemy-defense", "stat_modifier", { stat: "def", value_mode: "flat", amount: 5, chance: 1, target: "all_enemies" }),
];
let temporaryKnockout = takeTurn(battle(temporaryKnockoutCatalog, makePlayer(), "temporary-knockout"), [
  { actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 },
]);
temporaryKnockout = {
  ...temporaryKnockout,
  opponentUnits: temporaryKnockout.opponentUnits.map((unit) => unit.key === "o1" ? { ...unit, hp: 1 } : unit),
};
temporaryKnockout = takeTurn(temporaryKnockout, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }]);
const knockedOutOpponent = temporaryKnockout.opponentUnits.find((unit) => unit.key === "o1")!;
const knockoutDamageEvent = temporaryKnockout.presentationEvents.find((event) => event.kind === "damage" && event.targetKeys.includes("o1"));
check(
  knockedOutOpponent.hp === 0
    && knockedOutOpponent.stats.def === 25
    && !temporaryKnockout.modifiers.some((modifier) => modifier.holderKey === "o1")
    && !knockoutDamageEvent?.state?.modifiers.some((modifier) => modifier.holderKey === "o1"),
  "Stat modifiers must be removed immediately when a Critter is knocked out, including the damage presentation snapshot.",
);
check(
  temporaryKnockout.turnEvents.filter((event) => event.target_critter_id === "o1" && ["knock_out_critters", "critter_knocked_out"].includes(event.event_type)).map((event) => event.event_type).join(",") === "critter_knocked_out",
  "A knocked-out opponent must emit exactly one normalized knockout progress event.",
);

const debuffCatalog = makeCatalog();
debuffCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "menace", "stat_modifier", { stat: "def", value_mode: "percentage", amount: -0.2, chance: 1, target: "all_enemies" }),
];
const debuffBefore = battle(debuffCatalog, makePlayer(), "debuff-playback");
const debuffResolved = takeTurn(debuffBefore, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
const debuffEvents = debuffResolved.presentationEvents.map((event, index) => ({
  ...event,
  id: `debuff:${index}`,
  turn: 1,
  phase: "resolution",
  requiresAdvance: true,
}));
const debuffSkillEventIndex = debuffEvents.findIndex((event) => event.kind === "skill" && event.skillId === "ritual");
const firstDebuffEvent = debuffEvents[debuffSkillEventIndex + 1];
const secondDebuffEvent = debuffEvents[debuffSkillEventIndex + 2];
const firstDebuffAmount = firstDebuffEvent?.message.match(/lost −(\d+) DEF from Ritual\./)?.[1];
const secondDebuffAmount = secondDebuffEvent?.message.match(/lost −(\d+) DEF from Ritual\./)?.[1];
check(
  debuffEvents[debuffSkillEventIndex]?.message === "Your Player One used Ritual!"
    && firstDebuffEvent?.message.startsWith("The enemy Opponent One lost −")
    && secondDebuffEvent?.message.startsWith("The enemy Opponent Two lost −")
    && Boolean(firstDebuffAmount)
    && Boolean(secondDebuffAmount),
  `Multi-target stat effects must narrate each exact stat delta using the Skill name, not the internal effect name. Received: ${JSON.stringify(debuffEvents.map((event) => event.message))}`,
);
check(
  firstDebuffEvent?.state?.modifiers.length === 1
    && secondDebuffEvent?.state?.modifiers.length === 2,
  "Each multi-target effect event must snapshot only the effects that have triggered by that playback step.",
);
let debuffPlayback = {
  ...swapPlayback,
  battle: debuffBefore,
  pendingBattle: debuffResolved,
  events: debuffEvents,
  eventCursor: debuffSkillEventIndex,
} as unknown as DungeonRunState;
debuffPlayback = advanceDungeonEvent(debuffPlayback);
check(
  currentDungeonEvent(debuffPlayback)?.message === firstDebuffEvent.message
    && combatEffectSummaries(debuffPlayback.battle, firstDebuffEvent.targetKeys[0]).some((row) => row.amountLabel === `−${firstDebuffAmount} DEF` && row.sourceOwnerId === "ritual")
    && combatEffectSummaries(debuffPlayback.battle, secondDebuffEvent.targetKeys[0]).length === 0,
  `The first target's tooltip data must become visible on its narration event before the next target's effect triggers. First: ${JSON.stringify(combatEffectSummaries(debuffPlayback.battle, firstDebuffEvent.targetKeys[0]))}; second: ${JSON.stringify(combatEffectSummaries(debuffPlayback.battle, secondDebuffEvent.targetKeys[0]))}`,
);
debuffPlayback = advanceDungeonEvent(debuffPlayback);
check(
  currentDungeonEvent(debuffPlayback)?.message === secondDebuffEvent.message
    && combatEffectSummaries(debuffPlayback.battle, secondDebuffEvent.targetKeys[0]).some((row) => row.amountLabel === `−${secondDebuffAmount} DEF` && row.sourceOwnerId === "ritual"),
  "Advancing playback must expose the second target's effect on its own narration event.",
);

const statusCatalog = makeCatalog();
statusCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "finite-apply", "apply_status", { status_id: "finite", chance: 1, target: "self", indefinite: false, turns: 3 }),
];
let finite = takeTurn(battle(statusCatalog, makePlayer(), "finite-status"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(finite.statuses.length === 1 && finite.statuses[0].duration === 2, "Finite Status duration must come from its application and decrement after the application turn.");
const instanceId = finite.statuses[0].instanceId;
finite = takeTurn(finite, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(finite.statuses[0].instanceId === instanceId && finite.statuses[0].duration === 1, "Reapplying a Status must reject the duplicate without duplicating or refreshing the icon-bearing instance.");

const indefiniteCatalog = makeCatalog();
indefiniteCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "indefinite", "apply_status", { status_id: "finite", chance: 1, target: "self", indefinite: true })];
const indefinite = takeTurn(battle(indefiniteCatalog, makePlayer(), "indefinite-status"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(indefinite.statuses[0].duration === null, "Indefinite Status applications must not synthesize a Status-owned duration.");

const selectedCatalog = makeCatalog();
selectedCatalog.effectsBySkill.wave = [effect("skill", "wave", "target-status", "apply_status", { status_id: "finite", chance: 1, target: "target_enemies", indefinite: false, turns: 3 })];
const selected = takeTurn(battle(selectedCatalog, makePlayer(), "target-enemies"), [{ actorKey: "p1", type: "skill", skillId: "wave", cost: 0 }]);
check(selected.statuses.length === 2 && selected.statuses.every((item) => item.holderKey.startsWith("o")), "target_enemies must use every active enemy slot selected by the Skill.");

const multiStatusCatalog = makeCatalog();
let multiStatusState = simApplyStatus(battle(multiStatusCatalog, makePlayer(), "multi-status"), "finite", "p1", 2);
multiStatusState = simApplyStatus(multiStatusState, "aura", "p1", 3);
check(
  multiStatusState.statuses.length === 2
    && multiStatusState.statuses.some((status) => status.statusId === "finite" && status.holderKey === "p1")
    && multiStatusState.statuses.some((status) => status.statusId === "aura" && status.holderKey === "p1"),
  "A Critter may carry multiple different Statuses at the same time.",
);
multiStatusState = simApplyStatus(multiStatusState, "finite", "p1", 4);
check(
  multiStatusState.statuses.length === 2
    && multiStatusState.statuses.find((status) => status.statusId === "finite")?.duration === 2,
  "A duplicate Status application must not create or refresh a second instance.",
);
multiStatusCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "cure-current-status", "effect_removal", {
    target: "self", removal_category: "statuses", maximum_effects_removed: 1, selection_method: "oldest", specific_effect_id: "", prevent_reapplication: false,
  }, 0),
  effect("skill", "ritual", "apply-after-cure", "apply_status", { status_id: "aura", chance: 1, target: "self", indefinite: false, turns: 3 }, 1),
];
let curedThenAfflicted = simApplyStatus(battle(multiStatusCatalog, makePlayer(), "cure-then-afflict"), "finite", "p1", 3);
curedThenAfflicted = takeTurn(curedThenAfflicted, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(
  curedThenAfflicted.statuses.length === 1 && curedThenAfflicted.statuses[0].statusId === "aura",
  "A Status applied later in the same turn must succeed when an earlier Effect has already cured the target.",
);
check(
  curedThenAfflicted.presentationEvents.some((event) => event.message === "Your Player One was cured of Finite.")
    && curedThenAfflicted.presentationEvents.some((event) => event.message.includes("Aura from Ritual")),
  "Status cures and later same-turn applications must each receive ordered narration.",
);

const duplicateSkillCatalog = makeCatalog();
duplicateSkillCatalog.effectsBySkill.strike = [effect(
  "skill",
  "strike",
  "duplicate-finite",
  "apply_status",
  { status_id: "finite", chance: 1, target: "targets", indefinite: false, turns: 3 },
)];
let duplicateSkillState = takeTurn(
  battle(duplicateSkillCatalog, makePlayer(), "duplicate-status-skill"),
  [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 0 }],
  50,
);
const duplicateTargetHp = duplicateSkillState.opponentUnits[0].hp;
const duplicateDuration = duplicateSkillState.statuses.find((status) => status.statusId === "finite")?.duration;
duplicateSkillState = takeTurn(startTurn(duplicateSkillState), [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 0 }], 50);
check(
    duplicateSkillState.opponentUnits[0].hp === duplicateTargetHp
    && duplicateSkillState.statuses.length === 1
    && duplicateSkillState.statuses[0].duration === Number(duplicateDuration) - 1
    && duplicateSkillState.presentationEvents.some((event) => event.message.includes("already afflicted with Finite") && event.message.includes("Strike failed"))
    && !duplicateSkillState.turnEvents.some((event) => event.event_type === "skill_resolved" && event.skill_id === "strike"),
  "A Skill that cannot apply its duplicate Status must fail atomically without dealing damage or refreshing the Status.",
);

const freshDifferentStatusCatalog = makeCatalog();
freshDifferentStatusCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "apply-finite", "apply_status", { status_id: "finite", chance: 1, target: "self", indefinite: false, turns: 3 }),
  effect("skill", "ritual", "apply-aura", "apply_status", { status_id: "aura", chance: 1, target: "self", indefinite: true, turns: 0 }, 1),
];
const freshDifferentStatus = takeTurn(
  battle(freshDifferentStatusCatalog, makePlayer(), "fresh-different-status"),
  [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }],
  50,
);
check(
  freshDifferentStatus.statuses.length === 2
    && freshDifferentStatus.turnEvents.filter((event) => event.event_type === "status_afflicted" && event.payload?.fresh === true).length === 2,
  "A Critter with one Status must receive a fresh affliction event when a different Status is added.",
);

const selectedSideCatalog = makeCatalog();
selectedSideCatalog.effectsBySkill.mark = [
  effect("skill", "mark", "selected-ally", "stat_modifier", { stat: "def", value_mode: "flat", amount: 3, chance: 1, target: "selected_ally" }, 0),
  effect("skill", "mark", "selected-enemy", "stat_modifier", { stat: "atk", value_mode: "flat", amount: -4, chance: 1, target: "selected_enemy" }, 1),
];
const selectedAlly = takeTurn(battle(selectedSideCatalog, makePlayer(), "selected-ally"), [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p2", cost: 2 }]);
check(selectedAlly.playerUnits[1].stats.def === 23 && selectedAlly.opponentUnits[0].stats.atk === 24, "selected_ally must resolve only when the chosen slot contains an ally.");
const selectedEnemy = takeTurn(battle(selectedSideCatalog, makePlayer(), "selected-enemy"), [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: "o1", cost: 2 }]);
check(selectedEnemy.opponentUnits[0].stats.atk === 20 && selectedEnemy.playerUnits[1].stats.def === 20, "selected_enemy must resolve only when the chosen slot contains an enemy.");

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
const ritualSkillEventIndex = healing.presentationEvents.findIndex((event) => event.kind === "skill" && event.actorKey === "p1" && event.skillId === "ritual");
const ritualHealEventIndexes = healing.presentationEvents
  .map((event, index) => event.kind === "heal" && event.actorKey === "p1" ? index : -1)
  .filter((index) => index >= 0);
check(
  ritualSkillEventIndex >= 0
    && ritualHealEventIndexes.length >= 2
    && ritualHealEventIndexes.every((index) => index > ritualSkillEventIndex)
    && healing.presentationEvents.filter((event) => event.kind === "heal" && event.actorKey === "p1").every((event) => event.message.includes("gained") && event.message.includes("HP from Ritual") && event.hpChanges.length === 1),
  "Healing Skills must stage the user animation before numeric healing messages and per-target HP changes.",
);
const beforeVampire = healing.playerUnits[0].hp;
healing = takeTurn(healing, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }]);
check(healing.playerUnits[0].hp === beforeVampire + 3, "percent_damage_done healing must use the Skill's actual final damage and half-up percentage rounding.");
const vampireKinds = healing.presentationEvents
  .filter((event) => event.actorKey === "p1")
  .map((event) => event.kind)
  .join(",");
check(
  vampireKinds.includes("skill,damage,heal"),
  "Damage-drain Skills must present skill use, damage, and healing in that order.",
);

const draconovaCatalog = makeCatalog();
const draconova = { ...draconovaCatalog.skills[0], id: "draconova", name: "Draconova", power: 100, mana_cost: 0 };
draconovaCatalog.skills = [...draconovaCatalog.skills, draconova];
const draconovaPlayer = makePlayer();
draconovaPlayer.skillSlots = draconovaPlayer.skillSlots.map((slot) => (
  slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: "draconova" } : slot
));
draconovaCatalog.effectsBySkill.draconova = [{
  ...effect("skill", "draconova", "expended-energy", "direct_health_modifier", {
    target: "self",
    operation: "lose_hp",
    value_type: "percent_damage_dealt",
    value: 0.15,
    activation_chance: 1,
    can_defeat_target: false,
    affected_by_shield: false,
    affected_by_healing_modifiers: false,
    overhealing_behavior: "discard",
    overheal_effect_ids: [],
  }),
  name: "Expended Energy",
}];
let draconovaBattle = battle(draconovaCatalog, draconovaPlayer, "draconova-recoil");
draconovaBattle = {
  ...draconovaBattle,
  playerUnits: draconovaBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 80 } : unit),
  opponentUnits: draconovaBattle.opponentUnits.map((unit) => unit.key === "o1" ? { ...unit, shield: 100, maxShield: 100 } : unit),
};
const draconovaResult = takeTurn(draconovaBattle, [{ actorKey: "p1", type: "skill", skillId: "draconova", targetKey: "o1", cost: 0 }]);
const draconovaImpact = draconovaResult.presentationEvents.find((event) => event.kind === "damage" && event.targetKeys.includes("o1"));
const draconovaDamage = 100 - draconovaResult.opponentUnits[0].shield;
const draconovaRecoil = 80 - draconovaResult.playerUnits[0].hp;
const draconovaRecoilEvent = draconovaResult.presentationEvents.find((event) => event.kind === "damage" && event.targetKeys.includes("p1") && event.message.includes("Expended Energy"));
check(draconovaDamage > 0 && draconovaRecoil === roundHalfUp(draconovaDamage * 0.15), "Draconova recoil must use 15% of actual HP or Shield damage dealt.");
check(
  Boolean(draconovaImpact) && Boolean(draconovaRecoilEvent)
    && draconovaResult.presentationEvents.indexOf(draconovaRecoilEvent!) > draconovaResult.presentationEvents.indexOf(draconovaImpact!)
    && draconovaRecoilEvent!.message === `Your Player One lost ${draconovaRecoil} health from Expended Energy.`,
  "Direct health recoil must animate and narrate the user after the attack impact.",
);
draconovaCatalog.effectsBySkill.draconova[0].parameters.activation_chance = 0;
let noDraconovaRecoilBattle = battle(draconovaCatalog, draconovaPlayer, "draconova-no-recoil");
noDraconovaRecoilBattle = {
  ...noDraconovaRecoilBattle,
  playerUnits: noDraconovaRecoilBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 80 } : unit),
};
const noDraconovaRecoil = takeTurn(noDraconovaRecoilBattle, [{ actorKey: "p1", type: "skill", skillId: "draconova", targetKey: "o1", cost: 0 }]);
check(noDraconovaRecoil.playerUnits[0].hp === 80, "A Direct Health Modifier with zero activation chance must not activate.");

const stimCatalog = makeCatalog();
stimCatalog.relics.push({ id: "stim", name: "Stim Shot", description: "Healing amplifier.", max_owned: 1, asset_path: null, sort_order: 10 });
stimCatalog.effectsByRelic.stim = [effect("relic", "stim", "health-booster", "effect_amplification", {
  target: "equipped_critter",
  affected_effect_category: "healing",
  direction: "received",
  modifier_type: "percentage",
  modifier_value: 0.2,
  duration_type: "while_relic_equipped",
  duration_clock: "target_turn",
  duration_value: null,
})];
stimCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "stim-heal", "restore_hp", { value_mode: "percent_max_hp", amount: 0.1, chance: 1, target: "self" })];
const stimPlayer = makePlayer();
stimPlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "stim" }];
let stimulated = battle(stimCatalog, stimPlayer, "stim-healing");
stimulated = {
  ...stimulated,
  playerUnits: stimulated.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, maxHp: 48, hp: 30, stats: { ...unit.stats, hp: 48 }, baseStats: { ...unit.baseStats, hp: 48 } } : unit),
};
stimulated = takeTurn(stimulated, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(stimulated.playerUnits[0].hp === 36, "Stim Shot must round the 4.8 HP base heal to 5, then boost 5 by 20% to 6.");
check(stimulated.turnEvents.some((event) => event.event_type === "hp_healed" && event.amount === 6 && event.target_critter_id === "p1"), "Heal HP Challenge progress must use amplified, actually restored HP.");

const unamplified = takeTurn({ ...stimulated, runtimeEffects: [], playerUnits: stimulated.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 30 } : unit) }, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(unamplified.playerUnits[0].hp === 35, "Base 10% healing from 48 max HP must round to 5 before any amplifier is applied.");

const medicCatalog = makeCatalog();
medicCatalog.rollcasterAbilities.push({ id: "battle-medic", name: "Battle Medic I", description: "Heal after an enemy knockout.", sort_order: 10 });
medicCatalog.effectsByAbility["battle-medic"] = [
  { ...effect("ability", "battle-medic", "medic-heal", "direct_health_modifier", {
    value: 0.05,
    target: "all_friendlies",
    operation: "heal",
    value_type: "percent_max_hp",
    can_defeat_target: false,
    affected_by_shield: false,
    affected_by_healing_modifiers: true,
    overhealing_behavior: "discard",
    overheal_effect_ids: [],
  }), execution: "child" },
  effect("ability", "battle-medic", "medic-trigger", "reactive_trigger", {
    target: "all_friendlies",
    trigger_event: "owner_defeats_enemy",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "per_target_battle",
    requires_hp_damage: false,
    requires_shield_damage: false,
    child_effect_ids: ["medic-heal"],
  }, 1),
];
const medicPlayer = makePlayer();
medicPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "battle-medic" }];
let medicBattle = battle(medicCatalog, medicPlayer, "battle-medic");
medicBattle = {
  ...medicBattle,
  playerUnits: medicBattle.playerUnits.map((unit) => ({ ...unit, hp: unit.key === "p1" ? 50 : unit.key === "p2" ? 40 : unit.hp })),
  opponentUnits: medicBattle.opponentUnits.map((unit) => unit.key === "o1" ? { ...unit, hp: 1 } : unit),
};
const medicResult = takeTurn(medicBattle, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }]);
check(medicResult.playerUnits[0].hp === 55 && medicResult.playerUnits[1].hp === 44, "Battle Medic I must heal every living active friendly for 5% max HP after an enemy knockout.");
const medicEvent = medicResult.presentationEvents.find((event) => event.kind === "heal" && event.message.includes("Battle Medic I"));
check(Boolean(medicEvent) && medicEvent!.targetKeys.length === 2 && medicEvent!.hpChanges.length === 2, "Battle Medic I must animate all healed friendlies in one staged presentation event.");
check(medicEvent?.message === "Your Player One healed 5 HP and your Player Two healed 4 HP from Battle Medic I.", "Battle Medic I must narrate every Critter's actual healed HP in one message.");

const battleMedicVCatalog = makeCatalog();
battleMedicVCatalog.statuses.push(
  { id: "mana-boost", name: "Mana Boost", description: "Mana Boost.", asset_path: null, sort_order: 10, version: 1, classification: "positive" },
  { id: "toxic", name: "Toxic", description: "Toxic.", asset_path: null, sort_order: 11, version: 1, classification: "negative" },
);
battleMedicVCatalog.rollcasterAbilities.push({ id: "battle-medic-5", name: "Battle Medic V", description: "Cure Negative Statuses.", sort_order: 14 });
battleMedicVCatalog.effectsByAbility["battle-medic-5"] = [
  { ...effect("ability", "battle-medic-5", "cure-negative-statuses", "effect_removal", {
    target: "all_friendlies",
    removal_category: "statuses",
    maximum_effects_removed_mode: "all",
    selection_method: "oldest",
    status_classification: "negative",
    specific_effect_id: "",
    prevent_reapplication: false,
  }), execution: "child" },
  effect("ability", "battle-medic-5", "battle-medic-v-trigger", "reactive_trigger", {
    target: "all_friendlies",
    trigger_event: "turn_start",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "turn",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["cure-negative-statuses"],
  }, 1),
];
const battleMedicVPlayer = makePlayer();
battleMedicVPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "battle-medic-5" }];
let battleMedicVBattle = battle(battleMedicVCatalog, battleMedicVPlayer, "battle-medic-v");
battleMedicVBattle = simApplyStatus(battleMedicVBattle, "toxic", "p1", null);
battleMedicVBattle = simApplyStatus(battleMedicVBattle, "mana-boost", "p1", null);
battleMedicVBattle = simApplyStatus(battleMedicVBattle, "toxic", "p2", null);
battleMedicVBattle = simApplyStatus(battleMedicVBattle, "toxic", "o1", null);
const battleMedicVStarted = startTurn(battleMedicVBattle);
check(
  battleMedicVStarted.statuses.some((status) => status.statusId === "mana-boost" && status.holderKey === "p1")
    && !battleMedicVStarted.statuses.some((status) => status.statusId === "toxic" && ["p1", "p2"].includes(status.holderKey))
    && battleMedicVStarted.statuses.some((status) => status.statusId === "toxic" && status.holderKey === "o1"),
  "Battle Medic V must remove every Negative Status from friendly Critters at turn start while leaving Positive and enemy Statuses untouched.",
);
const battleMedicVNext = startTurn(simApplyStatus(battleMedicVStarted, "toxic", "p1", null));
check(!battleMedicVNext.statuses.some((status) => status.statusId === "toxic" && status.holderKey === "p1"), "Battle Medic V must repeat its Negative Status cleanse at the start of each later turn.");

let smallMedicBattle = battle(medicCatalog, medicPlayer, "battle-medic-small-heal");
smallMedicBattle = {
  ...smallMedicBattle,
  playerUnits: smallMedicBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, maxHp: 48, hp: 30, stats: { ...unit.stats, hp: 48 }, baseStats: { ...unit.baseStats, hp: 48 } } : unit),
  opponentUnits: smallMedicBattle.opponentUnits.map((unit) => unit.key === "o1" ? { ...unit, hp: 1 } : unit),
};
const smallMedicResult = takeTurn(smallMedicBattle, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }]);
check(smallMedicResult.playerUnits[0].hp === 32, "Battle Medic must half-up round 48 max HP * 5% to 2 HP.");

const percentageRoundingCatalog = makeCatalog();
percentageRoundingCatalog.effectsBySkill.ritual = [
  effect("skill", "ritual", "three-point-three", "restore_hp", { value_mode: "percent_max_hp", amount: 0.033, chance: 1, target: "self" }, 0),
  effect("skill", "ritual", "four-point-five", "restore_hp", { value_mode: "percent_max_hp", amount: 0.045, chance: 1, target: "self" }, 1),
  effect("skill", "ritual", "less-than-one", "restore_hp", { value_mode: "percent_max_hp", amount: 0.003, chance: 1, target: "self" }, 2),
];
let percentageRoundingBattle = battle(percentageRoundingCatalog, makePlayer(), "healing-percentage-rounding");
percentageRoundingBattle = { ...percentageRoundingBattle, playerUnits: percentageRoundingBattle.playerUnits.map((unit) => unit.key === "p1" ? { ...unit, hp: 50 } : unit) };
const percentageRoundingResult = takeTurn(percentageRoundingBattle, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(percentageRoundingResult.playerUnits[0].hp === 59, "Healing percentages must round 3.3 to 3, 4.5 to 5, and any positive result below 1 to 1.");

medicCatalog.effectsBySkill.mark = [effect("skill", "mark", "effect-knockout", "direct_health_modifier", {
  value: 100,
  target: "selected_enemy",
  operation: "lose_hp",
  value_type: "flat",
  can_defeat_target: true,
  affected_by_shield: false,
})];
let effectKnockoutBattle = battle(medicCatalog, medicPlayer, "battle-medic-effect-knockout");
effectKnockoutBattle = {
  ...effectKnockoutBattle,
  playerUnits: effectKnockoutBattle.playerUnits.map((unit) => ({ ...unit, hp: unit.key === "p1" ? 50 : unit.key === "p2" ? 40 : unit.hp })),
  opponentUnits: effectKnockoutBattle.opponentUnits.map((unit) => unit.key === "o1" ? { ...unit, hp: 1 } : unit),
};
const effectKnockoutResult = takeTurn(effectKnockoutBattle, [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: "o1", cost: 2 }]);
check(
  effectKnockoutResult.playerUnits[0].hp === 55 && effectKnockoutResult.playerUnits[1].hp === 44,
  "Battle Medic I must also trigger when an enemy is knocked out by a Skill Effect instead of base attack damage.",
);

const dotCatalog = makeCatalog();
dotCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "apply-aura", "apply_status", { status_id: "aura", chance: 1, target: "self", indefinite: true })];
dotCatalog.effectsByStatus.aura = [
  effect("status", "aura", "holder-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 1, chance: 1, target: "status_holder" }, 0),
  effect("status", "aura", "allies-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 2, chance: 1, target: "status_holder_allies_without_holder" }, 1),
  effect("status", "aura", "friendlies-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 3, chance: 1, target: "status_holder_allies_with_holder" }, 2),
  effect("status", "aura", "enemies-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 4, chance: 1, target: "status_holder_enemies" }, 3),
  effect("status", "aura", "failed-dot", "damage_over_time", { timing: "end_of_turn", value_mode: "flat", amount: 50, chance: 0, target: "status_holder" }, 4),
];
let dotted = takeTurn(battle(dotCatalog, makePlayer(), "status-targets"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(dotted.playerUnits[0].hp === 96 && dotted.playerUnits[1].hp === 75, "Status holder, allies, and friendlies scopes must resolve relative to the active holder.");
check(dotted.opponentUnits[0].hp === 96 && dotted.opponentUnits[1].hp === 116, "status_holder_enemies must resolve every active enemy relative to the holder.");
const inactiveHolderHp = dotted.playerUnits.map((unit) => unit.hp);
dotted = takeTurn(dotted, [{ actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }]);
check(dotted.playerUnits.every((unit, index) => unit.hp === inactiveHolderHp[index]) && dotted.opponentUnits[0].hp === 96, "Status effects must stop triggering while their holder is inactive.");

const statusStatCatalog = makeCatalog();
statusStatCatalog.effectsByStatus.aura = [
  { ...effect("status", "aura", "status-atk", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 5, chance: 1, application_mode: "single_application", target: "status_holder" }), runtimeVersion: 2, classification: "negative", execution: "root" },
  { ...effect("status", "aura", "status-cost", "stat_modifier", { stat: "skill_cost", skill_scope: "attack", skill_element_ids: ["basic"], value_mode: "flat", amount: -2, chance: 1, application_mode: "single_application", target: "status_holder" }, 1), runtimeVersion: 2, classification: "positive", execution: "root" },
];
let statusStatState = simApplyStatus(battle(statusStatCatalog, makePlayer(), "status-static"), "aura", "p1", 1);
check(statusStatState.playerUnits[0].stats.atk === 30, "A Single Application Status Stat Modifier must apply its ATK change immediately.");
check(calculateActionCost(statusStatState, { actorKey: "p1", type: "skill", skillId: "strike", cost: 5 }) === 3, "A Status Skill Cost modifier must discount matching attack Skills and their selected Elements.");
statusStatState = takeTurn(statusStatState, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
check(statusStatState.playerUnits[0].stats.atk === 25 && statusStatState.statuses.length === 0, "Status Stat Modifiers must be removed when their finite Status expires.");

const manaDiceStatusCatalog = makeCatalog();
manaDiceStatusCatalog.effectsByStatus.aura = [{ ...effect("status", "aura", "mana-bounds", "stat_modifier", { stat: "mana_dice", minimum_amount: -1, maximum_amount: 2, value_mode: "flat", chance: 1, application_mode: "single_application", removal_behavior: "expire_on_removal", target: "status_holder" }), runtimeVersion: 2, classification: "negative", execution: "root" }];
let manaDiceStatusState = simApplyStatus(battle(manaDiceStatusCatalog, makePlayer(), "status-mana-dice"), "aura", "p1", 1);
check(manaDiceStatusState.playerUnits[0].stats.diceMin === 1 && manaDiceStatusState.playerUnits[0].stats.diceMax === 6, "A unified Status Mana Dice modifier must apply independent minimum and maximum deltas from one Effect.");
manaDiceStatusState = takeTurn(manaDiceStatusState, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
check(manaDiceStatusState.playerUnits[0].stats.diceMin === 2 && manaDiceStatusState.playerUnits[0].stats.diceMax === 4, "A unified Status Mana Dice modifier must expire both bound changes with the Status.");

let swappedStatusState = simApplyStatus(battle(statusStatCatalog, makePlayer(), "status-swap"), "aura", "p1", null);
swappedStatusState = takeTurn(swappedStatusState, [{ actorKey: "p1", type: "swap", swapToId: "up3", cost: 4 }], 10);
swappedStatusState = takeTurn(swappedStatusState, [{ actorKey: "p3", type: "swap", swapToId: "up1", cost: 4 }], 10);
check(swappedStatusState.playerUnits[0].stats.atk === 30, "A Status Stat Modifier must return when its holder swaps back into the active battlefield.");

const incrementalStatusCatalog = makeCatalog();
incrementalStatusCatalog.effectsByStatus.aura = [{ ...effect("status", "aura", "incremental-atk", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 2, chance: 1, application_mode: "incremental", timing: "start_of_turn", spacing: 2, removal_behavior: "expire_on_removal", target: "status_holder" }), runtimeVersion: 2, classification: "negative", execution: "root" }];
let incrementalStatusState = simApplyStatus(battle(incrementalStatusCatalog, makePlayer(), "status-incremental"), "aura", "p1", 3);
check(incrementalStatusState.playerUnits[0].stats.atk === 25, "An incremental Status Stat Modifier must not apply before its first scheduled timing.");
incrementalStatusState = takeTurn(incrementalStatusState, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
incrementalStatusState = startTurn(incrementalStatusState);
check(incrementalStatusState.playerUnits[0].stats.atk === 27, "Spacing 2 must apply an incremental Status Stat Modifier every other turn.");
const incrementalTriggerEvent = incrementalStatusState.presentationEvents.find((event) => event.kind === "status" && event.message.includes("ATK"));
const incrementalCountdownEvent = incrementalStatusState.presentationEvents.find((event) => event.kind === "status" && event.message.includes("turn") && event.message.includes("Aura"));
check(Boolean(incrementalTriggerEvent), "A start-of-turn Status stat change must emit a presentation event for text and animation playback.");
check(Boolean(incrementalCountdownEvent), "A finite start-of-turn Status checkup must narrate its remaining duration.");
check(
  incrementalStatusState.playerUnits[0].manaRoll > 0
    && Number(incrementalTriggerEvent?.state?.playerMana ?? 0) > 0,
  "Start-of-turn Status presentation must be staged after the turn's dice have rolled.",
);
const startPlaybackBattle = simApplyStatus(battle(incrementalStatusCatalog, makePlayer(), "status-start-playback"), "aura", "p1", 3);
const startPlaybackDungeon = {
  ...confirmedMechDungeon,
  battle: { ...startPlaybackBattle, statuses: startPlaybackBattle.statuses.map((status) => ({ ...status, turnsElapsed: 1 })), phase: "ready" as const },
  pendingBattle: null,
  phase: "await_roll" as const,
  rollSummary: null,
  events: [],
  eventCursor: -1,
} as DungeonRunState;
const rolledStatusDungeon = rollDungeonDice(startPlaybackDungeon);
check(
  rolledStatusDungeon.phase === "roll_result" && rolledStatusDungeon.pendingBattle !== null && rolledStatusDungeon.events.length >= 2,
  "The main game must retain start-of-turn Status events after showing the dice result.",
);
let playedStatusDungeon = continueAfterRoll(rolledStatusDungeon);
check(
  playedStatusDungeon.phase === "event_playback" && currentDungeonEvent(playedStatusDungeon)?.message.includes("Aura"),
  "Continuing after the dice result must enter Status narration playback before action selection.",
);
while (playedStatusDungeon.phase === "event_playback") playedStatusDungeon = advanceDungeonEvent(playedStatusDungeon);
check(playedStatusDungeon.phase === "select_player_actions", "Start-of-turn Status playback must return the main game to action selection.");

const retainedIncrementalCatalog = makeCatalog();
retainedIncrementalCatalog.effectsByStatus.aura = [{ ...effect("status", "aura", "retained-atk", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 2, chance: 1, application_mode: "incremental", timing: "end_of_turn", spacing: 1, removal_behavior: "keep_after_removal", target: "status_holder" }), runtimeVersion: 2, classification: "negative", execution: "root" }];
let retainedIncrementalState = simApplyStatus(battle(retainedIncrementalCatalog, makePlayer(), "status-retained"), "aura", "p1", 1);
retainedIncrementalState = takeTurn(retainedIncrementalState, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
check(retainedIncrementalState.statuses.length === 0 && retainedIncrementalState.playerUnits[0].stats.atk === 27, "Keep after Effect Removal must preserve accumulated incremental modifiers when the Status expires.");
const retainedSingleCatalog = makeCatalog();
retainedSingleCatalog.effectsByStatus.aura = [{ ...effect("status", "aura", "retained-single-atk", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 5, chance: 1, application_mode: "single_application", removal_behavior: "keep_after_removal", target: "status_holder" }), runtimeVersion: 2, classification: "negative", execution: "root" }];
retainedSingleCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "cleanse-status", "effect_removal", {
  target: "self", removal_category: "statuses", maximum_effects_removed: null, selection_method: "oldest", specific_effect_id: "", prevent_reapplication: false,
})];
let retainedSingleState = simApplyStatus(battle(retainedSingleCatalog, makePlayer(), "status-retained-single-expiry"), "aura", "p1", 1);
retainedSingleState = takeTurn(retainedSingleState, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
check(retainedSingleState.statuses.length === 0 && retainedSingleState.playerUnits[0].stats.atk === 30, "Keep after Effect Removal must preserve a Single Application modifier when the Status expires.");
retainedSingleState = simApplyStatus(battle(retainedSingleCatalog, makePlayer(), "status-retained-single-cleanse"), "aura", "p1", null);
retainedSingleState = takeTurn(retainedSingleState, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }], 10);
check(retainedSingleState.statuses.length === 0 && retainedSingleState.playerUnits[0].stats.atk === 30, "Keep after Effect Removal must preserve a Single Application modifier when the Status is cleansed.");
const expiredIncrementalCatalog = makeCatalog();
expiredIncrementalCatalog.effectsByStatus.aura = [{ ...effect("status", "aura", "expired-atk", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 2, chance: 1, application_mode: "incremental", timing: "end_of_turn", spacing: 1, removal_behavior: "expire_on_removal", target: "status_holder" }), runtimeVersion: 2, classification: "negative", execution: "root" }];
let expiredIncrementalState = simApplyStatus(battle(expiredIncrementalCatalog, makePlayer(), "status-expired"), "aura", "p1", 1);
expiredIncrementalState = takeTurn(expiredIncrementalState, [{ actorKey: "p1", type: "skip", cost: 0 }], 10);
check(expiredIncrementalState.statuses.length === 0 && expiredIncrementalState.playerUnits[0].stats.atk === 25, "Expire on Effect Removal must remove accumulated incremental modifiers when the Status expires.");

const skipCatalog = makeCatalog();
skipCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "apply-stun", "apply_status", { status_id: "stun", chance: 1, target: "self", indefinite: true })];
skipCatalog.effectsByStatus.stun = [effect("status", "stun", "skill-skip", "skip_action_chance", { chance: 1, combat_action: "skill", target: "status_holder" })];
let skipped = takeTurn(battle(skipCatalog, makePlayer(), "skip-refund"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }], 10);
skipped = takeTurn(skipped, [{ actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 5 }], 10);
check(skipped.playerMana === 5 && skipped.opponentUnits[0].hp === 100, "A skipped Skill must perform no damage and spend its reserved Mana after submission.");
const blocked = takeTurn(skipped, [{ actorKey: "p1", type: "block", cost: 3 }], 10);
check(blocked.playerMana === 7 && blocked.playerUnits[0].blocking, "A skill-only skip effect must not cancel a Block action.");

const allySkipCatalog = makeCatalog();
allySkipCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "apply-ally-stun", "apply_status", { status_id: "stun", chance: 1, target: "self", indefinite: true })];
allySkipCatalog.effectsByStatus.stun = [effect("status", "stun", "ally-skip", "skip_action_chance", { chance: 1, combat_action: "all", target: "status_holder_allies_without_holder" })];
let allySkipped = takeTurn(battle(allySkipCatalog, makePlayer(), "ally-skip"), [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }], 10);
allySkipped = takeTurn(allySkipped, [{ actorKey: "p2", type: "block", cost: 2 }], 10);
check(allySkipped.playerMana === 8 && !allySkipped.playerUnits[1].blocking, "Status skip targeting must resolve holder-relative recipients, cancel Swap/Block/Skill, and retain the submitted Mana cost.");

const slotCatalog = makeCatalog();
let slotted = battle(slotCatalog, makePlayer(), "slot-following");
slotted = takeTurn(slotted, [
  { actorKey: "p2", type: "swap", swapToId: "up3", cost: 4 },
  { actorKey: "p1", type: "skill", skillId: "mark", targetKey: "p2", cost: 2 },
]);
check(slotted.log.some((line) => line === "Your Player One used Mark on your Player Three."), "A selected target must follow its battlefield slot when a Swap resolves before the Skill.");

const frozenCatalog = makeCatalog();
frozenCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "frozen", "stat_modifier", { stat: "atk", value_mode: "flat", amount: 5, chance: 1, target: "self" })];
const frozen = battle(frozenCatalog, makePlayer(), "frozen");
frozenCatalog.effectsBySkill.ritual.length = 0;
const frozenResult = takeTurn(frozen, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }]);
check(frozenResult.playerUnits[0].stats.atk === 30, "An active combat must resolve its frozen inline-effect registry after mutable catalog data changes.");
check(
  combatEffectSummaries(frozenResult, "p1").some((row) => row.amountLabel === "+5 ATK" && row.sourceOwnerType === "skill" && row.sourceOwnerId === "ritual"),
  "Active-effect summaries must report the exact applied stat delta and its Skill source.",
);
check(JSON.stringify(frozen.snapshot) === JSON.stringify(battle(makeCatalogWithFrozenEffect(), makePlayer(), "frozen").snapshot), "Effect snapshots must be deterministic for an identical run and inline catalog.");

const weightedCatalog = makeCatalog();
const weightedChildOne = { ...effect("skill", "ritual", "weighted-one", "direct_health_modifier", {
  target: "self", operation: "lose_hp", value_type: "flat", value: 1,
  can_defeat_target: false, affected_by_shield: false, affected_by_healing_modifiers: false,
  overhealing_behavior: "discard",
}), execution: "child" as const, classification: "negative" as const };
const weightedChildTwo = { ...effect("skill", "ritual", "weighted-two", "direct_health_modifier", {
  target: "self", operation: "lose_hp", value_type: "flat", value: 2,
  can_defeat_target: false, affected_by_shield: false, affected_by_healing_modifiers: false,
  overhealing_behavior: "discard",
}, 1), execution: "child" as const, classification: "negative" as const };
const weightedParent = { ...effect("skill", "ritual", "weighted-parent", "weighted_child_selector", {
  outcome_rows: [
    { effect_id: weightedChildOne.id, probability: 0.5 },
    { effect_id: weightedChildTwo.id, probability: 0.5 },
  ],
}), execution: "root" as const, classification: "mixed" as const };
weightedCatalog.effectsBySkill.ritual = [weightedParent, weightedChildOne, weightedChildTwo];
const weightedLosses = new Set<number>();
for (let seed = 1; seed <= 256; seed += 1) {
  const state = { ...battle(weightedCatalog, makePlayer(), `weighted-${seed}`), rngState: seed };
  const result = takeTurn(state, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }], 10);
  weightedLosses.add(100 - result.playerUnits[0].hp);
}
check(weightedLosses.has(1) && weightedLosses.has(2), "Weighted Child Effect Selector must resolve both 50% child outcomes across deterministic rolls.");
check(!weightedLosses.has(3), "Weighted Child Effect Selector must resolve at most one child outcome per Skill use.");

const weightedNothingCatalog = structuredClone(weightedCatalog);
weightedNothingCatalog.effectsBySkill.ritual[0].parameters.outcome_rows = [
  { effect_id: weightedChildOne.id, probability: 0.4 },
  { effect_id: weightedChildTwo.id, probability: 0.4 },
  { effect_id: null, probability: 0.2 },
];
const weightedNothingLosses = new Set<number>();
for (let seed = 1; seed <= 256; seed += 1) {
  const state = { ...battle(weightedNothingCatalog, makePlayer(), `weighted-nothing-${seed}`), rngState: seed };
  const result = takeTurn(state, [{ actorKey: "p1", type: "skill", skillId: "ritual", cost: 0 }], 10);
  weightedNothingLosses.add(100 - result.playerUnits[0].hp);
}
check(weightedNothingLosses.has(0) && weightedNothingLosses.has(1) && weightedNothingLosses.has(2), "An explicit Nothing outcome must leave the Skill unchanged while other weighted rows still resolve.");

const weightedTargetCatalog = makeCatalog();
const weightedTargetChildOne = { ...weightedChildOne, id: "weighted-target-one", ownerId: "mark", parameters: { ...weightedChildOne.parameters, target: "targets" } };
const weightedTargetChildTwo = { ...weightedChildTwo, id: "weighted-target-two", ownerId: "mark", parameters: { ...weightedChildTwo.parameters, target: "targets" } };
const weightedTargetParent = { ...effect("skill", "mark", "weighted-target-parent", "weighted_child_selector", {
  target_element_ids: ["bloom", "aqua"],
  outcome_rows: [
    { effect_id: weightedTargetChildOne.id, probability: 0.5 },
    { effect_id: weightedTargetChildTwo.id, probability: 0.5 },
  ],
}), execution: "root" as const, classification: "mixed" as const };
weightedTargetCatalog.effectsBySkill.mark = [weightedTargetParent, weightedTargetChildOne, weightedTargetChildTwo];
const nonMatchingTargetState = battle(weightedTargetCatalog, makePlayer(), "weighted-target-nonmatch");
const nonMatchingTarget = nonMatchingTargetState.opponentUnits.find((unit) => unit.critter.id === "o1")!;
const nonMatchingTargetResult = takeTurn(nonMatchingTargetState, [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: nonMatchingTarget.key, cost: 2 }], 10);
check(nonMatchingTargetResult.opponentUnits.find((unit) => unit.key === nonMatchingTarget.key)?.hp === nonMatchingTarget.hp, "A weighted selector must not roll or resolve children when no selected Skill target matches its required Elements.");
const matchingTargetState = battle(weightedTargetCatalog, makePlayer(), "weighted-target-match");
const matchingTarget = matchingTargetState.opponentUnits.find((unit) => unit.critter.id === "o2")!;
const matchingTargetResult = takeTurn(matchingTargetState, [{ actorKey: "p1", type: "skill", skillId: "mark", targetKey: matchingTarget.key, cost: 2 }], 10);
const matchingTargetLoss = matchingTarget.hp - (matchingTargetResult.opponentUnits.find((unit) => unit.key === matchingTarget.key)?.hp ?? matchingTarget.hp);
check(matchingTargetLoss === 1 || matchingTargetLoss === 2, "A weighted selector must roll its children when a selected Skill target matches any required Element, including a dual-element target.");

const invalidWeighted = structuredClone(weightedParent);
invalidWeighted.parameters.outcome_rows = [{ effect_id: weightedChildOne.id, probability: 0.6 }, { effect_id: weightedChildTwo.id, probability: 0.5 }];
let invalidWeightedRejected = false;
try { battle({ ...weightedCatalog, effectsBySkill: { ...weightedCatalog.effectsBySkill, ritual: [invalidWeighted, weightedChildOne, weightedChildTwo] } }, makePlayer(), "invalid-weighted"); } catch { invalidWeightedRejected = true; }
check(invalidWeightedRejected, "Weighted Child Effect Selector probabilities above 100% must be rejected before combat.");

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

function delayedEffectCatalog(options: { timing?: "start_of_turn" | "end_of_turn"; allowMultiple?: boolean; delayType?: string; activationChance?: number } = {}) {
  const catalog = makeCatalog();
  const skill = { ...catalog.skills[0], id: "possessive-strike", name: "Possessive Strike", power: 1, mana_cost: 0, targeting: "single_enemy" as const };
  catalog.skills = [...catalog.skills, skill];
  const player = makePlayer();
  player.skillSlots = player.skillSlots.map((slot) => slot.user_critter_id === "up1" && slot.slot_index === 1 ? { ...slot, skill_id: skill.id } : slot);
  const child = { ...effect("skill", skill.id, "visionary-damage", "direct_health_modifier", {
    target: "targets", operation: "lose_hp", value_type: "percent_max_hp", value: 0.2,
    can_defeat_target: true, affected_by_shield: false, affected_by_healing_modifiers: false,
    overhealing_behavior: "discard", overheal_effect_ids: [],
  }), execution: "child" as const, classification: "negative" as const };
  const delayed = { ...effect("skill", skill.id, "visionary", "delayed_effect", {
    target: "targets", activation_chance: options.activationChance ?? 1, delay_type: options.delayType ?? "turns", delay_value: 3,
    delay_timing: options.timing ?? "end_of_turn", child_effect_ids: [child.id], target_tracking: "original",
    cancel_condition: "none", visible_countdown: true, repeat: false,
    allow_multiple_at_once: options.allowMultiple ?? false, trigger_description: "Visionary attacks!",
  }), classification: "negative" as const };
  catalog.effectsBySkill[skill.id] = [delayed, child];
  return { catalog, player, skill };
}

const delayedBase = delayedEffectCatalog({ allowMultiple: false });
const delayedInitial = battle(delayedBase.catalog, delayedBase.player, "delayed-end-inclusive");
const delayedTurnOne = takeTurn(delayedInitial, [{ actorKey: "p1", type: "skill", skillId: delayedBase.skill.id, targetKey: "o1", cost: 0 }], 10);
const delayedFirstTimer = delayedTurnOne.runtimeEffects.filter((instance) => instance.sourceEffectId === "visionary");
check(delayedFirstTimer.length === 1 && delayedFirstTimer[0]?.remaining === 2, "An end-of-turn delay of 3 must tick to 1/3 on the turn in which the target is hit.");
check(delayedTurnOne.presentationEvents.some((event) => event.message.includes("1/3 turns")), "Visible delayed countdowns must narrate the first end-of-turn tick.");
const delayedTurnTwo = takeTurn(delayedTurnOne, [{ actorKey: "p1", type: "skill", skillId: delayedBase.skill.id, targetKey: "o1", cost: 0 }], 10);
check(delayedTurnTwo.runtimeEffects.filter((instance) => instance.sourceEffectId === "visionary").length === 1, "Allow multiple at once must default to false and deduplicate a timer on one target.");
const delayedTurnThree = takeTurn(delayedTurnTwo, [{ actorKey: "p1", type: "skill", skillId: delayedBase.skill.id, targetKey: "o1", cost: 0 }], 10);
check(delayedTurnThree.presentationEvents.some((event) => event.message === "Visionary attacks!"), "The configured delayed description must display before the child Effect resolves.");
check(delayedTurnThree.presentationEvents.some((event) => event.kind === "damage" && event.targetKeys.includes("o1")), "A delayed child Effect must resolve against the originally hit target.");

const delayedNever = delayedEffectCatalog({ activationChance: 0 });
const neverInitial = battle(delayedNever.catalog, delayedNever.player, "delayed-zero-chance");
const neverTurn = takeTurn(neverInitial, [{ actorKey: "p1", type: "skill", skillId: delayedNever.skill.id, targetKey: "o1", cost: 0 }], 10);
check(!neverTurn.runtimeEffects.some((instance) => instance.sourceEffectId === "visionary"), "A delayed Effect with zero activation chance must not create a timer.");

const delayedMultiple = delayedEffectCatalog({ allowMultiple: true });
const multipleInitial = battle(delayedMultiple.catalog, delayedMultiple.player, "delayed-multiple");
const multipleTurnOne = takeTurn(multipleInitial, [{ actorKey: "p1", type: "skill", skillId: delayedMultiple.skill.id, targetKey: "o1", cost: 0 }], 10);
const multipleTurnTwo = takeTurn(multipleTurnOne, [{ actorKey: "p1", type: "skill", skillId: delayedMultiple.skill.id, targetKey: "o1", cost: 0 }], 10);
check(multipleTurnTwo.runtimeEffects.filter((instance) => instance.sourceEffectId === "visionary").length === 2, "Allow multiple at once must keep overlapping timers on one target.");

const delayedStart = delayedEffectCatalog({ timing: "start_of_turn" });
const startInitial = battle(delayedStart.catalog, delayedStart.player, "delayed-start-timing");
const startTurnOne = takeTurn(startInitial, [{ actorKey: "p1", type: "skill", skillId: delayedStart.skill.id, targetKey: "o1", cost: 0 }], 10);
check(!startTurnOne.presentationEvents.some((event) => event.message.includes("1/3 turns")), "A start-of-turn delayed timer must not tick at the end of its creation turn.");
const startTurnTwo = { ...startTurnOne, phase: "ready" as const };
const startTurnTwoStarted = startTurn(startTurnTwo);
check(startTurnTwoStarted.presentationEvents.some((event) => event.message.includes("1/3 turns")), "A start-of-turn delayed timer must tick when the next turn starts.");

const priorityCatalog = makeCatalog();
priorityCatalog.skills = priorityCatalog.skills.map((skill) => skill.id === "mark" ? { ...skill, priority: 6 } : skill);
const priorityState = battle(priorityCatalog, makePlayer(), "priority-order");
const priorityResult = takeTurn(priorityState, [
  { actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 0 },
  { actorKey: "p2", type: "skill", skillId: "mark", targetKey: "p1", cost: 0 },
], 10);
const prioritySkillEvents = priorityResult.presentationEvents.filter((event) => event.kind === "skill");
check(prioritySkillEvents[0]?.actorKey === "p2", "A higher-priority Skill must resolve before a lower-priority Skill regardless of Speed.");

const stunCatalog = makeCatalog();
stunCatalog.skills = stunCatalog.skills.map((skill) => skill.id === "mark" ? { ...skill, priority: 6 } : skill);
stunCatalog.effectsBySkill.mark = [effect("skill", "mark", "mark-stun", "stun_chance", { target: "targets", chance: 1 })];
const stunResult = takeTurn(battle(stunCatalog, makePlayer(), "stun-chance"), [
  { actorKey: "p1", type: "skill", skillId: "strike", targetKey: "o1", cost: 0 },
  { actorKey: "p2", type: "skill", skillId: "mark", targetKey: "p1", cost: 0 },
], 10);
check(stunResult.presentationEvents.some((event) => event.message === "Your Player One was Stunned and couldn't act!" && event.effectPolarity === "negative"), "A guaranteed Stun must replace an unacted Critter's Skill with the negative Stunned narration.");
check(!stunResult.presentationEvents.some((event) => event.kind === "skill" && event.actorKey === "p1"), "A Stunned Critter must not also narrate its normal Skill.");

const skillChanceCatalog = makeCatalog();
skillChanceCatalog.effectsBySkill.strike = [effect(
  "skill",
  "strike",
  "skill-seven-percent-stun",
  "stun_chance",
  { target: "targets", chance: 0.07 },
)];
const skillChanceHit = runPlayerSkill(skillChanceCatalog, makePlayer(), "skill-seven-percent-hit", "strike", 21);
const skillChanceHitEvent = stunEvents(skillChanceHit)[0];
check(skillChanceHitEvent?.payload.combined_chance === 0.07, "A direct Skill Stun Chance must preserve its authored 7% contribution.");
check(skillChanceHitEvent?.payload.contributing_effect_ids?.[0] === "skill-seven-percent-stun", "A direct Skill Stun activation must identify its contributing Skill Effect.");
const skillChanceMiss = runPlayerSkill(skillChanceCatalog, makePlayer(), "skill-seven-percent-miss", "strike", 1);
check(stunEvents(skillChanceMiss).length === 0, "A direct Skill Stun Chance must be able to miss its deterministic roll.");

const relicChanceCatalog = makeCatalog();
relicChanceCatalog.relics.push({ id: "daze-token", name: "Daze Token", description: "Daze Token.", max_owned: 1, asset_path: null, sort_order: 20 });
relicChanceCatalog.effectsByRelic["daze-token"] = [
  effect("relic", "daze-token", "daze-token-trigger", "reactive_trigger", {
    target: "equipped_critter",
    trigger_event: "owner_uses_attack_skill",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "battle",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["daze-token-stun"],
  }),
  {
    ...effect("relic", "daze-token", "daze-token-stun", "stun_chance", { target: "defender", chance: 0.07 }),
    execution: "child",
    classification: "negative",
  },
];
const relicChancePlayer = makePlayer();
relicChancePlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "daze-token" }];
const relicChanceHit = runPlayerSkill(relicChanceCatalog, relicChancePlayer, "relic-seven-percent-hit", "strike", 21);
const relicChanceHitEvent = stunEvents(relicChanceHit)[0];
check(relicChanceHitEvent?.payload.combined_chance === 0.07, "A Relic Reactive Trigger with 100% activation and a 7% Stun child must contribute exactly 7%.");
check(relicChanceHitEvent?.payload.contributing_effect_ids?.[0] === "daze-token-stun", "A Relic Stun activation must identify the child Stun Effect rather than the Reactive parent.");
check(relicChanceHit.rngState === skillChanceHit.rngState, "A Relic Reactive Stun child must consume one combined Stun roll, not separate parent and child rolls.");
const relicChanceMiss = runPlayerSkill(relicChanceCatalog, relicChancePlayer, "relic-seven-percent-miss", "strike", 1);
check(stunEvents(relicChanceMiss).length === 0, "A Relic Reactive Stun child must be able to miss its deterministic 7% roll.");
const relicSupportSkill = runPlayerSkill(relicChanceCatalog, relicChancePlayer, "relic-support-filter", "mark", 1);
check(stunEvents(relicSupportSkill).length === 0, "A Relic watching owner_uses_attack_skill must not Stun after a support Skill.");
const legacyRelicChanceCatalog = structuredClone(relicChanceCatalog);
legacyRelicChanceCatalog.effectsByRelic["daze-token"][0].parameters.activation_chance = 0.07;
legacyRelicChanceCatalog.effectsByRelic["daze-token"][1].parameters.chance = 1;
const legacyRelicChanceHit = runPlayerSkill(legacyRelicChanceCatalog, relicChancePlayer, "legacy-relic-seven-percent-hit", "strike", 21);
check(stunEvents(legacyRelicChanceHit)[0]?.payload.combined_chance === 0.07, "Legacy Relic Reactive Stun rows with a 7% parent and 100% child must remain readable and equivalent.");
check(legacyRelicChanceHit.rngState === relicChanceHit.rngState, "Legacy Relic parent-chance Stun rows must also consume one combined Stun roll.");

const abilityChanceCatalog = makeCatalog();
abilityChanceCatalog.rollcasterAbilities.push({ id: "attack-daze", name: "Attack Daze", description: "Attack Daze.", sort_order: 20 });
abilityChanceCatalog.effectsByAbility["attack-daze"] = [
  effect("ability", "attack-daze", "attack-daze-trigger", "reactive_trigger", {
    target: "all_friendlies",
    trigger_event: "owner_uses_attack_skill",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "battle",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["attack-daze-stun"],
  }),
  {
    ...effect("ability", "attack-daze", "attack-daze-stun", "stun_chance", { target: "defender", chance: 0.5 }),
    execution: "child",
    classification: "negative",
  },
];
const abilityChancePlayer = makePlayer();
abilityChancePlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "attack-daze" }];
const abilityChanceHit = runPlayerSkill(abilityChanceCatalog, abilityChancePlayer, "ability-fifty-percent-hit", "strike", 2);
const abilityChanceHitEvent = stunEvents(abilityChanceHit)[0];
check(abilityChanceHitEvent?.payload.combined_chance === 0.5, "An Ability Reactive Trigger with a 50% Stun child must contribute exactly 50%.");
check(abilityChanceHitEvent?.payload.contributing_effect_ids?.[0] === "attack-daze-stun", "An Ability Stun activation must identify the child Stun Effect rather than the Reactive parent.");
const abilitySupportSkill = runPlayerSkill(abilityChanceCatalog, abilityChancePlayer, "ability-support-filter", "mark", 2);
check(stunEvents(abilitySupportSkill).length === 0, "An Ability watching owner_uses_attack_skill must not Stun after a support Skill.");
const legacyAbilityChanceCatalog = structuredClone(abilityChanceCatalog);
legacyAbilityChanceCatalog.effectsByAbility["attack-daze"][0].parameters.activation_chance = 0.5;
legacyAbilityChanceCatalog.effectsByAbility["attack-daze"][1].parameters.chance = 1;
const legacyAbilityChanceHit = runPlayerSkill(legacyAbilityChanceCatalog, abilityChancePlayer, "legacy-ability-fifty-percent-hit", "strike", 2);
check(stunEvents(legacyAbilityChanceHit)[0]?.payload.combined_chance === 0.5, "Legacy Ability Reactive Stun rows with a 50% parent and 100% child must remain readable and equivalent.");
check(legacyAbilityChanceHit.rngState === abilityChanceHit.rngState, "Legacy Ability parent-chance Stun rows must also consume one combined Stun roll.");

const combinedStunCatalog = makeCatalog();
combinedStunCatalog.rollcasterAbilities.push({ id: "first-turn-daze", name: "First Turn Daze", description: "First Turn Daze.", sort_order: 20 });
combinedStunCatalog.relics.push({ id: "daze-token", name: "Daze Token", description: "Daze Token.", max_owned: 1, asset_path: null, sort_order: 20 });
combinedStunCatalog.effectsBySkill.strike = [
  effect("skill", "strike", "strike-base-stun", "stun_chance", { target: "targets", chance: 0.1 }),
];
combinedStunCatalog.effectsByAbility["first-turn-daze"] = [
  effect("ability", "first-turn-daze", "first-turn-trigger", "reactive_trigger", {
    target: "all_friendlies",
    trigger_event: "owner_uses_attack_skill",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "battle",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["first-turn-window"],
  }),
  {
    ...effect("ability", "first-turn-daze", "first-turn-window", "turn_restriction", {
      main_restriction: "child_effect_trigger",
      turn_restriction: "specific_active_turn",
      specific_turn: 1,
      minimum_turn: 1,
      maximum_turn: 1,
      child_effect_ids: ["first-turn-stun"],
    }),
    execution: "child",
  },
  {
    ...effect("ability", "first-turn-daze", "first-turn-stun", "stun_chance", { target: "defender", chance: 0.5 }),
    execution: "child",
    classification: "negative",
  },
];
combinedStunCatalog.effectsByRelic["daze-token"] = [
  effect("relic", "daze-token", "daze-trigger", "reactive_trigger", {
    target: "equipped_critter",
    trigger_event: "owner_uses_attack_skill",
    trigger_source: "self",
    activation_chance: 1,
    activation_limit: null,
    activation_limit_scope: "battle",
    cooldown_turns: 0,
    requires_hp_damage: false,
    requires_shield_damage: false,
    minimum_damage: null,
    child_effect_ids: ["daze-stun"],
  }),
  {
    ...effect("relic", "daze-token", "daze-stun", "stun_chance", { target: "defender", chance: 0.07 }),
    execution: "child",
    classification: "negative",
  },
];
const combinedStunPlayer = makePlayer();
combinedStunPlayer.abilitySlots = [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "first-turn-daze" }];
combinedStunPlayer.relicSlots = [{ user_critter_id: "up1", slot_index: 1, relic_id: "daze-token" }];
const combinedStunAction = [{ actorKey: "p1", type: "skill" as const, skillId: "strike", targetKey: "o1", cost: 0 }];
const combinedStunTurnOne = takeTurn(
  { ...startTurn({ ...battle(combinedStunCatalog, combinedStunPlayer, "combined-stun"), phase: "ready" }), rngState: 2 },
  combinedStunAction,
  50,
);
const combinedStunEvent = combinedStunTurnOne.turnEvents.find((event) => event.event_type === "stun_activated");
check(combinedStunEvent?.payload.combined_chance === 0.67, "Skill, Ability, and Relic Stun Chance contributions must combine additively into the expected 67% roll.");
const combinedContributors = new Set(combinedStunEvent?.payload.contributing_effect_ids as string[] | undefined);
check(combinedContributors.size === 3 && combinedContributors.has("strike-base-stun") && combinedContributors.has("first-turn-stun") && combinedContributors.has("daze-stun"), "A combined Stun activation must record the Skill, Ability, and Relic contributions together.");
const combinedStunTurnTwo = takeTurn(
  { ...startTurn({ ...combinedStunTurnOne, phase: "ready" }), rngState: 2 },
  combinedStunAction,
  50,
);
check(!combinedStunTurnTwo.turnEvents.some((event) => event.event_type === "stun_activated"), "After the first active turn, the Ability Turn Restriction must leave only the 17% Skill-plus-Relic contribution, which misses this deterministic roll.");

const multiTargetStunCatalog = makeCatalog();
multiTargetStunCatalog.effectsBySkill.wave = [effect("skill", "wave", "wave-guaranteed-stun", "stun_chance", { target: "targets", chance: 1 })];
const multiTargetStun = runPlayerSkill(multiTargetStunCatalog, makePlayer(), "multi-target-stun", "wave", 1);
const multiTargetEvents = stunEvents(multiTargetStun);
check(multiTargetEvents.length === 2 && new Set(multiTargetEvents.map((event) => event.target_critter_id)).size === 2, "A multi-target Skill must resolve one guaranteed Stun roll per legal target without target leakage.");
check(multiTargetEvents.every((event) => event.payload.combined_chance === 1 && (event.payload.contributing_effect_ids as string[] | undefined)?.length === 1), "Each multi-target Stun activation must preserve its per-target combined chance and contributor list.");

const restrictionCatalog = makeCatalog();
restrictionCatalog.effectsBySkill.ritual = [effect("skill", "ritual", "ritual-turn-one", "turn_restriction", {
  main_restriction: "skill_use", turn_restriction: "specific_active_turn", specific_turn: 1, minimum_turn: 1, maximum_turn: 1,
})];
const restrictionBeforeTurn = battle(restrictionCatalog, makePlayer(), "turn-restriction-before-start");
check(
  !skillAvailability(restrictionBeforeTurn, "p1", "ritual").valid
    && skillAvailability(restrictionBeforeTurn, "p1", "ritual").selectable,
  "A Skill Use Turn Restriction must leave a restricted Skill selectable before its active-turn window begins.",
);
const restrictionTurnOne = startTurn({ ...restrictionBeforeTurn, phase: "ready" });
check(skillAvailability(restrictionTurnOne, "p1", "ritual").valid, "A Skill Use Turn Restriction must expose its Skill during the configured active turn.");
const restrictionUsed = takeTurn(restrictionTurnOne, [{ actorKey: "p1", type: "skill", skillId: "ritual", targetKey: "p1", cost: 0 }], 10);
check(restrictionUsed.activeTurnCounts?.p1 === 1 && restrictionUsed.presentationEvents.some((event) => event.kind === "skill" && event.skillId === "ritual"), "A Specific Active Turn restriction must allow its configured turn.");
const restrictionTurnTwo = startTurn({ ...restrictionUsed, phase: "ready" });
check(
  !skillAvailability(restrictionTurnTwo, "p1", "ritual").valid
    && skillAvailability(restrictionTurnTwo, "p1", "ritual").selectable,
  "A Skill Use Turn Restriction must remain selectable after its active-turn window closes.",
);
const restrictionFizzled = takeTurn(restrictionTurnTwo, [{ actorKey: "p1", type: "skill", skillId: "ritual", targetKey: "p1", cost: 0 }], 10);
check(
  restrictionFizzled.activeTurnCounts?.p1 === 2
    && restrictionFizzled.presentationEvents.some((event) => event.message.includes("fizzled") && event.effectPolarity === "negative" && event.targetKeys.includes("p1")),
  "A Skill Use Turn Restriction must fizzle after its active-turn window, identify the failure, and spend the reserved Mana.",
);
const swapped = takeTurn(restrictionTurnTwo, [{ actorKey: "p1", type: "swap", swapInKey: "p3", cost: 0 }], 10);
check(swapped.activeTurnCounts?.p1 === 0 && swapped.activeTurnCounts?.p3 === 0, "Swapping out must reset both outgoing and incoming active-turn counters.");
const swappedBackIn = startTurn({ ...swapped, phase: "ready" });
check(swappedBackIn.activeTurnCounts?.p3 === 1, "A swapped-in Critter must begin a fresh active-turn sequence on the next turn.");

const childRestrictionCatalog = makeCatalog();
const childStun = { ...effect("skill", "ritual", "ritual-child-stun", "stun_chance", { target: "all_enemies", chance: 1 }), execution: "child" as const, classification: "negative" as const };
const childRestriction = effect("skill", "ritual", "ritual-child-window", "turn_restriction", {
  main_restriction: "child_effect_trigger", turn_restriction: "specific_active_turn", specific_turn: 2, minimum_turn: 1, maximum_turn: 2, child_effect_ids: [childStun.id],
});
childRestrictionCatalog.effectsBySkill.ritual = [childRestriction, childStun];
const childRestrictionTurnOne = startTurn({ ...battle(childRestrictionCatalog, makePlayer(), "child-turn-restriction"), phase: "ready" });
const childRestrictionMiss = takeTurn(childRestrictionTurnOne, [{ actorKey: "p1", type: "skill", skillId: "ritual", targetKey: "p1", cost: 0 }], 10);
check(!(childRestrictionMiss.stunnedSkillKeys ?? []).includes("o1"), "Child Effect Trigger mode must suppress its child Effect outside the active-turn window.");
const childRestrictionTurnTwo = startTurn({ ...childRestrictionMiss, phase: "ready" });
const childRestrictionHit = takeTurn(childRestrictionTurnTwo, [{ actorKey: "p1", type: "skill", skillId: "ritual", targetKey: "p1", cost: 0 }], 10);
check((childRestrictionHit.stunnedSkillKeys ?? []).includes("o1"), "Child Effect Trigger mode must resolve its child Effect inside the active-turn window while the Skill still resolves.");

console.log("Inline effect combat runtime tests passed.");
