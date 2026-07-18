import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_DUNGEON_BROWSER_TEST !== "true") {
  throw new Error("Set RUN_LIVE_DUNGEON_BROWSER_TEST=true to create and clean up a disposable Dungeon test user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5195";
const outputDir = path.join(root, "output", "dungeon-combat-browser");
const email = `dungeon-combat-${Date.now()}@example.com`;
const password = `Rollcasters-Dungeon-${Date.now()}!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

fs.mkdirSync(outputDir, { recursive: true });

let userId;
let browser;
let devServer;
const browserErrors = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function gameState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function waitForPhase(page, phases) {
  await page.waitForFunction(
    (expected) => expected.includes(JSON.parse(window.render_game_to_text()).combat?.phase),
    phases,
  );
  return (await gameState(page)).combat.phase;
}

async function selectRequiredLeads(page) {
  const state = await gameState(page);
  if (!["lead_selection", "forced_replacements"].includes(state.combat?.phase)) return;
  const needed = state.combat.requiredLeadCount - state.combat.selectedLeadIds.length;
  for (let index = 0; index < needed; index += 1) {
    await page.locator(".battle-unit.selectable:not(.selected-lead)").first().click();
  }
  await page.getByRole("button", { name: "Start Encounter" }).click();
  await waitForPhase(page, ["await_roll"]);
}

async function chooseActions(page) {
  for (let actionIndex = 0; actionIndex < 3; actionIndex += 1) {
    const actionMenu = page.locator(".battle-unit .combat-primary-actions:visible").first();
    if (!(await actionMenu.count())) break;
    await actionMenu.getByRole("button", { name: /^Skill$/ }).click();
    const affordableAttack = page.locator(".battle-unit .combat-skill-actions .skill-tile:has(.skill-power):not([disabled]):visible").first();
    const affordableSkill = await affordableAttack.count()
      ? affordableAttack
      : page.locator(".battle-unit .combat-skill-actions .skill-tile:not([disabled]):visible").first();
    if (await affordableSkill.count()) {
      await affordableSkill.click();
      const legalTarget = page.locator(".battle-unit.legal-target:visible").first();
      if (await legalTarget.count()) await legalTarget.click();
    } else {
      const back = page.locator(".battle-unit .combat-back-row:visible").first();
      await back.click();
      await page.locator(".battle-unit .combat-primary-actions:visible").first()
        .getByRole("button", { name: /^Skip/ }).click();
    }
  }
  const submit = page.getByRole("button", { name: "Submit Actions" });
  check(await submit.isEnabled(), "Every active Critter must have one valid reserved action before submission.");
  await submit.click();
}

async function advanceNarration(page) {
  for (let index = 0; index < 40; index += 1) {
    const phase = (await gameState(page)).combat?.phase;
    if (phase !== "event_playback") return phase;
    await page.locator(".combat-narration").click();
  }
  throw new Error("Combat event playback did not terminate.");
}

async function dismissUnlockNotifications(page) {
  for (let index = 0; index < 20; index += 1) {
    const close = page.locator(".modal-backdrop").getByRole("button", { name: "Close" });
    if (!(await close.count())) return;
    await close.click();
    await page.waitForTimeout(40);
  }
  throw new Error("Unlock notifications did not finish dismissing.");
}

async function waitForPersistedPhase(runId, phase) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await admin
      .from("dungeon_runs")
      .select("combat_state,state_version")
      .eq("id", runId)
      .single();
    if (result.error) throw result.error;
    if (result.data.combat_state?.phase === phase) return result.data.state_version;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for persisted Dungeon phase ${phase}.`);
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
    user_metadata: { username: "Dungeon Combat Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  browser = await chromium.launch({
    headless: process.env.HEADED !== "true",
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) browserErrors.push(`response ${response.status()}: ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  check(
    await page.evaluate(() => typeof crypto.randomUUID === "undefined"),
    "The Dungeon browser regression must exercise the UUID fallback.",
  );
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await page.locator(".starter-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  const leveled = await admin
    .from("user_critters")
    .update({ xp: 1_000_000, level: 100 })
    .eq("user_id", userId)
    .select("id")
    .single();
  if (leveled.error) throw leveled.error;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await dismissUnlockNotifications(page);

  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "play");
  const ids = await page.locator(".dungeon-grid-card > .collectible-id").allTextContents();
  check(ids.length >= 1, "The Dungeon grid must contain at least one authored Dungeon.");
  check(
    ids.join(",") === [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join(","),
    "The Dungeon grid must use natural numeric ID order.",
  );
  await page.locator(".dungeon-select-screen").screenshot({
    path: path.join(outputDir, "dungeon-grid.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGrid = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".dungeon-grid")).gridTemplateColumns.split(" ").length,
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  check(mobileGrid.columns === 1 && mobileGrid.noHorizontalOverflow, "The Dungeon grid must collapse to one overflow-safe mobile column.");
  await page.locator(".dungeon-select-screen").screenshot({
    path: path.join(outputDir, "dungeon-grid-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const firstCard = page.locator(".dungeon-grid-card").first();
  check(await firstCard.locator(".dungeon-stat-grid").count() === 1, "Dungeon cards must show difficulty, format, encounter count, and clears.");
  await firstCard.getByRole("button", { name: /^View .* information$/ }).click();
  check(await page.locator(".dungeon-opponent-entry").count() >= 1, "Dungeon information must expose its effective opponent pool.");
  await page.locator(".dungeon-opponent-entry > summary").first().click();
  check(await page.locator(".dungeon-xp-drops").first().isVisible(), "Opponent details must show Critter and Rollcaster XP.");
  await page.locator(".modal").screenshot({
    path: path.join(outputDir, "dungeon-information.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close" }).click();
  await firstCard.getByRole("button", { name: "Enter Dungeon" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "combat");

  const initial = await gameState(page);
  check(initial.combat?.phase === "lead_selection", `A 1–2 Critter format must start with lead selection; received ${initial.combat?.phase}.`);
  check(initial.combat.opponents.every((opponent) => opponent.hidden), "Enemy identities must remain hidden during lead selection.");
  check(await page.locator(".combat-hidden-opponent").count() === 3, "All three fixed enemy slots must remain concealed before lead confirmation.");
  check(
    await page.locator(".combat-dice-side.opponent .combat-die").count() === 0
      && await page.locator(".combat-dice-hidden").isVisible(),
    "Enemy dice labels must not leak an opponent identity before lead confirmation.",
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-lead-selection.png"),
    animations: "disabled",
  });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  check(
    (await gameState(page)).combat === null,
    "Opening the game root must not auto-resume an unfinished Dungeon.",
  );
  await page.screenshot({
    path: path.join(outputDir, "home-with-active-dungeon.png"),
    animations: "disabled",
  });
  await page.goto(`${baseUrl}/play`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.view === "combat" && state.combat?.phase === "lead_selection";
  });
  check(
    (await gameState(page)).combat.dungeonId === initial.combat.dungeonId,
    "Opening /play must resume the unfinished Dungeon after Home remains opt-in.",
  );

  await selectRequiredLeads(page);
  const revealed = await gameState(page);
  check(revealed.combat.opponents.some((opponent) => opponent.name), "The encounter lineup must reveal after lead confirmation.");
  const run = await admin
    .from("dungeon_runs")
    .select("id,effective_mode,battle_format,battle_count,selected_opponents,catalog_snapshot,squad_snapshot,effect_snapshot,state_version")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();
  if (run.error) throw run.error;
  check(
    run.data.selected_opponents.length ===
      run.data.battle_count * Number(run.data.battle_format.split("v")[1]),
    "The live run must persist one immutable opponent instance per encounter slot.",
  );
  check(run.data.catalog_snapshot && run.data.squad_snapshot, "The live run must persist catalog and squad snapshots.");
  check(Array.isArray(run.data.effect_snapshot?.effects), "The live run must freeze its effect registry.");

  await page.getByRole("button", { name: "Roll Dice" }).click();
  check(await page.locator(".combat-narration").isDisabled(), "Narration must remain gated while dice are rolling.");
  check((await page.locator(".combat-narration").innerText()).includes("Rolling"), "The rolling state must be narrated.");
  await page.waitForTimeout(750);
  check(await page.locator(".combat-narration").isEnabled(), "Dice results must become advanceable after the settle animation.");
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-dice-result.png"),
    animations: "disabled",
  });
  await page.locator(".combat-narration").click();
  await waitForPhase(page, ["select_player_actions"]);
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-action-selection.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCombat = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".combat-board")).gridTemplateColumns.split(" ").length,
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  check(mobileCombat.columns === 1 && mobileCombat.noHorizontalOverflow, "The fixed combat board must collapse to one overflow-safe mobile column.");
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-action-mobile.png"),
    animations: "disabled",
  });
  await page.screenshot({
    path: path.join(outputDir, "combat-action-mobile-viewport.png"),
    animations: "disabled",
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chooseActions(page);
  await waitForPhase(page, ["event_playback"]);
  const savedVersion = await waitForPersistedPhase(run.data.id, "event_playback");
  await page.waitForFunction(() => !document.querySelector(".combat-narration")?.disabled);
  const beforeReload = await gameState(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.view === "combat" && state.combat?.phase === "event_playback";
  });
  const afterReload = await gameState(page);
  check(
    afterReload.combat.narration === beforeReload.combat.narration
      && JSON.stringify(afterReload.combat.player.map((unit) => unit.hp)) === JSON.stringify(beforeReload.combat.player.map((unit) => unit.hp))
      && JSON.stringify(afterReload.combat.opponents.map((unit) => unit.hp)) === JSON.stringify(beforeReload.combat.opponents.map((unit) => unit.hp)),
    "Reloading during event playback must reconstruct the same narration and pre-application HP state.",
  );
  check(savedVersion > run.data.state_version, "Persisted combat UI transitions must advance the server state version.");
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-event-reloaded.png"),
    animations: "disabled",
  });

  let finalPhase = null;
  for (let step = 0; step < 160; step += 1) {
    await dismissUnlockNotifications(page);
    let phase = (await gameState(page)).combat?.phase;
    if (phase === "dungeon_complete" || phase === "dungeon_failed") {
      finalPhase = phase;
      break;
    }
    if (phase === "lead_selection" || phase === "forced_replacements") {
      await selectRequiredLeads(page);
      continue;
    }
    if (phase === "await_roll") {
      await page.getByRole("button", { name: "Roll Dice" }).click();
      await page.waitForTimeout(700);
      await page.locator(".combat-narration").click();
      await waitForPhase(page, ["select_player_actions"]);
      continue;
    }
    if (phase === "roll_result") {
      await page.waitForTimeout(700);
      await page.locator(".combat-narration").click();
      await waitForPhase(page, ["select_player_actions"]);
      continue;
    }
    if (phase === "select_player_actions") {
      await chooseActions(page);
      await waitForPhase(page, ["event_playback", "forced_replacements", "await_roll", "battle_result"]);
      continue;
    }
    if (phase === "event_playback") {
      phase = await advanceNarration(page);
      if (phase === "battle_result") {
        await waitForPhase(page, ["encounter_rewards", "dungeon_complete", "dungeon_failed"]);
      }
      continue;
    }
    if (phase === "battle_result") {
      await waitForPhase(page, ["encounter_rewards", "dungeon_complete", "dungeon_failed"]);
      continue;
    }
    if (phase === "encounter_rewards") {
      await page.locator(".combat-result-dialog").screenshot({
        path: path.join(outputDir, "encounter-rewards.png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "Next Encounter" }).click();
      continue;
    }
    throw new Error(`Unhandled Dungeon phase: ${phase}.`);
  }

  check(finalPhase === "dungeon_complete", `Expected the starter squad to complete the first Dungeon; received ${finalPhase}.`);
  const finalState = await gameState(page);
  check(finalState.combat.encounter === finalState.combat.encounterCount, "The completed run must end on its authored final encounter.");
  await page.locator(".dungeon-outcome-screen").screenshot({
    path: path.join(outputDir, "dungeon-complete.png"),
    animations: "disabled",
  });

  const [completedRun, progress, results, commands] = await Promise.all([
    admin.from("dungeon_runs").select("status,rewards,battle_results").eq("id", run.data.id).single(),
    admin.from("user_dungeon_progress").select("clear_count,completed_at").eq("user_id", userId).eq("dungeon_id", initial.combat.dungeonId).single(),
    admin.from("dungeon_runs").select("battle_results").eq("id", run.data.id).single(),
    admin.from("dungeon_run_commands").select("request_id,command_type").eq("run_id", run.data.id),
  ]);
  for (const result of [completedRun, progress, results, commands]) {
    if (result.error) throw result.error;
  }
  check(completedRun.data.status === "won", "The server must commit the completed live run.");
  check(progress.data.clear_count === 1 && progress.data.completed_at, "The live clear must persist completion progress exactly once.");
  check(results.data.battle_results.length === run.data.battle_count, "The server must journal one result for every encounter.");
  check(commands.data.filter((command) => command.command_type === "battle_result").length === run.data.battle_count, "Every live encounter must have one idempotent result command.");
  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);

  process.stdout.write(`${JSON.stringify({
    dungeonId: initial.combat.dungeonId,
    mode: run.data.effective_mode,
    battleFormat: run.data.battle_format,
    battleCount: run.data.battle_count,
    finalPhase,
    rewardEntries: completedRun.data.rewards?.entries?.length ?? 0,
    browserErrors,
  })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
}
