import { challengeEventIncrement } from "../src/lib/challenges.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const challenge = (overrides: Record<string, unknown> = {}) => ({
  id: "closing-move",
  collectible_type: "critter",
  collectible_id: "001",
  challenge_type: "closing_move",
  target_category: null,
  target_id: null,
  target_mode: null,
  any_target: false,
  target_ids: [],
  required_amount: "10",
  required_level: null,
  sort_order: 0,
  parameters: {
    finisher_type: "skill",
    skill_ids: ["punch"],
    skill_tag_ids: [],
    skill_element_ids: ["fire"],
    status_ids: [],
    source_critter_ids: ["001"],
    source_element_ids: ["fire"],
    target_critter_ids: ["101"],
    target_element_ids: ["grass"],
    target_critter_tag_ids: ["boss"],
    final_knockout_scope: "end_of_encounter",
    required_completions: 10,
    failure_policy: "no_increment",
    ...overrides,
  },
}) as never;

const event = (payload: Record<string, unknown> = {}) => ({
  eventId: "battle:turn:4:final-knockout-attribution",
  type: "final_knockout_attribution",
  battleId: "battle-1",
  dungeonRunId: "run-1",
  sourceCritterId: "001",
  targetCritterId: "101",
  sourceElementIds: ["fire"],
  targetElementIds: ["grass"],
  skillTagIds: [],
  skillId: "punch",
  amount: 1,
  payload: {
    battle_won: true,
    finisher_type: "skill",
    source_side: "player",
    target_side: "opponent",
    skill_element_id: "fire",
    status_id: null,
    remaining_enemy_count: 0,
    remaining_active_enemy_count: 0,
    is_end_of_encounter: true,
    is_end_of_dungeon: true,
    source_critter_tag_ids: ["starter"],
    target_critter_tag_ids: ["boss"],
    ...payload,
  },
}) as never;

check(challengeEventIncrement(challenge(), event()) === 1, "A matching final Skill knockout must increment once.");
check(challengeEventIncrement(challenge({ skill_ids: ["kick"] }), event()) === 0, "The configured finishing Skill must filter the final knockout.");
check(challengeEventIncrement(challenge({ skill_element_ids: ["aqua"] }), event()) === 0, "The configured finishing Skill Element must filter the final knockout.");
check(challengeEventIncrement(challenge({ finisher_type: "status_tick", skill_ids: [] }), event()) === 0, "The configured finisher type must filter the final knockout.");
check(challengeEventIncrement(challenge({ finisher_type: "status_tick", skill_ids: [], skill_element_ids: [], status_ids: ["burning"] }), event({ finisher_type: "status_tick", skill_id: null, skill_element_id: null, status_id: "burning" })) === 1, "A matching Damage Over Time Status must increment the final knockout.");
check(challengeEventIncrement(challenge({ finisher_type: "status_tick", skill_ids: [], skill_element_ids: [], status_ids: ["poisoned"] }), event({ finisher_type: "status_tick", skill_ids: [], skill_element_id: null, status_id: "burning" })) === 0, "The configured ticking Status must filter the final knockout.");
check(challengeEventIncrement(challenge({ final_knockout_scope: "end_of_encounter" }), event({ is_end_of_encounter: false })) === 0, "End of Encounter scope must require the encounter-ending attribution.");
check(challengeEventIncrement(challenge({ final_knockout_scope: "end_of_dungeon" }), event()) === 1, "End of Dungeon scope must accept a final encounter knockout.");
check(challengeEventIncrement(challenge({ final_knockout_scope: "end_of_dungeon" }), event({ is_end_of_dungeon: false })) === 0, "End of Dungeon scope must require the Dungeon-ending attribution.");
check(challengeEventIncrement(challenge(), event({ remaining_enemy_count: 1, is_end_of_encounter: false })) === 0, "A non-final knockout must not increment.");
check(challengeEventIncrement(challenge(), event({ battle_won: false })) === 0, "A failed battle must not increment or reset progress.");

console.log("Closing Move Game matcher tests passed.");
