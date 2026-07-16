import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createDbClient, readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_GATE_CHALLENGE_BROWSER_TEST !== "true") {
  throw new Error("Set RUN_LIVE_GATE_CHALLENGE_BROWSER_TEST=true to create and clean up a disposable gate catalog fixture and Auth user.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5194";
const outputDir = path.join(root, "output", "gate-challenges-browser");
const email = `gate-challenges-${Date.now()}@example.com`;
const password = `Rollcasters-Gates-${Date.now()}!`;
const challengeIds = Array.from({ length: 4 }, () => crypto.randomUUID());
const targetId = `gate-test-${Date.now()}`;

let target;
let userId;
let browser;
let devServer;
let contentSeeded = false;
const browserErrors = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function adminAuthRequest(pathname, init) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/admin/${pathname}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`Supabase Auth Admin ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function createUser() {
  return adminAuthRequest("users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: "Gate Challenge Test" },
    }),
  });
}

async function deleteUser(id) {
  return adminAuthRequest(`users/${id}`, { method: "DELETE" });
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

async function stabilizeModalCapture(page) {
  await page.addStyleTag({ content: ".modal-backdrop { backdrop-filter: none !important; }" });
}

async function waitForTargetArtwork(scope) {
  const artwork = scope.getByRole("img", { name: target.name, exact: true });
  await artwork.waitFor({ state: "visible" });
  await artwork.evaluate((image) => new Promise((resolve) => {
    if (image.complete && image.naturalWidth > 0) resolve();
    else image.addEventListener("load", resolve, { once: true });
  }));
  await scope.page().waitForTimeout(250);
}

async function openSignedInPage() {
  browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADED !== "true" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15_000);
  page.on("console", (message) => message.type() === "error" && browserErrors.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  return page;
}

async function seedContent() {
  const db = createDbClient();
  try {
    await db.connect();
    await db.query("begin");
    const source = await db.query(`
      select critter.id,critter.name
      from public.critters critter
      where critter.is_active and not critter.is_archived
        and not exists(
          select 1 from public.starter_options starter where starter.critter_id=critter.id
        )
      order by critter.sort_order,critter.id
      limit 1
    `);
    check(source.rowCount === 1, "No active non-starter Critter is available to clone for the disposable gate browser fixture.");
    target = { id: targetId, name: `${source.rows[0].name} Gate Test` };

    await db.query(`
      insert into public.critters(
        id,name,element_id,base_hp,base_atk,base_def,base_spd,base_dice_max,
        base_block_cost,base_swap_cost,asset_path,description,sort_order,base_dice_min,
        is_active,is_archived,version
      )
      select
        $1,$2,element_id,base_hp,base_atk,base_def,base_spd,base_dice_max,
        base_block_cost,base_swap_cost,asset_path,'Disposable Gate Challenge browser fixture.',
        (select coalesce(max(sort_order),0)+1 from public.critters),base_dice_min,
        true,false,1
      from public.critters
      where id=$3
    `, [target.id, target.name, source.rows[0].id]);

    await db.query(`
      insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
      values('critter',$1,4)
    `, [target.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,required_amount,sort_order,gate_order
      ) values($1,'critter',$2,'shop_shards',2,0,1)
    `, [challengeIds[0], target.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,target_mode,any_target,target_ids,required_amount,sort_order,gate_order
      ) values($1,'critter',$2,'take_damage','species',true,'{}',4,1,2)
    `, [challengeIds[1], target.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,target_mode,any_target,target_ids,required_amount,sort_order,gate_order
      ) values($1,'critter',$2,'deal_damage','species',true,'{}',5,2,null)
    `, [challengeIds[2], target.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,target_mode,any_target,target_ids,required_amount,sort_order,gate_order
      ) values($1,'critter',$2,'knock_out_critters','species',true,'{}',3,3,null)
    `, [challengeIds[3], target.id]);
    await db.query("commit");
    contentSeeded = true;
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function completeGateOne() {
  const db = createDbClient();
  try {
    await db.connect();
    await db.query(`
      insert into public.user_collectible_shards(user_id,collectible_type,collectible_id,quantity)
      values($1,'critter',$2,2)
      on conflict(user_id,collectible_type,collectible_id)
      do update set quantity=excluded.quantity,updated_at=now()
    `, [userId, target.id]);
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function completeGateTwo() {
  const db = createDbClient();
  try {
    await db.connect();
    await db.query(`
      insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at,updated_at)
      values($1,$2,4,now(),now())
      on conflict(user_id,challenge_id)
      do update set progress=excluded.progress,completed_at=excluded.completed_at,updated_at=excluded.updated_at
    `, [userId, challengeIds[1]]);
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
    await db.query("delete from public.collectible_unlock_challenges where id=any($1::uuid[])", [challengeIds]);
    await db.query(`
      delete from public.collectible_unlock_requirements
      where collectible_type='critter' and collectible_id=$1
    `, [target.id]);
    await db.query("delete from public.critters where id=$1", [target.id]);
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
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5194"], { cwd: root, stdio: "ignore" });
    await waitForServer(baseUrl);
  }

  const created = await createUser();
  userId = created.id;

  let page = await openSignedInPage();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");
  await page.locator(".starter-card").first().click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  await stabilizeModalCapture(page);

  const lockedCards = page.locator(".collection-grid .catalog-card.locked");
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll(".collection-grid .catalog-card.locked")];
    return cards.length > 0 && cards.every((card) => card.querySelectorAll(".collection-card-scrollbar").length === 1);
  });
  const lockedScrollbarStates = await lockedCards.evaluateAll((cards) => cards.map((card, index) => {
    const state = card.querySelector(".collection-card-state");
    const pane = state.querySelector(".collection-card-state-scroll");
    const scrollbar = state.querySelector(".collection-card-scrollbar");
    const thumb = state.querySelector(".collection-card-scrollbar-thumb");
    const trackRect = scrollbar.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const scrollable = pane.scrollHeight > pane.clientHeight + 1;
    return {
      index,
      scrollable,
      fullThumb: Math.abs(trackRect.height - thumbRect.height) < 1,
      trackWidth: trackRect.width,
      thumbWidth: thumbRect.width,
      ariaDisabled: scrollbar.getAttribute("aria-disabled"),
    };
  }));
  check(lockedScrollbarStates.every((state) => state.trackWidth === 10 && state.thumbWidth === 4 && (state.scrollable ? !state.fullThumb && state.ariaDisabled === "false" : state.fullThumb && state.ariaDisabled === "true")), "Every locked collection card must show the correct full or proportional slim scrollbar.");
  check(lockedScrollbarStates.some((state) => !state.scrollable), "The live collection needs a non-scrolling locked card to verify the full-height consistency thumb.");
  check(await page.locator(".collection-grid .catalog-card:not(.locked) .collection-card-scrollbar").count() === 0, "Owned collection cards must remain scrollbar-free.");
  const fullThumbCardIndex = lockedScrollbarStates.find((state) => !state.scrollable).index;
  await lockedCards.nth(fullThumbCardIndex).locator(".collection-card-state").screenshot({ path: path.join(outputDir, "full-scrollbar-locked-pane.png") });

  let targetCard = page.locator(`.critter-card:has(> .collectible-id:text-is("${target.id}"))`);
  check(await targetCard.count() === 1, "The disposable gated Critter card did not render.");
  check(await targetCard.locator(".gate-badge").count() === 0, "Compact Critter cards must not show Gate pills.");
  let compactRows = targetCard.locator(".challenge-row");
  check(await compactRows.count() === 4, "The compact gated Critter card must render all four ordered challenges.");
  check((await compactRows.nth(0).textContent())?.includes("0 / 2"), "The Gate 1 challenge must render first on the compact card.");
  check((await compactRows.nth(1).textContent())?.includes("Receive Damage") && (await compactRows.nth(1).textContent())?.includes("0 / 4"), "The Gate 2 challenge must render second on the compact card.");
  check((await compactRows.nth(2).textContent())?.includes("Damage Critters"), "The first ungated challenge must render after gated challenges.");
  check((await compactRows.nth(3).textContent())?.includes("Knock out Critters"), "The second ungated challenge must remain ordered after the first.");
  let compactBoundary = targetCard.locator(".challenge-gate-boundary");
  check(await compactBoundary.count() === 1, "The compact card must render exactly one locked-group boundary.");
  check((await compactBoundary.textContent())?.trim() === "Complete all above challenges first", "The compact locked-group boundary must use the requested copy.");
  let boundaryNeighbors = await compactBoundary.evaluate((entry) => ({
    previous: entry.previousElementSibling?.textContent ?? "",
    next: entry.nextElementSibling?.textContent ?? "",
  }));
  check(boundaryNeighbors.previous.includes("0 / 2") && boundaryNeighbors.next.includes("Receive Damage"), "The initial compact boundary must sit between Gate 1 and Gate 2.");
  check(await targetCard.locator(".challenge-row .gate-blocked").count() === 0, "Blocked compact rows must not repeat the shared boundary copy.");
  check(await compactRows.nth(1).locator(".grid-challenge-track").count() === 0 && await compactRows.nth(2).locator(".grid-challenge-track").count() === 0, "Gate-blocked compact challenges must not expose Track actions.");
  const compactAlignmentOffsets = await compactRows.evaluateAll((rows) => rows.map((row) => {
    const description = row.querySelector(".challenge-row-description").getBoundingClientRect();
    const progress = row.querySelector(":scope > strong").getBoundingClientRect();
    return Math.abs(description.y - progress.y);
  }));
  check(compactAlignmentOffsets.every((offset) => offset < 1), "Every compact challenge description must align with its progress value.");
  const compactState = targetCard.locator(".collection-card-state");
  const compactPane = compactState.locator(".collection-card-state-scroll");
  const compactScrollbar = await compactPane.evaluate((entry) => {
    const state = entry.closest(".collection-card-state");
    const stateRect = state.getBoundingClientRect();
    const scrollbar = state.querySelector(".collection-card-scrollbar");
    const thumb = state.querySelector(".collection-card-scrollbar-thumb");
    const scrollbarRect = scrollbar?.getBoundingClientRect();
    const thumbRect = thumb?.getBoundingClientRect();
    const progressValues = [...entry.querySelectorAll(".challenge-row > strong")];
    return {
      scrollable: entry.scrollHeight > entry.clientHeight,
      nativeScrollbarHidden: getComputedStyle(entry).scrollbarWidth === "none" && getComputedStyle(entry, "::-webkit-scrollbar").display === "none",
      customScrollbarCount: scrollbar ? 1 : 0,
      scrollbarWidth: scrollbarRect?.width ?? 0,
      thumbWidth: thumbRect?.width ?? 0,
      thumbHeight: thumbRect?.height ?? 0,
      thumbRadius: thumb ? getComputedStyle(thumb).borderRadius : null,
      thumbWithinPane: Boolean(thumbRect && thumbRect.top >= stateRect.top && thumbRect.bottom <= stateRect.bottom),
      progressRightGap: Math.min(...progressValues.map((value) => stateRect.right - value.getBoundingClientRect().right)),
    };
  });
  check(compactScrollbar.scrollable && compactScrollbar.nativeScrollbarHidden && compactScrollbar.customScrollbarCount === 1 && compactScrollbar.scrollbarWidth === 10 && compactScrollbar.thumbWidth === 4 && compactScrollbar.thumbHeight >= 22 && compactScrollbar.thumbRadius === "999px" && compactScrollbar.thumbWithinPane && compactScrollbar.progressRightGap >= 10, "Overflowing compact challenges must show the slim rounded scrollbar beside their progress values.");
  await waitForTargetArtwork(targetCard);
  await targetCard.screenshot({ path: path.join(outputDir, "compact-gated-critter-card.png") });
  await compactPane.hover();
  await page.mouse.wheel(0, 80);
  await page.waitForTimeout(120);
  check(await compactPane.evaluate((entry) => entry.scrollTop) > 0, "The live compact challenge pane must scroll with the mouse wheel.");
  const liveScrollbar = compactState.locator(".collection-card-scrollbar");
  check(Number(await liveScrollbar.getAttribute("aria-valuenow")) > 0, "The custom scrollbar must update its accessible value while the pane scrolls.");
  check(!(await compactState.locator(".collection-card-scrollbar-thumb").getAttribute("style"))?.includes("translateY(0px)"), "The slim scrollbar thumb must visibly move with challenge progress scrolling.");
  await compactState.screenshot({ path: path.join(outputDir, "scrollable-challenge-pane.png") });
  await liveScrollbar.press("End");
  await page.waitForTimeout(50);
  check(await compactPane.evaluate((entry) => Math.abs(entry.scrollTop - (entry.scrollHeight - entry.clientHeight)) < 1), "The custom scrollbar End key must reach the bottom of the challenge pane.");
  await liveScrollbar.press("Home");
  await page.waitForTimeout(50);
  check(await compactPane.evaluate((entry) => entry.scrollTop) <= 5, "The custom scrollbar Home key must return to the first challenge snap position.");
  await targetCard.click();
  await waitForTargetArtwork(page.locator(".modal"));
  let gateOne = page.locator(".challenge-detail-row").filter({ hasText: "Gate 1" });
  let gateTwo = page.locator(".challenge-detail-row").filter({ hasText: "Gate 2" });
  let trackedChallenge = page.locator(".challenge-detail-row").filter({ hasText: "Damage Critters" });
  check((await gateOne.textContent())?.includes("Gate 1"), "The first gated row must show its Gate 1 badge.");
  check((await gateOne.textContent())?.includes("0 / 2"), "Gate 1 must expose its raw Shop progress.");
  check((await gateTwo.textContent())?.includes("0 / 4"), "Gate 2 must expose its raw Shop progress.");
  const detailBoundary = page.locator(".challenge-detail-gate-boundary");
  check(await detailBoundary.count() === 1, "The detail panel must render one shared locked-group boundary.");
  check(await page.locator(".challenge-detail-row .gate-blocked").count() === 0, "Detail rows must not repeat the shared boundary copy.");
  check((await trackedChallenge.getAttribute("class"))?.includes("blocked"), "The blocked Tracked row must use its locked visual state.");
  check(await trackedChallenge.getByRole("button", { name: "Track", exact: true }).count() === 0, "A blocked Tracked challenge must not expose a Track action.");
  await page.locator(".modal").screenshot({ path: path.join(outputDir, "blocked-tracked-challenge.png") });

  await completeGateOne();
  await browser.close();
  browser = null;
  page = await openSignedInPage();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  await stabilizeModalCapture(page);
  targetCard = page.locator(`.critter-card:has(> .collectible-id:text-is("${target.id}"))`);
  await waitForTargetArtwork(targetCard);
  compactRows = targetCard.locator(".challenge-row");
  compactBoundary = targetCard.locator(".challenge-gate-boundary");
  check(await compactBoundary.count() === 1, "The compact boundary must remain singular after Gate 1 completes.");
  boundaryNeighbors = await compactBoundary.evaluate((entry) => ({
    previous: entry.previousElementSibling?.textContent ?? "",
    next: entry.nextElementSibling?.textContent ?? "",
  }));
  check(boundaryNeighbors.previous.includes("0 / 4") && boundaryNeighbors.next.includes("Damage Critters"), "After Gate 1 completes, the boundary must move below Gate 2 and above the ungated challenges.");
  check(!(await compactRows.nth(1).getAttribute("class"))?.includes("blocked"), "Gate 2 must become eligible after Gate 1 completes.");
  check((await compactRows.nth(2).getAttribute("class"))?.includes("blocked"), "Ungated challenges must remain blocked until Gate 2 completes.");
  await compactBoundary.evaluate((entry) => entry.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(120);
  await targetCard.locator(".collection-card-state").screenshot({ path: path.join(outputDir, "moved-gate-boundary-card.png") });

  await completeGateTwo();
  await browser.close();
  browser = null;
  page = await openSignedInPage();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  await stabilizeModalCapture(page);
  targetCard = page.locator(`.critter-card:has(> .collectible-id:text-is("${target.id}"))`);
  await waitForTargetArtwork(targetCard);
  check(await targetCard.locator(".challenge-gate-boundary").count() === 0, "The compact boundary must disappear after the final gate completes.");
  const eligibleCompactRow = targetCard.locator(".challenge-row").filter({ hasText: "Damage Critters" });
  check(!(await eligibleCompactRow.getAttribute("class"))?.includes("blocked"), "The compact Tracked row must become eligible when the final gate completes.");
  const compactTrackButton = eligibleCompactRow.getByRole("button", { name: /^Track Damage Critters/ });
  check(await compactTrackButton.isEnabled(), "The newly eligible compact challenge must expose an enabled Track action.");
  const trackRowGeometry = await eligibleCompactRow.evaluate((row) => {
    const description = row.querySelector(".challenge-row-description").getBoundingClientRect();
    const progress = row.querySelector(":scope > strong").getBoundingClientRect();
    const action = row.querySelector(".grid-challenge-track").getBoundingClientRect();
    return {
      descriptionCenter: description.top + description.height / 2,
      progressCenter: progress.top + progress.height / 2,
      progressLeft: progress.left,
      actionCenter: action.top + action.height / 2,
      actionRight: action.right,
      actionWidth: action.width,
      actionHeight: action.height,
      actionLabelFits: action.scrollWidth <= action.clientWidth,
      actionBackground: getComputedStyle(action).backgroundColor,
    };
  });
  check(Math.abs(trackRowGeometry.descriptionCenter - trackRowGeometry.progressCenter) < 1 && Math.abs(trackRowGeometry.descriptionCenter - trackRowGeometry.actionCenter) < 1 && trackRowGeometry.actionRight <= trackRowGeometry.progressLeft && trackRowGeometry.actionWidth === 60 && trackRowGeometry.actionHeight === 20 && trackRowGeometry.actionLabelFits && trackRowGeometry.actionBackground === "rgb(203, 183, 255)", "The compact Track action must be light purple, fit its label, sit left of progress, and stay vertically centered with the description/progress row.");
  await targetCard.screenshot({ path: path.join(outputDir, "trackable-collection-card.png") });
  await compactTrackButton.click();
  await page.waitForFunction((challengeId) => JSON.parse(window.render_game_to_text()).trackedChallenges.some((row) => row.challenge_id === challengeId), challengeIds[2]);
  check(await page.locator(".modal").count() === 0, "Tracking from a compact card must not open its detail modal.");
  const compactUntrackButton = eligibleCompactRow.getByRole("button", { name: /^Untrack Damage Critters/ });
  check(await compactUntrackButton.getAttribute("aria-pressed") === "true", "The compact action must switch to its tracked state after the refresh.");
  const untrackGeometry = await compactUntrackButton.evaluate((button) => ({ width: button.getBoundingClientRect().width, labelFits: button.scrollWidth <= button.clientWidth }));
  check(untrackGeometry.width === 60 && untrackGeometry.labelFits, "The compact Untrack action must retain enough width for its full label.");
  await waitForTargetArtwork(targetCard);
  await targetCard.locator(".collection-card-state").screenshot({ path: path.join(outputDir, "tracked-from-collection-card.png") });
  await targetCard.locator(".catalog-card-details").click();
  await waitForTargetArtwork(page.locator(".modal"));
  gateOne = page.locator(".challenge-detail-row").filter({ hasText: "Gate 1" });
  gateTwo = page.locator(".challenge-detail-row").filter({ hasText: "Gate 2" });
  trackedChallenge = page.locator(".challenge-detail-row").filter({ hasText: "Damage Critters" });
  check((await gateOne.getAttribute("class"))?.includes("complete"), "Gate 1 must render complete after reaching its Shop goal.");
  check((await gateTwo.getAttribute("class"))?.includes("complete"), "Gate 2 must render complete after reaching its Shop goal.");
  check(await page.locator(".challenge-detail-gate-boundary").count() === 0, "The detail boundary must disappear after the final gate completes.");
  check(!(await trackedChallenge.getAttribute("class"))?.includes("blocked"), "The Tracked row must become eligible when the final gate completes.");
  check(await trackedChallenge.getByRole("button", { name: /Untrack · Slot 1/ }).isEnabled(), "The detail panel must reflect tracking started from the compact card.");
  await page.locator(".collectible-challenge-panel").screenshot({ path: path.join(outputDir, "eligible-tracked-challenge.png") });
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Rollcasters home" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");
  check(await page.locator(".tracked-challenge-card").filter({ hasText: target.name }).count() === 1, "The newly eligible challenge must appear in the main tracking HUD.");
  await page.screenshot({ path: path.join(outputDir, "eligible-tracking-hud.png") });
  check(browserErrors.length === 0, `The gate browser scenario emitted errors: ${browserErrors.join(" | ")}`);

  console.log(JSON.stringify({
    target,
    screenshots: [
      path.join(outputDir, "compact-gated-critter-card.png"),
      path.join(outputDir, "full-scrollbar-locked-pane.png"),
      path.join(outputDir, "scrollable-challenge-pane.png"),
      path.join(outputDir, "blocked-tracked-challenge.png"),
      path.join(outputDir, "moved-gate-boundary-card.png"),
      path.join(outputDir, "trackable-collection-card.png"),
      path.join(outputDir, "tracked-from-collection-card.png"),
      path.join(outputDir, "eligible-tracked-challenge.png"),
      path.join(outputDir, "eligible-tracking-hud.png"),
    ],
    browserErrors,
  }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (devServer) {
    devServer.kill("SIGTERM");
    await new Promise((resolve) => devServer.once("exit", resolve));
  }
  if (userId) await deleteUser(userId).catch(() => undefined);
  await cleanupContent();
}
