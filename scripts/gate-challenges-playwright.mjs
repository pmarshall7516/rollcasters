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
const challengeIds = [crypto.randomUUID(), crypto.randomUUID()];
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

async function waitForTargetArtwork(page) {
  const artwork = page.locator(".modal").getByRole("img", { name: target.name, exact: true });
  await artwork.waitFor({ state: "visible" });
  await artwork.evaluate((image) => new Promise((resolve) => {
    if (image.complete && image.naturalWidth > 0) resolve();
    else image.addEventListener("load", resolve, { once: true });
  }));
  await page.waitForTimeout(250);
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
      values('critter',$1,2)
    `, [target.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,required_amount,sort_order,gate_order
      ) values($1,'critter',$2,'shop_shards',2,0,1)
    `, [challengeIds[0], target.id]);
    await db.query(`
      insert into public.collectible_unlock_challenges(
        id,collectible_type,collectible_id,challenge_type,target_mode,any_target,target_ids,required_amount,sort_order,gate_order
      ) values($1,'critter',$2,'deal_damage','species',true,'{}',5,1,null)
    `, [challengeIds[1], target.id]);
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

  let targetCard = page.locator(`.critter-card:has(> .collectible-id:text-is("${target.id}"))`);
  check(await targetCard.count() === 1, "The disposable gated Critter card did not render.");
  await targetCard.click();
  await waitForTargetArtwork(page);
  let gateOne = page.locator(".challenge-detail-row").filter({ hasText: "shards" });
  let trackedChallenge = page.locator(".challenge-detail-row").filter({ hasText: "Damage Critters" });
  check((await gateOne.textContent())?.includes("Gate 1"), "The first gated row must show its Gate 1 badge.");
  check((await gateOne.textContent())?.includes("0 / 2"), "Gate 1 must expose its raw Shop progress.");
  check((await trackedChallenge.textContent())?.includes("Complete all gates first"), "The ungated Tracked row must explain why it is blocked.");
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
  await targetCard.click();
  await waitForTargetArtwork(page);
  gateOne = page.locator(".challenge-detail-row").filter({ hasText: "shards" });
  trackedChallenge = page.locator(".challenge-detail-row").filter({ hasText: "Damage Critters" });
  check((await gateOne.getAttribute("class"))?.includes("complete"), "Gate 1 must render complete after reaching its Shop goal.");
  check(!(await trackedChallenge.getAttribute("class"))?.includes("blocked"), "The Tracked row must become eligible when the final gate completes.");
  const trackButton = trackedChallenge.getByRole("button", { name: "Track", exact: true });
  check(await trackButton.isEnabled(), "The newly eligible Tracked challenge must expose an enabled Track action.");
  await trackButton.click();
  await page.waitForFunction((challengeId) => JSON.parse(window.render_game_to_text()).trackedChallenges.some((row) => row.challenge_id === challengeId), challengeIds[1]);
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
      path.join(outputDir, "blocked-tracked-challenge.png"),
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
