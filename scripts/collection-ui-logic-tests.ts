import { calculateLoadoutStats, equippedRelicIdsForCritter, nextOpenSquadSlot } from "../src/lib/loadout.js";
import { challengeDescription, collectibleIsUnlocked, completedTrackedChallengeIds, progressFor, trackedChallengesForDisplay, trackedSlotFor } from "../src/lib/collectibles.js";
import { loadSeenChallengeCompletions, rememberSeenChallengeCompletion } from "../src/lib/notifications.js";
import { relicSlotUnlocks, xpProgress } from "../src/lib/progression.js";
import type { AppData, Catalog, CollectibleUnlockChallenge, PlayerState, ResolvedEffectRef } from "../src/lib/types.js";

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
  runtimeKind: "stat_modifier" | "mana_dice_modifier" | "action_cost_modifier",
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
  currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [], tags: [],
  elements: [
    { id: "ember", name: "Ember", description: null, asset_path: null, sort_order: 1 },
    { id: "bloom", name: "Bloom", description: null, asset_path: null, sort_order: 2 },
  ],
  elementEffectiveness: [{ attacking_element_id: "ember", defending_element_id: "ember", multiplier: 1 }],
  skills: [
    { id: "starter-skill", name: "Starter Skill", element_id: "ember", skill_type: "support", power: 0, mana_cost: 3, targeting: "self_only", description: "Starter Skill", sort_order: 0, tag_ids: [] },
    { id: "bloom-attack", name: "Bloom Attack", element_id: "bloom", skill_type: "attack", power: 40, mana_cost: 4, targeting: "single_enemy", description: "Bloom Attack", sort_order: 1, tag_ids: [] },
  ],
  critters: [
    { id: "hero", name: "Hero", element_1_id: "ember", element_2_id: null, base_hp: 30, base_atk: 25, base_def: 20, base_spd: 15, base_dice_min: 1, base_dice_max: 6, base_block_cost: 2, base_swap_cost: 2, asset_path: null, description: null, sort_order: 1, tag_ids: [] },
    { id: "ally", name: "Ally", element_1_id: "ember", element_2_id: null, base_hp: 20, base_atk: 20, base_def: 20, base_spd: 20, base_dice_min: 1, base_dice_max: 6, base_block_cost: 2, base_swap_cost: 2, asset_path: null, description: null, sort_order: 2, tag_ids: [] },
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
  ], dungeons: [], dungeonOpponents: [], dungeonCompletionDrops: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [], statuses: [],
  effectsBySkill: {},
  effectsByAbility: {
    "high-roll": [
      effect("ability", "high-roll", "Maximum Roll", "mana_dice_modifier", { target: "all_friendlies", minimum_delta: 0, maximum_delta: 3 }, 0),
      effect("ability", "high-roll", "Defense Cost", "stat_modifier", { target: "all_friendlies", stat: "def", value_mode: "flat", amount: -2 }, 1),
      effect("ability", "high-roll", "Block Cost", "action_cost_modifier", { target: "all_friendlies", cost_type: "block", applicable_action: "all_actions", modifier_type: "flat", modifier_value: -1 }, 2),
      effect("ability", "high-roll", "Bloom Attack Cost", "action_cost_modifier", { target: "all_friendlies", cost_type: "skill_mana", applicable_action: "skills_attack", element_ids: ["bloom"], modifier_type: "flat", modifier_value: -2 }, 3),
    ],
  },
  effectsByRelic: {
    guard: [
      effect("relic", "guard", "Guard", "stat_modifier", { target: "equipped_critter", stat: "def", value_mode: "flat", amount: 3 }, 0),
      effect("relic", "guard", "Weight", "stat_modifier", { target: "equipped_critter", stat: "atk", value_mode: "flat", amount: -1 }, 1),
      effect("relic", "guard", "Mana Talisman", "action_cost_modifier", { target: "equipped_critter", cost_type: "skill_mana", applicable_action: "all_actions", modifier_type: "flat", modifier_value: -1 }, 2),
    ],
    "ally-aura": [effect("relic", "ally-aura", "Aura", "stat_modifier", { target: "equipped_allies", stat: "hp", value_mode: "flat", amount: 2 }, 0)],
  },
  effectsByStatus: {}, dungeonOpponentStatOverrides: [],
} as Catalog;

const player = {
  profile: { user_id: "user", username: "Test", coins: 0, starter_rollcaster_selected_at: "now", starter_selected_at: "now", active_rollcaster_id: "owned-rollcaster" },
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
  collectibleSnapshot: { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] },
} as PlayerState;

const calculated = calculateLoadoutStats({ catalog, player } as AppData, player.critters[0]);
check(calculated.stats.hp === 32, "An ally Relic must affect the selected squad Critter.");
check(calculated.stats.atk === 24, "The equipped Relic ATK penalty must be reflected on the home card.");
check(calculated.stats.def === 21, "Positive and negative DEF deltas must combine into the combat value.");
check(calculated.stats.diceMin === 1 && calculated.stats.diceMax === 9, "Only the modified Mana maximum must change.");
catalog.effectsByRelic.guard.push(effect("relic", "guard", "capped-minimum", "mana_dice_modifier", { target: "equipped_critter", minimum_delta: 10, maximum_delta: 0 }, 3));
const cappedCalculated = calculateLoadoutStats({ catalog, player } as AppData, player.critters[0]);
check(cappedCalculated.stats.diceMin === 9 && cappedCalculated.stats.diceMax === 9, "Loadout Mana stats must cap an over-maximum minimum at the displayed maximum.");
check(cappedCalculated.breakdowns.diceMin?.final === 9 && cappedCalculated.breakdowns.diceMax?.final === 9, "Loadout Mana breakdowns must retain the capped final values for stat tooltips.");
check(calculated.stats.blockCost === 1, "A Block action-cost discount must reduce the home stat value.");
check(calculated.skillCosts["starter-skill"]?.final === 2, "A Mana Talisman-style Skill cost discount must reduce the home Skill tile cost.");
check(calculated.skillCosts["starter-skill"]?.sources[0]?.amount === -1 && calculated.skillCosts["starter-skill"]?.sources[0]?.sourceName === "Guard Charm", "Skill cost breakdowns must retain the discount source.");
check(calculated.skillCosts["bloom-attack"]?.final === 1, "Skill action-cost filters must match the Skill type and Element in loadout previews without filtering the receiving Critter by Skill Element.");
check(calculated.breakdowns.def?.sources.map((source) => source.amount).join(",") === "3,-2", "The DEF tooltip must retain positive and negative source deltas in resolution order.");
check([...equippedRelicIdsForCritter(player.relicSlots, "owned-hero")].join(",") === "guard", "The Relic equip popup must identify Relics already equipped to the target Critter.");
check(equippedRelicIdsForCritter(player.relicSlots, "owned-hero").has("ally-aura") === false, "A Relic equipped to another Critter must remain eligible when an extra copy is available.");

check(nextOpenSquadSlot([
  { slot_index: 1, user_critter_id: "owned-hero" },
  { slot_index: 2, user_critter_id: "owned-ally" },
  { slot_index: 3, user_critter_id: null },
], 5) === 3, "A new Critter requested for slot 5 must use the first open slot below it.");
check(nextOpenSquadSlot([
  { slot_index: 1, user_critter_id: "owned-hero" },
  { slot_index: 2, user_critter_id: "owned-ally" },
  { slot_index: 3, user_critter_id: null },
], 4) === 3, "A new Critter requested for slot 4 must use the first open slot below it.");
check(nextOpenSquadSlot([
  { slot_index: 1, user_critter_id: "owned-hero" },
  { slot_index: 2, user_critter_id: "owned-ally" },
  { slot_index: 3, user_critter_id: null },
], 3) === 3, "A new Critter requested for its open slot must remain in that slot.");
check(nextOpenSquadSlot([
  { slot_index: 1, user_critter_id: "owned-hero" },
  { slot_index: 2, user_critter_id: "owned-ally" },
  { slot_index: 3, user_critter_id: "owned-third" },
], 3) === 3, "An occupied requested slot must remain stable for replacements and removals.");

const trackedChallenge = (id: string): CollectibleUnlockChallenge => ({
  id,
  collectible_type: "critter",
  collectible_id: "hero",
  challenge_type: "deal_damage",
  parameters: { target_mode: "species", any_target: true, target_ids: [], required_amount: 5 },
  target_category: "critter",
  target_id: "hero",
  target_mode: "species",
  any_target: true,
  target_ids: [],
  required_amount: "5",
  required_level: null,
  sort_order: 0,
});
const sparseTrackingData = {
  catalog: { ...catalog, collectibleUnlockChallenges: [trackedChallenge("tracked-top"), trackedChallenge("tracked-bottom")] },
  player: {
    ...player,
    collectibleSnapshot: {
      ...player.collectibleSnapshot,
      progress: ["tracked-top", "tracked-bottom"].map((challenge_id) => ({
        challenge_id,
        current: "1",
        goal: "5",
        completed: false,
        eligible: true,
        trackable: true,
      })),
      tracked: [
        { challenge_id: "tracked-top", slot_order: 1 },
        { challenge_id: "tracked-bottom", slot_order: 3 },
      ],
    },
  },
} as AppData;
check(trackedChallengesForDisplay(sparseTrackingData).map((row) => `${row.challenge_id}:${row.slot_order}`).join(",") === "tracked-top:1,tracked-bottom:2", "Sparse tracked slots must compact after a manual untrack.");
check(trackedSlotFor(sparseTrackingData, "tracked-bottom") === 2, "Tracked challenge controls must report the compacted slot number.");
const goalReachedButUnmarkedData = {
  ...sparseTrackingData,
  player: {
    ...sparseTrackingData.player!,
    collectibleSnapshot: {
      ...sparseTrackingData.player!.collectibleSnapshot,
      progress: sparseTrackingData.player!.collectibleSnapshot.progress.map((progress) => progress.challenge_id === "tracked-top"
        ? { ...progress, current: "5", goal_reached: true, completed: false }
        : progress),
    },
  },
} as AppData;
check(trackedChallengesForDisplay(goalReachedButUnmarkedData).map((row) => row.challenge_id).join(",") === "tracked-bottom", "A goal-reached tracked challenge must release its visible tracking slot even if the server completion flag is stale.");
const completedTrackingData = {
  ...sparseTrackingData,
  player: {
    ...sparseTrackingData.player!,
    collectibleSnapshot: {
      ...sparseTrackingData.player!.collectibleSnapshot,
      progress: sparseTrackingData.player!.collectibleSnapshot.progress.map((progress) => progress.challenge_id === "tracked-top" ? { ...progress, completed: true } : progress),
      tracked: [],
    },
  },
} as AppData;
check(completedTrackedChallengeIds(sparseTrackingData, completedTrackingData).join(",") === "tracked-top", "A completed tracked challenge must be identified for its completion banner.");
const notificationStorage = new Map<string, string>();
const notificationStorageAdapter = {
  getItem: (key: string) => notificationStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { notificationStorage.set(key, value); },
};
const firstSeenCompletions = loadSeenChallengeCompletions(notificationStorageAdapter, "user");
rememberSeenChallengeCompletion(notificationStorageAdapter, "user", firstSeenCompletions, "tracked-top");
check(loadSeenChallengeCompletions(notificationStorageAdapter, "user").has("tracked-top"), "A completion banner identity must survive a browser refresh.");

const legacyGateChallenge: CollectibleUnlockChallenge = {
  ...trackedChallenge("boost-box-dungeon-gate"),
  id: "boost-box-dungeon-gate",
  challenge_type: "dungeon_clear",
  parameters: { dungeon_selection: "specific_dungeon", dungeon_ids: ["001"], required_clears: 1 },
  required_amount: "1",
  gate_order: 1,
};
const legacyPostGateDamageChallenge: CollectibleUnlockChallenge = {
  ...trackedChallenge("boost-box-post-gate-damage"),
  id: "boost-box-post-gate-damage",
  parameters: { target_mode: "species", any_target: true, target_ids: [], required_amount: 5 },
  sort_order: 1,
  gate_order: null,
};
const legacyGatedTrackingData = {
  catalog: {
    ...catalog,
    collectibleUnlockRequirements: [{ collectible_type: "critter", collectible_id: "hero", required_challenges: 2 }],
    collectibleUnlockChallenges: [legacyGateChallenge, legacyPostGateDamageChallenge],
  },
  player: {
    ...player,
    collectibleSnapshot: {
      ...player.collectibleSnapshot,
      // This is the pre-gate snapshot shape: progress has no eligibility or
      // trackability fields, even though the catalog has a pending Gate 1.
      progress: [
        { challenge_id: legacyGateChallenge.id, current: "0", goal: "1", completed: false },
        { challenge_id: legacyPostGateDamageChallenge.id, current: "0", goal: "5", completed: false },
      ],
      tracked: [{ challenge_id: legacyPostGateDamageChallenge.id, slot_order: 1 }],
    },
  },
} as AppData;
const blockedLegacyDamage = progressFor(legacyGatedTrackingData, legacyPostGateDamageChallenge.id);
check(blockedLegacyDamage.eligible === false && blockedLegacyDamage.trackable === false,
  "A post-gate damage challenge must remain blocked when a legacy snapshot omits gate state.");
check(trackedChallengesForDisplay(legacyGatedTrackingData).length === 0,
  "A post-gate damage challenge must not remain in tracking display before its dungeon gate is complete.");
const completedLegacyGateData = {
  ...legacyGatedTrackingData,
  player: {
    ...legacyGatedTrackingData.player!,
    collectibleSnapshot: {
      ...legacyGatedTrackingData.player!.collectibleSnapshot,
      progress: legacyGatedTrackingData.player!.collectibleSnapshot.progress.map((progress) =>
        progress.challenge_id === legacyGateChallenge.id ? { ...progress, current: "1" } : progress),
    },
  },
} as AppData;
const eligibleLegacyDamage = progressFor(completedLegacyGateData, legacyPostGateDamageChallenge.id);
check(eligibleLegacyDamage.eligible === true && eligibleLegacyDamage.trackable === true,
  "A post-gate damage challenge must become trackable after its dungeon gate reaches its goal.");

const ownershipChallenge: CollectibleUnlockChallenge = {
  id: "ownership-seven",
  collectible_type: "critter",
  collectible_id: "hero",
  challenge_type: "own_collectible",
  parameters: {
    collectible_category: "critter",
    collectible_ids: [],
    required_amount: 7,
    require_unique_collectibles: true,
    retroactive: true,
  },
  target_category: "critter",
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: "7",
  required_level: null,
  sort_order: 0,
};
const ownershipData = {
  catalog: { ...catalog, collectibleUnlockChallenges: [ownershipChallenge] },
  player,
} as AppData;
check(challengeDescription(ownershipData, ownershipChallenge) === "Own 7 different Critters.", "Quantity ownership text must put 'different' before the collectible name.");
const ownershipProgress = progressFor(ownershipData, ownershipChallenge.id);
check(ownershipProgress.current === "2" && ownershipProgress.goal === "7", "A missing snapshot row must derive ownership progress instead of rendering 0 / 0.");
check(ownershipProgress.trackable === false, "A catalog row missing from the authoritative snapshot must not be trackable.");

const taggedOwnershipChallenge = {
  ...ownershipChallenge,
  id: "ownership-tagged",
  parameters: { ...ownershipChallenge.parameters, required_amount: 1, collectible_ids: [], critter_tag_ids: ["final-stage"] },
  required_amount: "1",
} satisfies CollectibleUnlockChallenge;
const taggedOwnershipData = {
  catalog: {
    ...ownershipData.catalog,
    tags: [{ id: "final-stage", name: "Final Stage", description: null, tag_type: "critter", sort_order: 1 }],
    critters: ownershipData.catalog.critters.map((critter, index) => ({ ...critter, tag_ids: index === 0 ? ["final-stage"] : [] })),
    collectibleUnlockChallenges: [taggedOwnershipChallenge],
  },
  player: ownershipData.player,
} as AppData;
check(progressFor(taggedOwnershipData, taggedOwnershipChallenge.id).current === "1", "Tagged ownership progress must count an owned Critter with the selected tag.");
check(challengeDescription(taggedOwnershipData, taggedOwnershipChallenge) === "Own 1 different Critter tagged Final Stage.", "Tagged ownership text must identify the selected Critter Tag.");

const quantityRelicChallenge = {
  ...ownershipChallenge,
  id: "relic-copies",
  parameters: { ...ownershipChallenge.parameters, collectible_category: "relic", collectible_ids: ["guard"], required_amount: 3, require_unique_collectibles: false },
  target_category: "relic",
  target_id: "guard",
  required_amount: "3",
} satisfies CollectibleUnlockChallenge;
check(challengeDescription(ownershipData, quantityRelicChallenge) === "Own 3 of: Guard Charm.", "Quantity-based Relic ownership text must match the dev default.");

const gatedRelic = {
  ...catalog.relics[0],
  id: "polished-ivory-gated-relic",
};
const gatedRelicChallenge = {
  ...quantityRelicChallenge,
  id: "polished-ivory-gate",
  collectible_type: "relic",
  collectible_id: gatedRelic.id,
  parameters: {
    collectible_category: "relic",
    collectible_ids: ["guard"],
    required_amount: 3,
    require_unique_collectibles: false,
  },
  target_category: "relic",
  target_id: "guard",
  required_amount: "3",
} satisfies CollectibleUnlockChallenge;
const gatedRelicData = {
  catalog: {
    ...catalog,
    relics: [...catalog.relics, gatedRelic],
    collectibleUnlockRequirements: [{ collectible_type: "relic", collectible_id: gatedRelic.id, required_challenges: 1 }],
    collectibleUnlockChallenges: [gatedRelicChallenge],
  },
  player: {
    ...player,
    relicInventory: [{ user_id: "user", relic_id: gatedRelic.id, quantity: 1, discovered_at: "now" }],
    collectibleSnapshot: {
      ...player.collectibleSnapshot,
      progress: [{ challenge_id: gatedRelicChallenge.id, current: "0", goal: "3", completed: false, eligible: true }],
    },
  },
} as AppData;
check(!collectibleIsUnlocked(gatedRelicData, "relic", gatedRelic.id), "Owning a gated Relic must not unlock it before its required challenges are complete.");
const dependentOwnershipChallenge = {
  ...ownershipChallenge,
  id: "depends-on-gated-relic",
  collectible_type: "critter",
  collectible_id: "hero",
  parameters: {
    ...ownershipChallenge.parameters,
    collectible_category: "relic",
    collectible_ids: [gatedRelic.id],
    required_amount: 1,
  },
  target_category: "relic",
  target_id: gatedRelic.id,
  required_amount: "1",
} satisfies CollectibleUnlockChallenge;
const dependentOwnershipData = {
  catalog: {
    ...gatedRelicData.catalog,
    collectibleUnlockChallenges: [gatedRelicChallenge, dependentOwnershipChallenge],
  },
  player: gatedRelicData.player,
} as AppData;
check(progressFor(dependentOwnershipData, dependentOwnershipChallenge.id).current === "0", "A dependent ownership challenge must ignore a Relic inventory row until that Relic is unlocked.");
const historicallyUnlockedRelicData = {
  ...gatedRelicData,
  player: {
    ...gatedRelicData.player!,
    collectibleSnapshot: {
      ...gatedRelicData.player!.collectibleSnapshot,
      unlocked_collectibles: [{ collectible_type: "relic" as const, collectible_id: gatedRelic.id }],
    },
  },
} as AppData;
check(collectibleIsUnlocked(historicallyUnlockedRelicData, "relic", gatedRelic.id), "A server-recorded unlock must remain usable even when the live goal changes.");
gatedRelicData.player!.collectibleSnapshot.progress[0].current = "3";
gatedRelicData.player!.collectibleSnapshot.progress[0].goal_reached = true;
gatedRelicData.player!.collectibleSnapshot.progress[0].completed = true;
check(collectibleIsUnlocked(gatedRelicData, "relic", gatedRelic.id), "A gated Relic must unlock after the required challenge count is complete.");

const thresholdChallenges = [
  gatedRelicChallenge,
  { ...gatedRelicChallenge, id: "polished-ivory-gate-two", sort_order: 1 },
  { ...gatedRelicChallenge, id: "polished-ivory-gate-three", sort_order: 2 },
];
const thresholdData = {
  catalog: {
    ...gatedRelicData.catalog,
    collectibleUnlockRequirements: [{ collectible_type: "relic", collectible_id: gatedRelic.id, required_challenges: 2 }],
    collectibleUnlockChallenges: thresholdChallenges,
  },
  player: {
    ...gatedRelicData.player!,
    collectibleSnapshot: {
      ...gatedRelicData.player!.collectibleSnapshot,
      progress: thresholdChallenges.map((challenge, index) => ({
        challenge_id: challenge.id,
        current: index < 2 ? "1" : "0",
        goal: "1",
        completed: index < 2,
        eligible: true,
      })),
    },
  },
} as AppData;
check(collectibleIsUnlocked(thresholdData, "relic", gatedRelic.id), "A collectible must unlock when its configured required challenge count, not necessarily every authored row, is complete.");

console.log("Collection progression and loadout stat tests passed.");
