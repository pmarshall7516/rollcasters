import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const supabase = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(
  new URL("../../rollcaster-docs/migrations/general/20260824205116_fix_gameplay_session_takeover_and_shutdown.sql", import.meta.url),
  "utf8",
);

const insertSession = migration.indexOf("insert into public.player_game_sessions(");
const displacedByReference = migration.indexOf("set displaced_by_session_id=p_session_id");
assert.ok(insertSession >= 0, "The gameplay-session acquisition function must insert the new session.");
assert.ok(displacedByReference >= 0, "The gameplay-session acquisition function must link the old session to its successor.");
assert.ok(
  insertSession < displacedByReference,
  "Takeover must create the new session row before storing it in displaced_by_session_id.",
);

assert.match(supabase, /export async function releaseGameplaySession\(/, "The client must expose a clean gameplay-session release.");
assert.match(app, /releaseGameplaySession/, "The app must release the gameplay lease during shutdown.");
assert.match(app, /onCloseRequested/, "The desktop app must handle OS/window close requests.");

const signOut = supabase.slice(supabase.indexOf("export async function signOut()"));
const releaseInSignOut = signOut.indexOf("await releaseGameplaySession()");
const flushInSignOut = signOut.indexOf("await flushPlayerMutations()");
assert.ok(releaseInSignOut >= 0, "Logout must release the gameplay lease.");
assert.ok(flushInSignOut < 0 || releaseInSignOut < flushInSignOut, "Logout must release the lease before waiting on queued player mutations.");

assert.match(app, /sessionStoppingRef/, "Intentional logout/close must be distinguishable from remote session displacement.");
assert.match(app, /if \(!sessionStoppingRef\.current && errorMessage\(heartbeatError/, "A delayed heartbeat must not show Account Moved during intentional shutdown.");
const closeHandler = app.slice(app.indexOf("onCloseRequested"));
const closeRelease = closeHandler.indexOf("await releaseGameplaySession()");
const closeFlush = closeHandler.indexOf("await flushCombatSaveRef.current()");
assert.ok(closeRelease >= 0, "Desktop close must release the gameplay lease.");
assert.ok(closeFlush < 0 || closeRelease < closeFlush, "Desktop close must release the lease before waiting on a best-effort state flush.");

console.log("Gameplay session shutdown and takeover regression contract passed.");
