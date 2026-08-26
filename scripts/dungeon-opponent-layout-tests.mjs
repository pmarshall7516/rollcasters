import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
    <main class="app-shell">
      <div class="dungeon-opponent-list" style="width: 600px">
        <details class="dungeon-opponent-entry" open>
          <summary><span>Critter</span><span>50%</span><span class="dungeon-boss-position"><span class="sr-only">Boss position </span>1</span></summary>
          <div class="dungeon-opponent-drop-panel">
            <div class="dungeon-xp-drops"><span>100 Critter XP</span></div>
            <div class="dungeon-drop-list"><div class="dungeon-drop-row"><span>Coins</span><span><strong>6–8 x Coins</strong><small>100% chance</small></span></div></div>
          </div>
        </details>
        <details class="dungeon-opponent-entry">
          <summary><span>Neighbor</span><span>50%</span><span>⌄</span></summary>
        </details>
      </div>
    </main>
  </body></html>`);

  const result = await page.locator(".dungeon-opponent-list").evaluate((list) => {
    const entries = [...list.querySelectorAll(".dungeon-opponent-entry")];
    const bossPosition = list.querySelector(".dungeon-boss-position");
    const [expanded, closed] = entries.map((entry) => entry.getBoundingClientRect().height);
    const bossPositionStyle = bossPosition ? getComputedStyle(bossPosition) : null;
    return {
      alignItems: getComputedStyle(list).alignItems,
      bossPosition: bossPositionStyle && {
        width: bossPositionStyle.width,
        height: bossPositionStyle.height,
        borderRadius: bossPositionStyle.borderRadius,
      },
      expanded,
      closed,
    };
  });

  if (result.alignItems !== "start" || result.closed >= result.expanded - 20) {
    throw new Error(`Closed dungeon opponent entry should keep its intrinsic height: ${JSON.stringify(result)}`);
  }
  if (result.bossPosition?.width !== "34px" || result.bossPosition.height !== "34px" || result.bossPosition.borderRadius !== "50%") {
    throw new Error(`Boss position should render as a circular badge: ${JSON.stringify(result.bossPosition)}`);
  }

  console.log(`Dungeon opponent row alignment regression passed: ${JSON.stringify(result)}`);
} finally {
  await browser.close();
}
