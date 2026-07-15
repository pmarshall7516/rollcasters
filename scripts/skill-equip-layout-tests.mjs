import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "skill-equip-layout");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");

const skill = (name, classes = "", disabled = false) => `<span class="tooltip-anchor">
  <button class="skill-tile ${classes}" ${disabled ? "disabled" : ""}>
    <span class="skill-title"><span class="asset-icon">✦</span><strong>${name}</strong></span>
    <span class="skill-power">PWR 20</span>
    <span class="skill-mana"><span class="asset-icon">◆</span>3</span>
    ${classes.includes("selected") || classes.includes("equipped") ? '<span class="selection-check">✓</span>' : ""}
  </button>
</span>`;

const grid = (surface) => `<div class="skill-tile-grid" data-surface="${surface}">
  ${skill("Venom Peck")}
  ${skill("Rush", "selected equipped")}
  ${skill("Guard", "equipped", true)}
  ${skill("Focus")}
</div>`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${css}
    .skill-parity-layout { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 24px; width: min(100%, 1080px); margin: 0 auto; }
    .skill-parity-surface { min-width: 0; padding: 18px; border: 1px solid var(--border-soft); border-radius: 16px; background: rgb(8 10 24 / 52%); }
    .skill-parity-surface h2 { margin: 0 0 14px; }
    @media (max-width: 600px) { .skill-parity-layout { grid-template-columns: 1fr; gap: 18px; } }
  </style></head><body><main class="app-shell"><section class="skill-parity-layout">
    <article class="skill-parity-surface"><h2>Critter skill slots</h2>${grid("slot")}</article>
    <article class="skill-parity-surface"><h2>Equip skill · Slot 1</h2>${grid("popup")}</article>
  </section></main></body></html>`);
  await mkdir(outputDir, { recursive: true });

  async function inspect(name, width, height, sourceWidth) {
    await page.setViewportSize({ width, height });
    await page.evaluate((requestedWidth) => {
      const slotGrid = document.querySelector('[data-surface="slot"]');
      const popupGrid = document.querySelector('[data-surface="popup"]');
      slotGrid.style.width = requestedWidth ? `${requestedWidth}px` : "";
      slotGrid.style.maxWidth = "100%";
      popupGrid.style.width = "";
      popupGrid.style.maxWidth = "";
      popupGrid.style.width = "100%";
      popupGrid.style.maxWidth = `${slotGrid.getBoundingClientRect().width}px`;
      const compact = slotGrid.getBoundingClientRect().width <= 180;
      slotGrid.classList.toggle("compact", compact);
      popupGrid.classList.toggle("compact", compact);
    }, sourceWidth);
    const result = await page.evaluate(() => {
      const signature = (surface) => {
        const grid = document.querySelector(`[data-surface="${surface}"]`);
        const tile = grid.querySelector(".skill-tile");
        const title = tile.querySelector(".skill-title");
        const icon = title.querySelector(".asset-icon");
        const power = tile.querySelector(".skill-power");
        const mana = tile.querySelector(".skill-mana");
        const gridStyle = getComputedStyle(grid);
        const tileStyle = getComputedStyle(tile);
        const titleStyle = getComputedStyle(title);
        const powerStyle = getComputedStyle(power);
        const manaStyle = getComputedStyle(mana);
        const rect = tile.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        const powerRect = power.getBoundingClientRect();
        const nameRect = title.querySelector("strong").getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();
        const manaRect = mana.getBoundingClientRect();
        const contained = (child) => child.left >= rect.left - .1 && child.right <= rect.right + .1 && child.top >= rect.top - .1 && child.bottom <= rect.bottom + .1;
        return {
          gridWidth: gridRect.width,
          gridColumns: gridStyle.gridTemplateColumns,
          gridGap: gridStyle.gap,
          directTileWrappers: [...grid.children].every((child) => child.classList.contains("tooltip-anchor")),
          tile: {
            width: rect.width,
            height: rect.height,
            padding: tileStyle.padding,
            borderRadius: tileStyle.borderRadius,
            background: tileStyle.backgroundImage,
            columns: tileStyle.gridTemplateColumns,
            rows: tileStyle.gridTemplateRows,
          },
          title: { column: titleStyle.gridColumn, row: titleStyle.gridRow, fontSize: titleStyle.fontSize, gap: titleStyle.gap },
          icon: { width: iconRect.width, height: iconRect.height },
          power: { column: powerStyle.gridColumn, row: powerStyle.gridRow, fontSize: powerStyle.fontSize, topRight: powerRect.top < rect.top + rect.height / 2 && powerRect.right <= rect.right && rect.right - powerRect.right <= Number.parseFloat(tileStyle.paddingRight) + 2 },
          mana: { column: manaStyle.gridColumn, row: manaStyle.gridRow, fontSize: manaStyle.fontSize },
          contentsContained: [nameRect, iconRect, powerRect, manaRect].every(contained),
        };
      };
      const selectedCheck = document.querySelector('[data-surface="popup"] .skill-tile.selected .selection-check');
      const selectedTile = selectedCheck.closest(".skill-tile").getBoundingClientRect();
      const checkRect = selectedCheck.getBoundingClientRect();
      return {
        slot: signature("slot"),
        popup: signature("popup"),
        popupParentWider: document.querySelector('[data-surface="popup"]').parentElement.getBoundingClientRect().width > document.querySelector('[data-surface="slot"]').parentElement.getBoundingClientRect().width,
        selectedCheckLeftMiddle: checkRect.left < selectedTile.left && checkRect.right <= selectedTile.left + 7 && Math.abs((checkRect.top + checkRect.bottom) / 2 - (selectedTile.top + selectedTile.bottom) / 2) < 1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });

    if (JSON.stringify(result.slot) !== JSON.stringify(result.popup)) throw new Error(`${name} Skill surface mismatch:\n${JSON.stringify(result, null, 2)}`);
    if (!result.slot.directTileWrappers || result.slot.gridColumns.split(" ").length !== 2 || !result.slot.contentsContained) throw new Error(`${name} Skill grid organization failed:\n${JSON.stringify(result, null, 2)}`);
    if (result.slot.title.column !== "1" || result.slot.title.row !== "1 / 3" || result.slot.power.column !== "2" || result.slot.power.row !== "1" || !result.slot.power.topRight || result.slot.mana.column !== "2" || result.slot.mana.row !== "2") throw new Error(`${name} Skill tile organization failed:\n${JSON.stringify(result, null, 2)}`);
    if (!result.selectedCheckLeftMiddle || !result.noHorizontalOverflow) throw new Error(`${name} Skill state or overflow failed:\n${JSON.stringify(result, null, 2)}`);

    const screenshot = path.join(outputDir, `skill-parity-${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    return { name, width, height, screenshot, ...result };
  }

  const desktop = await inspect("desktop", 1200, 760);
  const mobile = await inspect("mobile", 390, 844, 155);
  if (!desktop.popupParentWider || desktop.slot.gridWidth !== desktop.popup.gridWidth) throw new Error(`Popup size handoff failed:\n${JSON.stringify(desktop, null, 2)}`);
  if (desktop.slot.tile.height <= mobile.slot.tile.height || desktop.slot.title.fontSize === mobile.slot.title.fontSize) throw new Error(`Responsive Skill scaling failed:\n${JSON.stringify({ desktop, mobile }, null, 2)}`);
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
} finally {
  await browser.close();
}
