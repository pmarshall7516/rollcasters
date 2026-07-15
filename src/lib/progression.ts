export type XpProgress = {
  current: number;
  needed: number;
  isMaxLevel: boolean;
};

type ProgressionThreshold = {
  level: number;
  total_required_xp: number;
};

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

export type RelicSlotUnlock = {
  slotIndex: number;
  unlockLevel: number | null;
};

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
