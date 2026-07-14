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
