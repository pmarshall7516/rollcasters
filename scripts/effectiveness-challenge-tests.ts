import { challengeEventIncrement } from "../src/lib/challenges.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const challenge = (metric: string, overrides: Record<string, unknown> = {}) => ({
  id: "effectiveness-challenge",
  collectible_type: "critter",
  collectible_id: "001",
  challenge_type: "effectiveness_strike",
  target_category: null,
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: "1",
  required_level: null,
  sort_order: 0,
  parameters: {
    tracking_metric: metric,
    effectiveness_classes: ["effective"],
    damage_mode: "total",
    required_amount: 1,
    tracking_scope: "lifetime",
    ...overrides,
  },
}) as never;

const hit = (payload: Record<string, unknown> = {}) => ({
  eventId: "hit-1",
  type: "effectiveness_strike",
  sourceCritterId: "001",
  targetCritterId: "101",
  skillId: "skill-1",
  amount: 12,
  payload: {
    effectiveness_class: "effective",
    hp_damage: 12,
    shield_damage: 0,
    total_damage: 12,
    knocked_out: false,
    source_element_ids: ["fire"],
    target_element_ids: ["grass"],
    source_critter_tag_ids: ["starter"],
    target_critter_tag_ids: ["boss"],
    skill_tag_ids: ["projectile"],
    skill_element_id: "fire",
    ...payload,
  },
}) as never;

check(challengeEventIncrement(challenge("damage"), hit()) === 12, "Effectiveness damage must accumulate total damage.");
check(challengeEventIncrement(challenge("damage", { damage_mode: "hp" }), hit({ hp_damage: 7, shield_damage: 5 })) === 7, "Effectiveness damage must support HP-only progress.");
check(challengeEventIncrement(challenge("damage", { damage_mode: "shield" }), hit({ hp_damage: 7, shield_damage: 5 })) === 5, "Effectiveness damage must support Shield-only progress.");
check(challengeEventIncrement(challenge("hits"), hit({ total_damage: 0 })) === 1, "Effectiveness hit progress must count every classified hit without a damage threshold.");
check(challengeEventIncrement(challenge("knockouts"), hit({ knocked_out: true })) === 1 && challengeEventIncrement(challenge("knockouts"), hit()) === 0, "Effectiveness knockout progress must require a knockout.");
check(challengeEventIncrement(challenge("damage", { effectiveness_classes: ["resisted"], must_knock_out: true }), hit({ effectiveness_class: "resisted", knocked_out: true })) === 12 && challengeEventIncrement(challenge("damage", { effectiveness_classes: ["resisted"], must_knock_out: true }), hit({ effectiveness_class: "resisted" })) === 0, "Effectiveness damage must match classes and knockout requirements.");
check(challengeEventIncrement(challenge("hits", { skill_element_ids: ["fire"] }), hit()) === 1
  && challengeEventIncrement(challenge("hits", { skill_element_ids: ["water"] }), hit()) === 0,
"Effectiveness challenges must filter by the Skill Element.");
check(challengeEventIncrement(challenge("hits", { target_critter_ids: ["102"] }), hit()) === 0, "Effectiveness target filters must apply to the current target hit.");
check(challengeEventIncrement(challenge("skills_hit"), {
  eventId: "skill-1",
  type: "effectiveness_skill_resolved",
  sourceCritterId: "001",
  skillId: "skill-1",
  amount: 1,
  payload: {
    effectiveness_hits: [
      { target_critter_id: "101", effectiveness_class: "neutral", total_damage: 9, hp_damage: 9, shield_damage: 0, knocked_out: false },
      { target_critter_id: "102", effectiveness_class: "effective", total_damage: 11, hp_damage: 11, shield_damage: 0, knocked_out: false },
    ],
    source_element_ids: ["fire"],
    source_critter_tag_ids: ["starter"],
    skill_tag_ids: ["projectile"],
  },
} as never) === 1, "Effectiveness Skill progress must count one qualifying multi-target Skill once.");
for (const effectivenessClass of ["immune", "mega-resisted", "mega-effective"]) {
  check(challengeEventIncrement(challenge("hits", { effectiveness_classes: [effectivenessClass] }), hit({ effectiveness_class: effectivenessClass, total_damage: 0, hp_damage: 0 })) === 1, `${effectivenessClass} must be trackable as a classified hit even with zero damage.`);
  check(challengeEventIncrement(challenge("damage", { effectiveness_classes: [effectivenessClass] }), hit({ effectiveness_class: effectivenessClass, total_damage: 0, hp_damage: 0 })) === 0, `${effectivenessClass} zero damage must add zero damage progress.`);
}

console.log("Effectiveness Challenge runtime tests passed.");
