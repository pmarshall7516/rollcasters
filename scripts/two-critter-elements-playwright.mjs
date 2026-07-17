import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_TWO_CRITTER_ELEMENTS_TEST !== "true") {
  throw new Error("Set RUN_LIVE_TWO_CRITTER_ELEMENTS_TEST=true to create and clean up a disposable two-element browser fixture.");
}

const env = readEnv();
const suppliedBaseUrl = process.env.BASE_URL;
const baseUrl = suppliedBaseUrl ?? "http://127.0.0.1:5197";
const outputDir = path.join(root, "output", "two-critter-elements-browser");
const email = `two-elements-${Date.now()}@example.com`;
const password = `Rollcasters-Two-Elements-${Date.now()}!`;
const serviceHeaders = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

let browser;
let devServer;
let userId;
let fixtureCritter;
let originalElement2Id;
const browserErrors = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function serviceRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...serviceHeaders, ...options.headers },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${raw}`);
  }
  return raw ? JSON.parse(raw) : null;
}

async function rest(pathname, options = {}) {
  return serviceRequest(`${env.VITE_SUPABASE_URL}/rest/v1/${pathname}`, options);
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

async function logoMetrics(locator) {
  return locator.evaluate((group) => {
    const icons = [...group.querySelectorAll(":scope > .asset-icon")];
    const rects = icons.map((icon) => {
      const rect = icon.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    });
    return {
      label: group.getAttribute("aria-label"),
      count: icons.length,
      rects,
      allVisible: icons.every((icon) => {
        const style = getComputedStyle(icon);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
      }),
    };
  });
}

fs.mkdirSync(outputDir, { recursive: true });

try {
  const starters = await rest("starter_options?select=critter_id,sort_order&is_active=eq.true&order=sort_order.asc&limit=1");
  check(starters.length === 1, "The browser fixture needs an active starter Critter.");
  const critters = await rest(`critters?select=id,name,element_1_id,element_2_id&id=eq.${encodeURIComponent(starters[0].critter_id)}&limit=1`);
  check(critters.length === 1, "The active starter Critter is missing.");
  fixtureCritter = critters[0];
  originalElement2Id = fixtureCritter.element_2_id;

  const secondaries = await rest(`elements?select=id,name,sort_order&id=neq.${encodeURIComponent(fixtureCritter.element_1_id)}&order=sort_order.asc&limit=1`);
  check(secondaries.length === 1, "The browser fixture needs a secondary Element.");
  const secondary = secondaries[0];
  const primaries = await rest(`elements?select=id,name&id=eq.${encodeURIComponent(fixtureCritter.element_1_id)}&limit=1`);
  check(primaries.length === 1, "The starter Critter's primary Element is missing.");
  const expectedLabel = `Element 1: ${primaries[0].name}; Element 2: ${secondary.name}`;

  const updatedRows = await rest(`critters?id=eq.${encodeURIComponent(fixtureCritter.id)}&select=element_1_id,element_2_id,element_id`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ element_2_id: secondary.id }),
  });
  check(updatedRows.length === 1, "The live dual-type fixture update returned no Critter.");
  const updated = updatedRows[0];
  check(
    updated.element_1_id === fixtureCritter.element_1_id
      && updated.element_2_id === secondary.id
      && updated.element_id === fixtureCritter.element_1_id,
    "The live dual-type fixture did not preserve the canonical order and compatibility alias.",
  );

  if (!suppliedBaseUrl) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5197"], {
      cwd: root,
      stdio: "ignore",
    });
    await waitForServer(baseUrl);
  }

  const created = await serviceRequest(`${env.VITE_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: "Two Element Test" },
    }),
  });
  userId = created.id;

  browser = await chromium.launch({ headless: process.env.HEADED !== "true" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => message.type() === "error" && browserErrors.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => browserErrors.push(`page: ${String(error)}`));
  page.on("response", (response) => response.status() >= 400 && browserErrors.push(`response ${response.status()}: ${response.url()}`));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "starter");

  const starterCard = page.locator(`.starter-card:has(> .collectible-id:text-is("${fixtureCritter.id}"))`);
  const starterLogos = await logoMetrics(starterCard.locator(".critter-element-logos"));
  check(starterLogos.label === expectedLabel && starterLogos.count === 2, "Starter selection must show both Elements in authored order.");
  await starterCard.click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "home");

  const homeLogos = page.locator(".loadout-critter-identity .critter-element-logos").first();
  const homeMetrics = await logoMetrics(homeLogos);
  check(homeMetrics.label === expectedLabel && homeMetrics.count === 2 && homeMetrics.allVisible, "Home loadout must retain both visible Element logos.");
  check(
    Math.abs(homeMetrics.rects[0].width - homeMetrics.rects[1].width) < 0.1
      && Math.abs(homeMetrics.rects[0].height - homeMetrics.rects[1].height) < 0.1
      && homeMetrics.rects[1].left > homeMetrics.rects[0].right,
    "The ordered Element pair must use identical logo sizes with a visible gap.",
  );
  const homeScreenshot = path.join(outputDir, "home-loadout-two-elements.png");
  await page.locator(".loadout-slot").first().screenshot({ path: homeScreenshot, animations: "disabled" });

  await page.getByRole("button", { name: "Collection" }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).view === "collection");
  const critterCard = page.locator(`.critter-card:has(> .collectible-id:text-is("${fixtureCritter.id}"))`);
  await critterCard.scrollIntoViewIfNeeded();
  const cardMetrics = await logoMetrics(critterCard.locator(".critter-element-logos"));
  check(cardMetrics.label === expectedLabel && cardMetrics.count === 2, "Collection cards must show exactly two ordered Element logos.");

  await page.locator(".element-filter summary").click();
  await page.locator(".element-filter-options button", { hasText: secondary.name }).click();
  check(await critterCard.isVisible(), "Filtering by Element 2 must retain the dual-type Critter.");
  check(await page.locator(`.critter-card:has(> .collectible-id:text-is("${fixtureCritter.id}"))`).count() === 1, "Flat Element filtering must not duplicate a dual-type Critter.");

  const collectionScreenshot = path.join(outputDir, "collection-secondary-filter.png");
  await critterCard.screenshot({ path: collectionScreenshot, animations: "disabled" });
  await critterCard.getByRole("button", { name: `View ${fixtureCritter.name} details` }).click();
  const modal = page.getByRole("dialog");
  const detailMetrics = await logoMetrics(modal.locator(".collectible-detail-hero .critter-element-logos"));
  check(detailMetrics.label === expectedLabel && detailMetrics.count === 2, "Critter details must show both Elements in authored order.");
  const skillLogoCounts = await modal.locator(".skill-title").evaluateAll((titles) =>
    titles.map((title) => title.querySelectorAll(".asset-icon").length)
  );
  check(skillLogoCounts.length > 0 && skillLogoCounts.every((count) => count === 1), "Skill tiles must remain single-type.");
  const detailScreenshot = path.join(outputDir, "detail-two-elements.png");
  await modal.screenshot({ path: detailScreenshot, animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMetrics = await logoMetrics(modal.locator(".collectible-detail-hero .critter-element-logos"));
  check(mobileMetrics.count === 2 && mobileMetrics.allVisible, "The mobile Critter detail must retain both Element logos.");
  const mobileScreenshot = path.join(outputDir, "detail-two-elements-mobile.png");
  await modal.screenshot({ path: mobileScreenshot, animations: "disabled" });

  check(browserErrors.length === 0, `Browser errors detected: ${browserErrors.join(" | ")}`);
  process.stdout.write(`${JSON.stringify({
    fixture: {
      critterId: fixtureCritter.id,
      element1Id: fixtureCritter.element_1_id,
      element2Id: secondary.id,
      label: expectedLabel,
    },
    screenshots: { homeScreenshot, collectionScreenshot, detailScreenshot, mobileScreenshot },
    browserErrors,
  }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  devServer?.kill("SIGTERM");
  if (userId) {
    await serviceRequest(`${env.VITE_SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
    }).catch((error) => console.error(`Unable to remove disposable Auth user ${userId}: ${error.message}`));
  }
  if (fixtureCritter) {
    await rest(`critters?id=eq.${encodeURIComponent(fixtureCritter.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ element_2_id: originalElement2Id }),
    }).catch((error) => console.error(`Unable to restore Critter ${fixtureCritter.id}: ${error.message}`));
  }
}
