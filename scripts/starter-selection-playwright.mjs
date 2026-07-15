import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_STARTER_SELECTION_TEST !== "true") {
  throw new Error("Set RUN_LIVE_STARTER_SELECTION_TEST=true to create and clean up disposable starter-selection users.");
}

const STARTER_IDS = ["001", "004", "007"];
const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5194";
const outputDir = path.join(root, "output", "starter-selection-browser");
const password = `Rollcasters-Starter-${Date.now()}!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let browser;
let devServer;
const userIds = [];
const browserErrors = [];
const verified = [];

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
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5194"], { cwd: root, stdio: "ignore" });
    await waitForServer(baseUrl);
  }

  for (const starterId of STARTER_IDS) {
    const email = `starter-${starterId}-${Date.now()}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `Starter ${starterId} Test` },
    });
    if (created.error) throw created.error;
    const userId = created.data.user.id;
    userIds.push(userId);

    browser = await chromium.launch({ headless: process.env.HEADED !== "true" });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("console", (message) => message.type() === "error" && browserErrors.push(`${starterId} console: ${message.text()}`));
    page.on("pageerror", (error) => browserErrors.push(`${starterId} page: ${String(error)}`));
    page.on("response", (response) => response.status() >= 400 && browserErrors.push(`${starterId} response ${response.status()}: ${response.url()}`));

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
    await page.locator(`.starter-card:has(> .collectible-id:text-is("${starterId}"))`).click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

    const shards = await admin
      .from("user_collectible_shards")
      .select("quantity")
      .eq("user_id", userId)
      .eq("collectible_type", "critter")
      .eq("collectible_id", starterId)
      .single();
    if (shards.error) throw shards.error;
    check(String(shards.data.quantity) === "50", `Starter ${starterId} must persist exactly 50 shards.`);

    await page.getByRole("button", { name: "Collection" }).click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
    // Chromium can tile the full-screen backdrop blur as opaque bands in a
    // screenshot even though the headed page is intact. Disable only those
    // capture-irrelevant blur layers before the modal compositor is created.
    await page.addStyleTag({ content: ".modal-backdrop,.modal-header{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}.sprite-box__image{display:none!important}" });
    await page.locator(`.critter-card:has(> .collectible-id:text-is("${starterId}"))`).click();
    const challenge = page.locator(".challenge-detail-row").filter({ hasText: "50 / 50" });
    check(await challenge.count() === 1, `Starter ${starterId} popup must show 50 / 50 shard progress.`);
    check((await challenge.getAttribute("class"))?.includes("complete"), `Starter ${starterId} popup must render completed challenge status.`);
    check(await page.getByText("1 complete", { exact: true }).isVisible(), `Starter ${starterId} popup must report one completed challenge.`);
    const panelWidth = await page.locator(".collectible-challenge-panel").evaluate((panel) => panel.getBoundingClientRect().width);
    await page.evaluate((width) => {
      const panel = document.querySelector(".collectible-challenge-panel");
      if (!panel) throw new Error("Challenge panel disappeared before capture.");
      document.body.replaceChildren(panel);
      document.body.style.margin = "0";
      document.body.style.background = "#080a18";
      panel.style.width = `${width}px`;
    }, panelWidth);
    await page.waitForTimeout(750);
    const screenshot = path.join(outputDir, `starter-${starterId}-challenge-complete.png`);
    await page.locator(".collectible-challenge-panel").screenshot({ path: screenshot, animations: "disabled" });
    verified.push({ starterId, shards: "50", screenshot });
    await context.close();
    await browser.close();
    browser = undefined;
  }

  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({ verified, browserErrors })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  for (const userId of userIds) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) console.error(`Unable to remove disposable Auth user ${userId}.`, removed.error);
  }
}
