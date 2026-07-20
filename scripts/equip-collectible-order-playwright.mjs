import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";
import { callCollectibleRpc } from "./manage-user-collectible.mjs";

if (process.env.RUN_LIVE_EQUIP_ORDER_TEST !== "true") {
  throw new Error("Set RUN_LIVE_EQUIP_ORDER_TEST=true to create and clean up a disposable equip-order test user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5204";
const outputDir = path.join(root, "output", "equip-collectible-order-browser");
const email = `equip-order-${Date.now()}@example.com`;
const password = `Rollcasters-Equip-Order-${Date.now()}!`;
const idCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId;
let browser;
let devServer;
const browserErrors = [];
const failedResponses = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function sortById(rows) {
  return [...rows].sort((left, right) => idCollator.compare(left.id, right.id));
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

async function grant(type, collectibleId) {
  await callCollectibleRpc({
    action: "grant",
    collectibleType: type,
    email,
    collectibleId,
    count: 1,
    countWasProvided: type === "relic",
  }, env);
}

async function candidateNames(modal, selector) {
  return modal.locator(".candidate-card").evaluateAll((cards, nameSelector) =>
    cards.map((card) => card.querySelector(nameSelector)?.textContent?.trim() ?? ""),
  selector);
}

function expectedNames(rows, ids) {
  return ids.map((id) => rows.find((row) => row.id === id)?.name ?? "");
}

fs.mkdirSync(outputDir, { recursive: true });

try {
  const [critterCatalogResult, rollcasterCatalogResult, relicCatalogResult] = await Promise.all([
    admin.from("critters").select("id,name").eq("is_active", true).eq("is_archived", false),
    admin.from("rollcasters").select("id,name").eq("is_active", true).eq("is_archived", false),
    admin.from("relics").select("id,name,max_owned").eq("is_active", true).eq("is_archived", false),
  ]);
  for (const result of [critterCatalogResult, rollcasterCatalogResult, relicCatalogResult]) {
    if (result.error) throw result.error;
  }
  const critterCatalog = sortById(critterCatalogResult.data);
  const rollcasterCatalog = sortById(rollcasterCatalogResult.data);
  const relicCatalog = sortById(relicCatalogResult.data.filter((relic) => relic.max_owned >= 1));
  check(critterCatalog.length >= 3, "The equip-order browser fixture requires at least three active Critters.");
  check(rollcasterCatalog.length >= 3, "The equip-order browser fixture requires at least three active Rollcasters.");
  check(relicCatalog.length >= 3, "The equip-order browser fixture requires at least three active Relics.");

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Equip Order Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5204"], {
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
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await page.locator(".starter-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  const [starterCritterResult, starterRollcasterResult, profileResult] = await Promise.all([
    admin.from("user_critters").select("id,critter_id").eq("user_id", userId).single(),
    admin.from("user_rollcasters").select("id,rollcaster_id").eq("user_id", userId).single(),
    admin.from("profiles").select("active_rollcaster_id").eq("user_id", userId).single(),
  ]);
  for (const result of [starterCritterResult, starterRollcasterResult, profileResult]) {
    if (result.error) throw result.error;
  }

  const extraCritters = critterCatalog.filter((row) => row.id !== starterCritterResult.data.critter_id).slice(0, 2);
  const extraRollcasters = rollcasterCatalog.filter((row) => row.id !== starterRollcasterResult.data.rollcaster_id).slice(0, 2);
  const ownedRelics = relicCatalog.slice(0, 3);
  for (const row of [...extraCritters].reverse()) await grant("critter", row.id);
  for (const row of [...extraRollcasters].reverse()) await grant("rollcaster", row.id);
  for (const row of [...ownedRelics].reverse()) await grant("relic", row.id);

  const ownedCrittersResult = await admin
    .from("user_critters")
    .select("id,critter_id")
    .eq("user_id", userId);
  if (ownedCrittersResult.error) throw ownedCrittersResult.error;
  const secondCritter = ownedCrittersResult.data.find((row) => row.critter_id === extraCritters[0].id);
  check(secondCritter, "The second Critter grant did not create an owned Critter row.");

  const squadUpdate = await admin.from("user_squad_slots").upsert({
    user_id: userId,
    slot_index: 2,
    user_critter_id: secondCritter.id,
  }, { onConflict: "user_id,slot_index" });
  if (squadUpdate.error) throw squadUpdate.error;
  const relicEquip = await admin.from("user_critter_relic_slots").upsert({
    user_critter_id: starterCritterResult.data.id,
    slot_index: 1,
    relic_id: ownedRelics[0].id,
  }, { onConflict: "user_critter_id,slot_index" });
  if (relicEquip.error) throw relicEquip.error;

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await waitForImages(page);

  const expectedRollcasterIds = [starterRollcasterResult.data.rollcaster_id, ...extraRollcasters.map((row) => row.id)]
    .sort((left, right) => idCollator.compare(left, right));
  const expectedCritterIds = [starterCritterResult.data.critter_id, ...extraCritters.map((row) => row.id)]
    .sort((left, right) => idCollator.compare(left, right));
  const expectedRelicIds = ownedRelics.map((row) => row.id).sort((left, right) => idCollator.compare(left, right));

  await page.getByRole("button", { name: "Choose active Rollcaster" }).click();
  let modal = page.getByRole("dialog");
  const rollcasterNames = await candidateNames(modal, ":scope > strong");
  check(
    rollcasterNames.join("|") === expectedNames(rollcasterCatalog, expectedRollcasterIds).join("|"),
    `Rollcaster candidates are not in collectible ID order: ${JSON.stringify({ expectedRollcasterIds, rollcasterNames })}.`,
  );
  const selectedRollcaster = modal.locator(".candidate-card.selected");
  check(await selectedRollcaster.count() === 1, "The active Rollcaster must retain exactly one selected candidate.");
  const activeOwnedRollcaster = [starterRollcasterResult.data].find(
    (owned) => owned.id === profileResult.data.active_rollcaster_id,
  );
  check(activeOwnedRollcaster, "The starter Rollcaster must remain active after additional grants.");
  check(
    (await selectedRollcaster.locator(":scope > strong").textContent())?.trim()
      === rollcasterCatalog.find((row) => row.id === activeOwnedRollcaster.rollcaster_id)?.name,
    "The green selected treatment moved away from the active Rollcaster.",
  );
  const selectedColors = await selectedRollcaster.evaluate((card) => ({
    card: getComputedStyle(card).borderColor,
    frame: getComputedStyle(card.querySelector(".sprite-frame")).borderColor,
    disabled: card.matches(":disabled"),
  }));
  check(
    selectedColors.card.includes("97, 221, 160")
      && selectedColors.frame.includes("97, 221, 160")
      && selectedColors.disabled,
    `The active Rollcaster lost its green selected border or disabled state: ${JSON.stringify(selectedColors)}.`,
  );
  await modal.screenshot({ path: path.join(outputDir, "rollcasters-id-order.png"), animations: "disabled" });
  await modal.getByRole("button", { name: "Cancel" }).click();

  await page.locator(".loadout-slot.empty").click();
  modal = page.getByRole("dialog");
  const critterNames = await candidateNames(modal, ".critter-name > strong");
  check(
    critterNames.join("|") === expectedNames(critterCatalog, expectedCritterIds).join("|"),
    `Critter candidates are not in collectible ID order: ${JSON.stringify({ expectedCritterIds, critterNames })}.`,
  );
  check(
    await modal.locator(".candidate-card").count() === expectedCritterIds.length,
    "The Critter popup must list every owned Critter.",
  );
  await modal.screenshot({ path: path.join(outputDir, "critters-id-order.png"), animations: "disabled" });
  await modal.getByRole("button", { name: "Cancel" }).click();

  const secondCritterName = critterCatalog.find((row) => row.id === secondCritter.critter_id)?.name;
  const secondCritterSlot = page.locator(".loadout-slot").filter({ hasText: secondCritterName });
  await secondCritterSlot.getByRole("button", { name: "Equip relic · Slot 1" }).click();
  modal = page.getByRole("dialog");
  const relicNames = await candidateNames(modal, ":scope > strong");
  check(
    relicNames.join("|") === expectedNames(relicCatalog, expectedRelicIds).join("|"),
    `Relic candidates are not in collectible ID order: ${JSON.stringify({ expectedRelicIds, relicNames })}.`,
  );
  check(
    await modal.locator(".candidate-card").count() === expectedRelicIds.length,
    "The Relic popup must list every owned Relic.",
  );
  await waitForImages(page);
  const relicSpriteAssets = await modal.locator(".candidate-card .sprite-frame img").evaluateAll((images) => images.map((image) => ({
    src: image.currentSrc,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  })));
  check(
    relicSpriteAssets.length === expectedRelicIds.length
      && relicSpriteAssets.every((asset) => asset.src.includes(".card.") && asset.naturalWidth >= 300),
    `Relic popup cards must use crisp high-resolution card assets: ${JSON.stringify(relicSpriteAssets)}.`,
  );
  const committedRelicName = relicCatalog.find((row) => row.id === ownedRelics[0].id)?.name;
  const committedRelicCard = modal.locator(".candidate-card").filter({ hasText: committedRelicName });
  check(
    await committedRelicCard.isDisabled()
      && (await committedRelicCard.locator(".inventory-count").textContent())?.includes("Available 0"),
    "A fully committed owned Relic must remain visible, show zero availability, and stay disabled.",
  );
  await modal.screenshot({ path: path.join(outputDir, "relics-id-order.png"), animations: "disabled" });

  check(browserErrors.length === 0, `The equip-order browser flow logged errors: ${browserErrors.join("\n")}`);
  check(failedResponses.length === 0, `The equip-order browser flow had failed responses: ${failedResponses.join("\n")}`);
  console.log(`Equip collectible ID-order browser flow passed; screenshots saved to ${outputDir}.`);
} finally {
  await browser?.close().catch(() => undefined);
  if (devServer) {
    devServer.kill("SIGTERM");
    await new Promise((resolve) => devServer.once("exit", resolve));
  }
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
}
