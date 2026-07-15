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
const lockedRelic = (level) => `<button class="loadout-relic-cell locked" disabled><svg></svg><span>Level ${level}</span></button>`;
const nullRelics = Array.from({ length: 7 }, () => '<span class="loadout-relic-cell null"></span>').join("");
const equippedRelic = `<span class="tooltip-anchor"><button class="loadout-relic-cell unlocked equipped"><span class="asset-icon"><svg class="asset-icon__image sprite-box__image" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="29" fill="#d88b28"/><circle cx="32" cy="32" r="22" fill="#6d3718" stroke="#ffd06c" stroke-width="4"/><path d="M20 34l8 8 17-20" stroke="#fff2bd" stroke-width="6"/></svg></span></button></span>`;

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
          <div class="loadout-critter-summary">
            <button class="slot-topline slot-button loadout-critter-header">
              <span class="sprite-frame sprite-frame-md loadout-critter-frame"><span class="sprite"></span></span>
              <div class="loadout-critter-content"><div class="loadout-critter-identity"><span class="critter-name"><span class="asset-icon">✦</span><strong>Toxichick</strong></span></div><div class="loadout-critter-progression"><p class="loadout-critter-level">Level 3</p>${xp("loadout-critter-xp-progress", 58)}</div></div>
            </button>
            <div class="stat-grid compact"><span class="stat-cell"><span class="stat-label">HP</span><strong>100</strong></span><span class="stat-cell"><span class="stat-label">ATK</span><strong>20</strong></span><span class="stat-cell"><span class="stat-label">DEF</span><strong>18</strong></span><span class="stat-cell"><span class="stat-label">SPD</span><strong>14</strong></span><span class="stat-cell"><span class="stat-label">Mana</span><strong>1–6</strong></span><span class="stat-cell"><span class="stat-label">Block</span><strong>2</strong></span><span class="stat-cell"><span class="stat-label">Swap</span><strong>2</strong></span><span class="stat-cell"><span class="stat-label">Relics</span><strong>2</strong></span></div>
          </div>
          <div class="loadout-equipment-grid">
            <div class="skill-tile-grid">${skill("Venom Peck")}${skill("Rush")}${skill("Guard")}${skill("Focus")}</div>
            <div class="loadout-relic-grid"><span class="tooltip-anchor"><button class="loadout-relic-cell unlocked empty"><svg class="empty-relic-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12h14M12 5v14"></path></svg></button></span>${equippedRelic}${lockedRelic(5)}${nullRelics}</div>
          </div>
        </article>
        <button class="loadout-slot empty"><svg class="empty-relic-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12h14M12 5v14"></path></svg><h3>Squad slot 2</h3><p>Choose a critter</p></button>
      </section>
    </section>
  </main>
</body></html>`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => {
    const panel = document.querySelector(".squad-panel");
    const occupied = panel.querySelector(".loadout-slot:not(.empty)");
    const secondOccupied = occupied.cloneNode(true);
    secondOccupied.querySelector(".critter-name strong").textContent = "Ramber";
    panel.insertBefore(secondOccupied, panel.querySelector(".loadout-slot.empty"));
  });
  await mkdir(outputDir, { recursive: true });

  async function inspect(name, width, height) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      const panel = document.querySelector(".squad-panel");
      panel.style.removeProperty("--squad-slot-height");
      document.querySelectorAll(".skill-tile-grid").forEach((grid) => grid.classList.toggle("compact", grid.getBoundingClientRect().width <= 180));
      const occupied = panel.querySelector(".loadout-slot:not(.empty)");
      panel.style.setProperty("--squad-slot-height", `${Math.ceil(occupied.getBoundingClientRect().height * 100) / 100}px`);
    });
    const metrics = await page.evaluate(() => {
      const rectForElement = (value) => ({
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      });
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return rectForElement(value);
      };
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      const mainPageSnapshot = () => [...document.querySelectorAll(".home-layout, .home-layout *")]
        .map((element) => rectForElement(element.getBoundingClientRect()));
      const levelElement = document.querySelector(".loadout-critter-level");
      const baselineSnapshot = mainPageSnapshot();
      const occupiedSlots = [...document.querySelectorAll(".loadout-slot:not(.empty)")];
      const anchoredSelectors = [".loadout-critter-header", ".loadout-critter-summary > .stat-grid", ".loadout-equipment-grid", ".loadout-equipment-grid > .skill-tile-grid", ".loadout-relic-grid"];
      const occupiedSlotLayouts = occupiedSlots.map((slot) => {
        const slotRect = slot.getBoundingClientRect();
        return {
          rect: rectForElement(slotRect),
          anchors: anchoredSelectors.map((selector) => {
            const child = slot.querySelector(selector).getBoundingClientRect();
            return { selector, left: child.left - slotRect.left, top: child.top - slotRect.top, width: child.width, height: child.height };
          }),
        };
      });
      const baseline = {
        home: rect(".home-layout"),
        loadout: rect(".loadout-slot"),
        emptyLoadout: rect(".loadout-slot.empty"),
        occupiedSlotLayouts,
        summary: rect(".loadout-critter-summary"),
        critterHeader: rect(".loadout-critter-header"),
        sprite: rect(".loadout-critter-frame"),
        skill: rect(".loadout-slot .skill-tile"),
        skillTitle: rect(".loadout-slot .skill-title"),
        skillName: rect(".loadout-slot .skill-title strong"),
        skillIcon: rect(".loadout-slot .skill-title .asset-icon"),
        skillPower: rect(".loadout-slot .skill-power"),
        skillMana: rect(".loadout-slot .skill-mana"),
        skillGrid: rect(".loadout-equipment-grid > .skill-tile-grid"),
        relicGrid: rect(".loadout-relic-grid"),
        equipmentGrid: rect(".loadout-equipment-grid"),
        relic: rect(".loadout-relic-cell"),
        element: rect(".loadout-critter-identity .asset-icon"),
        identity: rect(".loadout-critter-identity"),
        critterLevel: rect(".loadout-critter-level"),
        critterProgression: rect(".loadout-critter-progression"),
        critterXp: rect(".loadout-critter-xp-progress"),
        critterXpBar: rect(".loadout-critter-xp-progress .xp-bar"),
        critterXpNumbers: rect(".loadout-critter-xp-progress > p"),
        statGrid: rect(".loadout-critter-summary > .stat-grid"),
        firstStat: rect(".loadout-critter-summary .stat-cell"),
        firstStatLabel: rect(".loadout-critter-summary .stat-label"),
        firstStatValue: rect(".loadout-critter-summary .stat-cell strong"),
        rollcasterBar: rect(".rollcaster-xp-progress .xp-bar"),
        rollcasterNumbers: rect(".rollcaster-xp-progress > p"),
        rollcasterLevel: rect(".rollcaster-level"),
        critterNameSize: Number.parseFloat(style(".loadout-critter-identity .critter-name").fontSize),
        critterNameTextHeight: rect(".loadout-critter-identity .critter-name strong").height,
        critterLevelSize: Number.parseFloat(style(".loadout-critter-level").fontSize),
        statFontSize: Number.parseFloat(style(".loadout-critter-summary .stat-cell").fontSize),
        skillTitleSize: Number.parseFloat(style(".loadout-slot .skill-title").fontSize),
        skillMetaSize: Number.parseFloat(style(".loadout-slot .skill-power").fontSize),
        skillCompact: document.querySelector(".loadout-slot .skill-tile-grid").classList.contains("compact"),
        skillIconVisible: style(".loadout-slot .skill-title .asset-icon").display !== "none",
        skillLayout: {
          titleColumn: style(".loadout-slot .skill-title").gridColumn,
          powerRow: style(".loadout-slot .skill-power").gridRow,
        },
        layoutColumns: style(".home-layout").gridTemplateColumns.split(" ").length,
        skillColumns: style(".loadout-slot .skill-tile-grid").gridTemplateColumns.split(" ").length,
        relicColumns: style(".loadout-relic-grid").gridTemplateColumns.split(" ").length,
        relicRows: style(".loadout-relic-grid").gridTemplateRows.split(" ").length,
        statColumns: style(".loadout-critter-summary > .stat-grid").gridTemplateColumns.split(" ").length,
        statRows: style(".loadout-critter-summary > .stat-grid").gridTemplateRows.split(" ").length,
        hasEditLabel: Boolean(document.querySelector(".loadout-critter-header .edit-label")),
        relicStateCounts: {
          unlocked: occupiedSlots[0].querySelectorAll(".loadout-relic-cell.unlocked").length,
          locked: occupiedSlots[0].querySelectorAll(".loadout-relic-cell.locked").length,
          null: occupiedSlots[0].querySelectorAll(".loadout-relic-cell.null").length,
        },
        emptyRelicUsesPlus: Boolean(document.querySelector(".loadout-relic-cell.empty .empty-relic-plus")),
        emptySquadUsesRelicPlus: Boolean(document.querySelector(".loadout-slot.empty > .empty-relic-plus")),
        equippedRelicCell: rect(".loadout-relic-cell.equipped"),
        equippedRelicIcon: rect(".loadout-relic-cell.equipped .asset-icon"),
        equippedRelicBorder: style(".loadout-relic-cell.equipped").borderColor,
        equippedRelicGlow: style(".loadout-relic-cell.equipped").boxShadow,
        statWidths: [...occupiedSlots[0].querySelectorAll(".loadout-critter-summary > .stat-grid > .stat-cell")].map((entry) => entry.getBoundingClientRect().width),
        statLayouts: [...occupiedSlots[0].querySelectorAll(".loadout-critter-summary > .stat-grid > .stat-cell")].map((entry) => {
          const cell = entry.getBoundingClientRect();
          const label = entry.querySelector(".stat-label").getBoundingClientRect();
          const value = entry.querySelector("strong").getBoundingClientRect();
          return {
            justifyContent: getComputedStyle(entry).justifyContent,
            labelOffset: label.left - cell.left,
            valueOffset: cell.right - value.right,
            fits: entry.scrollWidth <= entry.clientWidth,
          };
        }),
        levelToXpGap: rect(".loadout-critter-xp-progress").left - rect(".loadout-critter-level").right,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
      levelElement.textContent = "Level 999";
      const threeDigitSnapshot = mainPageSnapshot();
      const threeDigitLevelFits = levelElement.scrollWidth <= levelElement.clientWidth + .1;
      const layoutStableAtThreeDigits = baselineSnapshot.length === threeDigitSnapshot.length
        && baselineSnapshot.every((entry, index) => Object.keys(entry)
          .every((key) => Math.abs(entry[key] - threeDigitSnapshot[index][key]) < .1));
      levelElement.textContent = "Level 3";
      return { ...baseline, threeDigitLevelFits, layoutStableAtThreeDigits };
    });
    const screenshot = path.join(outputDir, `home-loadout-${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const threeDigitScreenshot = path.join(outputDir, `home-loadout-${name}-level-999.png`);
    await page.evaluate(() => document.querySelectorAll(".loadout-critter-level").forEach((element) => { element.textContent = "Level 999"; }));
    await page.screenshot({ path: threeDigitScreenshot, fullPage: true });
    await page.evaluate(() => document.querySelectorAll(".loadout-critter-level").forEach((element) => { element.textContent = "Level 3"; }));
    return { name, width, height, screenshot, threeDigitScreenshot, ...metrics };
  }

  const viewports = [
    await inspect("wide", 1920, 1080),
    await inspect("desktop", 1380, 900),
    await inspect("laptop", 1280, 800),
    await inspect("ipad-landscape", 1024, 768),
    await inspect("ipad-portrait", 820, 1180),
    await inspect("mobile", 390, 844),
    await inspect("narrow-mobile", 320, 800),
  ];
  const failures = viewports.filter((viewport) => {
    const leftEdgesAlign = Math.abs(viewport.sprite.left - viewport.skillGrid.left) < 0.1 && viewport.relicGrid.left > viewport.skillGrid.right;
    const equipmentMatches = Math.abs(viewport.skillGrid.height - viewport.relicGrid.height) < .1 && viewport.skillColumns === 2 && viewport.relicColumns === 5 && viewport.relicRows === 2 && viewport.relicStateCounts.unlocked === 2 && viewport.relicStateCounts.locked === 1 && viewport.relicStateCounts.null === 7 && viewport.emptyRelicUsesPlus;
    const equippedRelicTreatment = viewport.equippedRelicIcon.width >= viewport.equippedRelicCell.width - 4 && viewport.equippedRelicIcon.height >= viewport.equippedRelicCell.height - 4 && viewport.equippedRelicGlow.includes("167, 121, 255") && !viewport.equippedRelicBorder.includes("97, 221, 160");
    const statWidthsMatch = viewport.statWidths.every((width) => Math.abs(width - viewport.statWidths[0]) < .1);
    const responsiveStatMatrix = (viewport.statColumns === 4 && viewport.statRows === 2)
      || (viewport.statColumns === 2 && viewport.statRows === 4)
      || (viewport.statColumns === 1 && viewport.statRows === 8);
    const statContentsAlign = viewport.statLayouts.every((entry) => entry.justifyContent === "space-between"
      && entry.labelOffset >= 6
      && entry.labelOffset <= 11
      && entry.valueOffset >= 6
      && entry.valueOffset <= 11
      && Math.abs(entry.labelOffset - entry.valueOffset) < .1
      && entry.fits);
    const compactStats = responsiveStatMatrix
      && statWidthsMatch
      && viewport.statWidths[0] > 96
      && viewport.firstStat.height >= 39
      && Math.abs(viewport.statFontSize - 18) < .1
      && statContentsAlign
      && Math.abs(viewport.statGrid.width - viewport.relicGrid.width) < .1
      && Math.abs(viewport.statGrid.right - viewport.relicGrid.right) < .1
      && !viewport.hasEditLabel;
    const statsPlacement = viewport.statColumns === 4
      ? Math.abs((viewport.statGrid.left - viewport.critterHeader.right) - (viewport.relicGrid.left - viewport.skillGrid.right)) < .1 && viewport.statGrid.top >= viewport.summary.top && viewport.statGrid.bottom <= viewport.summary.bottom
      : viewport.statGrid.top - viewport.critterHeader.bottom >= 14;
    const skillContents = [viewport.skillName, viewport.skillIcon, viewport.skillPower, viewport.skillMana];
    const skillContentsContained = skillContents.every((entry) => entry.left >= viewport.skill.left - .1 && entry.right <= viewport.skill.right + .1 && entry.top >= viewport.skill.top - .1 && entry.bottom <= viewport.skill.bottom + .1);
    const critterNameLinesFit = viewport.critterNameTextHeight < viewport.critterNameSize * (viewport.width < 360 ? 2.2 : 1.3);
    const scaleMatches = viewport.sprite.width >= 88 && viewport.sprite.width <= 124 && viewport.skill.height <= 90 && viewport.skill.height >= 54 && viewport.skillTitleSize >= 9 && viewport.skillMetaSize >= (viewport.skillCompact ? 7 : 8) && viewport.skillIcon.width >= (viewport.skillCompact ? 12 : 14) && viewport.skillIconVisible && skillContentsContained && viewport.element.width > 22 && viewport.critterNameSize > 18 && critterNameLinesFit && viewport.critterLevelSize > 12 && viewport.critterLevel.height < viewport.critterLevelSize * 1.3;
    const critterXpContentsContained = viewport.critterXpBar.left >= viewport.critterXp.left - .1
      && viewport.critterXpBar.right <= viewport.critterXp.right + .1
      && viewport.critterXpNumbers.left >= viewport.critterXp.left - .1
      && viewport.critterXpNumbers.right <= viewport.critterXp.right + .1;
    const critterXpPosition = viewport.critterXp.left >= viewport.critterLevel.right
      && viewport.critterLevel.width >= 82
      && viewport.levelToXpGap >= 12
      && viewport.levelToXpGap <= 16.1
      && viewport.threeDigitLevelFits
      && viewport.layoutStableAtThreeDigits
      && critterXpContentsContained
      && Math.abs((viewport.critterXp.top + viewport.critterXp.bottom) / 2 - (viewport.critterLevel.top + viewport.critterLevel.bottom) / 2) < 1;
    const rollcasterXpPosition = viewport.rollcasterBar.right <= viewport.rollcasterNumbers.left && viewport.rollcasterBar.top < viewport.rollcasterLevel.top;
    const expectedColumns = viewport.width > 960 ? 3 : 1;
    const fillsViewport = viewport.home.left <= Math.max(52, viewport.width * .03);
    const emptySquadMatchesOccupied = Math.abs(viewport.emptyLoadout.width - viewport.loadout.width) < .1
      && Math.abs(viewport.emptyLoadout.height - viewport.loadout.height) < .1
      && viewport.emptySquadUsesRelicPlus;
    const occupiedSlotsMatch = viewport.occupiedSlotLayouts.every((slot) => Math.abs(slot.rect.width - viewport.occupiedSlotLayouts[0].rect.width) < .1
      && Math.abs(slot.rect.height - viewport.occupiedSlotLayouts[0].rect.height) < .1
      && slot.anchors.every((anchor, index) => {
        const expected = viewport.occupiedSlotLayouts[0].anchors[index];
        return Math.abs(anchor.left - expected.left) < .1
          && Math.abs(anchor.top - expected.top) < .1
          && Math.abs(anchor.width - expected.width) < .1
          && Math.abs(anchor.height - expected.height) < .1;
      }));
    return !(leftEdgesAlign && equipmentMatches && equippedRelicTreatment && compactStats && statsPlacement && scaleMatches && critterXpPosition && rollcasterXpPosition && emptySquadMatchesOccupied && occupiedSlotsMatch && viewport.layoutColumns === expectedColumns && fillsViewport && viewport.noHorizontalOverflow);
  });

  const byLoadoutWidth = [...viewports].sort((a, b) => a.loadout.width - b.loadout.width);
  const responsiveSkillScale = byLoadoutWidth.every((viewport, index) => {
    if (index === 0) return true;
    const smaller = byLoadoutWidth[index - 1];
    return viewport.skillTitleSize + .1 >= smaller.skillTitleSize
      && viewport.skillMetaSize + .1 >= smaller.skillMetaSize
      && viewport.skillIcon.width + .1 >= smaller.skillIcon.width
      && viewport.skill.height + .1 >= smaller.skill.height;
  });
  const wide = viewports.find((viewport) => viewport.name === "wide");
  const mobile = viewports.find((viewport) => viewport.name === "mobile");
  if (!responsiveSkillScale || wide.skillTitleSize < 21 || wide.skillIcon.width < 40 || wide.skillMetaSize < 16 || mobile.skillTitleSize >= wide.skillTitleSize || mobile.skillIcon.width >= wide.skillIcon.width || mobile.skillMetaSize >= wide.skillMetaSize || mobile.skill.height >= wide.skill.height) {
    throw new Error(`Equipped Skill scaling failures:\n${JSON.stringify({ responsiveSkillScale, wide, mobile }, null, 2)}`);
  }

  if (failures.length) throw new Error(`Home loadout layout failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(JSON.stringify({ checkedViewports: viewports.length, viewports }, null, 2));
} finally {
  await browser.close();
}
