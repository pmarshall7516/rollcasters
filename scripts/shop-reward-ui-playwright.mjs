import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createDbClient, readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_SHOP_REWARD_UI_TEST !== "true") {
  throw new Error("Set RUN_LIVE_SHOP_REWARD_UI_TEST=true to create and clean up a disposable Shop test user.");
}

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

async function selectFirstStarter(page, selector) {
  const card = page.locator(selector).first();
  await card.waitFor();
  await card.click();
}

async function grantTestCoins(userId, amount) {
  const db = createDbClient();
  try {
    await db.connect();
    await db.query(`
      insert into public.user_currencies(user_id,currency_id,balance)
      values($1,'coins',$2)
      on conflict(user_id,currency_id)
      do update set balance=excluded.balance
    `, [userId, amount]);
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function bannerPresentation(banner) {
  return banner.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      bounds: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height },
      position: style.position,
      pointerEvents: style.pointerEvents,
      zIndex: Number(style.zIndex),
      live: node.getAttribute("aria-live"),
      animationName: style.animationName,
      interactiveDescendants: node.querySelectorAll("button, a, input, [tabindex]").length,
    };
  });
}

function checkBanner(presentation, label) {
  check(
    presentation.position === "fixed"
      && presentation.bounds.top <= 16
      && presentation.bounds.left <= 16
      && presentation.bounds.width <= 360
      && presentation.bounds.height <= 90
      && presentation.pointerEvents === "none"
      && presentation.zIndex > 50
      && presentation.live === "polite"
      && presentation.animationName.includes("unlock-banner-in")
      && presentation.interactiveDescendants === 0,
    `${label} must use the compact collectible banner presentation: ${JSON.stringify(presentation)}.`,
  );
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5203";
const outputDir = path.join(root, "output", "shop-reward-ui-browser");
const email = `shop-reward-ui-${Date.now()}@example.com`;
const password = `Rollcasters-Shop-Reward-${Date.now()}!`;
const startingCoins = 1_000;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId;
let browser;
let devServer;
const browserErrors = [];
const failedResponses = [];

fs.mkdirSync(outputDir, { recursive: true });

try {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Shop Reward UI Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5203"], {
      cwd: root,
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }

  browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADED !== "true" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await selectFirstStarter(page, ".starter-rollcaster-card");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await selectFirstStarter(page, ".starter-card");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  await grantTestCoins(userId, startingCoins);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  check(
    await page.locator('.currency-pill[data-currency-id="coins"]').getAttribute("aria-label") === `Coins: ${startingCoins.toLocaleString()}`,
    "The disposable player coin grant did not refresh into the game.",
  );

  await page.getByRole("button", { name: "Shop" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).shop?.tab === "shard");
  const availableCritterShard = page
    .locator('.shop-entry-card[data-shop-type="shard"][data-availability-code="AVAILABLE"]')
    .filter({ has: page.locator(".shop-target-identity") })
    .first();
  await availableCritterShard.waitFor();
  check(await availableCritterShard.getByRole("button", { name: "Purchase" }).isEnabled(), "An unowned Critter Shard offer must be purchasable.");

  const identity = await availableCritterShard.locator(".shop-target-identity").evaluate((node) => {
    const nameNode = node.querySelector(".critter-name");
    const idNode = node.querySelector(".shop-target-id");
    const name = nameNode.getBoundingClientRect();
    const id = idNode.getBoundingClientRect();
    return {
      nameCenter: name.top + name.height / 2,
      idCenter: id.top + id.height / 2,
      nameColor: getComputedStyle(nameNode).color,
      idColor: getComputedStyle(idNode).color,
      whiteSpace: getComputedStyle(node).whiteSpace,
    };
  });
  check(
    Math.abs(identity.nameCenter - identity.idCenter) < 1
      && identity.nameColor === identity.idColor
      && identity.whiteSpace === "nowrap",
    `Critter name and ID must share one aligned row: ${JSON.stringify(identity)}.`,
  );

  const layoutBeforePurchase = await page.locator(".shop-tabs").boundingBox();
  const shardTargetName = (await availableCritterShard.locator(".critter-name strong").textContent())?.trim();
  await availableCritterShard.getByRole("button", { name: "Purchase" }).click();
  const shardBanner = page.locator(".reward-notification").filter({ hasText: "Shop reward" });
  await shardBanner.waitFor();
  checkBanner(await bannerPresentation(shardBanner), "Shard purchase reward");
  check(await page.getByText("Purchase complete.", { exact: false }).count() === 0, "Shard purchases must not insert Purchase complete copy.");
  check(await page.locator(".notice.success").count() === 0, "Shard purchases must not insert an inline success region.");
  const layoutAfterPurchase = await page.locator(".shop-tabs").boundingBox();
  check(
    JSON.stringify(layoutBeforePurchase) === JSON.stringify(layoutAfterPurchase),
    "Displaying the Shard reward banner changed the Shop layout.",
  );
  await page.screenshot({ path: path.join(outputDir, "shard-purchase-reward-banner.png"), fullPage: true });

  await page.getByRole("tab", { name: "Relic Shop" }).click();
  const availableRelic = page.locator('.shop-entry-card[data-shop-type="relic"][data-availability-code="AVAILABLE"]').first();
  await availableRelic.waitFor();
  const relicTargetName = (await availableRelic.locator(".shop-target").textContent())?.replace(/\s+\([^)]+\)\s*$/, "").trim();
  await availableRelic.getByRole("button", { name: "Purchase" }).click();
  const relicBanner = page.locator(".reward-notification").filter({ hasText: `×1 ${relicTargetName} added` });
  await relicBanner.waitFor();
  checkBanner(await bannerPresentation(relicBanner), "Relic purchase reward");
  check(
    await page.locator(".reward-notification").count() === 1
      && !((await relicBanner.textContent()) ?? "").includes(`${shardTargetName} Shards`),
    "A newer Shop purchase must replace the older Shop reward banner instead of queueing behind it.",
  );
  check(await page.getByText("Purchase complete.", { exact: false }).count() === 0, "Relic purchases must not insert Purchase complete copy.");
  check(await page.locator(".notice.success").count() === 0, "Relic purchases must not insert an inline success region.");
  await page.screenshot({ path: path.join(outputDir, "relic-purchase-reward-banner.png"), fullPage: true });
  await relicBanner.waitFor({ state: "hidden", timeout: 6_000 });
  await page.waitForTimeout(100);
  check(
    await page.locator(".reward-notification").count() === 0,
    "An older Shop reward banner reappeared after the newest purchase banner dismissed.",
  );

  check(browserErrors.length === 0, `The Shop reward browser flow logged errors: ${browserErrors.join("\n")}`);
  check(failedResponses.length === 0, `The Shop reward browser flow had failed responses: ${failedResponses.join("\n")}`);
  console.log(`Shop reward UI browser flow passed; screenshots saved to ${outputDir}.`);
} finally {
  await browser?.close().catch(() => undefined);
  if (devServer) {
    devServer.kill("SIGTERM");
    await new Promise((resolve) => devServer.once("exit", resolve));
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}
