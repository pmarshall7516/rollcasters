import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "collection-layout");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const card = (id, name, extraClass = "") => `
  <button class="catalog-card ${extraClass}">
    <span class="collectible-id">${id}</span>
    <span class="card-sprite-frame"><span class="sprite"></span></span>
    <span class="card-name-row"><strong>${name}</strong></span>
    <p class="collection-status">Locked</p>
    ${name === "Critter" ? `<div class="stat-grid compact">
      <span>HP <strong>120</strong></span><span>ATK <strong>24</strong></span><span>DEF <strong>18</strong></span><span>SPD <strong>16</strong></span>
      <span class="mana-dice-stat">Mana Dice <strong>10–12</strong></span><span>Block <strong>2</strong></span><span>Swap <strong>3</strong></span><span>Relics <strong>2</strong></span>
    </div>` : name === "Relic" ? `<p class="relic-card-effect"><strong>Effect:</strong> Harden: Increases DEF by 10%.</p>` : ""}
  </button>`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 }, deviceScaleFactor: 1 });
  const cards = Array.from({ length: 9 }, (_, index) => card(String(index + 1).padStart(3, "0"), ["Rollcaster", "Critter", "Relic"][index % 3])).join("");
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
    <main class="app-shell collection-shell">
      <header class="top-bar"><span>Rollcasters</span></header>
      <section class="screen-stack collection-screen">
        <div class="screen-heading row"><div><h1>Collection</h1><p>Review owned and locked game pieces.</p></div><button>Back</button></div>
        <div class="tabs"><button>Rollcasters</button><button class="active">Critters</button><button>Relics</button></div>
        <div class="collection-tools">
          <label class="collection-search"><input placeholder="Search critters by name or ID"></label>
          <div class="collection-filter-slot"></div>
        </div>
        <div class="collection-grid-content"><div class="collection-grid">${cards}</div></div>
      </section>
    </main>
  </body></html>`);
  await mkdir(outputDir, { recursive: true });

  async function inspect(name, width, height) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { document.querySelector(".collection-filter-slot").innerHTML = ""; });
    const beforeFilter = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return [value.left, value.top, value.width, value.height];
      };
      return { heading: rect(".screen-heading"), tabs: rect(".tabs"), tools: rect(".collection-tools"), content: rect(".collection-grid-content") };
    });
    await page.evaluate(() => {
      document.querySelector(".collection-filter-slot").innerHTML = '<details class="element-filter"><summary>Ember</summary></details>';
      document.querySelector(".collection-search input").placeholder = "Search critters by name or ID";
    });
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".collection-grid .catalog-card")];
      const mana = [...document.querySelectorAll(".mana-dice-stat")];
      const effects = [...document.querySelectorAll(".relic-card-effect")];
      const statuses = [...document.querySelectorAll(".collection-status")];
      const grid = document.querySelector(".collection-grid");
      const content = document.querySelector(".collection-grid-content");
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return [value.left, value.top, value.width, value.height];
      };
      return {
        anchors: { heading: rect(".screen-heading"), tabs: rect(".tabs"), tools: rect(".collection-tools"), content: rect(".collection-grid-content") },
        cards: cards.map((entry) => {
          const rect = entry.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
        documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        gridColumns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        nestedGridScrollable:
          content.scrollHeight > content.clientHeight &&
          ["auto", "scroll"].includes(getComputedStyle(content).overflowY),
        mana: mana.map((entry) => ({
          text: entry.textContent.trim(),
          fits: entry.scrollWidth <= entry.clientWidth,
          whiteSpace: getComputedStyle(entry).whiteSpace,
          valueLines: entry.querySelector("strong").getClientRects().length,
        })),
        effects: effects.map((entry) => ({
          text: entry.textContent.trim(),
          visible: entry.getBoundingClientRect().height > 0 && entry.scrollHeight <= entry.clientHeight,
        })),
        statuses: statuses.map((entry) => ({
          align: getComputedStyle(entry).textAlign,
          transform: getComputedStyle(entry).textTransform,
          weight: Number(getComputedStyle(entry).fontWeight),
        })),
      };
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    result.pageScrollY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = path.join(outputDir, `collection-layout-${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    return { name, screenshot, beforeFilter, ...result };
  }

  const viewports = [await inspect("desktop", 1180, 720), await inspect("mobile", 360, 720)];
  const failures = viewports.flatMap((viewport) => {
    const [firstCard, ...otherCards] = viewport.cards;
    const sameCards = otherCards.every((entry) => Math.abs(entry.width - firstCard.width) < 0.1 && entry.height === firstCard.height && entry.height === 440);
    const manaFits = viewport.mana.every((entry) => entry.fits && entry.whiteSpace === "nowrap" && entry.valueLines === 1);
    const effectsVisible = viewport.effects.length === 3 && viewport.effects.every((entry) => entry.visible && entry.text.startsWith("Effect:"));
    const statusesMatch = viewport.statuses.every((entry) => entry.align === "center" && entry.transform === "uppercase" && entry.weight >= 700);
    const anchorsStable = JSON.stringify(viewport.beforeFilter) === JSON.stringify(viewport.anchors);
    const expectedColumns = viewport.name === "desktop" ? 3 : 1;
    const layoutMatches = viewport.documentScrollable && viewport.noHorizontalOverflow && viewport.pageScrollY > 0 && viewport.gridColumns === expectedColumns && !viewport.nestedGridScrollable && anchorsStable;
    return sameCards && firstCard.height === 440 && manaFits && effectsVisible && statusesMatch && layoutMatches
      ? []
      : [{ viewport: viewport.name, sameCards, manaFits, effectsVisible, statusesMatch, anchorsStable, documentScrollable: viewport.documentScrollable, noHorizontalOverflow: viewport.noHorizontalOverflow, pageScrollY: viewport.pageScrollY, gridColumns: viewport.gridColumns, nestedGridScrollable: viewport.nestedGridScrollable }];
  });

  if (failures.length) throw new Error(`Collection layout failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(JSON.stringify({ checkedViewports: viewports.length, viewports }, null, 2));
} finally {
  await browser.close();
}
