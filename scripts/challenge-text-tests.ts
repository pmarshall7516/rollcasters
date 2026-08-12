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
  [challenge("level_up_critter", { critter_id: "001", required_level: 20 }), "Unlock level 20 for Ramber (001)"],
  [challenge("knock_out_critters", { target_mode: "species", target_ids: ["001"], required_amount: 10 }), "Knock out Critters (Ramber)"],
  [challenge("deal_damage", { target_mode: "element", target_ids: ["vile"], required_amount: 1250 }), "Damage Critters (Vile)"],
  [challenge("take_damage", { target_mode: "species", any_target: true, target_ids: [], required_amount: 3000 }), "Receive Damage (Any Species)"],
  [challenge("use_skill", { target_mode: "skill", target_ids: ["vile-injection"], required_amount: 10 }), "Use Skill (Vile Injection)"],
  [challenge("squad_composition", { completion_event: "battle_win", required_completions: 2, required_critter_ids: ["001"], required_element_ids: ["vile"], require_survival: true }), "Win 2 battles with the configured squad."],
  [challenge("dungeon_clear", { dungeon_selection: "specific_dungeon", dungeon_ids: ["002"], required_clears: 1, has_relic_requirements: true, required_relic_ids: ["004"], require_relic_activation: true }), "Clear Creek Clash 1 time."],
  [challenge("resource_spending", { spending_context: "combat", resource_type: "currency", required_amount: 5, tracking_scope: "lifetime" }), "Spend 5 Currency in total."],
  [challenge("swap_action", { tracked_action: "unique_critters_swapped_in", required_amount: 2 }), "Unique Critters Swapped In 2 times."],
  [challenge("block_action", { tracked_action: "attacks_fully_blocked", required_amount: 2 }), "Attacks Fully Blocked: 2."],
  [challenge("dice_roll", { tracked_result: "maximum_die_result", comparison: "greater_than_or_equal", target_value: 6, required_occurrences: 2, die_types: ["d6"] }), "Maximum Die Result Greater Than Or Equal 6, 2 times."],
  [challenge("heal_hp", { required_amount: 200, recipient_side: "any", target_mode: "any", target_ids: [], tracking_scope: "lifetime" }), "Heal 200 HP on Critters."],
  [challenge("defeat_rollcaster_type", { rollcaster_types: ["adept"], required_amount: 10 }), "Defeat 10 Adept-rank Rollcasters."],
  [challenge("afflict_status", { status_ids: ["frostbite"], target_side: "enemies", affliction_mode: "fresh_afflictions", required_amount: 10 }), "Afflict Frostbite on enemies 10 times from a fresh Status."],
  [challenge("shop_shards", { required_amount: 20 }), "Unlock Cragram shards"],
  [challenge("shop_relic", { required_amount: 1 }), "Own Cragram"],
];

for (const [row, expected] of cases) check(challengeDescription(data, row) === expected, `${row.challenge_type} text differs from the dev default: ${challengeDescription(data, row)}`);

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
