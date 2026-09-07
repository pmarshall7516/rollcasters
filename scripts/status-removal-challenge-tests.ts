import { challengeEventIncrement, type ChallengeEvent } from "../src/lib/challenges.js";
import { challengeDescription } from "../src/lib/collectibles.js";
import { applyLocalChallengeEvents, emptyLocalChallengePreviewState, trackLocalChallenge } from "../src/lib/local-challenge-preview.js";
import type { CollectibleUnlockChallenge } from "../src/lib/types.js";

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

const challenge = {
  id: "status-removal",
  collectible_type: "relic",
  collectible_id: "001",
  challenge_type: "status_removal",
  target_category: null,
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: "30",
  required_level: null,
  sort_order: 1,
  parameters: {
    removal_kind: "statuses",
    status_ids: ["decay"],
    status_classification: "negative",
    target_side: "friendlies",
    removal_reason: "skill",
    source_critter_ids: [],
    skill_ids: ["natural-cure"],
    skill_tag_ids: [],
    ability_ids: [],
    relic_ids: [],
    required_amount: 30,
    tracking_scope: "lifetime",
  },
} as unknown as CollectibleUnlockChallenge;

const event = {
  eventId: "battle:turn:1:effect-removed:1",
  type: "effect_removed",
  sourceCritterId: "036",
  targetCritterId: "036",
  skillId: "natural-cure",
  amount: 1,
  payload: {
    removal_kind: "status",
    removal_reason: "skill",
    status_id: "decay",
    status_classification: "negative",
    target_side: "player",
    source_owner_type: "skill",
    source_owner_id: "natural-cure",
    skill_tag_ids: [],
  },
} as unknown as ChallengeEvent;

equal(challengeEventIncrement(challenge, event), 1, "Matching Status removal should increment");
equal(challengeEventIncrement(challenge, { ...event, payload: { ...event.payload, status_id: "toxic" } }), 0, "Wrong Status should not increment");
equal(challengeEventIncrement(challenge, { ...event, payload: { ...event.payload, target_side: "opponent" } }), 0, "Wrong target side should not increment");
const negativeModifierEvent = {
  ...event,
  payload: {
    ...event.payload,
    removal_kind: "negative_stat_modifier",
    status_id: null,
    modifier_stat: "atk",
    modifier_polarity: "negative",
  },
} as unknown as ChallengeEvent;
const negativeModifierChallenge = {
  ...challenge,
  parameters: {
    ...challenge.parameters,
    removal_kind: "negative_stat_modifiers",
    status_ids: [],
    status_classification: "any",
    skill_ids: [],
  },
} as unknown as CollectibleUnlockChallenge;
equal(challengeEventIncrement(negativeModifierChallenge, negativeModifierEvent), 1, "Negative stat modifier removal should increment in modifier-only mode");
equal(challengeEventIncrement(negativeModifierChallenge, event), 0, "Modifier-only mode should reject Status removal events");
const eitherChallenge = {
  ...negativeModifierChallenge,
  parameters: { ...negativeModifierChallenge.parameters, removal_kind: "either" },
} as unknown as CollectibleUnlockChallenge;
equal(challengeEventIncrement(eitherChallenge, event), 1, "Either mode should accept Status removal events");
equal(challengeEventIncrement(eitherChallenge, negativeModifierEvent), 1, "Either mode should accept negative stat modifier removal events");
const descriptionData = {
  catalog: {
    relics: [{ id: "001", name: "Test Relic" }],
    critters: [],
    rollcasters: [],
    statuses: [{ id: "decay", name: "Decay" }],
    skills: [{ id: "natural-cure", name: "Natural Cure" }],
  },
} as any;
equal(
  challengeDescription(descriptionData, challenge),
  "Remove 30 Decay from friendly Critters using Natural Cure with Skill.",
  "Status Removal descriptions should include the selected Status, target side, Skill, and reason",
);
const modifierChallenge = {
  ...challenge,
  parameters: {
    ...challenge.parameters,
    removal_kind: "negative_stat_modifiers",
    status_ids: [],
    skill_ids: [],
    removal_reason: "any",
  },
} as unknown as CollectibleUnlockChallenge;
equal(
  challengeDescription(descriptionData, modifierChallenge),
  "Remove 30 negative stat modifiers from friendly Critters.",
  "Status Removal descriptions should support negative stat modifier mode",
);
const previewEvent = {
  event_key: "preview:turn:1:effect_removed",
  event_type: "effect_removed",
  source_critter_id: "036",
  target_critter_id: "036",
  skill_id: "natural-cure",
  amount: 1,
  payload: event.payload,
} as any;
let previewState = trackLocalChallenge(emptyLocalChallengePreviewState(), challenge);
previewState = applyLocalChallengeEvents(previewState, [challenge], [previewEvent]);
equal(previewState.progress[0]?.current, "1", "Local challenge preview should count a matching Status removal");
previewState = applyLocalChallengeEvents(previewState, [challenge], [previewEvent]);
equal(previewState.progress[0]?.current, "1", "Local challenge preview should not double-count a repeated removal event");
console.log("Status Removal Game matcher contract passed.");
