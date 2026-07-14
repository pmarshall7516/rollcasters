import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "collection-layout");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const card = (id, name) => {
  const owned = id === "004" || id === "005" || id === "009";
  const progression = name === "Critter"
    ? `<div class="collection-progression critter-progression">${owned
      ? '<p>Level 2</p><div class="xp-progress"><div class="xp-bar"><span style="width:20%"></span></div><p>20 / 100 XP</p></div>'
      : '<p class="collection-status">Locked</p><div class="locked-xp-space"></div>'}</div>`
    : name === "Rollcaster"
      ? `<div class="collection-progression">${owned ? '<p>Level 1</p>' : '<p class="collection-status">Locked</p>'}<div class="xp-progress"><div class="xp-bar"><span style="width:0%"></span></div><p>0 / 120 XP</p></div></div>`
      : owned ? '<p>Owned 1 / 5</p>' : '<p class="collection-status">Locked</p>';
  return `
  <button class="catalog-card ${name.toLowerCase()}-card ${owned ? "" : "locked"}">
    <span class="collectible-id">${id}</span>
    <span class="card-sprite-frame"><span class="sprite"></span></span>
    <span class="card-name-row"><strong>${name}</strong></span>
    ${progression}
    ${name === "Critter" ? `<div class="stat-grid compact">
      <span>HP <strong>120</strong></span><span>ATK <strong>24</strong></span><span>DEF <strong>18</strong></span><span>SPD <strong>16</strong></span>
      <span class="mana-dice-stat">Mana Dice <strong>10–12</strong></span><span>Block <strong>2</strong></span><span>Swap <strong>3</strong></span><span>Relics <strong>2</strong></span>
    </div><p class="point-counter"><strong>${owned ? 1 : 0}</strong> skill points</p>` : name === "Rollcaster" ? `<p class="point-counter"><strong>0</strong> ability points</p>` : `<span class="effect-list relic-card-effects"><span class="effect-list-row"><strong>Harden:</strong> Increases DEF by 10%.</span><span class="effect-list-row"><strong>Steady:</strong> Prevents one point of loss.</span></span>`}
  </button>`;
};

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
      return { heading: rect(".screen-heading"), tabs: rect(".tabs"), tools: rect(".collection-tools"), search: rect(".collection-search"), content: rect(".collection-grid-content") };
    });
    await page.evaluate(() => {
      document.querySelector(".collection-filter-slot").innerHTML = '<details class="element-filter"><summary>Ember</summary></details>';
      document.querySelector(".collection-search input").placeholder = "Search critters by name or ID";
    });
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".collection-grid .catalog-card")];
      const mana = [...document.querySelectorAll(".mana-dice-stat")];
      const effects = [...document.querySelectorAll(".relic-card-effects")];
      const statuses = [...document.querySelectorAll(".collection-status")];
      const points = [...document.querySelectorAll(".point-counter")];
      const critterStatOffsets = [...document.querySelectorAll(".critter-card")].map((entry) => entry.querySelector(".stat-grid").getBoundingClientRect().top - entry.getBoundingClientRect().top);
      const critterSpacing = [...document.querySelectorAll(".critter-card")].map((entry) => {
        const cardRect = entry.getBoundingClientRect();
        const progressionRect = entry.querySelector(".collection-progression").getBoundingClientRect();
        const statsRect = entry.querySelector(".stat-grid").getBoundingClientRect();
        const pointsRect = entry.querySelector(".point-counter").getBoundingClientRect();
        return {
          progressionToStats: statsRect.top - progressionRect.bottom,
          statsToPoints: pointsRect.top - statsRect.bottom,
          pointsToBottom: cardRect.bottom - pointsRect.bottom,
        };
      });
      const grid = document.querySelector(".collection-grid");
      const content = document.querySelector(".collection-grid-content");
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return [value.left, value.top, value.width, value.height];
      };
      return {
        anchors: { heading: rect(".screen-heading"), tabs: rect(".tabs"), tools: rect(".collection-tools"), search: rect(".collection-search"), content: rect(".collection-grid-content") },
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
          namedRows: [...entry.querySelectorAll(".effect-list-row")].every((row) => row.firstElementChild?.tagName === "STRONG"),
        })),
        pointCount: points.length,
        pointsVisible: points.every((entry) => entry.getBoundingClientRect().bottom <= entry.closest(".catalog-card").getBoundingClientRect().bottom),
        critterStatOffsets,
        critterSpacing,
        stableScrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter.includes("stable"),
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
    const effectsVisible = viewport.effects.length === 3 && viewport.effects.every((entry) => entry.visible && entry.namedRows && !entry.text.startsWith("Effect:"));
    const pointCountersVisible = viewport.pointCount === 6 && viewport.pointsVisible;
    const critterStatsAligned = viewport.critterStatOffsets.every((offset) => Math.abs(offset - viewport.critterStatOffsets[0]) < 0.1);
    const minimumGap = viewport.name === "desktop" ? 13 : 10;
    const critterSpacingMatches = viewport.critterSpacing.every((spacing) => spacing.progressionToStats >= minimumGap && spacing.statsToPoints >= minimumGap && spacing.pointsToBottom >= 0);
    const statusesMatch = viewport.statuses.every((entry) => entry.align === "center" && entry.transform === "uppercase" && entry.weight >= 700);
    const anchorsStable = JSON.stringify(viewport.beforeFilter) === JSON.stringify(viewport.anchors);
    const expectedColumns = viewport.name === "desktop" ? 3 : 1;
    const layoutMatches = viewport.documentScrollable && viewport.noHorizontalOverflow && viewport.pageScrollY > 0 && viewport.gridColumns === expectedColumns && !viewport.nestedGridScrollable && anchorsStable && viewport.stableScrollbarGutter;
    return sameCards && firstCard.height === 440 && manaFits && effectsVisible && pointCountersVisible && critterStatsAligned && critterSpacingMatches && statusesMatch && layoutMatches
      ? []
      : [{ viewport: viewport.name, sameCards, manaFits, effectsVisible, pointCountersVisible, critterStatsAligned, critterSpacingMatches, critterSpacing: viewport.critterSpacing, statusesMatch, anchorsStable, stableScrollbarGutter: viewport.stableScrollbarGutter, documentScrollable: viewport.documentScrollable, noHorizontalOverflow: viewport.noHorizontalOverflow, pageScrollY: viewport.pageScrollY, gridColumns: viewport.gridColumns, nestedGridScrollable: viewport.nestedGridScrollable }];
  });

  if (failures.length) throw new Error(`Collection layout failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(JSON.stringify({ checkedViewports: viewports.length, viewports }, null, 2));
} finally {
  await browser.close();
}
