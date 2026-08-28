import {
  actionCostTone,
  breakdownText,
  buildXpAnimSegments,
  costBreakdownText,
  modificationTone,
  signedAmount,
  visualForLevelUpHold,
  visualForXpTotal,
  xpStateAtTotal,
  type XpThreshold,
} from "../src/app/presentation.js";
import type { ActionCostBreakdown } from "../src/lib/game.js";
import type { StatBreakdown } from "../src/lib/loadout.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const progression: XpThreshold[] = [
  { level: 3, total_required_xp: 20 },
  { level: 1, total_required_xp: 0 },
  { level: 2, total_required_xp: 10 },
];

const state = xpStateAtTotal(progression, 15);
check(state.level === 2 && state.progress.current === 5 && state.progress.needed === 10, "XP totals should resolve against ordered thresholds");

const segments = buildXpAnimSegments(progression, 0, 25);
check(
  JSON.stringify(segments) === JSON.stringify([
    { kind: "fill", from: 0, to: 10, displayLevel: 1, fillsToLevelUp: true },
    { kind: "levelUp", fromLevel: 1, toLevel: 2 },
    { kind: "fill", from: 10, to: 20, displayLevel: 2, fillsToLevelUp: true },
    { kind: "levelUp", fromLevel: 2, toLevel: 3 },
    { kind: "fill", from: 20, to: 25, displayLevel: 3, fillsToLevelUp: false },
  ]),
  "XP animation segments should preserve threshold ordering",
);
check(JSON.stringify(visualForXpTotal(progression, 15)) === JSON.stringify({ level: 2, pct: 50, progressText: "5 / 10 XP" }), "XP visual totals should preserve percentage semantics");
check(JSON.stringify(visualForLevelUpHold(progression, 1)) === JSON.stringify({ level: 1, pct: 100, progressText: "10 / 10 XP" }), "level-up holds should display a full pre-level bar");

const stats: StatBreakdown = { base: 10, sources: [{ amount: 2, sourceName: "Relic" }, { amount: -1, sourceName: "Status" }], final: 10 };
const cost: ActionCostBreakdown = { base: 4, final: 3, sources: [{ amount: -1, sourceName: "Relic" }] };
check(modificationTone(stats) === "mixed" && modificationTone(stats, true) === "mixed", "mixed stat modifiers should retain their tone");
check(actionCostTone(cost) === "positive", "discounted costs should retain their positive tone");
check(signedAmount(2) === "+2" && signedAmount(-1) === "-1" && signedAmount(0) === "0", "signed amounts should preserve formatting");
check(costBreakdownText("Action cost", cost) === "Action cost: 4 (Base) -1 (Relic)", "cost breakdown text should preserve formatting");
check(breakdownText("ATK", stats) === "ATK: 10 (Base) +2 (Relic) -1 (Status) = 10 (Capped)", "stat breakdown text should preserve cap annotations");

console.log("Presentation helper tests passed.");
