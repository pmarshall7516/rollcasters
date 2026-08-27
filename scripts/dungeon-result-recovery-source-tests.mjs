import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const supabaseSource = fs.readFileSync(path.join(root, "src", "lib", "supabase.ts"), "utf8");
const resultHandler = appSource.match(/onBattleResult=\{([\s\S]*?)\n\s*\}\}\s*onBack=/)?.[1] ?? "";

check(supabaseSource.includes("recordDungeonBattleResultWithRecovery"),
  "Encounter result persistence must have a retry-safe recovery wrapper.");
check(supabaseSource.includes("recordDungeonBattleResult(run, submission, requestId)"),
  "Encounter result retries must reuse the original request ID.");
check(resultHandler.includes("recordDungeonBattleResultWithRecovery"),
  "The combat result handler must use retry-safe encounter persistence.");
check(!resultHandler.includes("setError(errorMessage(resultError"),
  "Encounter result failures must not become a global error banner.");
check(appSource.includes("function isStatementTimeoutMessage")
  && appSource.includes('"The save service is busy right now. Please try again."'),
  "Statement timeout text must be sanitized before any generic error banner is rendered.");
check(appSource.includes("function DungeonResultSaveDialog"),
  "Encounter result save failures must have a dedicated recovery dialog.");
check(appSource.includes('title="Encounter result needs a retry"'),
  "The recovery dialog must clearly identify the pending encounter result.");
check(appSource.includes("Retry Save"),
  "The recovery dialog must expose a visible Retry Save action.");
check(appSource.includes('dismissible={false}'),
  "The recovery dialog must stay visible until the result save succeeds.");

console.log(JSON.stringify({ retrySafeResultPersistence: true, noGlobalTimeoutBanner: true, visibleRetryDialog: true }));
