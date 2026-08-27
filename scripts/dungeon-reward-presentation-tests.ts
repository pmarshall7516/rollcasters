import { aggregateDungeonRewardEntries, combineDungeonRewards } from "../src/lib/dungeon-rewards.js";
import type { DungeonRewardEntry, DungeonRewardSummary } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const entry = (overrides: Partial<DungeonRewardEntry>): DungeonRewardEntry => ({
  id: "reward",
  source: "opponent",
  kind: "currency",
  targetId: "coins",
  amount: 1,
  ...overrides,
});

const battle: DungeonRewardSummary = {
  entries: [
    entry({ id: "battle-coins", amount: 10 }),
    entry({ id: "battle-coins-2", amount: 5 }),
    entry({ id: "battle-relic", kind: "relic", targetCategory: "relic", targetId: "relic-1", amount: 1 }),
    entry({ id: "battle-xp", kind: "critter_xp", targetId: "xp", recipientId: "critter-1", amount: 7 }),
  ],
  defeatedOpponentInstanceIds: ["opponent-1"],
  critterXp: { "critter-1": 7 },
  rollcasterXp: 3,
};

const completion: DungeonRewardSummary = {
  entries: [
    entry({ id: "completion-coins", source: "completion", amount: 20 }),
    entry({ id: "completion-relic", source: "completion", kind: "relic", targetCategory: "relic", targetId: "relic-1", amount: 2 }),
  ],
  defeatedOpponentInstanceIds: [],
  critterXp: {},
  rollcasterXp: 0,
  completionPhase: "first_time",
};

const aggregated = aggregateDungeonRewardEntries([...battle.entries, ...completion.entries]);
check(
  JSON.stringify(
  aggregated.map(({ kind, targetId, amount }) => ({ kind, targetId, amount })),
  ) === JSON.stringify([
    { kind: "currency", targetId: "coins", amount: 35 },
    { kind: "relic", targetId: "relic-1", amount: 3 },
  ]),
  "same currency and Relic drops should render as one reward each",
);

const combined = combineDungeonRewards(battle, completion);
check(combined.entries.length === 2, "combined rewards should retain one entry per drop target");
check(combined.critterXp["critter-1"] === 7, "combined rewards should retain Critter XP");
check(combined.rollcasterXp === 3, "combined rewards should retain Rollcaster XP");
check(JSON.stringify(combined.defeatedOpponentInstanceIds) === JSON.stringify(["opponent-1"]), "combined rewards should retain defeated opponents");
check(combined.completionPhase === "first_time", "combined rewards should retain completion phase");

console.log(JSON.stringify({ aggregatedDrops: combined.entries.length, coins: combined.entries[0].amount, xpRecipients: Object.keys(combined.critterXp).length }));
