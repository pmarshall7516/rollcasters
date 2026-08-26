import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_DUNGEON_CHALLENGE_BROWSER_TEST !== "true") {
  throw new Error("Set RUN_LIVE_DUNGEON_CHALLENGE_BROWSER_TEST=true to create and clean up a disposable Dungeon test user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5195";
const outputDir = path.join(root, "output", "dungeon-challenge-progress-browser");
const email = `dungeon-challenge-${Date.now()}@example.com`;
const password = `Rollcasters-Challenge-${Date.now()}!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

fs.mkdirSync(outputDir, { recursive: true });

let userId;
let browser;
let devServer;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function gameState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function waitForPhase(page, phases) {
  await page.waitForFunction(
    (expected) => expected.includes(JSON.parse(window.render_game_to_text()).combat?.phase),
    phases,
  );
  return (await gameState(page)).combat.phase;
}

async function dismissUnlockNotifications(page) {
  for (let index = 0; index < 20; index += 1) {
    const close = page.locator(".modal-backdrop").getByRole("button", { name: "Close" });
    if (!(await close.count())) return;
    await close.first().click();
    await page.waitForTimeout(40);
  }
  throw new Error("Unlock notifications did not finish dismissing.");
}

async function localChallengeState(page) {
  return page.evaluate(() => {
    for (const value of Object.values(localStorage)) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && Array.isArray(parsed.progress) && Array.isArray(parsed.processedEventKeys)) return parsed;
      } catch {
        // Other local storage entries are unrelated to challenge preview state.
      }
    }
    return null;
  });
}

async function selectLeadAndStart(page) {
  let state = await gameState(page);
  if (["lead_selection", "forced_replacements"].includes(state.combat?.phase)) {
    await page.locator(".combat-lead-option:not(.selected):not([disabled])").first().click();
    await page.getByRole("button", { name: "Start Encounter" }).click();
  }
  state = await gameState(page);
  if (state.combat?.phase === "entry_dialogue") {
    await page.locator(".combat-narration:not(:disabled)").click();
  }
  await waitForPhase(page, ["await_roll"]);
}

async function chooseAttack(page) {
  const primary = page.locator(".battle-unit .combat-primary-actions:visible").first();
  await primary.getByRole("button", { name: /^Skill$/ }).click();
  const skill = page.locator(".battle-unit .combat-skill-actions .skill-tile:has(.skill-power):not([disabled]):visible").first();
  check(await skill.count() === 1, "The leveled starter Critter must have an affordable attack Skill.");
  await skill.click();
  const target = page.locator(".battle-unit.legal-target:visible").first();
  if (await target.count()) await target.click();
  const submit = page.getByRole("button", { name: "Submit Actions" });
  check(await submit.isEnabled(), "The attack must produce a valid action set.");
  await submit.click();
}

async function advancePlayback(page) {
  for (let index = 0; index < 40; index += 1) {
    const state = await gameState(page);
    if (state.combat?.phase !== "event_playback") return state.combat?.phase;
    await page.waitForFunction(() => {
      const button = document.querySelector(".combat-narration");
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await page.locator(".combat-narration:not(:disabled)").click();
  }
  throw new Error("Combat event playback did not terminate.");
}

try {
  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5195"], {
      cwd: root,
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Dungeon Challenge Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  browser = await chromium.launch({
    headless: process.env.HEADED !== "true",
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.route("**/rest/v1/rpc/get_collectible_player_snapshot", async (route) => {
    // Make the final battle-progress write overlap the result RPC. The fixed
    // app must wait for this receipt before the dungeon result reconciles.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await page.locator(".starter-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await dismissUnlockNotifications(page);

  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  await page.locator(".tabs button").nth(2).click();
  await page.locator("input[type=search]").fill("Tiny Blade");
  const tinyBlade = page.locator(".catalog-card").filter({ hasText: "Tiny Blade" }).first();
  const defeatChallenge = tinyBlade.locator(".challenge-row").filter({ hasText: "Defeat Acolyte rank enemies" });
  check((await page.evaluate(() => JSON.parse(window.render_game_to_text()).trackedChallenges)).length === 0, "A fresh preview user must not already have a tracked challenge.");
  await defeatChallenge.getByRole("button", { name: "Track" }).click();
  const trackedChallengeId = (await localChallengeState(page)).tracked.find((row) => row.challenge_id)?.challenge_id;
  check(trackedChallengeId, "The local preview must persist the newly tracked Tiny Blade challenge.");
  await page.waitForFunction(
    (id) => JSON.parse(window.render_game_to_text()).trackedChallenges.some((row) => row.challenge_id === id),
    trackedChallengeId,
  );
  const trackedBeforeRun = await localChallengeState(page);
  check(trackedBeforeRun?.tracked.some((row) => row.challenge_id === trackedChallengeId), "Tiny Blade's challenge must be tracked before the fresh run starts.");

  // Raise the starter Critter only after tracking, then reload so the fresh
  // run still uses normal player state rather than a test-only combat state.
  const leveled = await admin
    .from("user_critters")
    .update({ xp: 1_000_000, level: 100 })
    .eq("user_id", userId)
    .select("id");
  if (leveled.error) throw leveled.error;
  check(leveled.data.length === 1, "The fresh-run fixture must level the starter Critter.");
  // Return through the root route so the session takeover also lands on the
  // normal Home surface instead of restoring the Collection URL.
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  if ((await gameState(page)).view === "auth" && await page.getByRole("button", { name: "Play Here" }).count()) {
    await page.getByRole("button", { name: "Play Here" }).click();
  }
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.view === "home" && state.loading === false;
  }, null, { timeout: 30_000 });
  await dismissUnlockNotifications(page);

  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "play");
  const dungeon001 = page.locator(".dungeon-grid-card").first();
  check((await dungeon001.locator(".collectible-id").innerText()).trim() === "001", "Dungeon 001 must be the first naturally ordered Dungeon card.");
  await dungeon001.getByRole("button", { name: "Enter Dungeon" }).click();
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.view === "combat" && state.combat !== null;
  });
  const initial = await gameState(page);
  check(initial.combat.dungeonId === "001" && initial.combat.encounterCount === 1, "The regression must start fresh Dungeon 001 with its single encounter.");
  check((await localChallengeState(page)).progress.find((row) => row.challenge_id === trackedChallengeId)?.current === "0", "Tiny Blade progress must start at zero.");

  await selectLeadAndStart(page);
  const runId = (await admin.from("dungeon_runs").select("id,selected_enemy_encounters").eq("user_id", userId).order("started_at", { ascending: false }).limit(1).single());
  if (runId.error) throw runId.error;
  check(runId.data.selected_enemy_encounters?.[0]?.enemyRollcaster?.eclipse_order_type === "acolyte", `Dungeon 001 must select an Acolyte enemy: ${JSON.stringify(runId.data.selected_enemy_encounters)}`);
  await page.getByRole("button", { name: "Roll Dice" }).click();
  await waitForPhase(page, ["roll_result"]);
  await page.locator(".combat-narration:not(:disabled)").click();
  await waitForPhase(page, ["select_player_actions"]);
  await chooseAttack(page);
  await waitForPhase(page, ["event_playback", "battle_result"]);
  if ((await gameState(page)).combat.phase === "event_playback") await advancePlayback(page);
  if ((await gameState(page)).combat.phase === "outcome_dialogue") {
    await page.locator(".combat-narration:not(:disabled)").click();
  }
  await page.waitForFunction(() => ["dungeon_complete", "battle_result"].includes(JSON.parse(window.render_game_to_text()).combat?.phase));
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).combat?.phase === "dungeon_complete", null, { timeout: 30_000 });
  const completedState = await gameState(page);
  const previewAfterRun = await localChallengeState(page);
  const progressAfterRun = previewAfterRun?.progress.find((row) => row.challenge_id === trackedChallengeId);
  check(completedState.combat.dungeonId === "001", "The fresh run must finish Dungeon 001.");
  check(progressAfterRun?.current === "1", `Tiny Blade must gain one Acolyte defeat after the final encounter; got ${JSON.stringify(progressAfterRun)}`);
  check(previewAfterRun.processedEventKeys.some((key) => key.endsWith(":battle_completed")), "The final encounter must record a battle_completed progress event.");
  await page.locator(".dungeon-outcome-screen").screenshot({ path: path.join(outputDir, "dungeon-001-challenge-progress.png"), animations: "disabled" });

  process.stdout.write(`${JSON.stringify({ dungeonId: "001", enemyRollcasterType: runId.data.selected_enemy_encounters[0].enemyRollcaster.eclipse_order_type, challengeId: trackedChallengeId, progress: progressAfterRun.current, processedBattleCompleted: true })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
}
