import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_CHALLENGE_RELEASE_TEST !== "true") {
  throw new Error("Set RUN_LIVE_CHALLENGE_RELEASE_TEST=true to create and clean up the temporary Auth test user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5194";
const outputDir = path.join(root, "output", "challenge-release-browser");
const email = `challenge-release-${Date.now()}@example.com`;
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

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

try {
  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5194"], {
      cwd: root,
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Challenge Release Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20_000);
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
  await page.locator(".starter-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  const renderedState = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  check(renderedState.catalogRelease?.schemaVersion === 2, `Expected schema-v2 release, received ${renderedState.catalogRelease?.schemaVersion}.`);
  check(typeof renderedState.catalogRelease?.catalogVersion === "string" && renderedState.catalogRelease.catalogVersion !== "live-development", `Expected a published catalog release, received ${renderedState.catalogRelease?.catalogVersion}.`);

  const owned = await admin.from("user_critters").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (owned.error) throw owned.error;
  const expectedProgress = `${owned.count ?? 0} / 7`;

  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  const card = page.locator('.critter-card:has(> .collectible-id:text-is("028"))');
  await card.scrollIntoViewIfNeeded();
  const challengeRow = card.locator(".challenge-row").filter({ hasText: "Own 7 different Critters." });
  const cardText = await card.textContent();
  check(await challengeRow.count() === 1, `Critter 028 must show the canonical seven-different-Critters challenge. Card text: ${cardText}`);
  const challengeRowText = await challengeRow.textContent();
  check(challengeRowText?.includes(expectedProgress), `Critter 028 must show ${expectedProgress}, not a stale 0 / 0 goal. Row text: ${challengeRowText}`);
  check(!(await card.textContent())?.includes("Own 5 Relics"), "The stale ownership challenge from the previous release is still visible.");

  const screenshot = path.join(outputDir, "critter-028-own-seven.png");
  await card.screenshot({ path: screenshot, animations: "disabled" });
  const diversityCard = page.locator('.critter-card:has(> .collectible-id:text-is("025"))');
  await diversityCard.scrollIntoViewIfNeeded();
  const diversityRow = diversityCard.locator(".challenge-row").filter({ hasText: "Own 1 Critter from each of: Basic, Vile, Frost." });
  check(await diversityRow.count() === 1, "Wispsqueak must show every required Element in its player-facing challenge text.");
  check((await diversityRow.textContent())?.includes("0 / 3"), "Wispsqueak must show the three-Element authored goal.");
  const diversityScreenshot = path.join(outputDir, "critter-025-specific-diversity.png");
  await diversityCard.screenshot({ path: diversityScreenshot, animations: "disabled" });
  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({ release: renderedState.catalogRelease, expectedProgress, screenshot, diversityScreenshot, browserErrors }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
}
