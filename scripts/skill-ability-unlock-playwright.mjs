import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createDbClient, readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_POINT_UNLOCK_TEST !== "true") {
  throw new Error("Set RUN_LIVE_POINT_UNLOCK_TEST=true to create and clean up a disposable point-unlock user and Ability mapping.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5196";
const outputDir = path.join(root, "output", "skill-ability-unlocks-browser");
const email = `point-unlocks-${Date.now()}@example.com`;
const password = `Rollcasters-Unlocks-${Date.now()}!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let browser;
let devServer;
let userId;
let insertedAbilityFixture = false;
let abilityUnlock;
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

async function prepareAbilityFixture() {
  const db = createDbClient();
  try {
    await db.connect();
    const existing = await db.query(`
      select unlock.rollcaster_id,rollcaster.name as rollcaster_name,
        unlock.ability_id,ability.name as ability_name,
        unlock.unlock_level,unlock.unlock_cost
      from public.rollcaster_ability_unlocks unlock
      join public.rollcasters rollcaster on rollcaster.id=unlock.rollcaster_id
      join public.rollcaster_abilities ability on ability.id=unlock.ability_id
      where unlock.rollcaster_id='001'
        and unlock.unlock_level>1
        and unlock.unlock_cost>0
      order by unlock.unlock_level,unlock.sort_order
      limit 1
    `);
    if (existing.rowCount === 1) {
      abilityUnlock = existing.rows[0];
      return;
    }

    const candidate = await db.query(`
      select rollcaster.id as rollcaster_id,rollcaster.name as rollcaster_name,
        ability.id as ability_id,ability.name as ability_name
      from public.rollcasters rollcaster
      cross join public.rollcaster_abilities ability
      where rollcaster.id='001'
        and not exists(
          select 1 from public.rollcaster_ability_unlocks unlock
          where unlock.rollcaster_id=rollcaster.id and unlock.ability_id=ability.id
        )
      order by ability.sort_order,ability.id
      limit 1
    `);
    check(candidate.rowCount === 1, "Rollcaster 001 needs one unmapped Ability for the disposable browser fixture.");
    abilityUnlock = { ...candidate.rows[0], unlock_level: 2, unlock_cost: 2 };
    await db.query(`
      insert into public.rollcaster_ability_unlocks(
        rollcaster_id,ability_id,unlock_level,unlock_cost,is_default,sort_order
      ) values($1,$2,$3,$4,false,10000)
    `, [
      abilityUnlock.rollcaster_id,
      abilityUnlock.ability_id,
      abilityUnlock.unlock_level,
      abilityUnlock.unlock_cost,
    ]);
    insertedAbilityFixture = true;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function removeAbilityFixture() {
  if (!insertedAbilityFixture || !abilityUnlock) return;
  const db = createDbClient();
  try {
    await db.connect();
    await db.query(`
      delete from public.rollcaster_ability_unlocks
      where rollcaster_id=$1 and ability_id=$2
        and unlock_level=$3 and unlock_cost=$4
        and not is_default and sort_order=10000
    `, [
      abilityUnlock.rollcaster_id,
      abilityUnlock.ability_id,
      abilityUnlock.unlock_level,
      abilityUnlock.unlock_cost,
    ]);
  } finally {
    await db.end().catch(() => undefined);
  }
}

fs.mkdirSync(outputDir, { recursive: true });

try {
  await prepareAbilityFixture();

  const critterUnlockResult = await admin
    .from("critter_skill_unlocks")
    .select("critter_id,skill_id,unlock_level,unlock_cost,skills(name)")
    .eq("critter_id", "001")
    .gt("unlock_level", 1)
    .gt("unlock_cost", 0)
    .order("unlock_level")
    .order("sort_order")
    .limit(1)
    .single();
  if (critterUnlockResult.error) throw critterUnlockResult.error;
  const critterUnlock = {
    ...critterUnlockResult.data,
    skill_name: critterUnlockResult.data.skills.name,
  };

  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5196"], { cwd: root, stdio: "ignore" });
    await waitForServer(baseUrl);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Point Unlock Test" },
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

  const ownedCritter = await admin
    .from("user_critters")
    .update({ level: critterUnlock.unlock_level })
    .eq("user_id", userId)
    .eq("critter_id", critterUnlock.critter_id)
    .select("id")
    .single();
  if (ownedCritter.error) throw ownedCritter.error;
  const critterPoints = await admin
    .from("user_critters")
    .update({ skill_points: Math.max(0, critterUnlock.unlock_cost - 1) })
    .eq("id", ownedCritter.data.id);
  if (critterPoints.error) throw critterPoints.error;

  const ownedRollcaster = await admin
    .from("user_rollcasters")
    .update({ level: abilityUnlock.unlock_level })
    .eq("user_id", userId)
    .eq("rollcaster_id", abilityUnlock.rollcaster_id)
    .select("id")
    .single();
  if (ownedRollcaster.error) throw ownedRollcaster.error;
  const abilityPoints = await admin
    .from("user_rollcasters")
    .update({ ability_points: abilityUnlock.unlock_cost + 1 })
    .eq("id", ownedRollcaster.data.id);
  if (abilityPoints.error) throw abilityPoints.error;

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  const occupiedAbility = page.locator(".rollcaster-panel .ability-slot").first();
  await occupiedAbility.click();
  const abilityEquipDialog = page.locator(".modal.equip-dialog-ability");
  check(await abilityEquipDialog.count() === 1, "The Rollcaster ability slot must open the ability equip popup.");
  check(await abilityEquipDialog.locator(".equip-ability-section[aria-label='Unlocked abilities']").count() === 1, "The ability equip popup must show an unlocked section.");
  const lockedAbilitySection = abilityEquipDialog.locator(".equip-ability-section[aria-label='Locked abilities']");
  check(await lockedAbilitySection.count() === 1, "The ability equip popup must show locked abilities beneath unlocked abilities.");
  const abilitySectionOrder = await abilityEquipDialog.locator(".equip-ability-section").evaluateAll((sections) => sections.map((section) => section.getAttribute("aria-label")));
  check(abilitySectionOrder.join(",") === "Unlocked abilities,Locked abilities", `Ability sections are out of order: ${abilitySectionOrder.join(",")}`);
  const abilityGridColumns = await abilityEquipDialog.locator(".ability-candidates").first().evaluate((grid) => ({
    cardCount: grid.children.length,
    trackCount: getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length,
  }));
  check(abilityGridColumns.trackCount === Math.min(3, abilityGridColumns.cardCount), `The desktop ability equip popup must use up to three columns, got ${JSON.stringify(abilityGridColumns)}.`);
  const abilityEquipUnlockButton = lockedAbilitySection.getByRole("button", { name: `Unlock · ${abilityUnlock.unlock_cost}` });
  check(await abilityEquipUnlockButton.count() === 1, "The level-eligible locked Ability must expose an unlock action in the equip popup.");
  check(await abilityEquipDialog.locator(".point-counter").getByText(`${abilityUnlock.unlock_cost + 1} ability point${abilityUnlock.unlock_cost + 1 === 1 ? "" : "s"}`, { exact: true }).isVisible(), "The ability equip popup must show the Rollcaster's ability-point balance.");
  await abilityEquipUnlockButton.click();
  await page.waitForFunction(
    ({ abilityName }) => [...document.querySelectorAll(".equip-ability-section[aria-label='Unlocked abilities'] .ability-candidate")].some((card) => card.textContent?.includes(abilityName)),
    { abilityName: abilityUnlock.ability_name },
  );
  check(await abilityEquipDialog.locator(".point-counter").getByText("1 ability point", { exact: true }).isVisible(), "The ability equip popup must refresh to the remaining point balance after unlock.");
  check(await lockedAbilitySection.getByRole("button", { name: `Unlock · ${abilityUnlock.unlock_cost}` }).count() === 0, "An unlocked Ability must leave the locked section after a successful equip-popup unlock.");
  await page.mouse.move(2, 2);
  const abilityEquipScreenshot = path.join(outputDir, "equip-ability-unlocked.png");
  await abilityEquipDialog.screenshot({ path: abilityEquipScreenshot, animations: "disabled" });
  await abilityEquipDialog.getByRole("button", { name: "Close" }).click();

  const resetAbilityUnlock = await admin
    .from("user_rollcaster_abilities")
    .delete()
    .eq("user_rollcaster_id", ownedRollcaster.data.id)
    .eq("ability_id", abilityUnlock.ability_id);
  if (resetAbilityUnlock.error) throw resetAbilityUnlock.error;
  const resetAbilityPoints = await admin
    .from("user_rollcasters")
    .update({ ability_points: abilityUnlock.unlock_cost + 1 })
    .eq("id", ownedRollcaster.data.id);
  if (resetAbilityPoints.error) throw resetAbilityPoints.error;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  const occupiedSkill = page.locator(".loadout-slot:not(.empty) .skill-tile").first();
  await occupiedSkill.click();
  const equipDialog = page.locator(".modal.equip-dialog-skill");
  const equipUnlockButton = equipDialog.getByRole("button", { name: `Unlock · ${critterUnlock.unlock_cost}` });
  check(await equipUnlockButton.count() === 1, "The level-eligible Skill must appear in the main-page equip popup.");
  const equipButtonState = await equipUnlockButton.evaluate((button) => ({
    disabled: button.disabled,
    opacity: getComputedStyle(button).opacity,
  }));
  check(!equipButtonState.disabled && equipButtonState.opacity === "1", `The underfunded equip unlock button must stay opaque and clickable: ${JSON.stringify(equipButtonState)}`);
  await equipUnlockButton.click();
  await page.waitForFunction(() => document.querySelector(".equip-dialog-skill .skill-unlock-button.insufficient-points") !== null);
  await page.waitForTimeout(220);
  const flashingButtonState = await equipUnlockButton.evaluate((button) => ({
    borderColor: getComputedStyle(button).borderTopColor,
    animationName: getComputedStyle(button).animationName,
  }));
  check(flashingButtonState.borderColor === "rgb(255, 110, 134)" && flashingButtonState.animationName === "skill-unlock-insufficient", `The underfunded equip unlock button must flash its border red: ${JSON.stringify(flashingButtonState)}`);
  const equipWarningScreenshot = path.join(outputDir, "equip-skill-insufficient-points.png");
  await equipUnlockButton.screenshot({ path: equipWarningScreenshot, animations: "allow" });
  await equipDialog.getByRole("button", { name: "Close" }).click();

  const fundedCritterPoints = await admin
    .from("user_critters")
    .update({ skill_points: critterUnlock.unlock_cost + 1 })
    .eq("id", ownedCritter.data.id);
  if (fundedCritterPoints.error) throw fundedCritterPoints.error;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");

  await page.locator(`.critter-card:has(> .collectible-id:text-is("${critterUnlock.critter_id}"))`).click();
  const critterDialog = page.getByRole("dialog");
  const skillTile = critterDialog.locator(".detail-tile").filter({ hasText: critterUnlock.skill_name });
  check(await skillTile.count() === 1, "The paid Skill must appear once in the Critter popup.");
  check(await skillTile.getByRole("button", { name: `Unlock · ${critterUnlock.unlock_cost}` }).isVisible(), "The level-eligible Skill must expose its unlock action.");
  await page.mouse.move(2, 2);
  const skillReadyScreenshot = path.join(outputDir, "critter-skill-unlock-ready.png");
  await skillTile.screenshot({ path: skillReadyScreenshot, animations: "disabled" });
  await skillTile.getByRole("button", { name: `Unlock · ${critterUnlock.unlock_cost}` }).click();
  await page.waitForFunction(
    ({ skillName }) => [...document.querySelectorAll(".detail-tile.unlocked")].some((tile) => tile.textContent?.includes(skillName)),
    { skillName: critterUnlock.skill_name },
  );
  check(await critterDialog.locator(".point-counter").getByText("1 skill point", { exact: true }).isVisible(), "The Skill popup must refresh to the remaining point balance.");
  check(await skillTile.getByRole("button", { name: `Unlock · ${critterUnlock.unlock_cost}` }).count() === 0, "An unlocked Skill must no longer expose a purchase action.");
  await page.mouse.move(2, 2);
  await critterDialog.evaluate((dialog) => { dialog.scrollTop = 0; });
  const skillScreenshot = path.join(outputDir, "critter-skill-unlocked.png");
  await critterDialog.screenshot({ path: skillScreenshot, animations: "disabled" });

  const persistedSkill = await admin
    .from("user_critter_skills")
    .select("skill_id")
    .eq("user_critter_id", ownedCritter.data.id)
    .eq("skill_id", critterUnlock.skill_id)
    .single();
  if (persistedSkill.error) throw persistedSkill.error;

  await critterDialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "rollcasters", exact: true }).click();
  await page.locator(`.rollcaster-card:has(> .collectible-id:text-is("${abilityUnlock.rollcaster_id}"))`).click();
  const rollcasterDialog = page.getByRole("dialog");
  const abilityTile = rollcasterDialog.locator(".detail-ability-tile").filter({ hasText: abilityUnlock.ability_name });
  check(await abilityTile.count() === 1, "The paid Ability must appear once in the Rollcaster popup.");
  check(await abilityTile.getByRole("button", { name: `Unlock · ${abilityUnlock.unlock_cost}` }).isVisible(), "The level-eligible Ability must expose its unlock action.");
  await page.mouse.move(2, 2);
  const abilityReadyScreenshot = path.join(outputDir, "rollcaster-ability-unlock-ready.png");
  await abilityTile.screenshot({ path: abilityReadyScreenshot, animations: "disabled" });
  await abilityTile.getByRole("button", { name: `Unlock · ${abilityUnlock.unlock_cost}` }).click();
  await page.waitForFunction(
    ({ abilityName }) => [...document.querySelectorAll(".detail-ability-tile.unlocked")].some((tile) => tile.textContent?.includes(abilityName)),
    { abilityName: abilityUnlock.ability_name },
  );
  check(await rollcasterDialog.locator(".point-counter").getByText("1 ability point", { exact: true }).isVisible(), "The Ability popup must refresh to the remaining point balance.");
  check(await abilityTile.getByRole("button", { name: `Unlock · ${abilityUnlock.unlock_cost}` }).count() === 0, "An unlocked Ability must no longer expose a purchase action.");
  await page.mouse.move(2, 2);
  await rollcasterDialog.evaluate((dialog) => { dialog.scrollTop = 0; });
  const abilityScreenshot = path.join(outputDir, "rollcaster-ability-unlocked.png");
  await rollcasterDialog.screenshot({ path: abilityScreenshot, animations: "disabled" });

  const persistedAbility = await admin
    .from("user_rollcaster_abilities")
    .select("ability_id")
    .eq("user_rollcaster_id", ownedRollcaster.data.id)
    .eq("ability_id", abilityUnlock.ability_id)
    .single();
  if (persistedAbility.error) throw persistedAbility.error;

  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({
    skill: { id: critterUnlock.skill_id, remainingPoints: 1, readyScreenshot: skillReadyScreenshot, screenshot: skillScreenshot, equipWarningScreenshot },
    ability: { id: abilityUnlock.ability_id, remainingPoints: 1, readyScreenshot: abilityReadyScreenshot, screenshot: abilityScreenshot, equipScreenshot: abilityEquipScreenshot },
    temporaryAbilityMapping: insertedAbilityFixture,
    browserErrors,
  }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) console.error(`Unable to remove disposable Auth user ${userId}.`, removed.error);
  }
  await removeAbilityFixture().catch((error) => console.error("Unable to remove disposable Ability mapping.", error));
}
