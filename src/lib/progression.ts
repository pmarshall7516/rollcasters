import type { CritterProgression, DungeonRewardSummary, PlayerState, RollcasterProgression } from "./types.js";

export type XpProgress = {
  current: number;
  needed: number;
  isMaxLevel: boolean;
};

type ProgressionThreshold = {
  level: number;
  total_required_xp: number;
};

type CritterXpProgression = Pick<CritterProgression, "critter_id" | "level" | "total_required_xp" | "grant_skill_points">;
type RollcasterXpProgression = Pick<RollcasterProgression, "rollcaster_id" | "level" | "total_required_xp" | "grant_ability_points">;

function levelAtTotalXp(progression: ProgressionThreshold[], totalXp: number): number {
  return [...progression]
    .sort((left, right) => left.level - right.level)
    .reverse()
    .find((row) => row.total_required_xp <= totalXp)?.level ?? 1;
}

function grantedPoints<T extends { level: number }>(
  progression: T[],
  fromLevel: number,
  toLevel: number,
  pointsKey: keyof T,
): number {
  return progression
    .filter((row) => row.level > fromLevel && row.level <= toLevel)
    .reduce((total, row) => total + Math.max(0, Number(row[pointsKey] ?? 0)), 0);
}

/**
 * Project the authoritative Dungeon XP receipt into the current client state
 * before the result screen mounts. The following background refresh should
 * reconcile to these same totals, so it cannot restart the XP animation.
 */
export function applyDungeonXpRewards(
  player: PlayerState,
  rewards: Pick<DungeonRewardSummary, "critterXp" | "rollcasterXp">,
  critterProgression: CritterXpProgression[],
  rollcasterProgression: RollcasterXpProgression[],
): PlayerState {
  const critters = player.critters.map((owned) => {
    const gain = Math.max(0, Number(rewards.critterXp[owned.id] ?? 0));
    if (gain <= 0) return owned;
    const progression = critterProgression.filter((row) => row.critter_id === owned.critter_id);
    const xp = owned.xp + gain;
    const level = levelAtTotalXp(progression, xp);
    return {
      ...owned,
      xp,
      level,
      skill_points: owned.skill_points + grantedPoints(progression, owned.level, level, "grant_skill_points"),
    };
  });

  const rollcasterGain = Math.max(0, Number(rewards.rollcasterXp ?? 0));
  const activeRollcasterId = player.profile.active_rollcaster_id;
  const rollcasters = player.rollcasters.map((owned) => {
    if (owned.id !== activeRollcasterId || rollcasterGain <= 0) return owned;
    const progression = rollcasterProgression.filter((row) => row.rollcaster_id === owned.rollcaster_id);
    const xp = owned.xp + rollcasterGain;
    const level = levelAtTotalXp(progression, xp);
    return {
      ...owned,
      xp,
      level,
      ability_points: owned.ability_points + grantedPoints(progression, owned.level, level, "grant_ability_points"),
    };
  });

  return { ...player, critters, rollcasters };
}

export function xpProgress(
  progression: ProgressionThreshold[],
  level: number,
  totalXp: number,
): XpProgress {
  const ordered = [...progression].sort((left, right) => left.level - right.level);
  const currentThreshold = [...ordered]
    .reverse()
    .find((row) => row.level <= level)?.total_required_xp ?? 0;
  const next = ordered.find((row) => row.level > level);

  if (!next) {
    return { current: 0, needed: 0, isMaxLevel: true };
  }

  const needed = Math.max(0, next.total_required_xp - currentThreshold);
  return {
    current: Math.max(0, Math.min(needed, totalXp - currentThreshold)),
    needed,
    isMaxLevel: false,
  };
}

type RelicSlotProgression = {
  critter_id: string;
  level: number;
  total_unlocked_relic_slots: number;
};

type RollcasterAbilitySlotProgression = {
  rollcaster_id: string;
  level: number;
  total_unlocked_ability_slots: number;
};

export const MAX_ROLLCASTER_ABILITY_SLOTS = 6;

export type SlotUnlock = {
  slotIndex: number;
  unlockLevel: number | null;
};

export type RelicSlotUnlock = SlotUnlock;

export function relicSlotUnlocks(
  progression: RelicSlotProgression[],
  critterId: string,
  visibleSlots = 10,
): RelicSlotUnlock[] {
  const unlockLevels: Array<number | null> = Array.from({ length: visibleSlots }, () => null);
  if (visibleSlots > 0) unlockLevels[0] = 1;

  let knownSlots = visibleSlots > 0 ? 1 : 0;
  const rows = progression
    .filter((row) => row.critter_id === critterId)
    .sort((left, right) => left.level - right.level);

  for (const row of rows) {
    const total = Math.min(visibleSlots, Math.max(0, Math.floor(row.total_unlocked_relic_slots)));
    for (let index = knownSlots; index < total; index += 1) unlockLevels[index] = row.level;
    knownSlots = Math.max(knownSlots, total);
  }

  return unlockLevels.map((unlockLevel, index) => ({ slotIndex: index + 1, unlockLevel }));
}

export function rollcasterAbilitySlotUnlocks(
  progression: RollcasterAbilitySlotProgression[],
  rollcasterId: string,
): SlotUnlock[] {
  const unlockLevels: Array<number | null> = Array.from({ length: MAX_ROLLCASTER_ABILITY_SLOTS }, () => null);
  unlockLevels[0] = 1;

  let knownSlots = 1;
  const rows = progression
    .filter((row) => row.rollcaster_id === rollcasterId)
    .sort((left, right) => left.level - right.level);

  for (const row of rows) {
    const total = Math.min(MAX_ROLLCASTER_ABILITY_SLOTS, Math.max(0, Math.floor(row.total_unlocked_ability_slots)));
    for (let index = knownSlots; index < total; index += 1) unlockLevels[index] = row.level;
    knownSlots = Math.max(knownSlots, total);
  }

  return unlockLevels.map((unlockLevel, index) => ({ slotIndex: index + 1, unlockLevel }));
}
