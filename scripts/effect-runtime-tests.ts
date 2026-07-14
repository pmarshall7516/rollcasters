import { createInitialCombatState, resolveTurn } from "../src/lib/game.js";
import type { Catalog, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function effect(
  id: string,
  ownerType: ResolvedEffectRef["ownerType"],
  runtimeKind: string,
  parameters: Record<string, unknown>,
  sortOrder = 0,
): ResolvedEffectRef {
  return { id, name: id, description: `${id} description`, ownerType, runtimeKind, runtimeVersion: 1, parameters, sortOrder, definitionVersion: 1, templateVersion: 1 };
}

const harden = effect("Harden", "ability", "stat_modifier", { stat: "def", mode: "flat", amount: 7, target: "all_friendly_critters" });
const boosted = effect("Boosted Roll", "relic", "mana_dice_modifier", { minimum_delta: 1, maximum_delta: 2, target: "equipped_critter" });
const toxicDot = effect("Toxic", "status", "damage_over_time", { timing: "end_of_turn", mode: "percent_max_hp", amount: 0.08, target: "status_holder" });

function makeCatalog(poisonChance = 1): Catalog {
  const poison = effect("Poison Touch", "skill", "apply_status", { status_id: "toxic", chance: poisonChance, target: "selected_target" });
  return {
    elements: [{ id: "basic", name: "Basic", description: null, asset_path: null, sort_order: 0 }],
    skills: [{ id: "poison", name: "Poison", element_id: "basic", skill_type: "attack", power: 1, mana_cost: 0, targeting: "single_enemy", description: "Poison.", effect: {}, sort_order: 0 }],
    critters: [
      { id: "p", name: "Player", element_id: "basic", base_hp: 100, base_atk: 10, base_def: 10, base_spd: 20, base_dice_min: 1, base_dice_max: 6, base_block_cost: 0, base_swap_cost: 0, asset_path: null, description: null, sort_order: 0 },
      { id: "o", name: "Opponent", element_id: "basic", base_hp: 100, base_atk: 10, base_def: 10, base_spd: 10, base_dice_min: 1, base_dice_max: 6, base_block_cost: 0, base_swap_cost: 0, asset_path: null, description: null, sort_order: 1 },
    ],
    critterProgression: [], critterSkillUnlocks: [],
    rollcasters: [{ id: "rc", name: "Caster", asset_path: null, description: null, sort_order: 0 }],
    rollcasterProgression: [],
    rollcasterAbilities: [{ id: "harden", name: "Harden", description: "Harden.", effect: {}, sort_order: 0 }],
    rollcasterAbilityUnlocks: [],
    relics: [{ id: "boost", name: "Boost", description: "Boost.", max_owned: 1, effect: {}, asset_path: null, sort_order: 0 }],
    dungeons: [{ id: "d", name: "Test", dungeon_type: "regular", difficulty: 1, battle_format: "1v1", player_active_count: 1, opponent_active_count: 1, encounter_count: 1, next_dungeon_id: null, sort_order: 0 }],
    dungeonOpponents: [{ id: "opp", dungeon_id: "d", pool_type: "regular_pool", sequence_index: 0, probability: 1, critter_id: "o", critter_level: 1, skill_ids: [], relic_ids: [], rollcaster_xp_reward: 0, critter_xp_reward: 0, currency_reward: 0, drops: [] }],
    starterOptions: [], gameAssets: [],
    statuses: [{ id: "toxic", name: "Toxic", description: "Toxic.", stacking_policy: "refresh", default_duration: 3, max_stacks: 1 }],
    effects: [], effectsBySkill: { poison: [poison] }, effectsByAbility: { harden: [harden] }, effectsByRelic: { boost: [boosted] }, effectsByStatus: { toxic: [toxicDot] },
    dungeonOpponentStatOverrides: [],
  };
}

const player = {
  profile: { user_id: "u", username: "u", coins: 0, starter_selected_at: "now", active_rollcaster_id: "ur" },
  rollcasters: [{ id: "ur", user_id: "u", rollcaster_id: "rc", level: 1, xp: 0, ability_points: 0 }],
  critters: [{ id: "uc", user_id: "u", critter_id: "p", level: 1, xp: 0, skill_points: 0 }],
  relicInventory: [],
  squadSlots: [{ user_id: "u", slot_index: 1, user_critter_id: "uc" }],
  skillSlots: [{ user_critter_id: "uc", slot_index: 1, skill_id: "poison" }],
  abilitySlots: [{ user_rollcaster_id: "ur", slot_index: 1, ability_id: "harden" }],
  relicSlots: [{ user_critter_id: "uc", slot_index: 1, relic_id: "boost" }],
  unlockedSkillIdsByCritter: {}, unlockedAbilityIdsByRollcaster: {}, dungeonProgress: [],
} as PlayerState;

const catalog = makeCatalog();
const dungeon = catalog.dungeons[0];
const initial = createInitialCombatState(catalog, player, dungeon, "fixed-run");
check(initial.playerUnits[0].stats.def === 17, "Harden must add 7 DEF to the friendly team.");
check(initial.playerUnits[0].stats.diceMin === 2 && initial.playerUnits[0].stats.diceMax === 8, "Boosted Roll must modify both Mana Dice bounds.");
check(JSON.stringify(initial.snapshot) === JSON.stringify(createInitialCombatState(catalog, player, dungeon, "fixed-run").snapshot), "Run snapshots must be deterministic for the same run id.");

let afterPoison = resolveTurn({ ...initial, phase: "selecting", playerMana: 99 }, [{ actorKey: "p1", type: "skill", skillId: "poison", targetKey: "o1", cost: 0 }]);
check(afterPoison.statuses.length === 1, "Poison Touch must proc when the injected deterministic chance is 100%.");
check(afterPoison.statuses[0].duration === 2, "Toxic must tick and decrement at end of turn.");
const firstInstance = afterPoison.statuses[0].instanceId;
afterPoison = resolveTurn({ ...afterPoison, phase: "selecting", playerMana: 99 }, [{ actorKey: "p1", type: "skill", skillId: "poison", targetKey: "o1", cost: 0 }]);
check(afterPoison.statuses.length === 1 && afterPoison.statuses[0].instanceId === firstInstance && afterPoison.statuses[0].duration === 2, "Refresh must reset, not duplicate, an active status.");

const noProcCatalog = makeCatalog(0);
const noProc = resolveTurn({ ...createInitialCombatState(noProcCatalog, player, dungeon, "no-proc"), phase: "selecting", playerMana: 99 }, [{ actorKey: "p1", type: "skill", skillId: "poison", targetKey: "o1", cost: 0 }]);
check(noProc.statuses.length === 0, "Poison Touch must not proc at 0% chance.");

const clampedCatalog = makeCatalog();
clampedCatalog.effectsByRelic.boost = [effect("Clamp", "relic", "mana_dice_modifier", { minimum_delta: -50, maximum_delta: -50, target: "equipped_critter" })];
const clamped = createInitialCombatState(clampedCatalog, player, dungeon, "clamp");
check(clamped.playerUnits[0].stats.diceMin === 1 && clamped.playerUnits[0].stats.diceMax === 1, "Mana Dice bounds must clamp to minimum >= 1 and maximum >= minimum.");

const mismatchCatalog = makeCatalog();
mismatchCatalog.effectsByAbility.harden = [{ ...harden, ownerType: "relic" }];
let rejected = false;
try { createInitialCombatState(mismatchCatalog, player, dungeon, "mismatch"); } catch { rejected = true; }
check(rejected, "Owner-mismatched effects must be rejected.");

const orderedCatalog = makeCatalog();
orderedCatalog.skills.push({ id: "heal", name: "Heal", element_id: "basic", skill_type: "support", power: 0, mana_cost: 0, targeting: "self_only", description: "Heal.", effect: {}, sort_order: 1 });
orderedCatalog.effectsBySkill.heal = [
  effect("First", "skill", "restore_hp", { mode: "flat", amount: 1, target: "skill_user" }, 0),
  effect("Second", "skill", "restore_hp", { mode: "flat", amount: 1, target: "skill_user" }, 1),
];
const orderedPlayer = structuredClone(player);
orderedPlayer.skillSlots[0].skill_id = "heal";
let ordered = createInitialCombatState(orderedCatalog, orderedPlayer, dungeon, "ordered");
ordered = { ...ordered, phase: "selecting", playerMana: 99, playerUnits: ordered.playerUnits.map((unit) => ({ ...unit, hp: 50 })) };
ordered = resolveTurn(ordered, [{ actorKey: "p1", type: "skill", skillId: "heal", cost: 0 }]);
check(ordered.log.findIndex((line) => line.startsWith("Second")) < ordered.log.findIndex((line) => line.startsWith("First")), "Attachments must execute in stored order.");

const stackedStatsCatalog = makeCatalog();
stackedStatsCatalog.effectsByAbility.harden = [
  effect("Flat", "ability", "stat_modifier", { stat: "def", mode: "flat", amount: 7, target: "all_friendly_critters" }, 0),
  effect("Ten Percent", "ability", "stat_modifier", { stat: "def", mode: "percentage", amount: 0.1, target: "all_friendly_critters" }, 1),
  effect("Twenty Percent", "ability", "stat_modifier", { stat: "def", mode: "percentage", amount: 0.2, target: "all_friendly_critters" }, 2),
];
const stackedStats = createInitialCombatState(stackedStatsCatalog, player, dungeon, "stacked-stats");
check(stackedStats.playerUnits[0].stats.def === 22, "Percentage stat modifiers must be summed and rounded once after flat modifiers.");

const repeatedBuffCatalog = makeCatalog();
repeatedBuffCatalog.skills.push({ id: "buff", name: "Buff", element_id: "basic", skill_type: "support", power: 0, mana_cost: 0, targeting: "self_only", description: "Buff.", effect: {}, sort_order: 1 });
repeatedBuffCatalog.effectsBySkill.buff = [
  effect("Buff Ten", "skill", "stat_modifier", { stat: "atk", mode: "percentage", amount: 0.1, target: "skill_user" }, 0),
  effect("Buff Twenty", "skill", "stat_modifier", { stat: "atk", mode: "percentage", amount: 0.2, target: "skill_user" }, 1),
];
const repeatedBuffPlayer = structuredClone(player);
repeatedBuffPlayer.skillSlots[0].skill_id = "buff";
let repeatedBuff = createInitialCombatState(repeatedBuffCatalog, repeatedBuffPlayer, dungeon, "repeated-buff");
repeatedBuff = resolveTurn({ ...repeatedBuff, phase: "selecting", playerMana: 99 }, [{ actorKey: "p1", type: "skill", skillId: "buff", cost: 0 }]);
check(repeatedBuff.playerUnits[0].stats.atk === 13, "A Skill's percentage modifiers must share one percentage bucket.");
repeatedBuff = resolveTurn({ ...repeatedBuff, phase: "selecting", playerMana: 99 }, [{ actorKey: "p1", type: "skill", skillId: "buff", cost: 0 }]);
check(repeatedBuff.playerUnits[0].stats.atk === 16, "Repeated Skill modifiers must remain additive rather than compounding intermediate stats.");

const swapPlayer = structuredClone(player);
swapPlayer.critters.push({ ...swapPlayer.critters[0], id: "uc2" });
swapPlayer.squadSlots.push({ user_id: "u", slot_index: 2, user_critter_id: "uc2" });
swapPlayer.skillSlots.push({ user_critter_id: "uc2", slot_index: 1, skill_id: "poison" });
swapPlayer.relicSlots[0].user_critter_id = "uc2";
const beforeSwap = createInitialCombatState(makeCatalog(), swapPlayer, dungeon, "swap-relic");
check(beforeSwap.playerUnits[1].stats.diceMin === 1 && beforeSwap.playerUnits[1].stats.def === 10, "Benched Relics and team Abilities must not affect an inactive Critter.");
const afterSwap = resolveTurn({ ...beforeSwap, phase: "selecting", playerMana: 99 }, [{ actorKey: "p1", type: "swap", swapToId: "uc2", cost: 0 }]);
check(afterSwap.playerUnits[0].stats.def === 10, "An inactive Critter must lose active-team Ability modifiers after swapping out.");
check(afterSwap.playerUnits[1].stats.def === 17 && afterSwap.playerUnits[1].stats.diceMin === 2 && afterSwap.playerUnits[1].stats.diceMax === 8, "The swapped-in Critter must register active Ability and equipped Relic effects.");

const frozenCatalog = makeCatalog();
const frozen = createInitialCombatState(frozenCatalog, player, dungeon, "frozen-run");
frozenCatalog.effectsBySkill.poison[0].parameters.chance = 0;
frozenCatalog.effectsBySkill.poison.length = 0;
const frozenResult = resolveTurn({ ...frozen, phase: "selecting", playerMana: 99 }, [{ actorKey: "p1", type: "skill", skillId: "poison", targetKey: "o1", cost: 0 }]);
check(frozenResult.statuses.length === 1, "An active run must resolve its frozen Effect registry after the mutable catalog changes.");

for (const [category, mapKey] of [
  ["skill", "effectsBySkill"],
  ["ability", "effectsByAbility"],
  ["relic", "effectsByRelic"],
  ["status", "effectsByStatus"],
] as const) {
  const invalidCatalog = makeCatalog();
  const registry = invalidCatalog[mapKey];
  const ownerId = Object.keys(registry)[0];
  registry[ownerId] = [{ ...registry[ownerId][0], ownerType: category === "skill" ? "relic" : "skill" }];
  let invalidRejected = false;
  try { createInitialCombatState(invalidCatalog, player, dungeon, `invalid-${category}`); } catch { invalidRejected = true; }
  check(invalidRejected, `The ${category} registry must reject a cross-category Effect.`);
}

const badTargetCatalog = makeCatalog();
badTargetCatalog.effectsBySkill.poison[0].parameters.target = "equipped_critter";
let badTargetRejected = false;
try { createInitialCombatState(badTargetCatalog, player, dungeon, "bad-target"); } catch { badTargetRejected = true; }
check(badTargetRejected, "Owner-specific target values must be rejected outside their category.");

const unsupportedCatalog = makeCatalog();
unsupportedCatalog.effectsBySkill.poison[0].runtimeVersion = 2;
let unsupportedRejected = false;
try { createInitialCombatState(unsupportedCatalog, player, dungeon, "unsupported"); } catch { unsupportedRejected = true; }
check(unsupportedRejected, "Unsupported runtime versions must fail encounter creation before an Effect is used.");

console.log("Effect runtime integration tests passed.");
