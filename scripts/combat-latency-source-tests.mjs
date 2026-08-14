import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const turnHandler = source.match(/onTurnResolved=\{([\s\S]*?)\n\s*\}\}\s*onBattleResult=/)?.[1] ?? "";
const resultHandler = source.match(/onBattleResult=\{([\s\S]*?)\n\s*\}\}\s*onBack=/)?.[1] ?? "";

check(turnHandler.includes("queueCombatProgressEvents"),
  "Turn presentation must enqueue collectible progress without blocking the resolved combat state.");
check(!turnHandler.includes("await submitCollectibleCombatEvents"),
  "Turn presentation must not await the challenge-progress RPC before playing the turn out.");
check(resultHandler.includes("applyDungeonBattleResult(resolved, result, data.catalog, data.player!)"),
  "Encounter result presentation must apply from the current client snapshot before refreshing in the background.");
check(!resultHandler.includes("await loadAppData()"),
  "Encounter result presentation must not block on a full app-data reload before showing rewards or Dungeon complete.");
check(resultHandler.includes("queueCombatProgressEvents"),
  "Dungeon completion progress must remain queued after the authoritative battle result is recorded.");

console.log(JSON.stringify({ turnRpcBlocking: false, resultRefreshBlocking: false }));
