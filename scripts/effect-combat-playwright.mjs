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
  check(initial.combat?.phase === "ready", "Combat did not initialize in the ready phase.");
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

  for (let turn = 0; turn < 40; turn += 1) {
    const state = await gameState(page);
    if (state.combat?.phase === "won" || state.combat?.phase === "lost") break;
    if (state.combat?.phase === "ready") {
      await page.getByRole("button", { name: "Roll Dice" }).click();
      await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).combat?.phase === "selecting");
    }

    const usableSkill = page.locator(".battle-unit:not(.opponent) .skill-tile:not([disabled])").first();
    if (await usableSkill.count()) await usableSkill.click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(20);
  }

  const resolved = await gameState(page);
  check(resolved.combat?.phase === "won", `Expected the live dungeon to be won, received ${resolved.combat?.phase}.`);
  await page.getByRole("button", { name: "Claim Rewards" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "rewards");
  await page.screenshot({ path: path.join(outputDir, "combat-rewards.png"), fullPage: true });
  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);

  process.stdout.write(`${JSON.stringify({
    initialPhase: initial.combat.phase,
    finalView: (await gameState(page)).view,
    snapshotEffectCount: run.data.effect_snapshot.effects.length,
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
