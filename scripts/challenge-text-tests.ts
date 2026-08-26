import { challengeDescription, challengeGoal, progressFor } from "../src/lib/collectibles.js";
import { challengeEventIncrement, derivedChallengeProgress } from "../src/lib/challenges.js";
import type { AppData, CollectibleUnlockChallenge } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const data = {
  catalog: {
    elements: [
      { id: "basic", name: "Basic" },
      { id: "vile", name: "Vile" },
      { id: "frost", name: "Frost" },
    ],
    critters: [
      { id: "001", name: "Ramber" },
      { id: "002", name: "Cragram" },
    ],
    rollcasters: [],
    relics: [
      { id: "004", name: "Polished Ivory" },
    ],
    skills: [{ id: "vile-injection", name: "Vile Injection" }],
    statuses: [
      { id: "frostbite", name: "Frostbite" },
      { id: "toxic", name: "Toxic" },
      { id: "paralysis", name: "Paralysis" },
    ],
    dungeons: [
      { id: "001", name: "Journey Begins" },
      { id: "002", name: "Creek Clash" },
    ],
    currencies: [{ id: "coins", name: "Coins" }],
    tags: [{ id: "final-stage", name: "Final Stage" }],
  },
} as unknown as AppData;

function challenge(type: CollectibleUnlockChallenge["challenge_type"], parameters: Record<string, unknown>, display_text?: string): CollectibleUnlockChallenge {
  return {
    id: crypto.randomUUID(),
    collectible_type: "critter",
    collectible_id: "002",
    challenge_type: type,
    target_category: null,
    target_id: null,
    target_mode: null,
    any_target: false,
    target_ids: [],
    required_amount: null,
    required_level: null,
    sort_order: 0,
    parameters,
    display_text,
  };
}

const diversity = challenge("collection_diversity", {
  diversity_mode: "specific_types",
  required_per_type: 1,
  required_element_ids: ["basic", "vile", "frost"],
  required_distinct_types: 2,
});
check(challengeDescription(data, diversity) === "Own 1 Critter from each of: Basic, Vile, Frost.", "Specific diversity text must name every required Element.");
check(challengeGoal(diversity) === 3n, "Specific diversity goal must equal the number of required Elements.");

const override = challenge("collection_diversity", {
  diversity_mode: "specific_types",
  required_per_type: 1,
  required_element_ids: ["basic", "vile", "frost"],
}, "Own 1 Critter from each of: Basic, Vile, Frost.");
check(challengeDescription(data, override) === override.display_text, "Authored player-facing text must be used verbatim.");
check(challengeDescription(data, { ...diversity, display_text: "  " }) === "Own 1 Critter from each of: Basic, Vile, Frost.", "Blank overrides must fall back to the generated default.");

const cases: Array<[CollectibleUnlockChallenge, string]> = [
  [challenge("own_collectible", { collectible_category: "critter", collectible_ids: ["001"], required_amount: 1, require_unique_collectibles: true }), "Own Ramber."],
  [challenge("own_collectible", { collectible_category: "critter", collectible_ids: [], critter_tag_ids: ["final-stage"], required_amount: 1, require_unique_collectibles: true }), "Own 1 different Critter tagged Final Stage."],
  [challenge("level_up_critter", { critter_id: "001", required_level: 20 }), "Unlock level 20 for Ramber (001)"],
  [challenge("knock_out_critters", { source_critter_ids: ["001"], target_critter_ids: ["002"], required_amount: 10 }), "Knock out Cragram using Ramber."],
  [challenge("deal_damage", { source_critter_ids: ["001"], target_element_ids: ["vile"], damage_mode: "any", required_amount: 1250 }), "Deal damage to Vile Element Critters using Ramber."],
  [challenge("take_damage", { source_element_ids: ["vile"], target_critter_ids: ["002"], damage_mode: "any", required_amount: 3000 }), "Take damage as Cragram from Vile Element Critters."],
  [challenge("use_skill", { skill_type: "attack", skill_ids: ["vile-injection"], source_critter_ids: ["001"], required_amount: 10 }), "Use Vile Injection with Ramber."],
  [challenge("squad_composition", { completion_event: "battle_win", required_completions: 2, required_critter_ids: ["001"], required_element_ids: ["vile"], required_matching_critters: 1, require_survival: true }), "Win 2 battles with 1 unique matching Critter covering Vile."],
  [challenge("dungeon_clear", { dungeon_selection: "specific_dungeon", dungeon_ids: ["002"], required_clears: 1, has_relic_requirements: true, required_relic_ids: ["004"], require_relic_activation: true }), "Clear Creek Clash 1 time."],
  [challenge("resource_spending", { spending_context: "combat", resource_type: "currency", required_amount: 5, tracking_scope: "lifetime" }), "Spend 5 Currency in total."],
  [challenge("swap_action", { tracked_action: "unique_critters_swapped_in", required_amount: 2 }), "Unique Critters Swapped In 2 times."],
  [challenge("block_action", { tracked_action: "attacks_fully_blocked", required_amount: 2 }), "Attacks Fully Blocked: 2."],
  [challenge("dice_roll", { tracked_result: "maximum_die_result", comparison: "greater_than_or_equal", target_value: 6, required_occurrences: 2, die_types: ["d6"] }), "Maximum Die Result Greater Than Or Equal 6, 2 times."],
  [challenge("heal_hp", { required_amount: 200, recipient_side: "any", target_mode: "any", target_ids: [], tracking_scope: "lifetime" }), "Heal 200 HP on Critters."],
  [challenge("defeat_rollcaster_type", { rollcaster_types: ["adept"], required_amount: 10 }), "Defeat 10 Adept-rank Rollcasters."],
  [challenge("afflict_status", { status_ids: ["frostbite"], target_side: "enemies", affliction_mode: "fresh_afflictions", required_amount: 10 }), "Afflict Frostbite on enemies 10 times from a fresh Status."],
  [challenge("shields_shattered", { shield_side: "friendlies", required_amount: 10 }), "Shatter 10 Friendly Shields."],
  [challenge("shop_shards", { required_amount: 20 }), "Unlock Cragram shards"],
  [challenge("shop_relic", { required_amount: 1 }), "Own Cragram"],
];

for (const [row, expected] of cases) check(challengeDescription(data, row) === expected, `${row.challenge_type} text differs from the dev default: ${challengeDescription(data, row)}`);

const specificOwnership = challenge("own_collectible", {
  collectible_category: "relic",
  collectible_ids: ["001", "005"],
  specific_collectible_mode: "all",
  required_amount: 1,
  require_unique_collectibles: false,
});
const specificOwnershipData = {
  ...data,
  catalog: {
    ...data.catalog,
    collectibleUnlockRequirements: [],
    collectibleUnlockChallenges: [],
    relics: [
      { id: "001", name: "Copper Shield" },
      { id: "005", name: "Spiky Shield" },
    ],
  },
  player: {
    relicInventory: [
      { user_id: "user", relic_id: "001", quantity: 1, discovered_at: "now" },
      { user_id: "user", relic_id: "005", quantity: 0, discovered_at: "now" },
    ],
    collectibleSnapshot: { progress: [], shards: [], lootboxes: [], tracked: [], unlocked_collectibles: [] },
  },
} as unknown as AppData;
check(challengeDescription(specificOwnershipData, specificOwnership) === "Own Copper Shield and Spiky Shield.", "Require all ownership text must name every selected collectible.");
check(challengeGoal(specificOwnership) === 2n, "Require all ownership goal must equal the number of selected IDs, not stale required_amount.");
check(derivedChallengeProgress(specificOwnershipData, specificOwnership) === 1n, "Require all ownership progress must report one of two selected Relics as 1/2.");
check(derivedChallengeProgress({
  ...specificOwnershipData,
  player: {
    ...specificOwnershipData.player!,
    relicInventory: specificOwnershipData.player!.relicInventory.map((row) => ({ ...row, quantity: 1 })),
  },
}, specificOwnership) === 2n, "Require all ownership must complete only after every selected Relic is owned.");

check(challengeDescription(data, challenge("deal_damage", { target_mode: "species", target_ids: ["001"], damage_mode: "hp_only", required_amount: 100 })) === "Deal HP damage to Ramber.", "Deal Damage HP-only text must identify the HP filter.");
check(challengeDescription(data, challenge("take_damage", { target_mode: "species", target_ids: ["002"], damage_mode: "shield_only", required_amount: 100 })) === "Take Shield damage as Cragram from any enemy Critter.", "Take Damage Shield-only text must identify the Shield filter.");

for (const [mode, payload, expected] of [
  ["any", { hp_damage: 4, shield_damage: 6 }, 10],
  ["hp_only", { hp_damage: 4, shield_damage: 6 }, 4],
  ["shield_only", { hp_damage: 4, shield_damage: 6 }, 6],
] as const) {
  const damageChallenge = challenge("deal_damage", { target_mode: "species", target_ids: ["001"], damage_mode: mode, required_amount: 100 });
  check(challengeEventIncrement(damageChallenge, {
    eventId: `damage:${mode}`,
    type: "hp_damage_dealt",
    targetCritterId: "001",
    amount: 10,
    payload,
  }) === expected, `Deal Damage ${mode} must select the correct normalized damage component.`);
}
const legacyDamage = challenge("deal_damage", { target_mode: "species", target_ids: ["001"], required_amount: 100 });
check(challengeEventIncrement(legacyDamage, { eventId: "damage:legacy", type: "hp_damage_dealt", targetCritterId: "001", amount: 7, payload: {} }) === 7, "Legacy damage events without components must remain HP-compatible and count as Any damage.");
check(challengeEventIncrement(challenge("deal_damage", { target_mode: "species", target_ids: ["001"], damage_mode: "shield_only", required_amount: 100 }), { eventId: "damage:none", type: "hp_damage_dealt", targetCritterId: "001", amount: 7, payload: {} }) === 0, "Legacy damage events must not be interpreted as Shield damage.");

const incomingSwap = {
  eventId: "swap:incoming",
  type: "swap_completed" as const,
  sourceCritterId: "001",
  targetCritterId: "002",
  dungeonId: "002",
  sourceElementIds: ["basic"],
  targetElementIds: ["vile", "frost"],
  amount: 1,
  payload: {
    dungeon_id: "002",
    incoming_critter_id: "002",
    incoming_element_ids: ["vile", "frost"],
    unique: true,
  },
};
check(challengeEventIncrement(challenge("swap_action", { tracked_action: "unique_critters_swapped_in", critter_ids: ["002"], element_ids: ["frost"], dungeon_ids: ["002"], required_amount: 1 }), incomingSwap) === 1, "Swap filters must describe the Critter and Elements swapped in, including Element 2.");
check(challengeEventIncrement(challenge("swap_action", { tracked_action: "unique_critters_swapped_in", critter_ids: ["001"], required_amount: 1 }), incomingSwap) === 0, "Swap-in filters must reject the outgoing Critter.");

const multiTargetSkill = challenge("use_skill", { skill_type: "attack", target_critter_ids: ["002"], required_amount: 1 });
check(challengeEventIncrement(multiTargetSkill, {
  eventId: "skill:multi-target",
  type: "skill_resolved",
  sourceCritterId: "001",
  targetCritterId: "001",
  skillId: "vile-injection",
  payload: {
    skill_type: "attack",
    target_critter_ids: ["001", "002"],
    target_element_ids: ["basic", "vile", "frost"],
  },
}) === 1, "Use Skill target filters must match any target of a multi-target Skill.");

const filteredBlock = {
  eventId: "block:filtered",
  type: "block_completed" as const,
  sourceCritterId: "001",
  targetCritterId: "002",
  sourceElementIds: ["basic"],
  targetElementIds: ["vile", "frost"],
  dungeonId: "002",
  amount: 3,
  payload: { dungeon_id: "002", damage_prevented: 3, fully_blocked: true, survived: true, source_element_ids: ["basic"], target_element_ids: ["vile", "frost"] },
};
check(challengeEventIncrement(challenge("block_action", { tracked_action: "damage_prevented", critter_ids: ["001"], element_ids: ["basic"], enemy_critter_ids: ["002"], enemy_element_ids: ["frost"], dungeon_ids: ["002"], required_amount: 10 }), filteredBlock) === 3, "Block challenges must apply friendly and enemy Element filters.");
check(challengeEventIncrement(challenge("block_action", { tracked_action: "damage_prevented", element_ids: ["vile"], required_amount: 10 }), filteredBlock) === 0, "Block friendly Element filters must reject an enemy-only Element.");
check(challengeEventIncrement(challenge("block_action", { tracked_action: "blocks_performed", required_amount: 1 }), {
  ...filteredBlock,
  payload: {
    dungeon_id: "002",
    blocks_performed: 1,
    block_action: true,
    source_element_ids: ["basic"],
    target_element_ids: ["vile", "frost"],
  },
}) === 1, "Block action events must count Blocks performed once.");
check(challengeEventIncrement(challenge("block_action", { tracked_action: "blocks_performed", required_amount: 1 }), filteredBlock) === 0, "Block prevention result events must not double-count Blocks performed.");

const filteredDice = {
  eventId: "dice:filtered",
  type: "dice_resolved" as const,
  sourceCritterId: "001",
  dungeonId: "002",
  rollcasterId: "rc-1",
  amount: 4,
  payload: {
    dungeon_id: "002",
    rollcaster_id: "rc-1",
    die_type: "d6",
    natural_value: 4,
    modified_value: 9,
    natural_maximum: 6,
    turn_mana_total: 8,
    turn_mana_total_event: true,
  },
};
check(challengeEventIncrement(challenge("dice_roll", { tracked_result: "die_value", comparison: "equal", target_value: 4, include_modifiers: false, rollcaster_ids: ["rc-1"], dungeon_ids: ["002"], required_amount: 1 }), filteredDice) === 1, "Dice challenges must be able to use the natural die value and filter Rollcaster and Dungeon context.");
check(challengeEventIncrement(challenge("dice_roll", { tracked_result: "die_value", comparison: "equal", target_value: 4, include_modifiers: true, rollcaster_ids: ["rc-1"], dungeon_ids: ["002"], required_amount: 1 }), filteredDice) === 0, "Dice challenges that include modifiers must compare the modified die value.");
check(challengeEventIncrement(challenge("dice_roll", { tracked_result: "die_value", comparison: "equal", target_value: 9, include_modifiers: true, rollcaster_ids: ["other"], dungeon_ids: ["002"], required_amount: 1 }), filteredDice) === 0, "Dice challenges must reject a non-selected Rollcaster.");
check(challengeEventIncrement(challenge("dice_roll", { tracked_result: "turn_mana_total", comparison: "greater_than_or_equal", target_value: 8, required_amount: 1 }), { ...filteredDice, payload: { ...filteredDice.payload, turn_mana_total_event: false } }) === 0, "Turn Mana totals must count only on their explicitly marked once-per-turn event.");

for (const [side, targetSide, expected] of [
  ["any", "player", 1],
  ["friendlies", "player", 1],
  ["friendlies", "opponent", 0],
  ["enemies", "opponent", 1],
  ["enemies", "player", 0],
] as const) {
  const shieldChallenge = challenge("shields_shattered", { shield_side: side, required_amount: 10 });
  check(challengeEventIncrement(shieldChallenge, {
    eventId: `shield:${side}:${targetSide}`,
    type: "shield_shattered",
    amount: 1,
    payload: { shield_shattered: true, target_side: targetSide },
  }) === expected, `Shields Shattered ${side} must apply its recipient-side filter.`);
}
check(challengeEventIncrement(challenge("shields_shattered", { shield_side: "any", required_amount: 10 }), {
  eventId: "shield:partial",
  type: "shield_shattered",
  amount: 1,
  payload: { shield_shattered: false, target_side: "player" },
}) === 0, "Shields Shattered must reject events that do not claim a completed Shield break.");

const friendlyVileHealing = challenge("heal_hp", {
  required_amount: 200,
  recipient_side: "friendly",
  target_mode: "element",
  target_ids: ["vile"],
  tracking_scope: "lifetime",
});
check(challengeGoal(friendlyVileHealing) === 200n, "Heal HP goal must use required_amount.");
check(challengeEventIncrement(friendlyVileHealing, {
  eventId: "heal:1",
  type: "hp_healed",
  targetCritterId: "002",
  targetElementIds: ["vile"],
  amount: 5,
  payload: { source_side: "player", recipient_side: "friendly" },
}) === 5, "Heal HP must count actual amplified friendly healing that matches the Element filter.");
check(challengeEventIncrement(friendlyVileHealing, {
  eventId: "heal:2",
  type: "hp_healed",
  targetCritterId: "002",
  targetElementIds: ["vile"],
  amount: 5,
  payload: { source_side: "player", recipient_side: "enemy" },
}) === 0, "Heal HP must reject healing on the wrong recipient side.");

const filteredResourceSpend = challenge("resource_spending", {
  spending_context: "shop",
  resource_type: "custom_currency",
  custom_currency_id: "tickets",
  shop_ids: ["shop-entry-1"],
  purchased_collectible_categories: ["lootbox"],
  required_amount: 50,
  tracking_scope: "lifetime",
});
check(challengeEventIncrement(filteredResourceSpend, {
  eventId: "spend:1",
  type: "resource_spent",
  amount: 9,
  shopId: "shop-entry-1",
  purchasedCollectibleCategory: "lootbox",
  payload: { spending_context: "shop", resource_type: "custom_currency", custom_currency_id: "tickets" },
}) === 9, "Resource Spending must count a matching custom-currency shop event.");
check(challengeEventIncrement(filteredResourceSpend, {
  eventId: "spend:2",
  type: "resource_spent",
  amount: 9,
  shopId: "shop-entry-2",
  purchasedCollectibleCategory: "lootbox",
  payload: { spending_context: "shop", resource_type: "custom_currency", custom_currency_id: "tickets" },
}) === 0, "Resource Spending must reject a shop event outside its authored Shop filter.");

const adeptDefeats = challenge("defeat_rollcaster_type", {
  rollcaster_types: ["adept"],
  required_amount: 10,
});
check(challengeGoal(adeptDefeats) === 10n, "Defeat Rollcaster Type goal must use required_amount.");
check(challengeEventIncrement(adeptDefeats, {
  eventId: "battle:adept",
  type: "battle_completed",
  amount: 1,
  payload: { won: true, enemy_rollcaster_type: "adept" },
}) === 1, "Defeat Rollcaster Type must count a matching defeated Rollcaster once.");
check(challengeEventIncrement(adeptDefeats, {
  eventId: "battle:acolyte",
  type: "battle_completed",
  amount: 1,
  payload: { won: true, enemy_rollcaster_type: "acolyte" },
}) === 0, "Defeat Rollcaster Type must ignore a non-matching rank.");
check(challengeEventIncrement(adeptDefeats, {
  eventId: "battle:loss",
  type: "battle_completed",
  amount: 1,
  payload: { won: false, enemy_rollcaster_type: "adept" },
}) === 0, "Defeat Rollcaster Type must ignore lost encounters.");
const acolyteOrAdeptDefeats = challenge("defeat_rollcaster_type", {
  rollcaster_types: ["acolyte", "adept"],
  required_amount: 2,
});
check(challengeEventIncrement(acolyteOrAdeptDefeats, {
  eventId: "battle:acolyte",
  type: "battle_completed",
  amount: 1,
  payload: { won: true, enemy_rollcaster_type: "acolyte" },
}) === 1, "Defeat Rollcaster Type must accept any selected rank.");

const freshFrostbite = challenge("afflict_status", {
  status_ids: ["frostbite"],
  target_side: "enemies",
  affliction_mode: "fresh_afflictions",
  required_amount: 10,
});
check(challengeGoal(freshFrostbite) === 10n, "Afflict Status goal must use required_amount.");
check(challengeEventIncrement(freshFrostbite, {
  eventId: "status:fresh",
  type: "status_afflicted",
  amount: 1,
  targetCritterId: "002",
  payload: { status_ids: ["frostbite"], target_side: "opponent", fresh: true },
}) === 1, "Fresh Afflictions must count a selected Status on an enemy.");
check(challengeEventIncrement(freshFrostbite, {
  eventId: "status:existing",
  type: "status_afflicted",
  amount: 1,
  targetCritterId: "002",
  payload: { status_ids: ["frostbite"], target_side: "opponent", fresh: false },
}) === 0, "Fresh Afflictions must reject reapplications of an existing Status.");
const afflictedTurns = challenge("afflict_status", {
  status_ids: ["toxic", "paralysis"],
  target_side: "any",
  affliction_mode: "afflicted_turns",
  required_amount: 4,
});
check(challengeDescription(data, afflictedTurns) === "Keep Toxic or Paralysis on any Critter for 4 afflicted turns.", "Afflicted Turns text must name selected Statuses and the target scope.");
check(challengeEventIncrement(afflictedTurns, {
  eventId: "status:turn",
  type: "status_turn_completed",
  amount: 1,
  targetCritterId: "002",
  payload: { status_ids: ["paralysis"], target_side: "player" },
}) === 1, "Afflicted Turns must count a matching completed turn for Any targets.");
check(challengeEventIncrement(freshFrostbite, {
  eventId: "status:wrong-side",
  type: "status_afflicted",
  amount: 1,
  targetCritterId: "002",
  payload: { status_ids: ["frostbite"], target_side: "player", fresh: true },
}) === 0, "Afflict Status must reject events on the wrong target side.");

const enemyStuns = challenge("stun_activation", { target_side: "enemies", required_amount: 10 });
const friendlyStuns = challenge("stun_activation", { target_side: "friendlies", required_amount: 10 });
const anyStuns = challenge("stun_activation", { target_side: "any", required_amount: 3 });
check(challengeGoal(enemyStuns) === 10n && challengeDescription(data, enemyStuns) === "Stun enemy Critters 10 times.", "Stun Activation must expose its authored amount and enemy-facing text.");
check(challengeEventIncrement(enemyStuns, { eventId: "stun:enemy", type: "stun_activated", amount: 1, targetCritterId: "002", payload: { stun_activated: true, target_side: "opponent" } }) === 1, "Enemy Stun Activation must count an enemy target.");
check(challengeEventIncrement(enemyStuns, { eventId: "stun:friendly", type: "stun_activated", amount: 1, targetCritterId: "001", payload: { stun_activated: true, target_side: "player" } }) === 0, "Enemy Stun Activation must reject a friendly target.");
check(challengeEventIncrement(friendlyStuns, { eventId: "stun:friendly", type: "stun_activated", amount: 1, targetCritterId: "001", payload: { stun_activated: true, target_side: "player" } }) === 1, "Friendly Stun Activation must count an enemy-caused Stun on the user's Critter.");
check(challengeEventIncrement(anyStuns, { eventId: "stun:any", type: "stun_activated", amount: 1, targetCritterId: "002", payload: { stun_activated: true, target_side: "opponent" } }) === 1, "Any Stun Activation must accept either target side.");

const frostTeraDiversity = challenge("collection_diversity", {
  diversity_mode: "specific_types",
  required_per_type: 1,
  require_unique_critters: true,
  required_element_ids: ["frost", "tera"],
});
const frostTeraData = {
  ...data,
  catalog: {
    ...data.catalog,
    critters: [
      { id: "brumbear", name: "Brumbear", element_1_id: "frost", element_2_id: "tera" },
      { id: "frostling", name: "Frostling", element_1_id: "frost", element_2_id: null },
    ],
  },
  player: {
    critters: [{ id: "owned-brumbear", user_id: "user", critter_id: "brumbear", level: 1, xp: 0, skill_points: 0 }],
    collectibleSnapshot: { progress: [], shards: [], lootboxes: [], tracked: [] },
  },
} as unknown as AppData;
check(derivedChallengeProgress(frostTeraData, frostTeraDiversity) === 1n, "A dual-element Critter must fill only one unique Frost/Tera requirement.");
check(derivedChallengeProgress({ ...frostTeraData, player: { ...frostTeraData.player, critters: [...frostTeraData.player!.critters, { id: "owned-frostling", user_id: "user", critter_id: "frostling", level: 1, xp: 0, skill_points: 0 }] } }, frostTeraDiversity) === 2n, "Two distinct Critters must satisfy the Frost/Tera ownership requirements.");

const voltaDiversity = challenge("collection_diversity", {
  diversity_mode: "specific_types",
  required_per_type: 2,
  require_unique_critters: true,
  required_element_ids: ["thunder", "mechanical"],
});
const voltaCatalog = {
  ...data.catalog,
  elements: [
    { id: "thunder", name: "Thunder" },
    { id: "mechanical", name: "Mechanical" },
  ],
  critters: [
    { id: "thunder-1", name: "Thunder 1", element_1_id: "thunder", element_2_id: null },
    { id: "thunder-2", name: "Thunder 2", element_1_id: "thunder", element_2_id: null },
    { id: "thunder-3", name: "Thunder 3", element_1_id: "thunder", element_2_id: null },
    { id: "mechanical-1", name: "Mechanical 1", element_1_id: "mechanical", element_2_id: null },
    { id: "mechanical-2", name: "Mechanical 2", element_1_id: "mechanical", element_2_id: null },
    { id: "mechanical-3", name: "Mechanical 3", element_1_id: "mechanical", element_2_id: null },
  ],
};
const voltaData = (critterIds: string[]) => ({
  catalog: { ...voltaCatalog, collectibleUnlockChallenges: [voltaDiversity], collectibleUnlockRequirements: [] },
  player: {
    critters: critterIds.map((critter_id, index) => ({ id: `owned-${index}`, user_id: "user", critter_id, level: 1, xp: 0, skill_points: 0 })),
    collectibleSnapshot: { progress: [], shards: [], lootboxes: [], tracked: [], unlocked_collectibles: [] },
  },
} as unknown as AppData);
check(challengeGoal(voltaDiversity) === 4n, "Specific diversity goal must multiply the required Elements by Critters required per Element.");
check(derivedChallengeProgress(voltaData(["mechanical-1", "mechanical-2", "mechanical-3", "thunder-1"]), voltaDiversity) === 3n, "Specific diversity progress must cap each Element at its per-Element quota instead of allowing overflow to cover another Element.");
check(progressFor(voltaData(["mechanical-1", "mechanical-2", "mechanical-3", "thunder-1"]), voltaDiversity.id).current === "3", "Player-facing diversity progress must show capped per-Element ownership.");
check(!progressFor(voltaData(["mechanical-1", "mechanical-2", "mechanical-3", "thunder-1"]), voltaDiversity.id).completed, "Three Mechanical and one Thunder Critter must not complete a two-per-Element challenge.");
check(progressFor(voltaData(["mechanical-1", "mechanical-2", "thunder-1", "thunder-2"]), voltaDiversity.id).goal_reached, "Two Critters from each required Element must complete the diversity challenge.");
const staleVoltaProgressData = voltaData(["thunder-1", "thunder-2", "thunder-3"]);
staleVoltaProgressData.player!.collectibleSnapshot.progress = [{
  challenge_id: voltaDiversity.id,
  current: "3",
  goal: "2",
  goal_reached: true,
  eligible: true,
  completed: false,
  blocked_by_gate_order: null,
  trackable: false,
}];
const staleVoltaProgress = progressFor(staleVoltaProgressData, voltaDiversity.id);
check(staleVoltaProgress.current === "2" && staleVoltaProgress.goal === "4", "Player-facing diversity progress must recompute capped ownership and use the authored X*Y goal when a stale snapshot exists.");
check(!staleVoltaProgress.completed, "Overflow from one Element must not complete a specific-types diversity challenge through a stale snapshot.");

const dungeonFrostTera = challenge("squad_composition", {
  completion_event: "dungeon_clear",
  required_completions: 1,
  required_element_ids: ["frost", "tera"],
  required_matching_critters: 2,
  required_distinct_elements: 2,
});
const dungeonEvent = (squad: Array<Record<string, unknown>>, type: "dungeon_completed" | "battle_completed" = "dungeon_completed") => challengeEventIncrement(dungeonFrostTera, {
  eventId: "dungeon:1",
  type,
  payload: { won: true, squad },
});
check(dungeonEvent([{ critter_id: "brumbear", element_ids: ["frost", "tera"] }]) === 0, "A single dual-element Critter must not satisfy the two-Critter dungeon challenge.");
check(dungeonEvent([
  { critter_id: "brumbear", element_ids: ["frost", "tera"] },
  { critter_id: "frostling", element_ids: ["frost"] },
]) === 1, "Two unique Critters covering Frost and Tera must satisfy the dungeon challenge.");
check(dungeonEvent([
  { critter_id: "brumbear", element_ids: ["frost", "tera"] },
  { critter_id: "frostling", element_ids: ["frost"] },
], "battle_completed") === 0, "The dungeon challenge must ignore battle-completed events.");

console.log(`Challenge text and progression audit passed for ${cases.length + 7} representative definitions.`);
