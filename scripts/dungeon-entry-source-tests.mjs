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
check(beginSource.includes("const activeBeforeStart = await getActiveDungeonRunWithTimeout()"), "Dungeon entry must reconcile an existing active run before creating another one.");
check(beginSource.includes("showActiveDungeonPrompt(activeBeforeStart"), "Dungeon entry must prompt before replacing or resuming an existing active run.");
check(!beginSource.includes("setLoading(true)"), "Dungeon entry must not use the global Refreshing state.");
check(beginSource.includes("setCombat(null)") && beginSource.includes('setView("combat")'), "Dungeon entry must show a dedicated pre-combat state.");
check(!beginSource.includes("Attempt {entry.attempt} of {entry.maxAttempts}"), "Dungeon entry must not expose transport retry counters in the player briefing.");
check(!beginSource.includes("Combat controls unlock after the server confirms this run."), "Dungeon entry must not expose implementation details in the player briefing.");
check(appSource.includes("ContinueDungeonDialog"), "An unfinished Dungeon must use a Continue Dungeon dialog.");
check(appSource.includes("resolveDungeonRun"), "The abandon action must resolve the active Dungeon run.");
check(appSource.includes("title=\"Continue Dungeon?\""), "The resume dialog must clearly ask whether to continue the Dungeon.");
check(appSource.includes("setActiveDungeonPrompt(null)"), "Continue and abandon must dismiss the unfinished-run prompt.");

check(supabaseSource.includes("export async function startDungeonRunWithRecovery"), "Start recovery helper is missing.");
check(supabaseSource.includes("export async function snapshotDungeonRunEffectsWithRecovery"), "Snapshot recovery helper is missing.");
check(supabaseSource.includes("export async function resolveDungeonRun"), "Abandon RPC wrapper is missing.");
check(supabaseSource.includes("DUNGEON_ENTRY_TIMEOUT"), "Dungeon entry must have a bounded timeout diagnostic.");
check(supabaseSource.includes("active?.run.dungeonId === dungeonId"), "Start recovery must reconcile an already-created active run.");
check(supabaseSource.includes("active?.run.id === runId"), "Snapshot recovery must reconcile the exact active run.");
check(supabaseSource.includes("active.effectSnapshot"), "Snapshot recovery must reuse an already-committed server snapshot.");

console.log("Dungeon entry source tests passed.");
