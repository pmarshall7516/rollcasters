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
check(resultHandler.includes('void refresh("combat", { showLoading: false })'), "Encounter results must still reconcile the projected client state in the background.");

console.log(JSON.stringify({ clientProjectionBeforeResultScreen: true, backgroundReconciliation: true }));
