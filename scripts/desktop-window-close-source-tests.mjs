import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const native = fs.readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const updater = fs.readFileSync(new URL("../src/lib/desktop-updater.ts", import.meta.url), "utf8");
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
assert.match(closeFunction, /invoke\(["']exit_app["']\)/, "The red-X close path must invoke the native app exit command.");
assert.doesNotMatch(closeFunction, /await releaseGameplaySession\(\)/, "The red-X close path must not wait for session cleanup.");
assert.match(closeFunction, /void completeShutdownCleanup\(\)/, "The red-X close path must start cleanup without blocking the window close.");
assert.doesNotMatch(closeFunction, /await completeShutdownCleanup\(\)/, "The red-X close path must not wait for a remote save before closing.");
assert.doesNotMatch(closeFunction, /getCurrentWindow\(\)\.destroy\(\)/, "The close path must not depend on renderer window destruction.");
assert.match(cleanup, /await Promise\.race\(\[[\s\S]*flushCombatSaveRef\.current\(\)/, "Shutdown must await the active Dungeon state flush.");
assert.match(cleanup, /void releaseGameplaySession\(\)/, "Shutdown must release the gameplay lease without blocking close.");
assert.doesNotMatch(closeHandler, /event\.preventDefault\(\)/, "The native close path must allow Tauri to complete the close.");
assert.doesNotMatch(closeHandler, /getCurrentWindow\(\)\.destroy\(\)/, "The native close handler must let Tauri destroy after the callback returns.");
assert.doesNotMatch(closeHandler, /getCurrentWindow\(\)\.close\(\)/, "The native close handler must not re-emit closeRequested from inside closeRequested.");
assert.match(closeHandler, /void completeShutdownCleanup\(\)/, "The native close path must start cleanup without blocking Tauri's close request.");
assert.doesNotMatch(closeHandler, /await completeShutdownCleanup\(\)/, "The native close path must not hold the OS close request for a remote save.");
assert.doesNotMatch(closeHandler, /onCloseRequested\(async/, "The native close callback must return synchronously to Tauri.");
assert.match(native, /#\[tauri::command\]\s*fn exit_app\(app: tauri::AppHandle/, "The native shell must expose an app-level exit command.");
assert.match(native, /app\.exit\(0\)/, "The native shell must terminate through AppHandle::exit.");
assert.match(native, /\.on_window_event\(/, "The native shell must own OS window-close handling.");
assert.match(updater, /window\.location\.protocol === ["']tauri:["']/, "Desktop detection must recognize the macOS Tauri origin.");

console.log("Native desktop window close contract passed.");
