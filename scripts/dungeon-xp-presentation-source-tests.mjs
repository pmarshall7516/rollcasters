import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const resultHandler = source.match(/onBattleResult=\{([\s\S]*?)\n\s*\}\}\s*onBack=/)?.[1] ?? "";
const projectionIndex = resultHandler.indexOf("applyDungeonXpRewards(");
const combatIndex = resultHandler.indexOf("setCombat(applyDungeonBattleResult");

check(projectionIndex >= 0, "Encounter results must project the committed XP receipt into client state.");
check(combatIndex > projectionIndex, "Client XP projection must happen before the result screen mounts.");
check(resultHandler.includes("const playerAfterRewards = applyDungeonXpRewards("), "Encounter results must create one projected player snapshot for the reward transition.");
check(resultHandler.includes("applyDungeonBattleResult(resolved, result, data.catalog, playerAfterRewards)"), "The next encounter must be built from the projected player level and stats.");
check(resultHandler.includes('void refresh("combat", { showLoading: false })'), "Encounter results must still reconcile the projected client state in the background.");
check(source.includes("const XP_REVEAL_DELAY_MS = 180"), "Completion XP should begin after a short presentation pause.");
check(source.includes("const XP_FILL_TOTAL_MS = 900"), "Completion XP should use a shorter fill animation.");

console.log(JSON.stringify({ clientProjectionBeforeResultScreen: true, projectedPlayerUsedForNextEncounter: true, backgroundReconciliation: true, fasterXpPresentation: true }));
