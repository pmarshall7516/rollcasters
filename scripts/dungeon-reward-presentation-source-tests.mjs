import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const outcomeSource = appSource.match(/function DungeonOutcomeScreen\([\s\S]*?\n}\n\nfunction StatusIconRow/)?.[0] ?? "";

check(appSource.includes('aggregateDungeonRewardEntries(rewards.entries)'), "Reward rows must aggregate identical drops before rendering.");
check(outcomeSource.includes("combineDungeonRewards(combat.lastBattleRewards, combat.dungeonRewards)"), "Dungeon completion must combine encounter and completion rewards.");
check(outcomeSource.includes("<h2>Rewards</h2>"), "Dungeon completion must use one Rewards section.");
check(!outcomeSource.includes("Final Encounter"), "Dungeon completion must not split out Final Encounter rewards.");
check(!outcomeSource.includes("First-clear Rewards"), "Dungeon completion must not split out first-clear rewards.");

console.log(JSON.stringify({ combinedRewardsSection: true, duplicateDropsAggregated: true }));
