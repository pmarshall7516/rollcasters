import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createDbClient, readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_PROMO_CODES_TEST !== "true") {
  throw new Error("Set RUN_LIVE_PROMO_CODES_TEST=true to create and clean up a disposable Promo Code and Auth user.");
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

async function gameState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function selectStarterOtherThan(page, cardSelector, excludedId) {
  const cards = page.locator(cardSelector);
  const count = await cards.count();
  check(count > 0, `No starter cards matched ${cardSelector}.`);
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const id = (await card.locator(".collectible-id").textContent())?.trim();
    if (!excludedId || id !== excludedId) {
      await card.click();
      return;
    }
  }
  throw new Error(`Every available starter matches the Promo Shard target ${excludedId}.`);
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5197";
const outputDir = path.join(root, "output", "promo-codes-browser");
const email = `promo-codes-${Date.now()}@example.com`;
const password = `Rollcasters-Promo-${Date.now()}!`;
const promoId = crypto.randomUUID();
const rewardIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const code = `GIFT${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
const currencyAmount = 125;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId;
let browser;
let devServer;
let seeded = false;
let shardTarget;
let relicTarget;
const browserErrors = [];
const failedResponses = [];
const promoNetworkRequests = [];

fs.mkdirSync(outputDir, { recursive: true });

async function seedPromoCode() {
  const db = createDbClient();
  try {
    await db.connect();
    shardTarget = (await db.query(`
      select
        challenge.collectible_type,
        challenge.collectible_id,
        challenge.required_amount::text,
        coalesce(critter.name,rollcaster.name,relic.name) as name,
        coalesce(critter.asset_path,rollcaster.asset_path,relic.asset_path) as asset_path
      from public.collectible_unlock_challenges challenge
      left join public.critters critter
        on challenge.collectible_type='critter' and critter.id=challenge.collectible_id
      left join public.rollcasters rollcaster
        on challenge.collectible_type='rollcaster' and rollcaster.id=challenge.collectible_id
      left join public.relics relic
        on challenge.collectible_type='relic' and relic.id=challenge.collectible_id
      where challenge.challenge_type='shop_shards'
        and (
          (critter.id is not null and critter.is_active and not critter.is_archived)
          or (rollcaster.id is not null and rollcaster.is_active and not rollcaster.is_archived)
          or (relic.id is not null and relic.is_active and not relic.is_archived)
        )
      order by challenge.collectible_type,challenge.collectible_id
      limit 1
    `)).rows[0];
    check(shardTarget?.collectible_id, "The browser fixture needs one active collectible with a Shop Shards challenge.");

    relicTarget = (await db.query(`
      select id,name,asset_path,max_owned
      from public.relics
      where is_active and not is_archived and max_owned>=1
        and ($1::text is null or id<>$1)
      order by sort_order,id
      limit 1
    `, [shardTarget.collectible_type === "relic" ? shardTarget.collectible_id : null])).rows[0];
    check(relicTarget?.id, "The browser fixture needs one active Relic.");

    await db.query(`
      insert into public.promo_codes(
        id,code,internal_notes,redemption_limit,infinite_use,
        infinite_uses_per_player,uses_per_player,sort_order,is_active,is_archived
      ) values($1,$2,'Disposable game browser fixture.',10,false,false,2,0,true,false)
    `, [promoId, code]);
    await db.query(`
      insert into public.promo_code_rewards(
        id,promo_code_id,reward_type,target_id,quantity,sort_order
      ) values($1,$2,'currency','coins',$3,0)
    `, [rewardIds[0], promoId, currencyAmount]);
    await db.query(`
      insert into public.promo_code_rewards(
        id,promo_code_id,reward_type,target_category,target_id,quantity,sort_order
      ) values($1,$2,'shard',$3,$4,$5,1)
    `, [
      rewardIds[1],
      promoId,
      shardTarget.collectible_type,
      shardTarget.collectible_id,
      Number(shardTarget.required_amount) + 2,
    ]);
    await db.query(`
      insert into public.promo_code_rewards(
        id,promo_code_id,reward_type,target_category,target_id,quantity,sort_order
      ) values($1,$2,'relic','relic',$3,1,2)
    `, [rewardIds[2], promoId, relicTarget.id]);
    seeded = true;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function cleanupPromoCode() {
  if (!seeded) return;
  const db = createDbClient();
  try {
    await db.connect();
    await db.query("delete from public.promo_codes where id=$1", [promoId]);
  } finally {
    await db.end().catch(() => undefined);
  }
}

try {
  await seedPromoCode();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Promo Code Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5197"], {
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
  page.on("request", (request) => {
    if (/promo_code|promo-codes/i.test(request.url())) promoNetworkRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("/rpc/redeem_promo_code")) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await selectStarterOtherThan(
    page,
    ".starter-rollcaster-card",
    shardTarget.collectible_type === "rollcaster" ? shardTarget.collectible_id : null,
  );
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await selectStarterOtherThan(
    page,
    ".starter-card",
    shardTarget.collectible_type === "critter" ? shardTarget.collectible_id : null,
  );
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  await page.getByRole("button", { name: "Shop" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "shop");
  const tabLabels = await page.getByRole("tab").allTextContents();
  check(
    tabLabels.map((label) => label.replace(/\s+/g, " ").trim()).join("|")
      === "Shard Shop|Relic Shop|Lootbox Shop Coming later|Promo Codes",
    `Promo Codes must follow Lootbox Shop; received ${tabLabels.join("|")}.`,
  );
  await page.getByRole("tab", { name: "Promo Codes" }).click();
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.shop?.tab === "promo" && state.shop.promo?.historyStatus === "loaded";
  });
  check(new URL(page.url()).searchParams.get("tab") === "promo", "The Promo Codes tab must be URL-addressable.");
  check(await page.getByRole("textbox", { name: "Promo Code", exact: true }).isVisible(), "The Promo Code input must have a visible accessible label.");
  check(await page.getByText("No redeemed codes yet").isVisible(), "A new player must see the empty history state.");
  check(
    promoNetworkRequests.every((url) => !/\/rest\/v1\/promo_codes(?:\?|$)/.test(url)),
    "The player client must never download Promo Code definitions.",
  );

  const input = page.getByRole("textbox", { name: "Promo Code", exact: true });
  await input.fill(`  ${code.toLowerCase()}  `);
  check(await input.inputValue() === `  ${code}  `, "Lowercase pasted input must remain accepted with an uppercase visual value.");
  await input.press("Enter");
  await page.getByRole("heading", { name: "Rewards claimed!" }).waitFor();
  await page.waitForFunction((expectedCode) => {
    const state = JSON.parse(window.render_game_to_text());
    return state.shop?.promo?.claimedCode === expectedCode
      && state.shop?.promo?.historyCount === 1
      && state.shop?.promo?.claimedPlayerUses === "1"
      && state.shop?.promo?.claimedPlayerUsesRemaining === "1"
      && state.shop?.promo?.claimedGlobalUsesRemaining === "9"
      && state.shop?.promo?.claiming === false;
  }, code);
  check(await input.inputValue() === "", "A successful claim must clear the Promo Code field.");
  check(
    await page.getByRole("heading", { name: "Rewards claimed!" }).evaluate((heading) => document.activeElement === heading),
    "Successful claims must move focus to the reward summary heading.",
  );

  const success = page.locator(".promo-success-card");
  check(await success.locator(".promo-reward-row").count() === 3, "The success reveal must render every returned reward.");
  check(await success.getByText("Coins", { exact: true }).isVisible(), "The Currency reward snapshot must render.");
  check(await success.getByText(`${shardTarget.name} Shards`, { exact: true }).isVisible(), "The Shard reward snapshot must render.");
  check(await success.getByText(relicTarget.name, { exact: true }).isVisible(), "The Relic reward snapshot must render.");
  check(
    await success.getByText("Claim 1 · 1 account use remaining · 9 total claims remaining", { exact: true }).isVisible(),
    "The success reveal must report the server-authoritative personal and global uses remaining.",
  );
  check(
    await success.getByText("Goal reached · 2 excess not added", { exact: true }).isVisible(),
    "Capped Shards must display their excess outcome.",
  );
  check(await success.getByText("Unlocked", { exact: true }).isVisible(), "A newly discovered Relic must display Unlocked.");
  check(
    await success.locator(".promo-reward-row img").evaluateAll((images) => images.every((image) => image.getAttribute("alt") === "")),
    "Reward images must use empty alt text when the adjacent reward name supplies the label.",
  );

  const historyCard = page.locator(".promo-redemption-card");
  check(await historyCard.count() === 1, "A successful claim must prepend one history card.");
  check((await historyCard.locator("header code").textContent())?.trim() === code, "History must display the canonical code snapshot.");
  check(await page.locator('.currency-pill[data-currency-id="coins"]').getAttribute("aria-label") === `Coins: ${currencyAmount}`, "Affected balances must refresh after a claim.");

  const db = createDbClient();
  try {
    await db.connect();
    const persisted = (await db.query(`
      select
        (select count(*)::int from public.promo_code_redemptions where user_id=$1 and promo_code_id=$2) as redemptions,
        (select count(*)::int
          from public.promo_code_redemption_rewards reward
          join public.promo_code_redemptions redemption on redemption.id=reward.redemption_id
          where redemption.user_id=$1 and redemption.promo_code_id=$2) as rewards
    `, [userId, promoId])).rows[0];
    check(persisted.redemptions === 1 && persisted.rewards === 3, "The browser claim must persist one redemption with three immutable snapshots.");
  } finally {
    await db.end().catch(() => undefined);
  }

  await page.screenshot({ path: path.join(outputDir, "promo-code-claimed-desktop.png"), fullPage: true });

  await input.fill(code);
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await page.waitForFunction((expectedCode) => {
    const state = JSON.parse(window.render_game_to_text());
    return state.shop?.promo?.claimedCode === expectedCode
      && state.shop?.promo?.historyCount === 2
      && state.shop?.promo?.claimedPlayerUses === "2"
      && state.shop?.promo?.claimedPlayerUsesRemaining === "0"
      && state.shop?.promo?.claimedGlobalUsesRemaining === "8"
      && state.shop?.promo?.claiming === false;
  }, code);
  check(await page.locator(".promo-redemption-card").count() === 2, "A permitted repeat claim must add another history card.");
  check(
    await page.locator('.currency-pill[data-currency-id="coins"]').getAttribute("aria-label") === `Coins: ${currencyAmount * 2}`,
    "A permitted repeat claim must grant its Currency reward again.",
  );
  const repeatDb = createDbClient();
  try {
    await repeatDb.connect();
    const repeated = (await repeatDb.query(`
      select
        (select count(*)::int from public.promo_code_redemptions
          where user_id=$1 and promo_code_id=$2) as redemptions,
        (select count(*)::int
          from public.promo_code_redemption_rewards reward
          join public.promo_code_redemptions redemption on redemption.id=reward.redemption_id
          where redemption.user_id=$1 and redemption.promo_code_id=$2) as rewards
    `, [userId, promoId])).rows[0];
    check(repeated.redemptions === 2 && repeated.rewards === 6, "Two browser claims must persist two redemptions and six immutable snapshots.");
  } finally {
    await repeatDb.end().catch(() => undefined);
  }
  await page.screenshot({ path: path.join(outputDir, "promo-code-repeated-claim-desktop.png"), fullPage: true });

  await input.fill(code);
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  const playerLimitReached = page.getByRole("alert").filter({ hasText: "You’ve reached this promo code’s claim limit for your account." });
  await playerLimitReached.waitFor();
  check(await input.inputValue() === code, "A failed claim must keep the typed code visible.");
  check(await historyCard.count() === 2, "A claim above the per-account limit must not add local history.");

  await input.fill("NOT_A_REAL_PROMO");
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "That promo code is invalid or no longer active." }).waitFor();
  check(await input.inputValue() === "NOT_A_REAL_PROMO", "Invalid code errors must retain the submitted text.");

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.shop?.tab === "promo" && state.shop.promo?.historyStatus === "loaded";
  });
  check(await page.locator(".promo-success-card").count() === 0, "The transient success reveal must not survive a reload.");
  check(await page.locator(".promo-redemption-card").count() === 2, "Every permitted redemption must reload from server history.");
  check(
    await page.getByText(`${shardTarget.name} Shards`, { exact: true }).count() === 2
      && await page.getByText(`${shardTarget.name} Shards`, { exact: true }).first().isVisible(),
    "Every reloaded history entry must use its reward-name snapshot.",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    columns: getComputedStyle(document.querySelector(".promo-reward-grid")).gridTemplateColumns.split(" ").length,
    inputWidth: document.querySelector(".promo-code-input").getBoundingClientRect().width,
    buttonWidth: document.querySelector(".promo-claim-button").getBoundingClientRect().width,
  }));
  check(mobileLayout.scrollWidth <= mobileLayout.viewport, "The Promo Codes page must not overflow horizontally on mobile.");
  check(mobileLayout.columns === 1, "Mobile reward history must remain one column.");
  check(Math.abs(mobileLayout.inputWidth - mobileLayout.buttonWidth) < 1, "The mobile Claim button must stack at full input width.");
  await page.screenshot({ path: path.join(outputDir, "promo-code-history-mobile.png"), fullPage: true });

  const unexpectedBrowserErrors = browserErrors.filter(
    (message) => !message.includes("Failed to load resource: the server responded with a status of 400"),
  );
  check(unexpectedBrowserErrors.length === 0, `The Promo Code browser flow logged errors: ${unexpectedBrowserErrors.join("\n")}`);
  check(failedResponses.length === 0, `The Promo Code browser flow had unexpected failed responses: ${failedResponses.join("\n")}`);
  console.log(`Promo Code browser flow passed for ${code}; desktop/mobile screenshots saved to ${outputDir}.`);
} finally {
  await browser?.close().catch(() => undefined);
  if (devServer) {
    devServer.kill("SIGTERM");
    await new Promise((resolve) => devServer.once("exit", resolve));
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  await cleanupPromoCode().catch((error) => {
    console.error("Unable to clean up the disposable Promo Code.", error);
  });
}
