import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const supabaseSource = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const beginStart = appSource.indexOf("  async function beginDungeon(dungeon: Dungeon) {");
const beginEnd = appSource.indexOf("\n  function queueCombatProgressEvents", beginStart);
check(beginStart >= 0 && beginEnd > beginStart, "Dungeon entry handler should remain easy to audit.");
const beginSource = appSource.slice(beginStart, beginEnd);

check(beginSource.includes("dungeonEntryRequestRef.current"), "Dungeon entry must guard against duplicate starts.");
check(beginSource.includes("startDungeonRunWithRecovery(dungeon.id, requestId"), "Dungeon entry must reuse one request id across retries.");
check(beginSource.includes("snapshotDungeonRunEffectsWithRecovery"), "Dungeon entry must confirm the effect snapshot before showing combat.");
check(beginSource.includes("const activeBeforeStart = await getActiveDungeonRun()"), "Dungeon entry must reconcile an existing active run before creating another one.");
check(beginSource.includes("activeBeforeStart.effectSnapshot"), "Dungeon entry must resume an already-committed effect snapshot.");
check(!beginSource.includes("setLoading(true)"), "Dungeon entry must not use the global Refreshing state.");
check(beginSource.includes("setCombat(null)") && beginSource.includes('setView("combat")'), "Dungeon entry must show a dedicated pre-combat state.");
check(!beginSource.includes("Attempt {entry.attempt} of {entry.maxAttempts}"), "Dungeon entry must not expose transport retry counters in the player briefing.");
check(!beginSource.includes("Combat controls unlock after the server confirms this run."), "Dungeon entry must not expose implementation details in the player briefing.");

check(supabaseSource.includes("export async function startDungeonRunWithRecovery"), "Start recovery helper is missing.");
check(supabaseSource.includes("export async function snapshotDungeonRunEffectsWithRecovery"), "Snapshot recovery helper is missing.");
check(supabaseSource.includes("DUNGEON_ENTRY_TIMEOUT"), "Dungeon entry must have a bounded timeout diagnostic.");
check(supabaseSource.includes("active?.run.dungeonId === dungeonId"), "Start recovery must reconcile an already-created active run.");
check(supabaseSource.includes("active?.run.id === runId"), "Snapshot recovery must reconcile the exact active run.");
check(supabaseSource.includes("active.effectSnapshot"), "Snapshot recovery must reuse an already-committed server snapshot.");

console.log("Dungeon entry source tests passed.");
