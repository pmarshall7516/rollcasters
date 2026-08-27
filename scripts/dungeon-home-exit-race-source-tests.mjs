import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const refreshSource = source.match(/async function refresh\([\s\S]*?\n  }\n\n  async function openPlay/)?.[0] ?? "";
const navigateSource = source.match(/function navigate\([\s\S]*?\n  }\n\n  function showActiveDungeonPrompt/)?.[0] ?? "";
const revisionCaptureIndex = refreshSource.indexOf("const navigationRevisionAtStart = navigationRevisionRef.current");
const dataAwaitIndex = refreshSource.indexOf("await ensureUserGameState()");
const revisionGuardIndex = refreshSource.indexOf("navigationRevisionRef.current !== navigationRevisionAtStart");
const viewApplyIndex = refreshSource.indexOf("setView(nextView)");

check(revisionCaptureIndex >= 0 && revisionCaptureIndex < dataAwaitIndex,
  "Refresh must capture the navigation revision before awaiting game data.");
check(revisionGuardIndex >= 0 && revisionGuardIndex < viewApplyIndex,
  "A stale refresh must not restore its old view after the player navigates away.");
check(navigateSource.includes("navigationRevisionRef.current += 1"),
  "Explicit navigation must invalidate in-flight refresh view updates.");
check(source.includes('void refresh("combat", { showLoading: false })'),
  "The result screen must continue reconciling authoritative data in the background.");

console.log(JSON.stringify({ staleRefreshCannotRestoreCombat: true }));
