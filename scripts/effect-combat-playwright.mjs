import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_EFFECT_BROWSER_TEST !== "true") {
  throw new Error("Set RUN_LIVE_EFFECT_BROWSER_TEST=true to create and clean up the temporary Auth test user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5192";
const outputDir = path.join(root, "output", "effect-combat-browser");
const email = `effect-combat-${Date.now()}@example.com`;
const password = `Rollcasters-Test-${Date.now()}!`;
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

try {
  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5192"], {
      cwd: root,
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Effect Combat Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");

  await page.locator(".starter-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByRole("button", { name: "Enter dungeon" }).first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "combat");

  const initial = await gameState(page);
  check(initial.combat?.phase === "await_roll", "Combat did not initialize in the await-roll phase.");
  check(initial.combat.player.some((unit) => unit.active && unit.stats.def >= 1), "Resolved combat stats were not exposed for the active player.");

  const run = await admin
    .from("dungeon_runs")
    .select("id,effect_snapshot")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();
  if (run.error) throw run.error;
  check(run.data.effect_snapshot?.effects?.some((effect) => effect.ownerType === "ability"), "The live run snapshot did not include its equipped Ability effects.");
  check(Array.isArray(run.data.effect_snapshot?.statuses), "The live run snapshot did not freeze Status lifecycle data.");

  await page.screenshot({ path: path.join(outputDir, "combat-initial.png"), fullPage: true });

  for (let step = 0; step < 600; step += 1) {
    const state = await gameState(page);
    const phase = state.combat?.phase;
    if (phase === "dungeon_complete" || phase === "dungeon_failed") break;

    if (phase === "await_roll") {
      await page.getByRole("button", { name: "Roll Dice" }).click();
      continue;
    }

    if (phase === "roll_result" || phase === "event_playback") {
      const narration = page.locator(".combat-narration.advanceable");
      await narration.waitFor({ state: "visible" });
      await page.waitForFunction(() => {
        const button = document.querySelector(".combat-narration.advanceable");
        return button instanceof HTMLButtonElement && !button.disabled;
      });
      await narration.click();
      continue;
    }

    if (phase === "select_player_actions") {
      const submit = page.getByRole("button", { name: "Submit Actions" });
      if (await submit.isEnabled()) {
        await submit.click();
        continue;
      }

      const skillMenu = page.locator(".combat-primary-actions button").filter({ hasText: /^\s*Skill\s*$/ }).first();
      if (await skillMenu.count()) {
        await skillMenu.click();
        const usableSkill = page.locator(".combat-skill-actions .skill-tile:not([disabled])").first();
        if (await usableSkill.count()) {
          await usableSkill.click();
          const target = page.locator(".battle-unit.legal-target").first();
          if (await target.count()) await target.click();
          continue;
        }
        await page.locator(".combat-back-row").filter({ hasText: "Back to Action Menu" }).click();
      }

      const skip = page.locator(".combat-primary-actions button").filter({ hasText: /^\s*Skip/ }).first();
      check(await skip.count(), "No usable Skill or Skip action was available for the current Critter.");
      await skip.click();
      continue;
    }

    if (phase === "encounter_rewards") {
      await page.getByRole("button", { name: "Next Encounter" }).click();
      continue;
    }

    if (phase === "battle_result") {
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).combat?.phase !== "battle_result");
      continue;
    }

    if (phase === "lead_selection" || phase === "forced_replacements") {
      const selectable = page.locator("[role=dialog] .battle-unit.selectable").first();
      if (await selectable.count()) await selectable.click();
      const confirm = page.locator("[role=dialog] button.primary-button").first();
      if (await confirm.isEnabled()) await confirm.click();
      continue;
    }

    throw new Error(`Unhandled combat phase ${String(phase)}.`);
  }

  const resolved = await gameState(page);
  check(
    resolved.combat?.phase === "dungeon_complete" || resolved.combat?.phase === "dungeon_failed",
    `Expected a terminal live dungeon outcome, received ${resolved.combat?.phase}.`,
  );
  await page.screenshot({ path: path.join(outputDir, "combat-outcome.png"), fullPage: true });
  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);

  process.stdout.write(`${JSON.stringify({
    initialPhase: initial.combat.phase,
    finalPhase: resolved.combat.phase,
    snapshotEffectCount: run.data.effect_snapshot.effects.length,
    browserErrors,
  })}\n`);
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages[0];
    if (page) {
      await page.screenshot({ path: path.join(outputDir, "combat-failure.png"), fullPage: true }).catch(() => undefined);
      const state = await page.evaluate(() => window.render_game_to_text?.() ?? null).catch(() => null);
      process.stderr.write(`${JSON.stringify({ state, browserErrors }, null, 2)}\n`);
    }
  }
  throw error;
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
}
