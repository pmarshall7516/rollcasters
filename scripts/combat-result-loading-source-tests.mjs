import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
check(appSource.includes("combatLoadingNarration"),
  "CombatScreen must use the shared loading narration for result recording.");
check(/submittingProgress\s*\|\|\s*recordingResult/.test(appSource),
  "Combat narration loading must cover both submitted turns and encounter-result recording.");
check(appSource.includes("if (combat.phase !== \"battle_result\")")
  && appSource.includes("if (recordingResult) return;\n    const requestId = resultRequestIdRef.current ?? createRequestId();"),
  "Result loading must be established before the post-knockout frame can paint and retries must keep one request ID.");
check(!appSource.includes("sectionRef.current?.scrollIntoView"),
  "Completion XP reveal must not scroll the combat shell during the KO transition.");
check(appSource.includes('aria-label={loadingNarration ? (recordingResult ? "Waiting for encounter results" : "Loading") :'),
  "Result loading must expose an accessible waiting state while the narration box is disabled.");

console.log(JSON.stringify({ sourceIntegration: true, completionScroll: false }));
