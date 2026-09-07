import { applySkillArsenalEvent, challengeEventIncrement, type ChallengeEvent } from "../src/lib/challenges.js";
import { assertEffectContract } from "../src/lib/effects.js";
import type { CollectibleUnlockChallenge, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function challenge(challengeType: CollectibleUnlockChallenge["challenge_type"], parameters: Record<string, unknown>): CollectibleUnlockChallenge {
  return {
    id: `tag-${challengeType}`,
    collectible_type: "critter",
    collectible_id: "tagged-reward",
    challenge_type: challengeType,
    target_category: null,
    target_id: null,
    target_mode: null,
    any_target: false,
    target_ids: [],
    required_amount: "1",
    required_level: null,
    sort_order: 0,
    parameters,
  };
}

const damageEvent: ChallengeEvent = {
  eventId: "damage-1",
  type: "hp_damage_dealt",
  sourceCritterId: "bloom-critter",
  targetCritterId: "final-critter",
  skillId: "pulse-skill",
  sourceCritterTagIds: ["first-stage"],
  targetCritterTagIds: ["final-stage"],
  skillTagIds: ["pulse"],
  amount: 7,
};
const damageChallenge = challenge("deal_damage", {
  required_amount: 1,
  source_critter_tag_ids: ["first-stage"],
  target_critter_tag_ids: ["final-stage"],
  source_skill_tag_ids: ["pulse"],
});
check(challengeEventIncrement(damageChallenge, damageEvent) === 7, "Damage challenges must require matching source Critter, target Critter, and Skill tags together.");
check(challengeEventIncrement(damageChallenge, { ...damageEvent, targetCritterTagIds: ["middle-stage"] }) === 0, "Damage challenges must reject a target whose tags do not match.");

const useSkillEvent: ChallengeEvent = {
  eventId: "skill-1",
  type: "skill_resolved",
  sourceCritterId: "first-critter",
  sourceCritterTagIds: ["first-stage"],
  skillId: "pulse-skill",
  skillTagIds: ["pulse", "contact"],
  payload: { skill_element_id: "bloom", skill_type: "attack" },
  amount: 1,
};
const pulseChallenge = challenge("use_skill", {
  required_amount: 100,
  source_critter_tag_ids: ["first-stage"],
  skill_tag_ids: ["pulse"],
});
check(challengeEventIncrement(pulseChallenge, useSkillEvent) === 1, "Use Skill challenges must match Skill Tags and the using Critter's tags.");

const specificPulseChallenge = challenge("use_skill", {
  required_amount: 1,
  skill_ids: ["pulse-skill"],
  element_ids: ["bloom"],
  skill_tag_ids: ["pulse"],
});
check(challengeEventIncrement(specificPulseChallenge, useSkillEvent) === 1, "Use Skill must combine optional specific Skill, Element, and Tag filters.");
check(challengeEventIncrement(specificPulseChallenge, { ...useSkillEvent, skillId: "other-skill" }) === 0, "Use Skill must reject a non-selected specific Skill.");
const attackOnlyChallenge = challenge("use_skill", { required_amount: 1, skill_type: "attack" });
check(challengeEventIncrement(attackOnlyChallenge, useSkillEvent) === 1, "Use Skill must match the selected Attack Skill Type.");
check(challengeEventIncrement(attackOnlyChallenge, { ...useSkillEvent, skillType: "support", payload: { ...useSkillEvent.payload, skill_type: "support" } }) === 0, "Use Skill must reject the opposite Skill Type.");

const arsenalChallenge = challenge("skill_arsenal" as CollectibleUnlockChallenge["challenge_type"], {
  required_distinct_skills: 2,
  minimum_uses_per_skill: 2,
  required_completions: 1,
  tracking_scope: "single_encounter",
  skill_type: "attack",
  skill_tag_ids: ["pulse"],
});
const arsenalAfterFirstPulse = applySkillArsenalEvent(arsenalChallenge, useSkillEvent, {});
check(Object.keys(arsenalAfterFirstPulse.skillUseCounts).length === 1 && arsenalAfterFirstPulse.qualifiedSkillIds.length === 0, "Skill Arsenal must count a matching Skill without qualifying it before the per-Skill minimum.");
const arsenalAfterSecondPulse = applySkillArsenalEvent(arsenalChallenge, { ...useSkillEvent, eventId: "skill-2" }, arsenalAfterFirstPulse);
check(arsenalAfterSecondPulse.qualifiedSkillIds.join(",") === "pulse-skill", "Skill Arsenal must qualify a Skill after its minimum uses.");
const arsenalAfterSecondSkill = applySkillArsenalEvent(arsenalChallenge, { ...useSkillEvent, eventId: "skill-3", skillId: "second-pulse-skill" }, arsenalAfterSecondPulse);
check(arsenalAfterSecondSkill.qualifiedSkillIds.length === 1, "Skill Arsenal must not qualify a second Skill before its minimum uses.");
const arsenalComplete = applySkillArsenalEvent(arsenalChallenge, { ...useSkillEvent, eventId: "skill-4", skillId: "second-pulse-skill" }, arsenalAfterSecondSkill);
check(arsenalComplete.qualifiedSkillIds.length === 2, "Skill Arsenal must count distinct matching Skills within one scope.");
check(arsenalComplete.skillUseCounts["second-pulse-skill"] === 2, "Skill Arsenal must retain per-Skill use counts.");
check(applySkillArsenalEvent(arsenalChallenge, { ...useSkillEvent, eventId: "skill-support", skillType: "support", payload: { ...useSkillEvent.payload, skill_type: "support" } }, arsenalComplete).qualifiedSkillIds.length === 2, "Skill Arsenal must reject Skills with the wrong type.");
check(applySkillArsenalEvent(arsenalChallenge, { ...useSkillEvent, eventId: "skill-untagged", skillTagIds: ["other-tag"] }, arsenalComplete).qualifiedSkillIds.length === 2, "Skill Arsenal must reject Skills without a selected Skill Tag.");

const healEvent: ChallengeEvent = {
  eventId: "heal-1",
  type: "hp_healed",
  sourceCritterId: "medic-critter",
  targetCritterId: "first-critter",
  skillId: "burst-skill",
  sourceCritterTagIds: ["middle-stage"],
  targetCritterTagIds: ["first-stage"],
  skillTagIds: ["burst"],
  payload: { source_side: "player", recipient_side: "friendly" },
  amount: 4,
};
const burstHealChallenge = challenge("heal_hp", {
  required_amount: 1,
  recipient_side: "friendly",
  target_critter_tag_ids: ["first-stage"],
  source_critter_tag_ids: ["middle-stage"],
  source_skill_tag_ids: ["burst"],
});
check(challengeEventIncrement(burstHealChallenge, healEvent) === 4, "Healing challenges must match source, recipient, and source Skill tags.");

const taggedConditional: ResolvedEffectRef = {
  id: "tagged-conditional",
  name: "Tagged Conditional",
  description: "Tagged Conditional",
  ownerType: "relic",
  ownerId: "stage-relic",
  templateId: "conditional-effect",
  runtimeKind: "conditional_effect",
  runtimeVersion: 1,
  sortOrder: 0,
  parameters: {
    effect_target: "equipped_critter",
    condition_target: "skill_targets",
    condition: "tags",
    comparison: "equal",
    condition_target_critter_tag_ids: ["final-stage"],
    effect_target_critter_tag_ids: ["first-stage", "middle-stage"],
    true_effect_ids: ["amplify"],
    false_effect_ids: [],
    check_timing: "continuous",
    remove_effects_when_false: true,
  },
};
assertEffectContract(taggedConditional, "relic");

console.log("Critter Tag, Skill Tag, challenge-filter, and conditional-effect contract tests passed.");
