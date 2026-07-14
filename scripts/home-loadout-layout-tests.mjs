import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "home-loadout-layout");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");

const xp = (className, width = 42) => `<div class="xp-progress xp-progress-inline ${className}">
  <div class="xp-bar"><span style="width:${width}%"></span></div><p>42 / 100 XP</p>
</div>`;
const skill = (name) => `<span class="tooltip-anchor"><button class="skill-tile">
  <span class="skill-title"><span class="asset-icon">✦</span><strong>${name}</strong></span>
  <span class="skill-power">PWR 20</span><span class="skill-mana">◆ 3</span>
</button></span>`;

const html = `<!doctype html><html><head><style>${css}</style></head><body>
  <main class="app-shell">
    <section class="home-layout">
      <aside class="rollcaster-panel">
        <p class="eyebrow">Active Rollcaster</p>
        <button class="portrait-button"><span class="card-sprite-frame rollcaster-sprite-frame"><span class="sprite sprite-fit-portrait"></span></span></button>
        <h1>Shanks</h1>
        ${xp("rollcaster-xp-progress", 35)}
        <p class="rollcaster-level">Level 2</p>
        <div class="ability-list"><button class="ability-slot"><span><small>Slot 1</small><strong>Fortify</strong></span></button></div>
      </aside>
      <nav class="main-actions"><button class="menu-button play-button">Play</button><button class="menu-button">Collection</button></nav>
      <section class="squad-panel">
        <article class="loadout-slot">
          <button class="slot-topline slot-button loadout-critter-header">
            <span class="sprite-frame sprite-frame-md loadout-critter-frame"><span class="sprite"></span></span>
            <div class="loadout-critter-identity"><span class="critter-name"><span class="asset-icon">✦</span><strong>Toxichick</strong></span><p class="loadout-critter-level">Level 3</p></div>
            ${xp("loadout-critter-xp-progress", 58)}
            <span class="edit-label">Edit</span>
          </button>
          <div class="stat-grid compact"><span>HP <strong>100</strong></span><span>ATK <strong>20</strong></span><span>DEF <strong>18</strong></span><span>SPD <strong>14</strong></span></div>
          <div class="skill-grid">${skill("Venom Peck")}${skill("Rush")}${skill("Guard")}${skill("Focus")}</div>
          <div class="relic-row"><span class="tooltip-anchor"><button class="relic-slot"><span class="sprite-frame sprite-frame-sm"><span class="asset-icon">◆</span></span><span>Charm</span></button></span></div>
        </article>
      </section>
    </section>
  </main>
</body></html>`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await mkdir(outputDir, { recursive: true });

  async function inspect(name, width, height) {
    await page.setViewportSize({ width, height });
    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      return {
        sprite: rect(".loadout-critter-frame"),
        skill: rect(".loadout-slot .skill-tile"),
        relic: rect(".loadout-slot > .relic-row .sprite-frame"),
        element: rect(".loadout-critter-identity .asset-icon"),
        identity: rect(".loadout-critter-identity"),
        critterXp: rect(".loadout-critter-xp-progress"),
        rollcasterBar: rect(".rollcaster-xp-progress .xp-bar"),
        rollcasterNumbers: rect(".rollcaster-xp-progress > p"),
        rollcasterLevel: rect(".rollcaster-level"),
        critterNameSize: Number.parseFloat(style(".loadout-critter-identity .critter-name").fontSize),
        critterNameTextHeight: rect(".loadout-critter-identity .critter-name strong").height,
        critterLevelSize: Number.parseFloat(style(".loadout-critter-level").fontSize),
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    const screenshot = path.join(outputDir, `home-loadout-${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    return { name, screenshot, ...metrics };
  }

  const viewports = [
    await inspect("desktop", 1380, 900),
    await inspect("compressed", 980, 900),
    await inspect("mobile", 360, 900),
  ];
  const failures = viewports.filter((viewport) => {
    const leftEdgesAlign = Math.abs(viewport.sprite.left - viewport.skill.left) < 0.1 && Math.abs(viewport.sprite.left - viewport.relic.left) < 0.1;
    const expectedSpriteWidth = viewport.name === "compressed" ? 96 : viewport.name === "mobile" ? 88 : 112;
    const scaleMatches = Math.abs(viewport.sprite.width - expectedSpriteWidth) < 0.1 && viewport.skill.height < 84 && viewport.element.width > 22 && viewport.critterNameSize > 18 && viewport.critterNameTextHeight < viewport.critterNameSize * 1.3 && viewport.critterLevelSize > 12;
    const critterXpPosition = viewport.name === "mobile"
      ? viewport.critterXp.left > viewport.sprite.left
      : viewport.critterXp.left >= viewport.identity.right;
    const rollcasterXpPosition = viewport.rollcasterBar.right <= viewport.rollcasterNumbers.left && viewport.rollcasterBar.top < viewport.rollcasterLevel.top;
    return !(leftEdgesAlign && scaleMatches && critterXpPosition && rollcasterXpPosition && viewport.noHorizontalOverflow);
  });

  if (failures.length) throw new Error(`Home loadout layout failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(JSON.stringify({ checkedViewports: viewports.length, viewports }, null, 2));
} finally {
  await browser.close();
}
