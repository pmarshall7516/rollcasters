import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
    <main class="app-shell">
      <section class="dungeon-grid-content">
        <div class="dungeon-grid">
          <article class="dungeon-card dungeon-grid-card">
            <span class="collectible-id">001</span>
            <span class="dungeon-logo-frame"><span aria-hidden="true">⚔</span></span>
            <h2>Corner Clash</h2>
            <p class="dungeon-description">A short dungeon description.</p>
            <div class="dungeon-stat-grid"><span><small>Difficulty</small><strong>1</strong></span><span><small>Format</small><strong>2v2</strong></span></div>
            <p class="dungeon-entry-state">Ready</p>
            <button class="primary-button dungeon-enter-button">Enter Dungeon</button>
          </article>
        </div>
      </section>
    </main>
  </body></html>`);

  const result = await page.locator(".dungeon-grid-card").evaluate((card) => {
    const style = getComputedStyle(card);
    const accent = getComputedStyle(card, "::before");
    return {
      overflow: style.overflow,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      borderRadius: style.borderRadius,
      accentTop: accent.top,
      accentLeft: accent.left,
      accentRight: accent.right,
      accentHeight: accent.height,
    };
  });

  const clipping = ["hidden", "clip"].includes(result.overflow) && ["hidden", "clip"].includes(result.overflowX) && ["hidden", "clip"].includes(result.overflowY);
  if (!clipping) {
    throw new Error(`Dungeon card accent is not clipped to the rounded card: ${JSON.stringify(result)}`);
  }
  if (result.borderRadius !== "18px" || result.accentTop !== "0px" || result.accentLeft !== "0px" || result.accentRight !== "0px" || result.accentHeight !== "4px") {
    throw new Error(`Dungeon card top accent geometry changed unexpectedly: ${JSON.stringify(result)}`);
  }

  console.log(`Dungeon grid corner regression passed: ${JSON.stringify(result)}`);
} finally {
  await browser.close();
}
