import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_PROGRESSION_POINTS_TEST !== "true") {
  throw new Error("Set RUN_LIVE_PROGRESSION_POINTS_TEST=true to create and clean up a disposable progression user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5195";
const outputDir = path.join(root, "output", "progression-points-browser");
const email = `progression-points-${Date.now()}@example.com`;
const password = `Rollcasters-Progression-${Date.now()}!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let browser;
let devServer;
let userId;
const browserErrors = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
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

fs.mkdirSync(outputDir, { recursive: true });

try {
  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5195"], { cwd: root, stdio: "ignore" });
    await waitForServer(baseUrl);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Progression Points Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  browser = await chromium.launch({ headless: process.env.HEADED !== "true" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15_000);
  page.on("console", (message) => message.type() === "error" && browserErrors.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));
  page.on("response", (response) => response.status() >= 400 && browserErrors.push(`response ${response.status()}: ${response.url()}`));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await page.locator('.starter-card:has(> .collectible-id:text-is("001"))').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  const critterResult = await admin
    .from("user_critters")
    .update({ level: 3, xp: 210 })
    .eq("user_id", userId)
    .eq("critter_id", "001")
    .select("skill_points,highest_processed_level")
    .single();
  if (critterResult.error) throw critterResult.error;
  check(critterResult.data.skill_points === 3, "The level-3 Ramber fixture must persist 3 Skill points.");
  check(critterResult.data.highest_processed_level === 3, "The level-3 Ramber fixture must process through level 3.");

  const rollcasterResult = await admin
    .from("user_rollcasters")
    .update({ level: 3, xp: 300 })
    .eq("user_id", userId)
    .eq("rollcaster_id", "001")
    .select("ability_points,highest_processed_level")
    .single();
  if (rollcasterResult.error) throw rollcasterResult.error;
  check(rollcasterResult.data.ability_points === 4, "The level-3 Roland fixture must persist 4 Ability points.");
  check(rollcasterResult.data.highest_processed_level === 3, "The level-3 Roland fixture must process through level 3.");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");

  const critterCard = page.locator('.critter-card:has(> .collectible-id:text-is("001"))');
  await critterCard.scrollIntoViewIfNeeded();
  check(await critterCard.locator(".point-counter").getByText("3 skill points", { exact: true }).isVisible(), "Collection must show Ramber's 3 Skill points.");
  const critterScreenshot = path.join(outputDir, "ramber-level-3-skill-points.png");
  await critterCard.screenshot({ path: critterScreenshot, animations: "disabled" });

  await page.getByRole("button", { name: "rollcasters", exact: true }).click();
  const rollcasterCard = page.locator('.rollcaster-card:has(> .collectible-id:text-is("001"))');
  await rollcasterCard.scrollIntoViewIfNeeded();
  check(await rollcasterCard.locator(".point-counter").getByText("4 ability points", { exact: true }).isVisible(), "Collection must show Roland's 4 Ability points.");
  const rollcasterScreenshot = path.join(outputDir, "roland-level-3-ability-points.png");
  await rollcasterCard.screenshot({ path: rollcasterScreenshot, animations: "disabled" });

  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({
    ramber: { level: 3, skillPoints: 3, screenshot: critterScreenshot },
    roland: { level: 3, abilityPoints: 4, screenshot: rollcasterScreenshot },
    browserErrors,
  }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) console.error(`Unable to remove disposable Auth user ${userId}.`, removed.error);
  }
}
