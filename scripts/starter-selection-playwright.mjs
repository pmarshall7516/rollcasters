import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_STARTER_SELECTION_TEST !== "true") {
  throw new Error("Set RUN_LIVE_STARTER_SELECTION_TEST=true to create and clean up disposable starter-selection users.");
}

const STARTER_CASES = [
  { rollcasterId: "001", critterId: "001" },
  { rollcasterId: "002", critterId: "004" },
  { rollcasterId: "003", critterId: "007" },
];
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

async function waitForImages(page) {
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
}

fs.mkdirSync(outputDir, { recursive: true });

try {
  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5194"], {
      cwd: root,
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }

  for (const starterCase of STARTER_CASES) {
    const { rollcasterId, critterId } = starterCase;
    const email = `starter-${rollcasterId}-${Date.now()}@example.com`;
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `Starter ${rollcasterId} Test` },
    });
    if (created.error) throw created.error;
    const userId = created.data.user.id;
    userIds.push(userId);

    browser = await chromium.launch({ headless: process.env.HEADED !== "true" });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("console", (message) =>
      message.type() === "error" && browserErrors.push(`${rollcasterId} console: ${message.text()}`),
    );
    page.on("pageerror", (error) => browserErrors.push(`${rollcasterId} page: ${String(error)}`));
    page.on("response", (response) =>
      response.status() >= 400 && browserErrors.push(`${rollcasterId} response ${response.status()}: ${response.url()}`),
    );

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
    await waitForImages(page);
    const rollcasterOnboardingState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    check(
      rollcasterOnboardingState.onboarding?.stage === "rollcaster" &&
        rollcasterOnboardingState.onboarding.options.join(",") === "001,002,003",
      "Text game state must expose the three Rollcaster starter options.",
    );

    const rollcasterCards = page.locator(".starter-rollcaster-card");
    check(await rollcasterCards.count() === 3, "The Rollcaster starter step must show exactly three options.");
    const cardTops = await rollcasterCards.evaluateAll((cards) =>
      cards.map((card) => Math.round(card.getBoundingClientRect().top)),
    );
    check(
      Math.max(...cardTops) - Math.min(...cardTops) <= 1,
      "Desktop starter Rollcasters must render in one row.",
    );

    const rollcasterCard = page.locator(
      `.starter-rollcaster-card:has(> .collectible-id:text-is("${rollcasterId}"))`,
    );
    check(await rollcasterCard.count() === 1, `Starter Rollcaster ${rollcasterId} must have one card.`);
    check(
      (await rollcasterCard.locator(".card-name-row").innerText()).trim().length > 0,
      `Starter Rollcaster ${rollcasterId} must show its name.`,
    );
    check(
      (await rollcasterCard.locator(".starter-rollcaster-description").innerText()).trim().length > 0,
      `Starter Rollcaster ${rollcasterId} must show its description.`,
    );
    check(
      (await rollcasterCard.locator(".starter-ability-card > strong").innerText()).trim().length > 0,
      `Starter Rollcaster ${rollcasterId} must show its starter Ability name.`,
    );
    check(
      (await rollcasterCard.locator(".starter-ability-card > span").nth(1).innerText()).trim().length > 0,
      `Starter Rollcaster ${rollcasterId} must show its starter Ability description.`,
    );
    const spriteLoaded = await rollcasterCard.locator(".starter-rollcaster-sprite img").evaluate(
      (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    );
    check(spriteLoaded, `Starter Rollcaster ${rollcasterId} must show its authored portrait.`);

    const selectionScreenshot = rollcasterId === STARTER_CASES[0].rollcasterId
      ? path.join(outputDir, "starter-rollcaster-selection.png")
      : null;
    if (selectionScreenshot) {
      await page.locator(".starter-selection-screen").screenshot({
        path: selectionScreenshot,
        animations: "disabled",
      });
    }

    await rollcasterCard.click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
    const critterOnboardingState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    check(
      critterOnboardingState.onboarding?.stage === "critter" &&
        critterOnboardingState.onboarding.options.join(",") === "001,004,007",
      "Text game state must advance to the three Critter starter options.",
    );
    check(
      await page.getByText("Step 2 of 2", { exact: true }).isVisible(),
      "Critter selection must follow Rollcaster selection.",
    );
    const critterSelectionScreenshot = rollcasterId === STARTER_CASES[0].rollcasterId
      ? path.join(outputDir, "starter-critter-selection.png")
      : null;
    if (critterSelectionScreenshot) {
      await waitForImages(page);
      await page.locator(".screen-stack").screenshot({
        path: critterSelectionScreenshot,
        animations: "disabled",
      });
    }
    await page.locator(`.starter-card:has(> .collectible-id:text-is("${critterId}"))`).click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

    const [profile, ownedRollcaster, rollcasterShards, critterShards] = await Promise.all([
      admin
        .from("profiles")
        .select("starter_rollcaster_selected_at,starter_selected_at,active_rollcaster_id")
        .eq("user_id", userId)
        .single(),
      admin
        .from("user_rollcasters")
        .select("id,rollcaster_id")
        .eq("user_id", userId)
        .single(),
      admin
        .from("user_collectible_shards")
        .select("quantity")
        .eq("user_id", userId)
        .eq("collectible_type", "rollcaster")
        .eq("collectible_id", rollcasterId)
        .single(),
      admin
        .from("user_collectible_shards")
        .select("quantity")
        .eq("user_id", userId)
        .eq("collectible_type", "critter")
        .eq("collectible_id", critterId)
        .single(),
    ]);
    for (const result of [profile, ownedRollcaster, rollcasterShards, critterShards]) {
      if (result.error) throw result.error;
    }
    check(
      ownedRollcaster.data.rollcaster_id === rollcasterId,
      `Starter Rollcaster ${rollcasterId} must be the only granted Rollcaster.`,
    );
    check(
      profile.data.active_rollcaster_id === ownedRollcaster.data.id,
      `Starter Rollcaster ${rollcasterId} must become active.`,
    );
    check(
      Boolean(profile.data.starter_rollcaster_selected_at && profile.data.starter_selected_at),
      "Both onboarding timestamps must persist.",
    );
    check(String(rollcasterShards.data.quantity) === "20", `Starter Rollcaster ${rollcasterId} must persist 20 shards.`);
    check(String(critterShards.data.quantity) === "50", `Starter Critter ${critterId} must persist 50 shards.`);

    const [abilitySlot, unlockedAbilities] = await Promise.all([
      admin
        .from("user_rollcaster_ability_slots")
        .select("ability_id")
        .eq("user_rollcaster_id", ownedRollcaster.data.id)
        .eq("slot_index", 1)
        .single(),
      admin
        .from("user_rollcaster_abilities")
        .select("ability_id")
        .eq("user_rollcaster_id", ownedRollcaster.data.id),
    ]);
    if (abilitySlot.error) throw abilitySlot.error;
    if (unlockedAbilities.error) throw unlockedAbilities.error;
    check(Boolean(abilitySlot.data.ability_id), `Starter Rollcaster ${rollcasterId} must equip an Ability in slot 1.`);
    check(
      unlockedAbilities.data.some((row) => row.ability_id === abilitySlot.data.ability_id),
      `Starter Rollcaster ${rollcasterId}'s equipped Ability must be unlocked.`,
    );

    await page.getByRole("button", { name: "Collection" }).click();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
    await page.getByRole("button", { name: "rollcasters", exact: true }).click();
    await page.locator(`.rollcaster-card:has(> .collectible-id:text-is("${rollcasterId}"))`).click();
    const rollcasterChallenge = page.locator(".challenge-detail-row").filter({ hasText: "20 / 20" });
    check(
      await rollcasterChallenge.count() === 1,
      `Starter Rollcaster ${rollcasterId} popup must show 20 / 20 shard progress.`,
    );
    check(
      (await rollcasterChallenge.getAttribute("class"))?.includes("complete"),
      `Starter Rollcaster ${rollcasterId} popup must render completed challenge status.`,
    );
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "critters", exact: true }).click();
    await page.locator(`.critter-card:has(> .collectible-id:text-is("${critterId}"))`).click();
    const critterChallenge = page.locator(".challenge-detail-row").filter({ hasText: "50 / 50" });
    check(
      await critterChallenge.count() === 1,
      `Starter Critter ${critterId} popup must show 50 / 50 shard progress.`,
    );
    check(
      (await critterChallenge.getAttribute("class"))?.includes("complete"),
      `Starter Critter ${critterId} popup must render completed challenge status.`,
    );

    verified.push({
      rollcasterId,
      critterId,
      rollcasterShards: "20",
      critterShards: "50",
      screenshot: selectionScreenshot,
      critterScreenshot: critterSelectionScreenshot,
    });
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
