import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const resultHandler = source.match(/onBattleResult=\{([\s\S]*?)\n\s*\}\}\s*onBack=/)?.[1] ?? "";
const progressQueue = source.match(/function queueCombatProgressEvents\([\s\S]*?\n\s*}\n\n\s*async function establishGameplaySession/)?.[0] ?? "";

check(!source.includes("onTurnResolved="),
  "Local combat turns must not invoke a server-backed progress callback.");
check(resultHandler.includes("applyDungeonBattleResult(resolved, result, data.catalog, playerAfterRewards)"),
  "Encounter result presentation must apply from the projected client snapshot before refreshing in the background.");
check(!resultHandler.includes("await loadAppData()"),
  "Encounter result presentation must not block on a full app-data reload before showing rewards or Dungeon complete.");
check(!source.includes("saveDungeonRunState(latest.run, latestSerialized)"),
  "Local combat must not persist every turn through save_dungeon_run_state.");
check(source.includes("serializeDungeonRunState(combat)") && source.includes("saveDungeonRunStateWithTimeout(latest.run, serialized)"),
  "Active Dungeon state must be persisted through the debounced versioned save path.");
check(!source.includes("setError(errorMessage(progressError, \"Unable to update challenge progress.\"))"),
  "A non-critical background challenge-progress failure must not become the global gameplay error banner.");
check(!progressQueue.includes("void refresh(\"combat\", { showLoading: false })"),
  "Post-combat challenge projection must not navigate the player back into combat after they leave it.");
check(source.includes("function requestDungeonExit") && source.includes("setError(null);"),
  "Leaving combat must clear any transient gameplay error banner before navigating.");

console.log(JSON.stringify({ localTurns: true, turnRpcBlocking: false, resultRefreshBlocking: false, transientErrors: true }));
