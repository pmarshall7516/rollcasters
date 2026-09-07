import {
  applyLocalChallengeEvents,
  emptyLocalChallengePreviewState,
  mergeLocalChallengeSnapshot,
  readLocalChallengePreviewState,
  trackLocalChallenge,
  writeLocalChallengePreviewState,
  type LocalChallengePreviewState,
} from "../src/lib/local-challenge-preview.js";
import type { CollectiblePlayerSnapshot, CollectibleUnlockChallenge, CombatProgressEvent } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const afflictStatusChallenge: CollectibleUnlockChallenge = {
  id: "ottice-afflict-status",
  collectible_type: "critter",
  collectible_id: "052",
  challenge_type: "afflict_status",
  target_category: null,
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: "35",
  required_level: null,
  sort_order: 1,
  parameters: {
    status_ids: ["frostbite"],
    target_side: "enemies",
    affliction_mode: "fresh_afflictions",
    required_amount: 35,
    tracking_required: true,
  },
};

const aquaDamageChallenge: CollectibleUnlockChallenge = {
  id: "ottice-aqua-damage",
  collectible_type: "critter",
  collectible_id: "052",
  challenge_type: "deal_damage",
  target_category: null,
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: "1000",
  required_level: null,
  sort_order: 2,
  parameters: {
    damage_mode: "any",
    tracking_scope: "lifetime",
    required_amount: 1000,
    tracking_required: true,
    source_critter_ids: [],
    source_element_ids: [],
    target_critter_ids: [],
    target_element_ids: ["aqua"],
    source_skill_tag_ids: [],
    source_critter_tag_ids: [],
    target_critter_tag_ids: [],
  },
};

const skillArsenalChallenge: CollectibleUnlockChallenge = {
  id: "ottice-skill-arsenal",
  collectible_type: "critter",
  collectible_id: "052",
  challenge_type: "skill_arsenal",
  target_category: null,
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: "1",
  required_level: null,
  sort_order: 3,
  parameters: {
    required_distinct_skills: 2,
    minimum_uses_per_skill: 2,
    tracking_scope: "single_turn",
    required_completions: 1,
    skill_ids: [],
    skill_tag_ids: ["arsenal"],
    element_ids: [],
    skill_type: "attack",
    tracking_required: true,
  },
};

const serverSnapshot: CollectiblePlayerSnapshot = {
  currencies: [],
  shards: [],
  lootboxes: [],
  progress: [],
  tracked: [],
  unlock_events: [],
  unlocked_collectibles: [],
};

let state = emptyLocalChallengePreviewState();
state = trackLocalChallenge(state, afflictStatusChallenge);
state = trackLocalChallenge(state, aquaDamageChallenge);
state = trackLocalChallenge(state, skillArsenalChallenge);
check(state.tracked.map((row) => row.challenge_id).join(",") === "ottice-afflict-status,ottice-aqua-damage,ottice-skill-arsenal", "Local preview must track unpublished candidate challenges.");
check(state.progress.every((row) => row.current === "0" && row.trackable === true), "New local preview challenges must start at zero and remain trackable.");

const frostbiteEvent: CombatProgressEvent = {
  event_key: "local:turn:1:status",
  event_type: "status_afflicted",
  source_critter_id: "052",
  target_critter_id: "enemy-aqua",
  skill_id: "frost-skill",
  amount: 1,
  payload: { status_ids: ["frostbite"], target_side: "opponent", fresh: true },
};
const aquaDamageEvent: CombatProgressEvent = {
  event_key: "local:turn:2:damage",
  event_type: "hp_damage_dealt",
  source_critter_id: "052",
  target_critter_id: "enemy-aqua",
  skill_id: "aqua-hit",
  amount: 12,
  payload: { hp_damage: 7, shield_damage: 5, target_element_ids: ["aqua"] },
};
const arsenalEvents: CombatProgressEvent[] = [
  { event_key: "local:turn:3:skill-a", event_type: "skill_resolved", source_critter_id: "052", target_critter_id: "enemy-aqua", skill_id: "skill-a", amount: 1, skill_tag_ids: ["arsenal"], payload: { battle_id: "run-1:0", turn_number: 3, skill_type: "attack" } },
  { event_key: "local:turn:3:skill-a-2", event_type: "skill_resolved", source_critter_id: "052", target_critter_id: "enemy-aqua", skill_id: "skill-a", amount: 1, skill_tag_ids: ["arsenal"], payload: { battle_id: "run-1:0", turn_number: 3, skill_type: "attack" } },
  { event_key: "local:turn:3:skill-b", event_type: "skill_resolved", source_critter_id: "052", target_critter_id: "enemy-aqua", skill_id: "skill-b", amount: 1, skill_tag_ids: ["arsenal"], payload: { battle_id: "run-1:0", turn_number: 3, skill_type: "attack" } },
  { event_key: "local:turn:3:skill-b-2", event_type: "skill_resolved", source_critter_id: "052", target_critter_id: "enemy-aqua", skill_id: "skill-b", amount: 1, skill_tag_ids: ["arsenal"], payload: { battle_id: "run-1:0", turn_number: 3, skill_type: "attack" } },
];
state = applyLocalChallengeEvents(state, [afflictStatusChallenge, aquaDamageChallenge, skillArsenalChallenge], [frostbiteEvent, aquaDamageEvent, ...arsenalEvents]);
check(state.progress.find((row) => row.challenge_id === afflictStatusChallenge.id)?.current === "1", "Local preview must count a fresh enemy Frostbite affliction.");
check(state.progress.find((row) => row.challenge_id === aquaDamageChallenge.id)?.current === "12", "Local preview must count combined HP and Shield damage to Aqua.");
check(state.progress.find((row) => row.challenge_id === skillArsenalChallenge.id)?.current === "1", "Local preview must award a Skill Arsenal scope after every matching Skill reaches its threshold.");

const duplicateState = applyLocalChallengeEvents(state, [afflictStatusChallenge, aquaDamageChallenge], [aquaDamageEvent]);
check(duplicateState.progress.find((row) => row.challenge_id === aquaDamageChallenge.id)?.current === "12", "Local preview must not double-count a retried combat event.");

const merged = mergeLocalChallengeSnapshot(serverSnapshot, duplicateState);
check(merged.tracked.length === 3, "Local preview tracking must survive a server snapshot refresh.");
check(merged.progress.find((row) => row.challenge_id === aquaDamageChallenge.id)?.current === "12", "Local preview progress must survive a server snapshot refresh.");

const storage = new Map<string, string>();
const browserStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
} as unknown as Storage;
writeLocalChallengePreviewState(browserStorage, "ottice-candidate", duplicateState);
const reloaded = readLocalChallengePreviewState(browserStorage, "ottice-candidate");
check(reloaded.tracked.length === 3 && reloaded.processedEventKeys.length === 6, "Local preview tracking and event receipts must survive browser reload.");

const unrelatedState: LocalChallengePreviewState = emptyLocalChallengePreviewState();
check(unrelatedState.tracked.length === 0, "The local preview state must be independently initializable.");

console.log("Local challenge preview regression passed.");
