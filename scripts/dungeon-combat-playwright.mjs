import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_DUNGEON_BROWSER_TEST !== "true") {
  throw new Error("Set RUN_LIVE_DUNGEON_BROWSER_TEST=true to create and clean up a disposable Dungeon test user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5195";
const outputDir = path.join(root, "output", "dungeon-combat-browser");
const email = `dungeon-combat-${Date.now()}@example.com`;
const password = `Rollcasters-Dungeon-${Date.now()}!`;
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

async function gameState(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
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

async function waitForPhase(page, phases) {
  await page.waitForFunction(
    (expected) => expected.includes(JSON.parse(window.render_game_to_text()).combat?.phase),
    phases,
  );
  return (await gameState(page)).combat.phase;
}

async function combatHeaderGeometry(page) {
  return page.evaluate(() => {
    const header = document.querySelector(".combat-header")?.getBoundingClientRect();
    const copy = document.querySelector(".combat-header > div")?.getBoundingClientRect();
    const logo = document.querySelector(".combat-shell .brand-logo")?.getBoundingClientRect();
    const headerCenterX = header ? header.left + header.width / 2 : -999;
    const logoCenterX = logo ? logo.left + logo.width / 2 : -999;
    const centerX = copy ? copy.left + copy.width / 2 : -999;
    return {
      centerX,
      headerCenterX,
      logoCenterX,
      headerCenterDelta: centerX - headerCenterX,
      logoCenterDelta: centerX - logoCenterX,
      logoToCopyGap: copy && logo ? copy.top - logo.bottom : -999,
    };
  });
}

async function selectRequiredLeads(page) {
  const state = await gameState(page);
  if (!["lead_selection", "forced_replacements"].includes(state.combat?.phase)) return;
  const needed = state.combat.requiredLeadCount - state.combat.selectedLeadIds.length;
  for (let index = 0; index < needed; index += 1) {
    await page.locator(".combat-lead-option:not(.selected):not([disabled])").first().click();
  }
  await page.getByRole("button", { name: "Start Encounter" }).click();
  await waitForPhase(page, ["await_roll"]);
}

async function chooseActions(page) {
  for (let actionIndex = 0; actionIndex < 3; actionIndex += 1) {
    const actionMenu = page.locator(".battle-unit .combat-primary-actions:visible").first();
    if (!(await actionMenu.count())) break;
    await actionMenu.getByRole("button", { name: /^Skill$/ }).click();
    const affordableAttack = page.locator(".battle-unit .combat-skill-actions .skill-tile:has(.skill-power):not([disabled]):visible").first();
    const affordableSkill = await affordableAttack.count()
      ? affordableAttack
      : page.locator(".battle-unit .combat-skill-actions .skill-tile:not([disabled]):visible").first();
    if (await affordableSkill.count()) {
      await affordableSkill.click();
      const legalTarget = page.locator(".battle-unit.legal-target:visible").first();
      if (await legalTarget.count()) await legalTarget.click();
    } else {
      const back = page.locator(".battle-unit .combat-back-row:visible").first();
      await back.click();
      await page.locator(".battle-unit .combat-primary-actions:visible").first()
        .getByRole("button", { name: /^Skip/ }).click();
    }
  }
  const submit = page.getByRole("button", { name: "Submit Actions" });
  check(await submit.isEnabled(), "Every active Critter must have one valid reserved action before submission.");
  await submit.click();
}

async function chooseSwapAction(page) {
  const before = await gameState(page);
  const outgoing = before.combat.player.find((unit) => unit.active && unit.hp > 0);
  const incoming = before.combat.player.find((unit) => !unit.active && unit.hp > 0);
  check(outgoing && incoming, "The swap fixture requires one active and one healthy benched Critter.");
  const actionMenu = page.locator(".battle-unit .combat-primary-actions:visible").first();
  const swapButton = actionMenu.getByRole("button", { name: /^Swap/ });
  check(await swapButton.isEnabled(), `The leveled swap fixture must have enough Mana to swap; current Mana is ${before.combat.playerMana}.`);
  await swapButton.click();
  const option = page.locator(`.combat-swap-actions [data-swap-to-id="${incoming.id}"]`);
  check(await option.isVisible(), "The selected benched Critter must appear in the Swap menu.");
  await option.click();
  const submit = page.getByRole("button", { name: "Submit Actions" });
  check(await submit.isEnabled(), "A queued 1v1 Swap must make the action set ready for submission.");
  await submit.click();
  return {
    outgoingId: outgoing.id,
    outgoingKey: outgoing.key,
    incomingId: incoming.id,
    incomingKey: incoming.key,
    battlefieldSlot: outgoing.slot,
  };
}

async function advanceNarration(page) {
  for (let index = 0; index < 40; index += 1) {
    const phase = (await gameState(page)).combat?.phase;
    if (phase !== "event_playback") return phase;
    await page.waitForFunction(() => !document.querySelector(".combat-narration")?.disabled);
    await page.locator(".combat-narration").click();
  }
  throw new Error("Combat event playback did not terminate.");
}

async function dismissUnlockNotifications(page) {
  for (let index = 0; index < 20; index += 1) {
    const close = page.locator(".modal-backdrop").getByRole("button", { name: "Close" });
    if (!(await close.count())) return;
    await close.click();
    await page.waitForTimeout(40);
  }
  throw new Error("Unlock notifications did not finish dismissing.");
}

async function waitForPersistedPhase(runId, phase) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await admin
      .from("dungeon_runs")
      .select("combat_state,state_version")
      .eq("id", runId)
      .single();
    if (result.error) throw result.error;
    if (result.data.combat_state?.phase === phase) return result.data.state_version;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for persisted Dungeon phase ${phase}.`);
}

async function waitForPersistedSwapReveal(runId, incomingKey, battlefieldSlot) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await admin
      .from("dungeon_runs")
      .select("combat_state,state_version")
      .eq("id", runId)
      .single();
    if (result.error) throw result.error;
    const incoming = result.data.combat_state?.battle?.playerUnits?.find((unit) => unit.key === incomingKey);
    if (incoming?.active && incoming.battlefieldSlot === battlefieldSlot) return result.data.state_version;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the revealed Swap handoff to persist.");
}

try {
  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5195"], {
      cwd: root,
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Dungeon Combat Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  browser = await chromium.launch({
    headless: process.env.HEADED !== "true",
    args: ["--use-gl=angle", "--use-angle=swiftshader"],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    Object.defineProperty(window.crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) browserErrors.push(`response ${response.status()}: ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  check(
    await page.evaluate(() => typeof crypto.randomUUID === "undefined"),
    "The Dungeon browser regression must exercise the UUID fallback.",
  );
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter-rollcaster");
  await page.locator(".starter-rollcaster-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await page.locator(".starter-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  const additionalCritterCatalog = await admin
    .from("critters")
    .select("id")
    .neq("id", "001")
    .eq("is_active", true)
    .eq("is_archived", false)
    .order("sort_order")
    .limit(2);
  if (additionalCritterCatalog.error) throw additionalCritterCatalog.error;
  check(additionalCritterCatalog.data.length === 2, "The Dungeon fixture requires two additional active Critters.");
  const additionalCritters = await admin
    .from("user_critters")
    .insert(additionalCritterCatalog.data.map((critter) => ({ user_id: userId, critter_id: critter.id })))
    .select("id,critter_id");
  if (additionalCritters.error) throw additionalCritters.error;
  for (const [index, critter] of additionalCritters.data.entries()) {
    const equipped = await admin
      .from("user_squad_slots")
      .update({ user_critter_id: critter.id })
      .eq("user_id", userId)
      .eq("slot_index", index + 2);
    if (equipped.error) throw equipped.error;
  }
  const leveled = await admin
    .from("user_critters")
    .update({ xp: 1_000_000, level: 100 })
    .eq("user_id", userId)
    .select("id");
  if (leveled.error) throw leveled.error;
  check(leveled.data.length === 3, "The Dungeon fixture must equip three Critters for Party XP and 1v1 lead selection.");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await dismissUnlockNotifications(page);

  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "play");
  const ids = await page.locator(".dungeon-grid-card > .collectible-id").allTextContents();
  check(ids.length >= 1, "The Dungeon grid must contain at least one authored Dungeon.");
  check(
    ids.join(",") === [...ids].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join(","),
    "The Dungeon grid must use natural numeric ID order.",
  );
  await page.locator(".dungeon-select-screen").screenshot({
    path: path.join(outputDir, "dungeon-grid.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileGrid = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".dungeon-grid")).gridTemplateColumns.split(" ").length,
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }));
  check(mobileGrid.columns === 1 && mobileGrid.noHorizontalOverflow, "The Dungeon grid must collapse to one overflow-safe mobile column.");
  await page.locator(".dungeon-select-screen").screenshot({
    path: path.join(outputDir, "dungeon-grid-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.locator(".dungeon-select-screen").screenshot({
    path: path.join(outputDir, "dungeon-grid-medium.png"),
    animations: "disabled",
  });
  const firstCard = page.locator(".dungeon-grid-card").first();
  check(await firstCard.locator(".dungeon-stat-grid").count() === 1, "Dungeon cards must show difficulty, format, encounter count, and clears.");
  const cardGeometry = await page.locator(".dungeon-grid-card").evaluateAll((cards) => cards.slice(0, 2).map((card) => {
    const rect = card.getBoundingClientRect();
    const logo = card.querySelector(".dungeon-logo-frame")?.getBoundingClientRect();
    const title = card.querySelector("h2")?.getBoundingClientRect();
    const description = card.querySelector(".dungeon-description")?.getBoundingClientRect();
    const stats = card.querySelector(".dungeon-stat-grid")?.getBoundingClientRect();
    const action = card.querySelector(".dungeon-enter-button")?.getBoundingClientRect();
    const centerDelta = (child) => child ? (child.left + child.width / 2) - (rect.left + rect.width / 2) : null;
    return {
      width: rect.width,
      height: rect.height,
      minHeight: getComputedStyle(card).minHeight,
      maxHeight: getComputedStyle(card).maxHeight,
      gridColumns: getComputedStyle(card).gridTemplateColumns,
      logoCenterDelta: centerDelta(logo),
      titleCenterDelta: centerDelta(title),
      descriptionCenterDelta: centerDelta(description),
      statsCenterDelta: centerDelta(stats),
      actionCenterDelta: centerDelta(action),
      titleTop: title?.top - rect.top,
      statsTop: stats?.top - rect.top,
      actionTop: action?.top - rect.top,
      text: card.textContent,
    };
  }));
  check(
    cardGeometry.length === 2
      && cardGeometry.every((card) => card.width === cardGeometry[0].width && card.height === cardGeometry[0].height)
      && cardGeometry.every((card) => card.minHeight === "550px" && card.maxHeight === "550px")
      && cardGeometry.every((card) => card.gridColumns === cardGeometry[0].gridColumns)
      && cardGeometry.every((card) => [
        card.logoCenterDelta,
        card.titleCenterDelta,
        card.descriptionCenterDelta,
        card.statsCenterDelta,
        card.actionCenterDelta,
      ].every((delta) => delta !== null && Math.abs(delta) < 0.6))
      && cardGeometry.every((card) => card.titleTop === cardGeometry[0].titleTop && card.statsTop === cardGeometry[0].statsTop && card.actionTop === cardGeometry[0].actionTop),
    `Dungeon cards must use identical fixed geometry and anchors: ${JSON.stringify(cardGeometry)}`,
  );
  check(!cardGeometry.some((card) => card.text?.includes("Ready to enter")), "Dungeon cards must not repeat the Enter button's ready state.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await firstCard.getByRole("button", { name: /^View .* information$/ }).click();
  check(await page.locator(".dungeon-opponent-entry").count() >= 1, "Dungeon information must expose its effective opponent pool.");
  const briefingText = await page.locator(".modal").innerText();
  check(
    !briefingText.includes("authored opponent")
      && !briefingText.includes("independently with replacement")
      && !/\b\d+\.\d+\s*·\s*\d/.test(briefingText),
    "Dungeon information must use simplified opponent, sampling, and percentage copy.",
  );
  const poolGeometry = await page.evaluate(() => {
    const list = document.querySelector(".dungeon-opponent-list")?.getBoundingClientRect();
    const card = document.querySelector(".dungeon-opponent-entry")?.getBoundingClientRect();
    return { listWidth: list?.width ?? 0, cardWidth: card?.width ?? 0 };
  });
  check(poolGeometry.cardWidth < poolGeometry.listWidth * 0.6, `Opponent cards must occupy a compact two-column track: ${JSON.stringify(poolGeometry)}`);
  await page.locator(".dungeon-opponent-entry > summary").first().click();
  check(await page.locator(".dungeon-xp-drops").first().isVisible(), "Opponent details must show Critter and Rollcaster XP.");
  await page.locator(".modal").screenshot({
    path: path.join(outputDir, "dungeon-information.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Close" }).click();
  await firstCard.getByRole("button", { name: "Enter Dungeon" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "combat");

  const initial = await gameState(page);
  check(initial.combat?.phase === "lead_selection", `A 1v1 format with two equipped Critters must start with lead selection; received ${initial.combat?.phase}.`);
  check(initial.combat.opponents.every((opponent) => opponent.hidden), "Enemy identities must remain hidden during lead selection.");
  check(await page.locator(".combat-lead-dialog").isVisible(), "Lead selection must use a dedicated equipped-party popup.");
  check(await page.locator(".combat-lead-option").count() === 3, "The lead popup must list every equipped Critter.");
  check(await page.locator(".combat-hidden-opponent").count() === 1, "Only the authored center enemy slot must remain concealed in a 1v1.");
  check(await page.locator(".opponent-column > :nth-child(2)").getAttribute("aria-label") === "Hidden enemy slot", "A one-active enemy formation must reserve the center battlefield slot.");
  check(
    await page.getByRole("button", { name: "Submit Actions" }).count() === 0
      && await page.getByRole("button", { name: "Roll Dice" }).count() === 0,
    "The dice-row action position must remain neutral while lead selection is incomplete.",
  );
  check(
    await page.locator(".combat-dice-side.opponent .combat-die").count() === 0
      && await page.locator(".combat-dice-hidden").isVisible(),
    "Enemy dice labels must not leak an opponent identity before lead confirmation.",
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-lead-selection.png"),
    animations: "disabled",
  });
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  check(
    (await gameState(page)).combat === null,
    "Opening the game root must not auto-resume an unfinished Dungeon.",
  );
  await page.screenshot({
    path: path.join(outputDir, "home-with-active-dungeon.png"),
    animations: "disabled",
  });
  await page.goto(`${baseUrl}/play`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.view === "combat" && state.combat?.phase === "lead_selection";
  });
  check(
    (await gameState(page)).combat.dungeonId === initial.combat.dungeonId,
    "Opening /play must resume the unfinished Dungeon after Home remains opt-in.",
  );

  await selectRequiredLeads(page);
  const revealed = await gameState(page);
  check(
    await page.getByRole("button", { name: "Roll Dice" }).isVisible()
      && await page.getByRole("button", { name: "Submit Actions" }).count() === 0,
    "The dice row must show Roll Dice, without a duplicate Submit Actions control, before rolling.",
  );
  check(revealed.combat.opponents.some((opponent) => opponent.name), "The encounter lineup must reveal after lead confirmation.");
  check(
    revealed.combat.player.filter((unit) => unit.active).every((unit) => unit.slot === 1)
      && revealed.combat.opponents.filter((unit) => unit.active).every((unit) => unit.slot === 1),
    "A 1v1 formation must place both active Critters in the center battlefield slots.",
  );
  const awaitRollHeader = await combatHeaderGeometry(page);
  check(
    Math.abs(awaitRollHeader.headerCenterDelta) < 0.6
      && Math.abs(awaitRollHeader.logoCenterDelta) < 0.6
      && awaitRollHeader.logoToCopyGap >= 8,
    `The Dungeon heading must remain centered below the Rollcasters logo before action selection: ${JSON.stringify(awaitRollHeader)}`,
  );
  const run = await admin
    .from("dungeon_runs")
    .select("id,effective_mode,battle_format,battle_count,selected_opponents,catalog_snapshot,squad_snapshot,effect_snapshot,state_version")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();
  if (run.error) throw run.error;
  check(
    run.data.selected_opponents.length ===
      run.data.battle_count * Number(run.data.battle_format.split("v")[1]),
    "The live run must persist one immutable opponent instance per encounter slot.",
  );
  check(run.data.catalog_snapshot && run.data.squad_snapshot, "The live run must persist catalog and squad snapshots.");
  check(Array.isArray(run.data.effect_snapshot?.effects), "The live run must freeze its effect registry.");

  await page.getByRole("button", { name: "Roll Dice" }).click();
  check(await page.locator(".combat-narration").isDisabled(), "Narration must remain gated while dice are rolling.");
  check((await page.locator(".combat-narration").innerText()).includes("Rolling"), "The rolling state must be narrated.");
  await page.waitForTimeout(750);
  check(await page.locator(".combat-narration").isEnabled(), "Dice results must become advanceable after the settle animation.");
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-dice-result.png"),
    animations: "disabled",
  });
  await page.locator(".combat-narration").click();
  await waitForPhase(page, ["select_player_actions"]);
  const submitBeforeActions = page.getByRole("button", { name: "Submit Actions" });
  check(
    await submitBeforeActions.isVisible() && await submitBeforeActions.isDisabled(),
    "Submit Actions must remain visible but disabled until every active Critter has an action.",
  );
  const actionSelectionHeader = await combatHeaderGeometry(page);
  check(
    Math.abs(actionSelectionHeader.headerCenterDelta) < 0.6
      && Math.abs(actionSelectionHeader.logoCenterDelta) < 0.6
      && Math.abs(actionSelectionHeader.centerX - awaitRollHeader.centerX) < 0.1
      && actionSelectionHeader.logoToCopyGap >= 8,
    `The Dungeon heading must stay on the same center anchor when action selection changes the phase badge: ${JSON.stringify({ awaitRollHeader, actionSelectionHeader })}`,
  );
  const desktopActionGeometry = await page.evaluate(() => {
    const card = document.querySelector(".battle-unit:has(.combat-primary-actions)")?.getBoundingClientRect();
    const controls = [...document.querySelectorAll(".combat-primary-actions > button")].map((control) => {
      const rect = control.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    const dice = document.querySelector(".combat-dice-row");
    const diceStyle = dice ? getComputedStyle(dice) : null;
    const boardRect = document.querySelector(".combat-board")?.getBoundingClientRect();
    const diceRect = dice?.getBoundingClientRect();
    const narrationRect = document.querySelector(".combat-narration")?.getBoundingClientRect();
    const dieHeights = [...document.querySelectorAll(".combat-die")].map((die) => die.getBoundingClientRect().height);
    const actionStyle = getComputedStyle(document.querySelector(".combat-action-space"));
    const rollcasterPortraitRect = document.querySelector(".rollcaster-mana-panel .rollcaster-combat-frame")?.getBoundingClientRect();
    const rollcasterNameRect = document.querySelector(".rollcaster-mana-panel > h3")?.getBoundingClientRect();
    const enemyEmblemRect = document.querySelector(".enemy-mana-panel .enemy-mana-emblem")?.getBoundingClientRect();
    const enemyNameRect = document.querySelector(".enemy-mana-panel > h3")?.getBoundingClientRect();
    return {
      card: card ? { top: card.top, bottom: card.bottom, height: card.height } : null,
      controls,
      dicePaddingTop: Number.parseFloat(diceStyle?.paddingTop ?? "999"),
      dicePaddingBottom: Number.parseFloat(diceStyle?.paddingBottom ?? "999"),
      boardToDiceGap: boardRect && diceRect ? diceRect.top - boardRect.bottom : 999,
      diceToNarrationGap: diceRect && narrationRect ? narrationRect.top - diceRect.bottom : 999,
      diceRowHeight: diceRect?.height ?? 999,
      tallestDieHeight: Math.max(...dieHeights),
      actionBorderTopWidth: actionStyle.borderTopWidth,
      rollcasterPortraitToNameGap: rollcasterPortraitRect && rollcasterNameRect
        ? rollcasterNameRect.top - rollcasterPortraitRect.bottom
        : 999,
      enemyEmblemToNameGap: enemyEmblemRect && enemyNameRect
        ? enemyNameRect.top - enemyEmblemRect.bottom
        : 999,
    };
  });
  check(
    desktopActionGeometry.card
      && desktopActionGeometry.card.height >= 210
      && desktopActionGeometry.controls.length === 4
      && desktopActionGeometry.controls.every((control) => control.height >= 36
        && control.top >= desktopActionGeometry.card.top
        && control.bottom <= desktopActionGeometry.card.bottom + 1)
      && Math.abs(desktopActionGeometry.dicePaddingTop - 5) <= 0.1
      && Math.abs(desktopActionGeometry.dicePaddingBottom - 5) <= 0.1
      && Math.abs(desktopActionGeometry.boardToDiceGap - 5) <= 0.6
      && Math.abs(desktopActionGeometry.diceToNarrationGap - 5) <= 0.6
      && Math.abs(desktopActionGeometry.diceRowHeight - desktopActionGeometry.tallestDieHeight - 12) <= 0.6
      && desktopActionGeometry.actionBorderTopWidth === "0px"
      && desktopActionGeometry.rollcasterPortraitToNameGap >= 0
      && desktopActionGeometry.rollcasterPortraitToNameGap <= 16
      && desktopActionGeometry.enemyEmblemToNameGap >= 0
      && desktopActionGeometry.enemyEmblemToNameGap <= 16,
    `Desktop Critter controls, dice spacing, and Mana-panel identity grouping must use the compact geometry: ${JSON.stringify(desktopActionGeometry)}`,
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-action-selection.png"),
    animations: "disabled",
  });
  await page.locator(".battle-unit .combat-primary-actions:visible").first().getByRole("button", { name: /^Skill$/ }).click();
  const desktopSkillGeometry = await page.locator(".battle-unit:has(.combat-skill-actions)").evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    const controls = [...card.querySelectorAll(".combat-skill-actions > *")].map((control) => {
      const rect = control.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    return { cardBottom: cardRect.bottom, controls };
  });
  check(
    desktopSkillGeometry.controls.length === 4
      && desktopSkillGeometry.controls.every((control) => control.height >= 36 && control.bottom <= desktopSkillGeometry.cardBottom + 1),
    `All four enlarged Skill controls must be visible inside the desktop Critter slot: ${JSON.stringify(desktopSkillGeometry)}`,
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-skill-selection.png"),
    animations: "disabled",
  });
  await page.locator(".battle-unit .combat-back-row:visible").first().click();
  await page.setViewportSize({ width: 1912, height: 953 });
  await page.waitForFunction(() => document.querySelector(".combat-viewport-fit")?.dataset.viewportFitScale);
  const shortWideCombat = await page.evaluate(() => {
    const fit = document.querySelector(".combat-viewport-fit");
    const fitRect = fit?.getBoundingClientRect();
    const screenRect = document.querySelector(".combat-screen")?.getBoundingClientRect();
    const narrationRect = document.querySelector(".combat-narration")?.getBoundingClientRect();
    const logoRect = document.querySelector(".combat-shell .brand-logo")?.getBoundingClientRect();
    const scale = Number(fit?.dataset.viewportFitScale ?? 0);
    return {
      scale,
      viewportBottom: window.innerHeight,
      fitBottom: fitRect?.bottom ?? 9999,
      narrationTop: narrationRect?.top ?? 9999,
      narrationBottom: narrationRect?.bottom ?? 9999,
      leftGutter: fitRect && screenRect ? fitRect.left - screenRect.left : -999,
      rightGutter: fitRect && screenRect ? screenRect.right - fitRect.right : -999,
      centerDelta: fitRect && logoRect
        ? (fitRect.left + fitRect.width / 2) - (logoRect.left + logoRect.width / 2)
        : 999,
      noVerticalOverflow: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
    };
  });
  check(
    shortWideCombat.scale > 0.85
      && shortWideCombat.scale < 1
      && shortWideCombat.fitBottom <= shortWideCombat.viewportBottom - 3
      && shortWideCombat.narrationTop >= 0
      && shortWideCombat.narrationBottom <= shortWideCombat.viewportBottom - 3
      && Math.abs(shortWideCombat.leftGutter - shortWideCombat.rightGutter) < 0.6
      && Math.abs(shortWideCombat.centerDelta) < 0.6
      && shortWideCombat.noVerticalOverflow,
    `Short wide monitors must proportionally center and fit the complete combat composition: ${JSON.stringify(shortWideCombat)}`,
  );
  await page.screenshot({
    path: path.join(outputDir, "combat-action-short-wide.png"),
    animations: "disabled",
    fullPage: false,
  });
  await page.setViewportSize({ width: 960, height: 720 });
  const compactDesktopCombat = await page.evaluate(() => {
    const card = document.querySelector(".battle-unit:has(.combat-primary-actions)")?.getBoundingClientRect();
    const controls = [...document.querySelectorAll(".combat-primary-actions > button")].map((control) => {
      const rect = control.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    const screen = document.querySelector(".combat-screen")?.getBoundingClientRect();
    const board = document.querySelector(".combat-board")?.getBoundingClientRect();
    const dice = document.querySelector(".combat-dice-row")?.getBoundingClientRect();
    return {
      card: card ? { top: card.top, bottom: card.bottom, height: card.height } : null,
      controls,
      screenBottom: screen?.bottom ?? 9999,
      viewportBottom: window.innerHeight,
      noVerticalOverflow: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      boardToDiceGap: board && dice ? dice.top - board.bottom : -999,
    };
  });
  check(
    compactDesktopCombat.card
      && compactDesktopCombat.controls.length === 4
      && compactDesktopCombat.controls.every((control) => control.top >= compactDesktopCombat.card.top
        && control.bottom <= compactDesktopCombat.card.bottom + 1)
      && compactDesktopCombat.noVerticalOverflow
      && compactDesktopCombat.screenBottom <= compactDesktopCombat.viewportBottom + 1
      && Math.abs(compactDesktopCombat.boardToDiceGap - 5) <= 0.6,
    `Compact desktop combat must contain all four actions without clipping or scrolling: ${JSON.stringify(compactDesktopCombat)}`,
  );
  await page.screenshot({
    path: path.join(outputDir, "combat-action-compact-desktop.png"),
    animations: "disabled",
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".combat-ability-slot").first().hover();
  const tooltipBounds = await page.locator(".viewport-game-tooltip.viewport-tooltip-visible").first().evaluate((tooltip) => {
    const rect = tooltip.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  check(
    tooltipBounds.left >= 0
      && tooltipBounds.top >= 0
      && tooltipBounds.right <= tooltipBounds.viewportWidth
      && tooltipBounds.bottom <= tooltipBounds.viewportHeight,
    `Combat tooltips must shift fully inside the viewport: ${JSON.stringify(tooltipBounds)}`,
  );
  await page.mouse.move(700, 90);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCombat = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".combat-board")).gridTemplateColumns.split(" ").length,
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    noVerticalOverflow: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
    screenBottom: document.querySelector(".combat-screen").getBoundingClientRect().bottom,
    viewportBottom: window.innerHeight,
    activeCardHeight: document.querySelector(".battle-unit:has(.combat-primary-actions)")?.getBoundingClientRect().height ?? 0,
    actionHeights: [...document.querySelectorAll(".combat-primary-actions > button")].map((button) => button.getBoundingClientRect().height),
    dicePaddingTop: Number.parseFloat(getComputedStyle(document.querySelector(".combat-dice-row")).paddingTop),
    dicePaddingBottom: Number.parseFloat(getComputedStyle(document.querySelector(".combat-dice-row")).paddingBottom),
    boardToDiceGap: document.querySelector(".combat-dice-row").getBoundingClientRect().top - document.querySelector(".combat-board").getBoundingClientRect().bottom,
    diceToNarrationGap: document.querySelector(".combat-narration").getBoundingClientRect().top - document.querySelector(".combat-dice-row").getBoundingClientRect().bottom,
    diceRowHeight: document.querySelector(".combat-dice-row").getBoundingClientRect().height,
    tallestDieHeight: Math.max(...[...document.querySelectorAll(".combat-die")].map((die) => die.getBoundingClientRect().height)),
    submitVisible: Boolean(document.querySelector(".combat-submit-actions")?.getClientRects().length),
    submitDisabled: document.querySelector(".combat-submit-actions")?.disabled,
  }));
  check(
    mobileCombat.columns === 2
      && mobileCombat.noHorizontalOverflow
      && mobileCombat.noVerticalOverflow
      && mobileCombat.screenBottom <= mobileCombat.viewportBottom + 1,
    `Combat must keep both sides and all controls within the mobile viewport: ${JSON.stringify(mobileCombat)}`,
  );
  check(
    mobileCombat.activeCardHeight >= 160
      && mobileCombat.actionHeights.length === 4
      && mobileCombat.actionHeights.every((height) => height >= 29)
      && Math.abs(mobileCombat.dicePaddingTop - 5) <= 0.1
      && Math.abs(mobileCombat.dicePaddingBottom - 5) <= 0.1
      && Math.abs(mobileCombat.boardToDiceGap - 5) <= 0.6
      && Math.abs(mobileCombat.diceToNarrationGap - 5) <= 0.6
      && Math.abs(mobileCombat.diceRowHeight - mobileCombat.tallestDieHeight - 12) <= 0.6
      && mobileCombat.submitVisible
      && mobileCombat.submitDisabled,
    `Mobile Critter controls, dice spacing, and contextual submission must retain their enlarged compact geometry: ${JSON.stringify(mobileCombat)}`,
  );
  await page.locator(".battle-unit .combat-primary-actions:visible").first().getByRole("button", { name: /^Skill$/ }).click();
  const mobileSkillGeometry = await page.locator(".battle-unit:has(.combat-skill-actions)").evaluate((card) => {
    const cardRect = card.getBoundingClientRect();
    const controls = [...card.querySelectorAll(".combat-skill-actions > *")].map((control) => {
      const rect = control.getBoundingClientRect();
      return { bottom: rect.bottom, height: rect.height };
    });
    return { cardBottom: cardRect.bottom, controls };
  });
  check(
    mobileSkillGeometry.controls.length === 4
      && mobileSkillGeometry.controls.every((control) => control.height >= 29 && control.bottom <= mobileSkillGeometry.cardBottom + 1),
    `All four enlarged Skill controls must remain visible inside the mobile Critter slot: ${JSON.stringify(mobileSkillGeometry)}`,
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-skill-mobile.png"),
    animations: "disabled",
  });
  await page.locator(".battle-unit .combat-back-row:visible").first().click();
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-action-mobile.png"),
    animations: "disabled",
  });
  await page.screenshot({
    path: path.join(outputDir, "combat-action-mobile-viewport.png"),
    animations: "disabled",
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator(".battle-unit .combat-primary-actions:visible").first()
    .getByRole("button", { name: /^Skip/ }).click();
  const selectedActionGeometry = await page.locator(".combat-action-status-row.editable").evaluate((row) => {
    const summary = row.querySelector(".combat-action-summary");
    const rowRect = row.getBoundingClientRect();
    const summaryRect = summary?.getBoundingClientRect();
    return {
      rowHeight: rowRect.height,
      summaryHeight: summaryRect?.height ?? 999,
      whiteSpace: summary ? getComputedStyle(summary).whiteSpace : "",
    };
  });
  check(
    await page.getByRole("button", { name: /^Reselect .+ action$/ }).isVisible()
      && await page.getByRole("button", { name: "Submit Actions" }).isEnabled()
      && selectedActionGeometry.whiteSpace === "nowrap"
      && selectedActionGeometry.summaryHeight <= selectedActionGeometry.rowHeight,
    `A selected action must stay on one row with a persistent reselect arrow: ${JSON.stringify(selectedActionGeometry)}`,
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-selected-action.png"),
    animations: "disabled",
  });
  await page.getByRole("button", { name: /^Reselect .+ action$/ }).click();
  check(
    await page.locator(".battle-unit .combat-primary-actions:visible").count() === 1
      && await page.getByRole("button", { name: "Submit Actions" }).isDisabled(),
    "Reselecting an action must restore that Critter's action menu and disable submission until it is chosen again.",
  );
  const swapSelection = await chooseSwapAction(page);
  await waitForPhase(page, ["event_playback"]);
  const savedVersion = await waitForPersistedPhase(run.data.id, "event_playback");
  const initialSwapState = await gameState(page);
  check(
    initialSwapState.combat.presentation?.kind === "swap"
      && initialSwapState.combat.presentation.swap?.outgoingKey === swapSelection.outgoingKey
      && initialSwapState.combat.presentation.swap?.incomingKey === swapSelection.incomingKey
      && initialSwapState.combat.presentation.swap?.battlefieldSlot === swapSelection.battlefieldSlot
      && initialSwapState.combat.presentation.swap?.revealed === false,
    `The Swap step must begin with the outgoing Critter still occupying its slot: ${JSON.stringify(initialSwapState.combat.presentation)}`,
  );
  await page.waitForFunction(() => {
    const unit = document.querySelector(".battle-unit.swapping-out");
    const stack = unit?.querySelector(".combat-sprite-stack");
    return Boolean(
      unit
      && stack
      && getComputedStyle(stack).animationName === "combat-swap-to-rollcaster"
      && unit.style.getPropertyValue("--combat-swap-x")
      && unit.style.getPropertyValue("--combat-swap-y"),
    );
  });
  await page.waitForTimeout(180);
  const outgoingSwapGeometry = await page.locator(".battle-unit.swapping-out").evaluate((unit) => {
    const stack = unit.querySelector(".combat-sprite-stack");
    const destination = document.querySelector(".rollcaster-combat-frame");
    const unitStyle = getComputedStyle(unit);
    const x = Number.parseFloat(unitStyle.getPropertyValue("--combat-swap-x"));
    const y = Number.parseFloat(unitStyle.getPropertyValue("--combat-swap-y"));
    return {
      x,
      y,
      distance: Math.hypot(x, y),
      animationName: stack ? getComputedStyle(stack).animationName : "",
      destinationVisible: Boolean(destination?.getBoundingClientRect().width),
      narrationDisabled: Boolean(document.querySelector(".combat-narration")?.disabled),
    };
  });
  check(
    outgoingSwapGeometry.animationName === "combat-swap-to-rollcaster"
      && outgoingSwapGeometry.distance > 40
      && outgoingSwapGeometry.destinationVisible
      && outgoingSwapGeometry.narrationDisabled,
    `The outgoing Critter must visibly travel toward the Rollcaster while combat advancement is locked: ${JSON.stringify(outgoingSwapGeometry)}`,
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-swap-outgoing.png"),
    animations: "allow",
  });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).combat?.presentation?.swap?.revealed === true);
  const revealedSwapState = await gameState(page);
  const revealedSwapCard = page.locator(`[data-combat-unit-key="${swapSelection.incomingKey}"]`);
  check(
    revealedSwapState.combat.player.find((unit) => unit.key === swapSelection.outgoingKey)?.active === false
      && revealedSwapState.combat.player.find((unit) => unit.key === swapSelection.incomingKey)?.active === true
      && revealedSwapState.combat.player.find((unit) => unit.key === swapSelection.incomingKey)?.slot === swapSelection.battlefieldSlot
      && await revealedSwapCard.isVisible()
      && await revealedSwapCard.locator(".critter-combat-frame .sprite").isVisible()
      && await revealedSwapCard.locator(".combat-identity-row").isVisible()
      && await revealedSwapCard.locator('[role="progressbar"]').isVisible()
      && await revealedSwapCard.locator(".combat-action-summary").getByText("Swap complete", { exact: true }).isVisible()
      && await page.locator(".combat-narration").isDisabled(),
    "The incoming Critter, artwork, identity, level/Mana range, and HP must fill the same slot before combat can advance.",
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-swap-incoming.png"),
    animations: "disabled",
  });
  await page.waitForFunction(() => !document.querySelector(".combat-narration")?.disabled);
  const revealedVersion = await waitForPersistedSwapReveal(
    run.data.id,
    swapSelection.incomingKey,
    swapSelection.battlefieldSlot,
  );
  const beforeReload = await gameState(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.view === "combat" && state.combat?.phase === "event_playback";
  });
  const afterReload = await gameState(page);
  check(
    afterReload.combat.narration === beforeReload.combat.narration
      && JSON.stringify(afterReload.combat.player.map((unit) => unit.hp)) === JSON.stringify(beforeReload.combat.player.map((unit) => unit.hp))
      && JSON.stringify(afterReload.combat.opponents.map((unit) => unit.hp)) === JSON.stringify(beforeReload.combat.opponents.map((unit) => unit.hp))
      && afterReload.combat.presentation?.kind === "swap"
      && afterReload.combat.presentation.swap?.revealed === true
      && afterReload.combat.player.find((unit) => unit.key === swapSelection.incomingKey)?.active === true,
    "Reloading after the Swap reveal must reconstruct the same narration, HP, and incoming battlefield occupant.",
  );
  check(
    savedVersion > run.data.state_version && revealedVersion >= savedVersion,
    "Persisting the initial Swap step and its revealed handoff must advance the server state version.",
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-event-reloaded.png"),
    animations: "disabled",
  });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).combat?.presentation?.swap?.revealed === true);
  await page.waitForFunction(() => !document.querySelector(".combat-narration")?.disabled);
  const swapEventId = (await gameState(page)).combat.presentation.id;
  await page.locator(".combat-narration").click();
  await page.waitForFunction(
    (eventId) => JSON.parse(window.render_game_to_text()).combat?.presentation?.id !== eventId,
    swapEventId,
  );
  const afterSwapProgress = await gameState(page);
  check(
    afterSwapProgress.combat.player.find((unit) => unit.key === swapSelection.incomingKey)?.active === true
      && afterSwapProgress.combat.player.find((unit) => unit.key === swapSelection.incomingKey)?.slot === swapSelection.battlefieldSlot,
    "Advancing beyond Swap must preserve the fully revealed incoming Critter for every later combat step.",
  );
  let stagedSkill = afterSwapProgress;
  for (let index = 0; index < 6 && stagedSkill.combat.presentation?.kind !== "skill"; index += 1) {
    await page.waitForFunction(() => !document.querySelector(".combat-narration")?.disabled);
    const previousEventId = stagedSkill.combat.presentation?.id;
    await page.locator(".combat-narration").click();
    await page.waitForFunction(
      (eventId) => JSON.parse(window.render_game_to_text()).combat?.presentation?.id !== eventId,
      previousEventId,
    );
    stagedSkill = await gameState(page);
  }
  check(
    stagedSkill.combat.presentation?.kind === "skill"
      && await page.locator(".battle-unit.acting-skill").count() === 1,
    `Skill narration must animate its acting Critter before its effect: ${JSON.stringify(stagedSkill.combat.presentation)}`,
  );
  const beforeDamage = stagedSkill;
  await page.waitForFunction(() => !document.querySelector(".combat-narration")?.disabled);
  await page.locator(".combat-narration").click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).combat?.presentation?.kind === "damage");
  const damageState = await gameState(page);
  check(
    await page.locator(".battle-unit.taking-damage").count() === 1
      && (
        JSON.stringify(damageState.combat.player.map((unit) => unit.hp)) !== JSON.stringify(beforeDamage.combat.player.map((unit) => unit.hp))
        || JSON.stringify(damageState.combat.opponents.map((unit) => unit.hp)) !== JSON.stringify(beforeDamage.combat.opponents.map((unit) => unit.hp))
      ),
    "Advancing skill narration must reveal numeric damage and animate the target HP change.",
  );
  await page.locator(".combat-screen").screenshot({
    path: path.join(outputDir, "combat-damage-event.png"),
    animations: "disabled",
  });

  let finalPhase = null;
  for (let step = 0; step < 160; step += 1) {
    await dismissUnlockNotifications(page);
    let phase = (await gameState(page)).combat?.phase;
    if (phase === "dungeon_complete" || phase === "dungeon_failed") {
      finalPhase = phase;
      break;
    }
    if (phase === "lead_selection" || phase === "forced_replacements") {
      await selectRequiredLeads(page);
      continue;
    }
    if (phase === "await_roll") {
      await page.getByRole("button", { name: "Roll Dice" }).click();
      await page.waitForTimeout(700);
      await page.locator(".combat-narration").click();
      await waitForPhase(page, ["select_player_actions"]);
      continue;
    }
    if (phase === "roll_result") {
      await page.waitForTimeout(700);
      await page.locator(".combat-narration").click();
      await waitForPhase(page, ["select_player_actions"]);
      continue;
    }
    if (phase === "select_player_actions") {
      await chooseActions(page);
      await waitForPhase(page, ["event_playback", "forced_replacements", "await_roll", "battle_result"]);
      continue;
    }
    if (phase === "event_playback") {
      phase = await advanceNarration(page);
      if (phase === "battle_result") {
        await waitForPhase(page, ["encounter_rewards", "dungeon_complete", "dungeon_failed"]);
      }
      continue;
    }
    if (phase === "battle_result") {
      await waitForPhase(page, ["encounter_rewards", "dungeon_complete", "dungeon_failed"]);
      continue;
    }
    if (phase === "encounter_rewards") {
      const xpCards = page.locator(".combat-xp-card");
      check(await xpCards.count() === 4, "Encounter results must show all three equipped Critters and the active Rollcaster in Party XP.");
      const xpLayout = await xpCards.evaluateAll((cards) => {
        const rects = cards.map((card) => card.getBoundingClientRect());
        const firstCritterFill = cards[1]?.querySelector(".combat-xp-bar span");
        const fillStyle = firstCritterFill ? getComputedStyle(firstCritterFill) : null;
        return {
          recipients: cards.map((card) => card.getAttribute("data-xp-recipient")),
          rollcasterFirst: cards[0]?.classList.contains("rollcaster") ?? false,
          remainingAreCritters: cards.slice(1).every((card) => !card.classList.contains("rollcaster")),
          columns: getComputedStyle(cards[0]?.parentElement).gridTemplateColumns.split(" ").length,
          firstRowAligned: Math.abs(rects[0].top - rects[1].top) < 0.6,
          secondRowAligned: Math.abs(rects[2].top - rects[3].top) < 0.6,
          firstColumnAligned: Math.abs(rects[0].left - rects[2].left) < 0.6,
          secondColumnAligned: Math.abs(rects[1].left - rects[3].left) < 0.6,
          critterFillBackground: fillStyle?.backgroundImage ?? "",
        };
      });
      check(
        xpLayout.rollcasterFirst
          && xpLayout.remainingAreCritters
          && xpLayout.columns === 2
          && xpLayout.firstRowAligned
          && xpLayout.secondRowAligned
          && xpLayout.firstColumnAligned
          && xpLayout.secondColumnAligned
          && xpLayout.critterFillBackground.includes("rgb(51, 118, 168)")
          && xpLayout.critterFillBackground.includes("rgb(125, 232, 255)"),
        `Party XP must be Rollcaster-first in a two-by-two grid with blue Critter bars: ${JSON.stringify(xpLayout)}`,
      );
      const xpSpritesVisible = await page.locator(".combat-xp-card").evaluateAll((cards) => cards.every((card) => {
        const sprite = card.querySelector(".sprite");
        const rect = sprite?.getBoundingClientRect();
        const image = sprite?.querySelector("img");
        return Boolean(
          rect
          && rect.width > 0
          && rect.height > 0
          && ((image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0) || sprite?.textContent?.trim()),
        );
      }));
      check(xpSpritesVisible, "Every Party XP recipient must show loaded artwork or its visible catalog fallback.");
      await page.locator(".combat-result-dialog").screenshot({
        path: path.join(outputDir, "encounter-rewards.png"),
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileXpLayout = await page.locator(".combat-xp-grid").evaluate((grid) => {
        const gridRect = grid.getBoundingClientRect();
        const cards = [...grid.querySelectorAll(".combat-xp-card")].map((card) => card.getBoundingClientRect());
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          cardCount: cards.length,
          cardsContained: cards.every((card) => card.left >= gridRect.left - 0.5 && card.right <= gridRect.right + 0.5),
          cardContentContained: [...grid.querySelectorAll(".combat-xp-card")].every((card) => card.scrollWidth <= card.clientWidth + 1),
          noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        };
      });
      check(
        mobileXpLayout.columns === 2
          && mobileXpLayout.cardCount === 4
          && mobileXpLayout.cardsContained
          && mobileXpLayout.cardContentContained
          && mobileXpLayout.noHorizontalOverflow,
        `Party XP must remain an overflow-safe two-by-two grid on mobile: ${JSON.stringify(mobileXpLayout)}`,
      );
      await page.locator(".combat-result-dialog").screenshot({
        path: path.join(outputDir, "encounter-rewards-mobile.png"),
        animations: "disabled",
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "Next Encounter" }).click();
      continue;
    }
    throw new Error(`Unhandled Dungeon phase: ${phase}.`);
  }

  check(finalPhase === "dungeon_complete", `Expected the starter squad to complete the first Dungeon; received ${finalPhase}.`);
  const finalState = await gameState(page);
  check(finalState.combat.encounter === finalState.combat.encounterCount, "The completed run must end on its authored final encounter.");
  check(await page.locator(".dungeon-outcome-screen .combat-xp-card").count() === 4, "Final outcomes must keep all three equipped Critters and the Rollcaster XP section visible.");
  await page.locator(".dungeon-outcome-screen").screenshot({
    path: path.join(outputDir, "dungeon-complete.png"),
    animations: "disabled",
  });

  const [completedRun, progress, results, commands] = await Promise.all([
    admin.from("dungeon_runs").select("status,rewards,battle_results").eq("id", run.data.id).single(),
    admin.from("user_dungeon_progress").select("clear_count,completed_at").eq("user_id", userId).eq("dungeon_id", initial.combat.dungeonId).single(),
    admin.from("dungeon_runs").select("battle_results").eq("id", run.data.id).single(),
    admin.from("dungeon_run_commands").select("request_id,command_type").eq("run_id", run.data.id),
  ]);
  for (const result of [completedRun, progress, results, commands]) {
    if (result.error) throw result.error;
  }
  check(completedRun.data.status === "won", "The server must commit the completed live run.");
  check(progress.data.clear_count === 1 && progress.data.completed_at, "The live clear must persist completion progress exactly once.");
  check(results.data.battle_results.length === run.data.battle_count, "The server must journal one result for every encounter.");
  check(commands.data.filter((command) => command.command_type === "battle_result").length === run.data.battle_count, "Every live encounter must have one idempotent result command.");
  await page.getByRole("button", { name: "Next Dungeon" }).click();
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.view === "combat" && state.combat?.dungeonId === "002";
  });
  const nextDungeonLeads = await gameState(page);
  check(
    nextDungeonLeads.combat.phase === "lead_selection"
      && await page.locator(".combat-lead-option").count() === 3,
    "A 2v2 formation with three equipped Critters must request two leads from the full party.",
  );
  await selectRequiredLeads(page);
  const selectedNextDungeonLeads = await gameState(page);
  check(
    selectedNextDungeonLeads.combat.phase === "await_roll"
      && selectedNextDungeonLeads.combat.player.filter((unit) => unit.active).map((unit) => unit.slot).sort().join(",") === "0,2"
      && selectedNextDungeonLeads.combat.opponents.filter((unit) => unit.active).map((unit) => unit.slot).sort().join(",") === "0,2",
    "A selected 2v2 formation must place both sides in the top/bottom battlefield slots.",
  );
  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);

  process.stdout.write(`${JSON.stringify({
    dungeonId: initial.combat.dungeonId,
    mode: run.data.effective_mode,
    battleFormat: run.data.battle_format,
    battleCount: run.data.battle_count,
    finalPhase,
    rewardEntries: completedRun.data.rewards?.entries?.length ?? 0,
    browserErrors,
  })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
}
