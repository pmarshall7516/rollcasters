import { applyDungeonXpRewards } from "../src/lib/progression.js";
import type { DungeonRewardSummary, PlayerState } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const player = {
  profile: {
    user_id: "user",
    username: "Test",
    coins: 0,
    starter_rollcaster_selected_at: "now",
    starter_selected_at: "now",
    active_rollcaster_id: "owned-rollcaster",
  },
  rollcasters: [{ id: "owned-rollcaster", user_id: "user", rollcaster_id: "caster", level: 1, xp: 120, ability_points: 0 }],
  critters: [{ id: "owned-critter", user_id: "user", critter_id: "critter", level: 1, xp: 70, skill_points: 0 }],
  relicInventory: [],
  squadSlots: [],
  skillSlots: [],
  abilitySlots: [],
  relicSlots: [],
  unlockedSkillIdsByCritter: {},
  unlockedAbilityIdsByRollcaster: {},
  dungeonProgress: [],
  collectibleSnapshot: { currencies: [], shards: [], lootboxes: [], progress: [], tracked: [], unlock_events: [], unlocked_collectibles: [] },
} as PlayerState;

const rewards = {
  entries: [],
  defeatedOpponentInstanceIds: [],
  critterXp: { "owned-critter": 15 },
  rollcasterXp: 25,
} satisfies DungeonRewardSummary;

const projected = applyDungeonXpRewards(
  player,
  rewards,
  [
    { critter_id: "critter", level: 1, total_required_xp: 0, grant_skill_points: 0 },
    { critter_id: "critter", level: 2, total_required_xp: 80, grant_skill_points: 1 },
  ],
  [
    { rollcaster_id: "caster", level: 1, total_required_xp: 0, grant_ability_points: 0 },
    { rollcaster_id: "caster", level: 2, total_required_xp: 140, grant_ability_points: 1 },
  ],
);

const projectedCritter = projected.critters[0];
const projectedRollcaster = projected.rollcasters[0];
check(projectedCritter.xp === 85 && projectedCritter.level === 2, "Encounter XP must update the client Critter XP and level before the result screen animates.");
check(projectedCritter.skill_points === 1, "Client Critter progression must include points granted by an immediate XP level-up.");
check(projectedRollcaster.xp === 145 && projectedRollcaster.level === 2, "Dungeon XP must update the active client Rollcaster XP and level before the result screen animates.");
check(projectedRollcaster.ability_points === 1, "Client Rollcaster progression must include points granted by an immediate XP level-up.");

const animationTargetBeforeRefresh = projectedCritter.xp;
const animationTargetAfterRefresh = player.critters[0].xp + rewards.critterXp["owned-critter"];
check(animationTargetBeforeRefresh === animationTargetAfterRefresh, "The background refresh must reconcile to the same XP animation target instead of restarting it.");

console.log(JSON.stringify({
  critter: { xp: projectedCritter.xp, level: projectedCritter.level, skillPoints: projectedCritter.skill_points },
  rollcaster: { xp: projectedRollcaster.xp, level: projectedRollcaster.level, abilityPoints: projectedRollcaster.ability_points },
  animationTarget: animationTargetAfterRefresh,
}));
