import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const outcomeSource = appSource.match(/function DungeonOutcomeScreen\([\s\S]*?\n}\n\nfunction StatusIconRow/)?.[0] ?? "";
const dungeonDropRowSource = appSource.match(/function DungeonDropRow\([\s\S]*?\n}\n\nfunction/)?.[0] ?? "";

check(appSource.includes('aggregateDungeonRewardEntries(rewards.entries)'), "Reward rows must aggregate identical drops before rendering.");
check(outcomeSource.includes("combineDungeonRewards(combat.lastBattleRewards, combat.dungeonRewards)"), "Dungeon completion must combine encounter and completion rewards.");
check(outcomeSource.includes("<h2>Rewards</h2>"), "Dungeon completion must use one Rewards section.");
check(outcomeSource.includes('"All encounters are complete."'), "Completed Dungeons must use the concise completion message.");
check(outcomeSource.includes('layout="dungeon-outcome"'), "Dungeon completion rewards must use the dedicated responsive reward layout.");
check(appSource.includes('className="combat-reward-count"'), "Reward rows must render a separate count component.");
check(appSource.includes('className="combat-reward-name"'), "Reward rows must render a separate reward-name component.");
check(!outcomeSource.includes("Final Encounter"), "Dungeon completion must not split out Final Encounter rewards.");
check(!outcomeSource.includes("First-clear Rewards"), "Dungeon completion must not split out first-clear rewards.");
check(dungeonDropRowSource.includes("dropAmountLabel(drop.minAmount, drop.maxAmount)} x <span"), "Dungeon drop rows must use count x name formatting for every drop kind.");
check(!dungeonDropRowSource.includes("Duplicates convert to"), "Dungeon drop rows must not show duplicate conversion text for Relics or Shards.");
check(dungeonDropRowSource.includes('className="dungeon-drop-row"'), "Dungeon drop presentation must remain in the dedicated drop row.");

console.log(JSON.stringify({ combinedRewardsSection: true, duplicateDropsAggregated: true }));
