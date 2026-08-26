import type { DungeonRewardEntry, DungeonRewardSummary } from "./types.js";

const experienceKinds = new Set<DungeonRewardEntry["kind"]>(["critter_xp", "rollcaster_xp"]);

/**
 * Collapse displayable Dungeon drops by reward kind and target. XP is kept out
 * of this list because it has a recipient-specific presentation below it.
 */
export function aggregateDungeonRewardEntries(entries: readonly DungeonRewardEntry[]): DungeonRewardEntry[] {
  const grouped = new Map<string, DungeonRewardEntry>();

  for (const entry of entries) {
    if (experienceKinds.has(entry.kind)) continue;
    const key = [entry.kind, entry.targetCategory ?? "", entry.targetId].join("\u0000");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...entry });
      continue;
    }

    existing.amount += entry.amount;
    if (entry.convertedAmount !== undefined) {
      existing.convertedAmount = (existing.convertedAmount ?? 0) + entry.convertedAmount;
    }
  }

  return [...grouped.values()];
}

/** Combine the drops and XP receipts used by the Dungeon completion screen. */
export function combineDungeonRewards(
  ...summaries: Array<DungeonRewardSummary | null | undefined>
): DungeonRewardSummary {
  const present = summaries.filter((summary): summary is DungeonRewardSummary => Boolean(summary));
  const critterXp: Record<string, number> = {};

  for (const summary of present) {
    for (const [recipientId, amount] of Object.entries(summary.critterXp)) {
      critterXp[recipientId] = (critterXp[recipientId] ?? 0) + amount;
    }
  }

  return {
    entries: aggregateDungeonRewardEntries(present.flatMap((summary) => summary.entries)),
    defeatedOpponentInstanceIds: [...new Set(present.flatMap((summary) => summary.defeatedOpponentInstanceIds))],
    critterXp,
    rollcasterXp: present.reduce((total, summary) => total + summary.rollcasterXp, 0),
    completionPhase: present.find((summary) => summary.completionPhase)?.completionPhase,
  };
}
