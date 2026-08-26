import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const closeFunctionStart = app.indexOf("async function closeRollcasters");
const closeFunctionEnd = app.indexOf("\n  }\n\n  useEffect", closeFunctionStart);
assert.ok(closeFunctionStart >= 0 && closeFunctionEnd > closeFunctionStart, "The app close function must remain discoverable.");
const closeFunction = app.slice(closeFunctionStart, closeFunctionEnd);
const cleanupStart = app.indexOf("async function completeShutdownCleanup");
const cleanupEnd = app.indexOf("\n  }\n\n  async function closeRollcasters", cleanupStart);
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart, "The shutdown cleanup function must remain discoverable.");
const cleanup = app.slice(cleanupStart, cleanupEnd);
const handlerStart = app.indexOf("onCloseRequested");
const handlerEnd = app.indexOf("\n      }))", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "The native close handler must remain discoverable.");

const closeHandler = app.slice(handlerStart, handlerEnd);
assert.match(closeFunction, /await getCurrentWindow\(\)\.destroy\(\)/, "The red-X close path must force-close the desktop window.");
assert.doesNotMatch(closeFunction, /await releaseGameplaySession\(\)/, "The red-X close path must not wait for session cleanup.");
assert.match(closeFunction, /void completeShutdownCleanup\(\)/, "The red-X close path must start cleanup without blocking the window close.");
assert.doesNotMatch(closeFunction, /await completeShutdownCleanup\(\)/, "The red-X close path must not wait for a remote save before closing.");
assert.match(cleanup, /await Promise\.race\(\[[\s\S]*flushCombatSaveRef\.current\(\)/, "Shutdown must await the active Dungeon state flush.");
assert.match(cleanup, /void releaseGameplaySession\(\)/, "Shutdown must release the gameplay lease without blocking close.");
assert.doesNotMatch(closeHandler, /event\.preventDefault\(\)/, "The native close path must allow Tauri to complete the close.");
assert.doesNotMatch(closeHandler, /getCurrentWindow\(\)\.destroy\(\)/, "The native close handler must let Tauri destroy after the callback returns.");
assert.doesNotMatch(closeHandler, /getCurrentWindow\(\)\.close\(\)/, "The native close handler must not re-emit closeRequested from inside closeRequested.");
assert.match(closeHandler, /void completeShutdownCleanup\(\)/, "The native close path must start cleanup without blocking Tauri's close request.");
assert.doesNotMatch(closeHandler, /await completeShutdownCleanup\(\)/, "The native close path must not hold the OS close request for a remote save.");
assert.doesNotMatch(closeHandler, /onCloseRequested\(async/, "The native close callback must return synchronously to Tauri.");

console.log("Native desktop window close contract passed.");
