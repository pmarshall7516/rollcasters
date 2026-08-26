import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const dungeonRun = fs.readFileSync(new URL("../src/lib/dungeon-run.ts", import.meta.url), "utf8");

assert.match(
  app,
  /<CombatScreen[\s\S]*?onCombatTurnResolved=\{\(runId, turnNumber, events\) => queueCombatProgressEvents\(runId, turnNumber, events\)\}/,
  "The app must pass the combat-progress sink into CombatScreen.",
);
assert.match(
  app,
  /const resolved = submitDungeonActions\(combat, selectedActions\);[\s\S]*?onCombatTurnResolved\(combat\.run\.id, combat\.battle\.turn, \(resolved\.pendingBattle \?\? resolved\.battle\)\.turnEvents\);/,
  "Every resolved combat turn must submit the normalized events from the pending resolved battle before the turn is discarded.",
);
assert.match(
  app,
  /const snapshot = await submitCollectibleCombatEvents\(runId, turnNumber, events\);[\s\S]*?collectibleSnapshot: snapshot/,
  "Submitted combat progress must update the in-memory collectible snapshot.",
);
assert.match(
  dungeonRun,
  /const restoredEnemyRollcasterType\s*=\s*enemyEncounterForBattle\(run\)\?\.enemyRollcaster\?\.eclipse_order_type[\s\S]*?enemyRollcasterType:\s*persisted\.battle\.enemyRollcasterType\s*\?\?\s*restoredEnemyRollcasterType/,
  "Restored combat must recover the enemy Rollcaster rank from the authoritative run encounter when an older saved battle omitted it.",
);

console.log("Combat challenge progress source regression passed.");
