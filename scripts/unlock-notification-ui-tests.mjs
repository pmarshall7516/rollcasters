import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const outputDir = path.join(root, "output", "unlock-notification-ui");
fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(
  appSource.includes("const BANNER_NOTIFICATION_DURATION_MS = 5_000;")
    && appSource.includes("}, BANNER_NOTIFICATION_DURATION_MS);"),
  "The shared production banner queue must advance on a five-second timer.",
);
check(
  !appSource.includes("<Modal title=\"Collection Updated\"")
    && !appSource.includes("onClose={() => setUnlockQueue"),
  "The production unlock notification must not use the old modal or a manual close action.",
);

const bannerMarkup = `
  <aside class="unlock-notification" role="status" aria-live="polite" aria-atomic="true">
    <span class="sprite-frame sprite-frame-xs">
      <span class="asset-icon" role="img" aria-label="Ramber">
        <svg class="asset-icon__image sprite-box__image" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="27" fill="#6f4432" stroke="#ffd06c" stroke-width="3"/>
          <path d="M18 38c3-15 25-20 29-2-6 12-23 15-29 2Z" fill="#c98049"/>
          <path d="M23 24 16 13l14 6m12 4 8-10-3 15" fill="none" stroke="#f1c476" stroke-width="4" stroke-linecap="round"/>
          <circle cx="27" cy="33" r="2.5" fill="#fff3ca"/><circle cx="40" cy="31" r="2.5" fill="#fff3ca"/>
        </svg>
      </span>
    </span>
    <div class="unlock-notification-copy">
      <span class="unlock-notification-label">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" aria-hidden="true"><path d="m12 3-1.4 4.1L6.5 8.5l4.1 1.4L12 14l1.4-4.1 4.1-1.4-4.1-1.4L12 3Z"/><path d="m5 15-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8L5 15Z"/></svg>
        Collectible unlocked
      </span>
      <h2><span class="critter-name"><span class="asset-icon"><svg class="asset-icon__image" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#dd6b48"/></svg></span><strong>Ramber</strong></span> <span>unlocked!</span></h2>
    </div>
  </aside>
`;

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>${css}</style>
    <style>
      body { min-height: 100vh; }
      .fixture-brand { justify-self: center; color: var(--text-primary); font-family: Georgia, serif; font-size: 31px; font-weight: 900; letter-spacing: .08em; }
      .fixture-content { display: grid; gap: 18px; }
      .fixture-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
      .fixture-card { min-height: 210px; padding: 18px; border: 1px solid var(--border-soft); border-radius: var(--radius-md); background: linear-gradient(150deg, rgb(23 29 56 / 96%), rgb(11 15 34 / 96%)); }
      .fixture-card h2 { color: var(--text-primary); }
      .fixture-card p { color: var(--text-secondary); }
      #click-through-target { position: fixed; z-index: 1; top: 12px; left: 12px; width: min(360px, calc(100vw - 24px)); height: 70px; opacity: 0; }
      @media (max-width: 650px) { .fixture-cards { grid-template-columns: 1fr; } .fixture-card:nth-child(n+2) { display: none; } }
    </style>
  </head>
  <body>
    <main class="app-shell">
      <header class="top-bar ui-layout-probe">
        <span class="currency-pill"><strong>24</strong> Coins</span>
        <div class="fixture-brand">ROLLCASTERS</div>
        <span class="user-pill">Player</span>
      </header>
      <section class="fixture-content">
        <div class="screen-heading"><p class="eyebrow">Loadout & collection</p><h1>Shard Shop</h1><p>Collect Shards to unlock new Critters and Rollcasters.</p></div>
        <div class="fixture-cards">
          <article class="fixture-card"><p class="eyebrow">Critter shards</p><h2>Ramber</h2><p>Challenge complete. Your collection has been updated.</p><button class="primary-button">Purchase</button></article>
          <article class="fixture-card"><p class="eyebrow">Critter shards</p><h2>Cragram</h2><p>Keep progressing through challenges.</p><button class="primary-button">Purchase</button></article>
          <article class="fixture-card"><p class="eyebrow">Relic</p><h2>Prism Charm</h2><p>A complete Relic purchase offer.</p><button class="primary-button">Purchase</button></article>
        </div>
      </section>
    </main>
    <button id="click-through-target" aria-label="Click-through probe"></button>
    <script>
      document.querySelector("#click-through-target").addEventListener("click", () => {
        document.body.dataset.clickThrough = "true";
      });
      window.insertUnlockBanner = () => document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(bannerMarkup)});
    </script>
  </body>
</html>`;

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const browserErrors = [];
    page.on("console", (message) => message.type() === "error" && browserErrors.push(`console: ${message.text()}`));
    page.on("pageerror", (error) => browserErrors.push(`page: ${error.message}`));
    await page.setContent(html, { waitUntil: "load" });
    const before = await page.locator(".ui-layout-probe").boundingBox();
    await page.evaluate(() => window.insertUnlockBanner());
    await page.waitForTimeout(350);
    const banner = page.locator(".unlock-notification");
    const after = await page.locator(".ui-layout-probe").boundingBox();
    const presentation = await banner.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        bounds: { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height },
        position: style.position,
        pointerEvents: style.pointerEvents,
        zIndex: Number(style.zIndex),
        animationName: style.animationName,
        role: node.getAttribute("role"),
        live: node.getAttribute("aria-live"),
        interactiveDescendants: node.querySelectorAll("button, a, input, [tabindex]").length,
      };
    });
    await page.mouse.click(Math.min(180, viewport.width / 2), 47);
    const clickedThrough = await page.evaluate(() => document.body.dataset.clickThrough === "true");
    const screenshot = path.join(outputDir, `unlock-banner-${viewport.name}.png`);
    await page.screenshot({ path: screenshot });

    check(before && after && JSON.stringify(before) === JSON.stringify(after), `${viewport.name}: inserting the fixed banner changed page layout.`);
    check(presentation.position === "fixed", `${viewport.name}: banner must use fixed positioning.`);
    check(presentation.bounds.top >= 12 && presentation.bounds.top <= 16 && presentation.bounds.left >= 12 && presentation.bounds.left <= 16, `${viewport.name}: banner is not anchored in the top-left corner.`);
    check(presentation.bounds.width <= 360 && presentation.bounds.width <= viewport.width - 24 && presentation.bounds.height <= 90, `${viewport.name}: banner is not compact.`);
    check(presentation.pointerEvents === "none" && presentation.interactiveDescendants === 0 && clickedThrough, `${viewport.name}: banner intercepted interaction.`);
    check(presentation.zIndex > 50 && presentation.animationName.includes("unlock-banner-in"), `${viewport.name}: banner does not animate above modal UI.`);
    check(presentation.role === "status" && presentation.live === "polite", `${viewport.name}: banner live-region semantics are missing.`);
    check(browserErrors.length === 0, `${viewport.name}: browser errors detected: ${browserErrors.join(" | ")}`);
    results.push({ ...viewport, presentation, layoutUnchanged: true, clickedThrough, screenshot });
    await page.close();
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
