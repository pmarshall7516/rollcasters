import crypto from "node:crypto";
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
const challengeIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const entryIds = [crypto.randomUUID(), crypto.randomUUID()];
const relicOfferName = `Relic UI Fixture ${Date.now()}`;
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
      select c.id,c.name
      from public.critters c
      where c.is_active and not c.is_archived
        and not exists(select 1 from public.collectible_unlock_requirements r where r.collectible_type='critter' and r.collectible_id=c.id)
        and not exists(select 1 from public.shop_entries s where s.target_category='critter' and s.target_id=c.id)
      order by c.sort_order,c.id limit 1
    `);
    check(critter.rowCount === 1, "No isolated Critter is available for the disposable browser fixture.");
    critterTarget = critter.rows[0];

    const relic = await db.query(`
      select r.id,r.name,r.max_owned
      from public.relics r
      join public.collectible_unlock_requirements u on u.collectible_type='relic' and u.collectible_id=r.id and u.required_challenges=1
      join public.collectible_unlock_challenges ch on ch.collectible_type='relic' and ch.collectible_id=r.id and ch.challenge_type='shop_relic' and ch.required_amount=1
      where r.is_active and not r.is_archived and r.max_owned>=1
      order by r.max_owned,r.sort_order,r.id limit 1
    `);
    check(relic.rowCount === 1, "No Relic with a one-purchase Shop challenge is available for the disposable browser fixture.");
    relicTarget = relic.rows[0];

    await db.query(`
      insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
      values('critter',$1,1)
    `, [critterTarget.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,target_mode,any_target,target_ids,required_amount,sort_order
      ) values($1,'critter',$2,'deal_damage','species',true,'{}',5,0)
    `, [challengeIds[0], critterTarget.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,required_amount,sort_order
      ) values
        ($1,'critter',$2,'shop_shards',4,1)
    `, [challengeIds[1], critterTarget.id]);
    await db.query(`
      insert into public.shop_entries(
        id,shop_type,name,description,target_category,target_id,quantity,currency_id,price,sort_order,is_active,is_archived
      ) values
        ($1,'shard',$3,'Two shards toward a collectible unlock.','critter',$5,2,'coins',0,0,true,false),
        ($2,'relic',$4,'A complete Relic purchase offer.','relic',$6,1,'coins',0,0,true,false)
    `, [entryIds[0], entryIds[1], `${critterTarget.name} Shard Bundle`, relicOfferName, critterTarget.id, relicTarget.id]);
    await db.query("commit");
    contentSeeded = true;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function cleanupContent() {
  if (!contentSeeded) return;
  const db = createDbClient();
  try {
    await db.connect();
    await db.query("begin");
    await db.query("delete from public.shop_entries where id=any($1::uuid[])", [entryIds]);
    await db.query("delete from public.collectible_unlock_challenges where id=any($1::uuid[])", [[challengeIds[0], challengeIds[1]]]);
    await db.query("delete from public.collectible_unlock_requirements where collectible_type='critter' and collectible_id=$1", [critterTarget.id]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
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
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  const selectedStarterCard = page.locator(".starter-card").first();
  const selectedStarterId = (await selectedStarterCard.locator(".collectible-id").textContent())?.trim();
  check(["001", "004", "007"].includes(selectedStarterId), "The starter screen must offer Critter 001, 004, or 007.");
  await selectedStarterCard.click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  const starterCollectionCard = page.locator(`.critter-card:has(> .collectible-id:text-is("${selectedStarterId}"))`);
  check(await starterCollectionCard.count() === 1, "The selected starter did not render in Collection.");
  await starterCollectionCard.click();
  const starterChallenge = page.locator(".challenge-detail-row").filter({ hasText: "50 / 50" });
  check(await starterChallenge.count() === 1, "The selected starter popup must show 50 / 50 shard progress.");
  check((await starterChallenge.getAttribute("class"))?.includes("complete"), "The selected starter shard challenge must render completed status.");
  await page.screenshot({ path: path.join(outputDir, "starter-shard-challenge-complete.png"), fullPage: true });
  await page.getByRole("button", { name: "Close" }).click();

  const targetCard = page.locator(".critter-card").filter({ hasText: critterTarget.id });
  check(await targetCard.count() === 1, "The locked Critter card did not render in Collection.");
  await targetCard.click();
  await page.getByRole("button", { name: "Track", exact: true }).click();
  await page.waitForFunction((challengeId) => JSON.parse(window.render_game_to_text()).trackedChallenges.some((row) => row.challenge_id === challengeId), challengeIds[0]);
  await page.screenshot({ path: path.join(outputDir, "collection-challenges.png"), fullPage: true });
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
  check(headerCurrencies.slice(0, 2).map((row) => row.id).join(",") === "coins,prismite", "Coins and Prismite must be the first two authored header currencies.");
  check(headerCurrencies[0]?.label === "Coins: 0" && headerCurrencies[1]?.label === "Prismite: 0", "Zero-balance currencies must remain visible with exact accessible labels.");
  check(headerCurrencies[0]?.color === "rgb(255, 214, 90)" && headerCurrencies[1]?.color === "rgb(125, 232, 255)", "Currency balance text must use its authored display color.");
  check(headerCurrencies[0]?.iconLoaded && headerCurrencies[1]?.iconLoaded, "Currency sprites must load in the signed-in header.");
  await page.screenshot({ path: path.join(outputDir, "home-tracking.png"), fullPage: true });

  const coinsCurrency = page.locator('.currency-pill[data-currency-id="coins"]');
  const prismiteCurrency = page.locator('.currency-pill[data-currency-id="prismite"]');
  await coinsCurrency.hover();
  await page.waitForTimeout(150);
  const currencyTooltip = page.locator(".currency-hover-tooltip");
  check(await currencyTooltip.isVisible(), "Hovering Coins must reveal its currency balance tooltip.");
  check((await currencyTooltip.textContent())?.trim() === "Coins: 0", "The Coins tooltip must show the exact owned balance label.");
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
  const shardOffer = page.locator(".shop-entry-card").filter({ hasText: critterTarget.id });
  await page.screenshot({ path: path.join(outputDir, "shop-shards.png"), fullPage: true });
  await shardOffer.hover();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, "shop-shards-diamond-hover.png"), fullPage: true });
  await page.getByRole("button", { name: "Relic Shop" }).click();
  check(await page.getByText(/Shop offer for/i).count() === 0, "Generated Relic Shop offer descriptions must be hidden.");
  await page.screenshot({ path: path.join(outputDir, "shop-relics.png"), fullPage: true });
  const relicOffer = page.locator(".shop-entry-card").filter({ hasText: relicOfferName });
  check(await relicOffer.count() === 1, "The Relic offer did not render.");
  check(await relicOffer.getByRole("button", { name: "Purchase" }).isEnabled(), "An unowned Relic offer must begin purchasable.");
  await relicOffer.hover();
  await page.screenshot({ path: path.join(outputDir, "shop-relics-hover.png"), fullPage: true });
  for (let quantity = 1; quantity <= relicTarget.max_owned; quantity += 1) {
    await relicOffer.getByRole("button", { name: "Purchase" }).click();
    await page.waitForFunction(({ offerName, expected, maximum }) => {
      const card = [...document.querySelectorAll(".shop-entry-card")].find((candidate) => candidate.textContent?.includes(offerName));
      return card?.textContent?.includes(`Owned: ${expected} / ${maximum}`);
    }, { offerName: relicOfferName, expected: quantity, maximum: relicTarget.max_owned });
    const unlockContinue = page.getByRole("button", { name: "Continue" });
    if (await unlockContinue.isVisible().catch(() => false)) await unlockContinue.click();
    if (quantity < relicTarget.max_owned) {
      check(await relicOffer.getByRole("button", { name: "Purchase" }).isEnabled(), "An owned Relic below max_owned must remain purchasable.");
    }
  }
  check(await relicOffer.getAttribute("data-availability-code") === "RELIC_MAX_OWNED_REACHED", "A max-owned Relic offer must expose its sold-out state.");
  check((await relicOffer.getAttribute("class"))?.includes("sold-out"), "A max-owned Relic offer must grey out the entire card.");
  check(await relicOffer.getByRole("button", { name: "Purchase" }).isDisabled(), "A max-owned Relic purchase button must be disabled.");
  await relicOffer.hover();
  await page.screenshot({ path: path.join(outputDir, "shop-relics-max-owned-hover.png"), fullPage: true });
  await page.getByRole("button", { name: "Shard Shop" }).click();

  await shardOffer.getByRole("button", { name: "Purchase" }).click();
  await page.waitForFunction((targetId) => {
    const card = [...document.querySelectorAll(".shop-entry-card")].find((candidate) => candidate.textContent?.includes(targetId));
    return card?.textContent?.includes("Shards: 2 / 4");
  }, critterTarget.id);
  await page.screenshot({ path: path.join(outputDir, "shop-shards-progress.png"), fullPage: true });
  await shardOffer.getByRole("button", { name: "Purchase" }).click();
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
  await page.screenshot({ path: path.join(outputDir, "unlock-notification.png"), fullPage: true });
  await unlockBanner.waitFor({ state: "hidden", timeout: 6_000 });
  await page.waitForFunction((targetId) => {
    const card = [...document.querySelectorAll(".shop-entry-card")].find((candidate) => candidate.textContent?.includes(targetId));
    return card?.getAttribute("data-availability-code") === "COLLECTIBLE_ALREADY_UNLOCKED";
  }, critterTarget.id);
  check((await shardOffer.getAttribute("class"))?.includes("sold-out"), "An already-unlocked Shard offer must grey out the entire card.");
  check(await shardOffer.getByRole("button", { name: "Purchase" }).isDisabled(), "An already-unlocked Shard purchase button must be disabled.");
  const shardVisuals = await shardOffer.evaluate((card) => {
    const square = card.querySelector(".shard-sprite-frame .sprite");
    const shard = card.querySelector(".shard-sprite-frame");
    const outline = card.querySelector(".shard-sprite-outline");
    const polygon = card.querySelector(".shard-outline-border");
    const outlineGlow = card.querySelector(".shard-outline-glow-wide");
    const unavailable = card.querySelector(".shop-unavailable");
    if (!square || !shard || !outline || !polygon || !outlineGlow || !unavailable) return null;
    const squareStyle = getComputedStyle(square);
    const shardStyle = getComputedStyle(shard);
    const unavailableStyle = getComputedStyle(unavailable);
    const shardBounds = shard.getBoundingClientRect();
    return {
      squareBackground: squareStyle.backgroundImage === "none" ? squareStyle.backgroundColor : squareStyle.backgroundImage,
      squareBorderWidth: squareStyle.borderTopWidth,
      squareBoxShadow: squareStyle.boxShadow,
      spriteFilter: squareStyle.filter,
      shardBackground: shardStyle.backgroundImage === "none" ? shardStyle.backgroundColor : shardStyle.backgroundImage,
      shardAspectRatio: shardBounds.width / shardBounds.height,
      polygonPoints: polygon.getAttribute("points"),
      outlineFilter: getComputedStyle(outline).filter,
      outlineGlowOpacity: getComputedStyle(outlineGlow).opacity,
      wrapperFilter: getComputedStyle(card.querySelector(".shard-sprite-glow")).filter,
      unavailableColor: unavailableStyle.color,
    };
  });
  check(shardVisuals?.squareBackground === "rgba(0, 0, 0, 0)", "The nested square Shard Sprite background must be transparent.");
  check(shardVisuals?.squareBorderWidth === "0px" && shardVisuals.squareBoxShadow === "none", "The nested square Shard Sprite border and shadow must be invisible.");
  check(shardVisuals?.shardBackground === "rgba(0, 0, 0, 0)", "The Shard-shaped SpriteFrame background must be transparent.");
  check((shardVisuals?.shardAspectRatio ?? 0) > 1.6 && shardVisuals?.polygonPoints === "1,50 50,1 99,50 50,99", "Shard offers must use the flattened diamond frame.");
  check(shardVisuals?.outlineFilter === "none" && shardVisuals.wrapperFilter === "none" && shardVisuals.outlineGlowOpacity === "0", "The diamond and collectible art must not glow before hover.");
  check(shardVisuals?.unavailableColor === "rgb(255, 110, 134)", "Already unlocked must retain the red danger color on a greyed offer.");
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
  check(shardHover.outlineFilter === "none" && shardHover.spriteFilter === shardVisuals?.spriteFilter && shardHover.wrapperFilter === "none", "Shard hover must not apply a filter glow to the collectible sprite or its wrapper.");
  await page.screenshot({ path: path.join(outputDir, "shop-shards-owned-hover.png"), fullPage: true });

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
