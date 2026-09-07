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
    source_critter_ids: ["001"],
    source_element_ids: ["fire"],
    target_critter_ids: ["101"],
    target_element_ids: ["grass"],
    target_critter_tag_ids: ["boss"],
    final_knockout_scope: "last_enemy",
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
    remaining_enemy_count: 0,
    remaining_active_enemy_count: 0,
    is_last_enemy_in_dungeon_battle: true,
    source_critter_tag_ids: ["starter"],
    target_critter_tag_ids: ["boss"],
    ...payload,
  },
}) as never;

check(challengeEventIncrement(challenge(), event()) === 1, "A matching final Skill knockout must increment once.");
check(challengeEventIncrement(challenge({ skill_ids: ["kick"] }), event()) === 0, "The configured finishing Skill must filter the final knockout.");
check(challengeEventIncrement(challenge({ finisher_type: "status_tick", skill_ids: [] }), event()) === 0, "The configured finisher type must filter the final knockout.");
check(challengeEventIncrement(challenge({ final_knockout_scope: "last_enemy_in_dungeon_battle" }), event({ is_last_enemy_in_dungeon_battle: false })) === 0, "Dungeon final scope must require the Dungeon final-enemy attribution.");
check(challengeEventIncrement(challenge(), event({ remaining_enemy_count: 1 })) === 0, "A non-final knockout must not increment.");
check(challengeEventIncrement(challenge(), event({ battle_won: false })) === 0, "A failed battle must not increment or reset progress.");

console.log("Closing Move Game matcher tests passed.");
