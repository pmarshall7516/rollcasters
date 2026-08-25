import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const closeFunctionStart = app.indexOf("async function closeRollcasters");
const closeFunctionEnd = app.indexOf("\n  }\n\n  useEffect", closeFunctionStart);
assert.ok(closeFunctionStart >= 0 && closeFunctionEnd > closeFunctionStart, "The app close function must remain discoverable.");
const closeFunction = app.slice(closeFunctionStart, closeFunctionEnd);
const handlerStart = app.indexOf("onCloseRequested");
const handlerEnd = app.indexOf("\n      }))", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "The native close handler must remain discoverable.");

const closeHandler = app.slice(handlerStart, handlerEnd);
assert.match(closeFunction, /startBestEffortShutdownCleanup\(\)/, "The red-X close path must start best-effort shutdown cleanup.");
assert.match(closeFunction, /await getCurrentWindow\(\)\.destroy\(\)/, "The red-X close path must force-close the desktop window.");
assert.doesNotMatch(closeFunction, /await releaseGameplaySession\(\)/, "The red-X close path must not wait for session cleanup.");
assert.doesNotMatch(closeFunction, /await flushCombatSaveRef\.current\(\)/, "The red-X close path must not wait for the Dungeon flush.");
assert.doesNotMatch(closeHandler, /await releaseGameplaySession\(\)/, "The native close path must not wait for session cleanup.");
assert.doesNotMatch(closeHandler, /await flushCombatSaveRef\.current\(\)/, "The native close path must not wait for the Dungeon flush.");
assert.match(closeHandler, /await getCurrentWindow\(\)\.destroy\(\)/, "The native close handler must force-close the desktop window.");
assert.doesNotMatch(closeHandler, /await getCurrentWindow\(\)\.close\(\)/, "The close handler must not re-emit closeRequested from inside closeRequested.");

console.log("Native desktop window close contract passed.");
