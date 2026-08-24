import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createDbClient, readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_COLLECTIBLES_BROWSER_TEST !== "true") {
  throw new Error("Set RUN_LIVE_COLLECTIBLES_BROWSER_TEST=true to create and clean up disposable catalog rows and an Auth test user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5193";
const outputDir = path.join(root, "output", "collectibles-shop-browser");
const email = `collectibles-shop-${Date.now()}@example.com`;
const password = `Rollcasters-Shop-${Date.now()}!`;
const entryIds = [];
let relicOfferName;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let critterTarget;
let relicTarget;
let userId;
let browser;
let devServer;
let contentSeeded = false;
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

async function gameState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function seedContent() {
  const db = createDbClient();
  try {
    await db.connect();
    await db.query("begin");
    const critter = await db.query(`
      select c.id,c.name,shop_challenge.id as shop_challenge_id,e.id as entry_id,e.price,shop_challenge.required_amount as shard_goal
      from public.critters c
      join public.collectible_unlock_requirements requirement
        on requirement.collectible_type='critter'
       and requirement.collectible_id=c.id
      join public.collectible_unlock_challenges shop_challenge
        on shop_challenge.collectible_type='critter' and shop_challenge.collectible_id=c.id
       and shop_challenge.challenge_type='shop_shards'
      join public.shop_entries e
        on e.shop_type='shard' and e.target_category='critter' and e.target_id=c.id
       and e.is_active and not e.is_archived
      where c.is_active and not c.is_archived
        and c.id='004'
      order by c.sort_order,c.id limit 1
    `);
    check(critter.rowCount === 1, "Published Critter 004 is not available for the browser fixture.");
    critterTarget = critter.rows[0];
    entryIds.push(critterTarget.entry_id);

    const relic = await db.query(`
      select r.id,r.name,r.max_owned,e.id as entry_id,e.price
      from public.relics r
      join public.collectible_unlock_requirements u on u.collectible_type='relic' and u.collectible_id=r.id and u.required_challenges=1
      join public.collectible_unlock_challenges ch on ch.collectible_type='relic' and ch.collectible_id=r.id and ch.challenge_type='shop_relic' and ch.required_amount=1
      join public.shop_entries e on e.shop_type='relic' and e.target_category='relic' and e.target_id=r.id and e.is_active and not e.is_archived
      where r.is_active and not r.is_archived and r.max_owned>=1
      order by r.max_owned desc,r.sort_order,r.id limit 1
    `);
    check(relic.rowCount === 1, "No published Relic Shop offer is available for the browser fixture.");
    relicTarget = relic.rows[0];
    await db.query("commit");
    relicOfferName = relicTarget.name;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function seedPlayerState() {
  const db = createDbClient();
  try {
    await db.connect();
    await db.query("begin");
    const totalCoins = Number(relicTarget.price) * Number(relicTarget.max_owned) + Number(critterTarget.price);
    await db.query("insert into public.user_currencies(user_id,currency_id,balance) values($1,'coins',$2) on conflict(user_id,currency_id) do update set balance=excluded.balance", [userId, totalCoins]);
    const startingShards = Number(critterTarget.shard_goal) - 1;
    await db.query("insert into public.user_collectible_shards(user_id,collectible_type,collectible_id,quantity) values($1,'critter',$2,$3) on conflict(user_id,collectible_type,collectible_id) do update set quantity=excluded.quantity", [userId, critterTarget.id, startingShards]);
    await db.query("insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at,updated_at) values($1,$2,$3,now(),now()) on conflict(user_id,challenge_id) do update set progress=excluded.progress,completed_at=coalesce(user_collectible_challenge_progress.completed_at,now()),updated_at=now()", [userId, critterTarget.shop_challenge_id, startingShards]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function cleanupContent() {
  return;
}

fs.mkdirSync(outputDir, { recursive: true });

try {
  await seedContent();
  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5193"], { cwd: root, stdio: "ignore" });
    await waitForServer(baseUrl);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Collectibles Shop Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  const headed = process.env.PLAYWRIGHT_HEADED === "true";
  browser = await chromium.launch({ headless: !headed, args: headed ? [] : ["--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15_000);
  page.on("console", (message) => message.type() === "error" && browserErrors.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await seedPlayerState();
  await page.reload();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  const selectedStarterCard = page.locator('.starter-card:has(> .collectible-id:text-is("001"))');
  const selectedStarterId = (await selectedStarterCard.locator(".collectible-id").textContent())?.trim();
  check(["001", "004", "007"].includes(selectedStarterId), "The starter screen must offer Critter 001, 004, or 007.");
  await selectedStarterCard.click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  const starterCollectionCard = page.locator(`.critter-card:has(> .collectible-id:text-is("${selectedStarterId}"))`);
  check(await starterCollectionCard.count() > 0, "The selected starter did not render in Collection.");
  await starterCollectionCard.first().click();
  const starterChallenge = page.locator(".challenge-detail-row").filter({ hasText: "50 / 50" });
  check(await starterChallenge.count() === 1, "The selected starter popup must show 50 / 50 shard progress.");
  check((await starterChallenge.getAttribute("class"))?.includes("complete"), "The selected starter shard challenge must render completed status.");
  await page.screenshot({ path: path.join(outputDir, "starter-shard-challenge-complete.png"), fullPage: false });
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Rollcasters home" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  const headerCurrencies = await page.locator(".currency-pill").evaluateAll((pills) => pills.map((pill) => {
    const icon = pill.querySelector("img");
    return {
      id: pill.getAttribute("data-currency-id"),
      label: pill.getAttribute("aria-label"),
      color: getComputedStyle(pill).color,
      iconLoaded: icon instanceof HTMLImageElement && icon.complete && icon.naturalWidth > 0,
    };
  }));
  const startingCoins = Number(relicTarget.price) * Number(relicTarget.max_owned) + Number(critterTarget.price);
  check(headerCurrencies.slice(0, 2).map((row) => row.id).join(",") === "coins,prismite", "Coins and Prismite must be the first two authored header currencies.");
  check(headerCurrencies[0]?.label === `Coins: ${startingCoins}` && headerCurrencies[1]?.label === "Prismite: 0", "Authored currency balances must remain visible with exact accessible labels.");
  check(headerCurrencies[0]?.color === "rgb(255, 214, 90)" && headerCurrencies[1]?.color === "rgb(125, 232, 255)", "Currency balance text must use its authored display color.");
  check(headerCurrencies[0]?.iconLoaded && headerCurrencies[1]?.iconLoaded, "Currency sprites must load in the signed-in header.");
  await page.screenshot({ path: path.join(outputDir, "home-tracking.png"), fullPage: false });

  const coinsCurrency = page.locator('.currency-pill[data-currency-id="coins"]');
  const prismiteCurrency = page.locator('.currency-pill[data-currency-id="prismite"]');
  await coinsCurrency.hover();
  await page.waitForTimeout(150);
  const currencyTooltip = page.locator(".currency-hover-tooltip");
  check(await currencyTooltip.isVisible(), "Hovering Coins must reveal its currency balance tooltip.");
  const startingCoinsLabel = (await currencyTooltip.textContent())?.trim();
  check(startingCoinsLabel === `Coins: ${startingCoins}`, `The Coins tooltip must show the exact owned balance label: ${startingCoinsLabel}`);
  check(await currencyTooltip.evaluate((tooltip) => getComputedStyle(tooltip).color) === "rgb(255, 214, 90)", "The Coins tooltip must use the Coins text color.");
  await page.screenshot({ path: path.join(outputDir, "home-currency-tooltip-coins.png") });
  await prismiteCurrency.hover();
  await page.waitForTimeout(150);
  check((await currencyTooltip.textContent())?.trim() === "Prismite: 0", "The Prismite tooltip must show the exact owned balance label.");
  check(await currencyTooltip.evaluate((tooltip) => getComputedStyle(tooltip).color) === "rgb(125, 232, 255)", "The Prismite tooltip must use the Prismite text color.");
  await page.reload();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await prismiteCurrency.hover();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outputDir, "home-currency-tooltip-prismite.png") });

  await page.getByRole("button", { name: "Shop" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "shop");
  check(await page.getByText(/Shop offer for/i).count() === 0, "Generated Shard Shop offer descriptions must be hidden.");
  const shardOffer = page.locator(`.shop-entry-card[data-shop-type="shard"][data-target-id="${critterTarget.id}"]`);
  await page.screenshot({ path: path.join(outputDir, "shop-shards.png"), fullPage: false });
  await shardOffer.hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, "shop-shards-diamond-hover.png"), fullPage: false });
  await page.getByRole("tab", { name: "Relic Shop" }).click();
  check(await page.getByText(/Shop offer for/i).count() === 0, "Generated Relic Shop offer descriptions must be hidden.");
  await page.screenshot({ path: path.join(outputDir, "shop-relics.png"), fullPage: false });
  const relicOffer = page.locator(".shop-entry-card").filter({ hasText: relicOfferName });
  check(await relicOffer.count() === 1, "The Relic offer did not render.");
  check(await relicOffer.getByRole("button", { name: "Purchase" }).isEnabled(), "An unowned Relic offer must begin purchasable.");
  await relicOffer.hover();
  await page.screenshot({ path: path.join(outputDir, "shop-relics-hover.png"), fullPage: false });
  for (let quantity = 1; quantity <= relicTarget.max_owned; quantity += 1) {
    await relicOffer.getByRole("button", { name: "Purchase" }).click();
    const shopRewardBanner = page.locator(".reward-notification").filter({ hasText: "Shop reward" });
    await shopRewardBanner.waitFor();
    check(await page.getByText("Purchase complete.", { exact: false }).count() === 0, "Shop purchases must not insert the old Purchase complete notice.");
    check(await page.locator(".notice.success").count() === 0, "Shop purchases must not render an inline success region.");
    const shopRewardPresentation = await shopRewardBanner.evaluate((banner) => {
      const bounds = banner.getBoundingClientRect();
      const style = getComputedStyle(banner);
      return {
        position: style.position,
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        pointerEvents: style.pointerEvents,
        zIndex: Number(style.zIndex),
        live: banner.getAttribute("aria-live"),
        animationName: style.animationName,
      };
    });
    check(
      shopRewardPresentation.position === "fixed"
        && shopRewardPresentation.top <= 16
        && shopRewardPresentation.left <= 16
        && shopRewardPresentation.width <= 360
        && shopRewardPresentation.pointerEvents === "none"
        && shopRewardPresentation.zIndex > 50
        && shopRewardPresentation.live === "polite"
        && shopRewardPresentation.animationName.includes("unlock-banner-in"),
      `Shop rewards must reuse the compact top-left banner: ${JSON.stringify(shopRewardPresentation)}.`,
    );
    await shopRewardBanner.waitFor({ state: "hidden", timeout: 6_000 });
    if (quantity < relicTarget.max_owned) {
      check(await relicOffer.getByRole("button", { name: "Purchase" }).isEnabled(), "An owned Relic below max_owned must remain purchasable.");
    }
  }
  check(await relicOffer.getAttribute("data-availability-code") === "RELIC_MAX_OWNED_REACHED", "A max-owned Relic offer must expose its max-owned state.");
  check((await relicOffer.getAttribute("class"))?.includes("max-owned") && !(await relicOffer.getAttribute("class"))?.includes("sold-out"), "A max-owned Relic offer must keep its full card presentation.");
  check(await relicOffer.getByRole("button", { name: "Purchase" }).count() === 0, "A max-owned Relic offer must replace Purchase with status text.");
  const relicMaxPresentation = await relicOffer.evaluate((card) => ({
    statusText: card.querySelector(".shop-complete-status")?.textContent?.trim(),
    statusColor: card.querySelector(".shop-complete-status") ? getComputedStyle(card.querySelector(".shop-complete-status")).color : null,
    cardOpacity: getComputedStyle(card).opacity,
    spriteFilter: card.querySelector(".sprite-frame .sprite") ? getComputedStyle(card.querySelector(".sprite-frame .sprite")).filter : null,
  }));
  check(relicMaxPresentation.statusText === "Max Owned!" && relicMaxPresentation.statusColor === "rgb(97, 221, 160)" && relicMaxPresentation.cardOpacity === "1" && relicMaxPresentation.spriteFilter === "none", `A max-owned Relic offer must use the full-card green status treatment: ${JSON.stringify(relicMaxPresentation)}`);
  await relicOffer.hover();
  await page.screenshot({ path: path.join(outputDir, "shop-relics-max-owned-hover.png"), fullPage: false });
  await page.getByRole("tab", { name: "Shard Shop" }).click();

  await shardOffer.getByRole("button", { name: "Purchase" }).click();
  const shardGoal = Number(critterTarget.shard_goal);
  await page.waitForFunction((targetId, goal) => {
    const card = [...document.querySelectorAll(".shop-entry-card")].find((candidate) => candidate.textContent?.includes(targetId));
    return card?.textContent?.includes(`${goal} / ${goal} Shards`) && !card?.textContent?.includes(`Shards: ${goal} / ${goal}`);
  }, critterTarget.id, shardGoal);
  const firstShardReward = page.locator(".reward-notification").filter({ hasText: "Shop reward" });
  await firstShardReward.waitFor();
  await page.screenshot({ path: path.join(outputDir, "shop-shards-progress.png"), fullPage: false });
  await firstShardReward.waitFor({ state: "hidden", timeout: 6_000 });
  await page.getByRole("heading", { name: `${critterTarget.name} unlocked!` }).waitFor();
  const unlockBanner = page.locator(".unlock-notification");
  const unlockPresentation = await unlockBanner.evaluate((banner) => {
    const bounds = banner.getBoundingClientRect();
    const style = getComputedStyle(banner);
    return {
      bounds: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height },
      position: style.position,
      pointerEvents: style.pointerEvents,
      zIndex: Number(style.zIndex),
      animationName: style.animationName,
      live: banner.getAttribute("aria-live"),
      interactiveDescendants: banner.querySelectorAll("button, a, input, [tabindex]").length,
      modalBackdrops: document.querySelectorAll(".modal-backdrop").length,
    };
  });
  check(
    unlockPresentation.position === "fixed"
      && unlockPresentation.bounds.top <= 16
      && unlockPresentation.bounds.left <= 16
      && unlockPresentation.bounds.width <= 360
      && unlockPresentation.bounds.height <= 90,
    `The unlock notification must be a compact top-left fixed banner: ${JSON.stringify(unlockPresentation)}`,
  );
  check(
    unlockPresentation.pointerEvents === "none"
      && unlockPresentation.interactiveDescendants === 0
      && unlockPresentation.modalBackdrops === 0,
    `The unlock banner must not intercept interaction or open a modal: ${JSON.stringify(unlockPresentation)}`,
  );
  check(
    unlockPresentation.zIndex > 50
      && unlockPresentation.live === "polite"
      && unlockPresentation.animationName.includes("unlock-banner-in"),
    `The unlock banner must announce politely, animate in, and layer above other UI: ${JSON.stringify(unlockPresentation)}`,
  );
  await page.screenshot({ path: path.join(outputDir, "unlock-notification.png"), fullPage: false });
  await unlockBanner.waitFor({ state: "hidden", timeout: 6_000 });
  await page.waitForFunction((targetId) => {
    const card = [...document.querySelectorAll(".shop-entry-card")].find((candidate) => candidate.textContent?.includes(targetId));
    return card?.getAttribute("data-availability-code") === "COLLECTIBLE_ALREADY_UNLOCKED";
  }, critterTarget.id);
  check(!(await shardOffer.getAttribute("class"))?.includes("sold-out"), "An already-unlocked Shard offer must keep its full card presentation.");
  check((await shardOffer.getAttribute("class"))?.includes("complete"), "A completed Shard Shop offer must expose the completed card state.");
  check(await shardOffer.getAttribute("data-shard-status") === "complete", "A completed Shard Shop offer must expose complete shard status.");
  check(await shardOffer.getByRole("button", { name: "Already Owned" }).count() === 0 && await shardOffer.getByRole("button", { name: "Purchase" }).count() === 0, "An already-unlocked Shard offer must replace the purchase button with status text.");
  check(await shardOffer.getByText("Already Unlocked!", { exact: true }).count() === 1, "An already-unlocked Shard offer must show the exact green status text.");
  const shardVisuals = await shardOffer.evaluate((card) => {
    const square = card.querySelector(".shard-sprite-frame .sprite");
    const shard = card.querySelector(".shard-sprite-frame");
    const outline = card.querySelector(".shard-sprite-outline");
    const polygon = card.querySelector(".shard-outline-border");
    const outlineGlow = card.querySelector(".shard-outline-glow-wide");
    const completeStatus = card.querySelector(".shop-complete-status");
    if (!square || !shard || !outline || !polygon || !outlineGlow || !completeStatus) return null;
    const squareStyle = getComputedStyle(square);
    const shardStyle = getComputedStyle(shard);
    const completeStatusStyle = getComputedStyle(completeStatus);
    const shardBounds = shard.getBoundingClientRect();
    return {
      squareBackground: squareStyle.backgroundImage === "none" ? squareStyle.backgroundColor : squareStyle.backgroundImage,
      squareBorderWidth: squareStyle.borderTopWidth,
      squareBoxShadow: squareStyle.boxShadow,
      spriteFilter: squareStyle.filter,
      shardBackground: shardStyle.backgroundImage === "none" ? shardStyle.backgroundColor : shardStyle.backgroundImage,
      shardAspectRatio: shardBounds.width / shardBounds.height,
      polygonPoints: polygon.getAttribute("points"),
      outlineColor: polygon ? getComputedStyle(polygon).stroke : null,
      outlineWidth: polygon ? getComputedStyle(polygon).strokeWidth : null,
      outlineFilter: getComputedStyle(outline).filter,
      outlineGlowOpacity: getComputedStyle(outlineGlow).opacity,
      wrapperFilter: getComputedStyle(card.querySelector(".shard-sprite-glow")).filter,
      progressClass: card.querySelector(".shard-progress")?.className ?? null,
      progressBorderColor: card.querySelector(".shard-progress .xp-bar") ? getComputedStyle(card.querySelector(".shard-progress .xp-bar")).borderTopColor : null,
      completeStatusColor: completeStatusStyle.color,
    };
  });
  check(shardVisuals?.squareBackground === "rgba(0, 0, 0, 0)", "The nested square Shard Sprite background must be transparent.");
  check(shardVisuals?.squareBorderWidth === "0px" && shardVisuals.squareBoxShadow === "none", "The nested square Shard Sprite border and shadow must be invisible.");
  check(shardVisuals?.shardBackground === "rgba(0, 0, 0, 0)", "The Shard-shaped SpriteFrame background must be transparent.");
  check((shardVisuals?.shardAspectRatio ?? 0) > 1.6 && shardVisuals?.polygonPoints === "1,50 50,1 99,50 50,99", "Shard offers must use the flattened diamond frame.");
  check(shardVisuals?.outlineColor === "rgb(97, 221, 160)" && shardVisuals.outlineWidth === "2.4px" && shardVisuals.progressClass?.includes("complete") && shardVisuals.progressBorderColor === "rgb(97, 221, 160)", `A completed Shard Shop offer must use the Bag completion colors: ${JSON.stringify(shardVisuals)}`);
  check(shardVisuals?.outlineFilter !== "none" && shardVisuals.wrapperFilter === "none" && shardVisuals.outlineGlowOpacity === "1", "A completed Shard Shop offer must keep its green diamond glow visible without hover.");
  check(shardVisuals?.completeStatusColor === "rgb(97, 221, 160)", "Already unlocked must use the green completion status color.");
  await shardOffer.hover();
  await page.waitForTimeout(250);
  const shardHover = await shardOffer.evaluate((card) => ({
    cardShadow: getComputedStyle(card).boxShadow,
    outlineFilter: getComputedStyle(card.querySelector(".shard-sprite-outline")).filter,
    outlineGlowOpacity: getComputedStyle(card.querySelector(".shard-outline-glow-wide")).opacity,
    spriteFilter: getComputedStyle(card.querySelector(".shard-sprite-frame .sprite")).filter,
    wrapperFilter: getComputedStyle(card.querySelector(".shard-sprite-glow")).filter,
  }));
  check(shardHover.cardShadow !== "none" && shardHover.outlineGlowOpacity === "1", "Hovering a Shard offer must glow both the card border and diamond outline.");
  check(shardHover.outlineFilter === shardVisuals?.outlineFilter && shardHover.spriteFilter === shardVisuals?.spriteFilter && shardHover.wrapperFilter === "none", "Shard hover must not apply a filter glow to the collectible sprite or its wrapper.");
  await page.screenshot({ path: path.join(outputDir, "shop-shards-owned-hover.png"), fullPage: false });

  await page.getByRole("button", { name: "Bag" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "bag");
  await page.getByRole("tab", { name: "Shards" }).click();
  const completedBagShard = page.locator(`.bag-shard-card[data-collectible-id="${critterTarget.id}"][data-shard-status="complete"]`);
  await completedBagShard.waitFor();
  const bagCompletion = await completedBagShard.evaluate((card) => {
    const outline = card.querySelector(".shard-outline-border");
    const outlineSvg = card.querySelector(".shard-sprite-outline");
    const progress = card.querySelector(".shard-progress");
    const progressBar = card.querySelector(".shard-progress .xp-bar");
    const progressFill = card.querySelector(".shard-progress .xp-bar span");
    return {
      text: card.textContent,
      cardStatus: card.getAttribute("data-shard-status"),
      outlineColor: outline ? getComputedStyle(outline).stroke : null,
      outlineWidth: outline ? getComputedStyle(outline).strokeWidth : null,
      outlineFilter: outlineSvg ? getComputedStyle(outlineSvg).filter : null,
      progressClass: progress?.className ?? null,
      progressBorderColor: progressBar ? getComputedStyle(progressBar).borderTopColor : null,
      progressBoxShadow: progressBar ? getComputedStyle(progressBar).boxShadow : null,
      progressAnimation: progressFill ? getComputedStyle(progressFill).animationName : null,
    };
  });
  check(bagCompletion.cardStatus === "complete", `The Bag Shard card must expose its completed state: ${JSON.stringify(bagCompletion)}`);
  check(bagCompletion.progressClass?.includes("complete"), `The Bag Shard progress block must expose its completed state: ${JSON.stringify(bagCompletion)}`);
  check(bagCompletion.outlineColor === "rgb(97, 221, 160)" && bagCompletion.outlineWidth === "2.4px", `The completed Bag Shard outline must use the success treatment: ${JSON.stringify(bagCompletion)}`);
  check(bagCompletion.outlineFilter !== "none" && bagCompletion.progressBorderColor === "rgb(97, 221, 160)" && bagCompletion.progressAnimation === "none", `The completed Bag Shard progress visuals must be static and distinct: ${JSON.stringify(bagCompletion)}`);
  check(bagCompletion.text?.includes(`${shardGoal} / ${shardGoal} Shards`) && !bagCompletion.text?.includes(`Shards: ${shardGoal} / ${shardGoal}`), `The Bag Shard card must keep one centered progress label: ${JSON.stringify(bagCompletion)}`);
  await page.screenshot({ path: path.join(outputDir, "bag-shards-complete.png"), fullPage: false });

  const finalState = await gameState(page);
  check(finalState.currencies.some((row) => row.currency_id === "coins" && row.balance === "0"), "The currency header did not use the normalized ledger snapshot.");
  check(finalState.currencies.some((row) => row.currency_id === "prismite" && row.balance === "0"), "The text game state must include visible zero-balance Prismite.");
  check(finalState.trackedChallenges.length === 0, "Unlocking a collectible must remove its tracked challenge.");
  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);

  process.stdout.write(`${JSON.stringify({
    critterTarget,
    relicTarget,
    finalView: finalState.view,
    headerCurrencies,
    browserErrors,
    screenshots: fs.readdirSync(outputDir).sort().map((name) => path.join(outputDir, name)),
  })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) console.error("Unable to remove disposable Auth user.", removed.error);
  }
  await cleanupContent();
}
