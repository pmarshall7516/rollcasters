import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const appUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:5173";
const catalogBaseUrl = process.env.CATALOG_BASE_URL ?? process.env.VITE_GAME_CATALOG_BASE_URL;
if (!catalogBaseUrl) throw new Error("Set VITE_GAME_CATALOG_BASE_URL (or the CATALOG_BASE_URL test override) to the generated or staged game-data URL.");
const outputDir = path.resolve(process.env.OUTPUT_DIR ?? "output/catalog-release-browser");
fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(appUrl, { waitUntil: "networkidle" });
  const result = await page.evaluate(async ({ catalogBaseUrl }) => {
    const module = await import("/src/lib/catalog-release.ts");
    const loaded = await module.loadPublishedCatalog(catalogBaseUrl, "0.1.0");
    const defaultAsset = loaded.catalog.gameAssets.find((asset) => asset.variant === "default") ?? loaded.catalog.gameAssets[0];
    const assetBase = loaded.release.assetBaseUrl;
    let assetStatus = 0;
    if (defaultAsset && assetBase) {
      assetStatus = (await fetch(`${assetBase}/${defaultAsset.path}`)).status;
    }
    return {
      catalogVersion: loaded.release.catalogVersion,
      source: loaded.release.source,
      elements: loaded.catalog.elements.length,
      critters: loaded.catalog.critters.length,
      assets: loaded.catalog.gameAssets.length,
      assetStatus,
      assetBase,
    };
  }, { catalogBaseUrl });
  check(result.catalogVersion !== "live-development", "The browser must load an immutable release.");
  check(result.source === "network" || result.source === "cache", "The release source must be verified network/cache data.");
  check(result.elements > 0 && result.critters > 0 && result.assets > 0, "The assembled release must contain the live catalog.");
  check(result.assetStatus === 200, "A hashed release asset must load from the static origin.");
  if (String(result.assetBase).includes("supabase.co")) {
    check(String(result.assetBase).includes("/storage/v1/object/public/game-releases/game-assets"), "Supabase release art must use the isolated game-releases bucket.");
  }
  check(errors.length === 0, `Online browser errors: ${errors.join(" | ")}`);
  await page.route(`${catalogBaseUrl}/**`, (route) => route.abort("internetdisconnected"));
  const offline = await page.evaluate(async ({ catalogBaseUrl }) => {
    const module = await import("/src/lib/catalog-release.ts");
    const loaded = await module.loadPublishedCatalog(catalogBaseUrl, "0.1.0");
    return { version: loaded.release.catalogVersion, source: loaded.release.source };
  }, { catalogBaseUrl });
  check(offline.version === result.catalogVersion && offline.source === "cache", "The last verified compatible release must load offline without mixing data.");
  const unexpectedOfflineErrors = errors.filter((message) => !message.includes("ERR_INTERNET_DISCONNECTED"));
  check(unexpectedOfflineErrors.length === 0, `Offline browser errors: ${unexpectedOfflineErrors.join(" | ")}`);
  await page.unroute(`${catalogBaseUrl}/**`);
  await page.route("**/*", async (route) => {
    if (!/\/combat\.[^/]+\.json$/.test(new URL(route.request().url()).pathname)) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ status: 200, contentType: "application/json", body: `${await response.text()} ` });
  });
  const tamperError = await page.evaluate(async ({ catalogBaseUrl }) => {
    const module = await import("/src/lib/catalog-release.ts");
    try {
      await module.loadPublishedCatalog(catalogBaseUrl, "0.1.0");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, { catalogBaseUrl });
  check(tamperError?.includes("mismatch"), `A tampered successful network response must fail closed instead of using cached data; received ${tamperError ?? "no error"}.`);

  const renderPage = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const renderErrors = [];
  renderPage.on("console", (message) => { if (message.type() === "error") renderErrors.push(message.text()); });
  renderPage.on("pageerror", (error) => renderErrors.push(error.message));
  await renderPage.goto(appUrl, { waitUntil: "networkidle" });
  const runtime = await renderPage.evaluate(async () => {
    const module = await import("/src/lib/supabase.ts");
    const catalog = await module.loadCatalog({ force: true });
    const release = module.getCurrentCatalogRelease();
    const critter = catalog.critters.find((entry) => entry.asset_path) ?? catalog.critters[0];
    const assetUrl = module.getGameAssetUrl(critter?.asset_path);
    document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;background:#0e1630;color:white;font-family:system-ui"><section style="width:360px;padding:28px;border:1px solid #7d6be8;border-radius:24px;background:#151d3b;text-align:center"><p style="color:#53e4d7">Verified published release</p><img data-release-art alt="Published catalog art" style="width:300px;height:300px;object-fit:contain"/><h1 style="font-size:28px"></h1><code></code></section></main>`;
    const image = document.querySelector("[data-release-art]");
    image.src = assetUrl ?? "";
    document.querySelector("h1").textContent = critter?.name ?? "Catalog art";
    document.querySelector("code").textContent = release?.catalogVersion ?? "no release";
    return { release, critterName: critter?.name, assetPath: critter?.asset_path, assetUrl };
  });
  await renderPage.locator("[data-release-art]").evaluate((image) => image.decode());
  const rendered = await renderPage.locator("[data-release-art]").evaluate((image) => ({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, src: image.src }));
  check(runtime.release?.catalogVersion === result.catalogVersion, `The running Game loaded ${runtime.release?.catalogVersion ?? "no release"}, expected ${result.catalogVersion}.`);
  check(rendered.naturalWidth > 0 && rendered.naturalHeight > 0, `The Game runtime did not render published art from ${runtime.assetUrl ?? "no URL"}.`);
  check(rendered.src.includes("/game-releases/game-assets/"), `The Game runtime resolved art outside game-releases: ${rendered.src}.`);
  check(renderErrors.length === 0, `Published-art render errors: ${renderErrors.join(" | ")}`);
  await renderPage.screenshot({ path: path.join(outputDir, "published-art-runtime.png"), fullPage: true });
  await renderPage.close();

  const fallbackPage = await browser.newPage();
  const fallbackErrors = [];
  fallbackPage.on("console", (message) => { if (message.type() === "error") fallbackErrors.push(message.text()); });
  fallbackPage.on("pageerror", (error) => fallbackErrors.push(error.message));
  await fallbackPage.addInitScript(() => {
    try { Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: undefined }); } catch { /* Browser may already omit it. */ }
  });
  await fallbackPage.goto(appUrl, { waitUntil: "networkidle" });
  const fallback = await fallbackPage.evaluate(async ({ catalogBaseUrl }) => {
    const module = await import("/src/lib/catalog-release.ts");
    const loaded = await module.loadPublishedCatalog(catalogBaseUrl, "0.1.0");
    return { catalogVersion: loaded.release.catalogVersion, subtleAvailable: Boolean(globalThis.crypto?.subtle) };
  }, { catalogBaseUrl });
  check(!fallback.subtleAvailable, "The fallback scenario must run without Web Crypto subtle.digest.");
  check(fallback.catalogVersion === result.catalogVersion, "Portable SHA-256 must verify the same published release.");
  check(fallbackErrors.length === 0, `Portable SHA-256 browser errors: ${fallbackErrors.join(" | ")}`);
  await fallbackPage.close();
  process.stdout.write(`Static browser release passed: ${result.catalogVersion}, ${result.assets} variants, online=${result.source}, offline=${offline.source}, tamper=blocked.\n`);
} finally {
  await browser.close();
}
