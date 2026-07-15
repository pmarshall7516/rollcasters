import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "responsive-shell-layout");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");

const unit = (opponent = false) => `<article class="battle-unit ${opponent ? "opponent" : ""}">
  ${opponent ? "" : '<span class="combat-sprite-frame critter-combat-frame"><span class="sprite"></span></span>'}
  <div class="battle-unit-info"><span class="critter-name"><strong>${opponent ? "Rival" : "Toxichick"}</strong></span><p>Lv 3 / Mana 2–6: 4</p><div class="hp-bar"><span style="width:72%"></span></div></div>
  ${opponent ? '<span class="combat-sprite-frame critter-combat-frame"><span class="sprite"></span></span>' : ""}
</article>`;

const combatHtml = `<!doctype html><html><head><style>${css}</style></head><body><main class="app-shell">
  <header class="top-bar">
    <button class="brand-home-button"><span class="brand-logo-fallback signed-in">Rollcasters</span></button>
    <div class="account-cluster"><span class="coin-pill">◆ 999</span><button class="icon-button">×</button></div>
  </header>
  <section class="combat-screen">
    <header class="combat-header"><h1>Dungeon Battle</h1><div class="mana-readout"><span>Mana 8</span><span>Turn 3</span></div></header>
    <div class="battlefield">
      <aside class="battle-rollcaster"><span class="combat-sprite-frame rollcaster-combat-frame"><span class="sprite"></span></span><p>Shanks</p></aside>
      <div class="battle-column">${unit()}${unit()}</div>
      <div class="battle-column opponent-column">${unit(true)}${unit(true)}</div>
    </div>
    <div class="turn-panel"><div class="selection-summary"><span>Attack selected</span></div><button class="primary-button">Continue</button></div>
    <div class="combat-log"><p>Toxichick used Venom Peck.</p></div>
  </section>
</main></body></html>`;

const modalHtml = `<!doctype html><html><head><style>${css}</style></head><body><main class="app-shell">
  <div class="modal-backdrop"><section class="modal">
    <div class="modal-header"><div><h2>Choose a Critter</h2><p>Choose an eligible item for this loadout slot.</p></div><button class="icon-button">×</button></div>
    <div class="candidate-grid">${Array.from({ length: 8 }, (_, index) => `<button class="candidate-card"><span class="sprite-frame sprite-frame-md"><span class="sprite"></span></span><strong>Critter ${index + 1}</strong><span>Level ${index + 1}</span></button>`).join("")}</div>
  </section></div>
</main></body></html>`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await mkdir(outputDir, { recursive: true });
  const viewports = [
    { name: "wide", width: 1920, height: 1080 },
    { name: "ipad-landscape", width: 1024, height: 768 },
    { name: "ipad-portrait", width: 820, height: 1180 },
    { name: "mobile", width: 390, height: 844 },
  ];

  const combatResults = [];
  await page.setContent(combatHtml);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      const top = rect(".top-bar");
      const screen = rect(".combat-screen");
      const brand = rect(".brand-home-button");
      const account = rect(".account-cluster");
      return {
        top,
        screen,
        battlefieldColumns: getComputedStyle(document.querySelector(".battlefield")).gridTemplateColumns.split(" ").length,
        rollcasterVisible: getComputedStyle(document.querySelector(".battle-rollcaster")).display !== "none",
        headerItemsSeparate: brand.right <= account.left,
        matchingShellEdges: Math.abs(top.left - screen.left) < .1 && Math.abs(top.right - screen.right) < .1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    const screenshot = path.join(outputDir, `combat-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    combatResults.push({ ...viewport, screenshot, ...metrics });
  }

  const combatFailures = combatResults.filter((result) => {
    const expectedColumns = result.width > 960 ? 3 : 1;
    const expectedRollcaster = result.width > 960;
    const fillsViewport = result.screen.left <= Math.max(52, result.width * .03);
    return !(result.battlefieldColumns === expectedColumns && result.rollcasterVisible === expectedRollcaster && result.headerItemsSeparate && result.matchingShellEdges && fillsViewport && result.noHorizontalOverflow);
  });

  const modalResults = [];
  await page.setContent(modalHtml);
  for (const viewport of viewports.slice(1)) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const metrics = await page.evaluate(() => {
      const modal = document.querySelector(".modal").getBoundingClientRect();
      return {
        modal: { left: modal.left, right: modal.right, top: modal.top, bottom: modal.bottom, width: modal.width, height: modal.height },
        columns: getComputedStyle(document.querySelector(".candidate-grid")).gridTemplateColumns.split(" ").length,
        withinViewport: modal.left >= 0 && modal.top >= 0 && modal.right <= window.innerWidth && modal.bottom <= window.innerHeight,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    const screenshot = path.join(outputDir, `modal-${viewport.name}.png`);
    await page.screenshot({ path: screenshot });
    modalResults.push({ ...viewport, screenshot, ...metrics });
  }

  const modalFailures = modalResults.filter((result) => !(result.withinViewport && result.noHorizontalOverflow && result.columns >= 1));
  const failures = [...combatFailures.map((result) => ({ surface: "combat", ...result })), ...modalFailures.map((result) => ({ surface: "modal", ...result }))];
  if (failures.length) throw new Error(`Responsive shell layout failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(JSON.stringify({ combat: combatResults, modals: modalResults }, null, 2));
} finally {
  await browser.close();
}
