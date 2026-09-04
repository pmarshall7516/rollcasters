import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const outputDir = path.join(root, "output", "combat-panel-layout");
fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(!app.includes("combat-phase-badge"), "Combat must not render the removed phase badge.");
check(/<span className="combat-die-value">\s*<AssetIcon[\s\S]*?<strong>/.test(app), "Dicebox mana icons must render before the roll value.");
check(!app.includes('<small className="collectible-name">{opponent ? "Enemy " : ""}{unit.name}</small>'), "Enemy Diceboxes must show the critter name without the Enemy prefix.");
check(!app.includes("Array.from({ length: 5 }, (_, index) => enemyAbilities[index])"), "Enemy Rollcaster combat abilities must expose no more than three slots.");
check(!app.includes("const activeAbilitySlots = Array.from({ length: 5 }"), "User Rollcaster combat abilities must expose no more than three slots.");
check(!styles.includes("grid-template-rows: repeat(5, var(--combat-ability-row-height))"), "Combat ability rows must be capped at three.");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

try {
  await page.setContent(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><style>${styles}
        body { margin: 0; overflow: hidden; background: #080b1d; }
        .combat-screen { width: 100%; max-width: none; }
        .combat-viewport-fit { width: 100%; }
        .combat-board { width: 100%; }
        .fixture-sprite { display: block; width: 100%; height: 100%; background: #28345f; }
      </style></head>
      <body>
        <section class="combat-screen">
          <div class="combat-viewport-fit">
            <div class="combat-header"><span></span><div><h1>Combat</h1></div></div>
            <div class="combat-board">
              <aside class="combat-mana-panel rollcaster-mana-panel">
                <span class="combat-sprite-frame rollcaster-combat-frame"><span class="fixture-sprite"></span></span>
                <h3>Rollcaster</h3>
                <div class="combat-mana-total-wrap"><strong class="combat-mana-total">5</strong></div>
                <div class="combat-ability-list" aria-label="User Rollcaster abilities">
                  ${["Fortify", "Arcane Ward", "Quick Step"].map((name) => `<span class="tooltip-anchor"><span class="combat-ability-slot">${name}</span></span>`).join("")}
                </div>
                <div class="combat-squad-grid player" aria-label="User Critter squad">
                  ${Array.from({ length: 5 }, (_, index) => `<span class="combat-squad-slot ${index === 0 ? "active" : "reserve"}"><span class="fixture-sprite"></span></span>`).join("")}
                </div>
              </aside>
              <div class="battle-column player-column"><article class="battle-unit combat-empty-slot"></article><article class="battle-unit combat-empty-slot"></article><article class="battle-unit combat-empty-slot"></article></div>
              <div class="battle-column opponent-column"><article class="battle-unit combat-empty-slot opponent"></article><article class="battle-unit combat-empty-slot opponent"></article><article class="battle-unit combat-empty-slot opponent"></article></div>
              <aside class="combat-mana-panel enemy-mana-panel">
                <span class="combat-sprite-frame rollcaster-combat-frame"><span class="fixture-sprite"></span></span>
                <h3>Enemy</h3>
                <div class="combat-mana-total-wrap"><strong class="combat-mana-total">4</strong></div>
                <div class="combat-ability-list" aria-label="Enemy Rollcaster abilities">
                  ${["Hex", "Ward", "Rush"].map((name) => `<span class="tooltip-anchor"><span class="combat-ability-slot enemy">${name}</span></span>`).join("")}
                </div>
                <div class="combat-squad-grid opponent" aria-label="Enemy Critter squad">
                  ${Array.from({ length: 5 }, (_, index) => `<span class="combat-squad-slot ${index === 0 ? "active" : "reserve"}"><span class="fixture-sprite"></span></span>`).join("")}
                </div>
              </aside>
            </div>
          </div>
        </section>
        <div class="combat-presentation-fixture" aria-hidden="true" style="position:absolute;left:-10000px;top:0;width:320px;">
          <span class="combat-ability-slot">Combat ability</span>
          <div class="combat-action-space"><button type="button">Combat action</button></div>
          <strong class="combat-mana-total">5</strong>
          <span class="combat-die-value"><span class="asset-icon"></span><strong>4</strong></span>
        </div>
      </body>
    </html>
  `);

  const presentation = await page.evaluate(() => {
    const playerAbility = document.querySelector(".rollcaster-mana-panel .combat-ability-slot");
    const enemyAbility = document.querySelector(".enemy-mana-panel .combat-ability-slot");
    const action = document.querySelector(".combat-presentation-fixture .combat-action-space button");
    const mana = document.querySelector(".combat-presentation-fixture .combat-mana-total");
    const dieValue = document.querySelector(".combat-presentation-fixture .combat-die-value");
    const icon = dieValue?.querySelector(".asset-icon");
    const roll = dieValue?.querySelector("strong");
    return {
      playerAbilityFont: playerAbility ? getComputedStyle(playerAbility).fontFamily : "",
      enemyAbilityFont: enemyAbility ? getComputedStyle(enemyAbility).fontFamily : "",
      actionFont: action ? getComputedStyle(action).fontFamily : "",
      manaColor: mana ? getComputedStyle(mana).color : "",
      iconColor: icon ? getComputedStyle(icon).color : "",
      iconHeight: icon?.getBoundingClientRect().height ?? 0,
      rollFontSize: roll ? Number.parseFloat(getComputedStyle(roll).fontSize) : 0,
      iconFirst: dieValue?.firstElementChild?.classList.contains("asset-icon") ?? false,
    };
  });

  check(presentation.playerAbilityFont.includes("Georgia") && presentation.enemyAbilityFont.includes("Georgia"), `Combat ability names must use the shared display font on both sides: ${JSON.stringify(presentation)}`);
  check(presentation.actionFont.includes("Georgia"), `Combat action buttons must use the shared display font: ${JSON.stringify(presentation)}`);
  check(presentation.iconColor === presentation.manaColor, `Dicebox mana icons must match the total mana color: ${JSON.stringify(presentation)}`);
  check(Math.abs(presentation.iconHeight - presentation.rollFontSize) <= 0.5, `Dicebox mana icons must match the roll text height: ${JSON.stringify(presentation)}`);
  check(presentation.iconFirst, `Dicebox mana icons must appear before the roll value: ${JSON.stringify(presentation)}`);

  const viewports = [
    { name: "ultra-wide-desktop", width: 2560, height: 1440, expectedSquadRows: 3 },
    { name: "wide-desktop", width: 1500, height: 900, expectedSquadRows: 3 },
    { name: "narrow-desktop", width: 1100, height: 780, expectedSquadRows: 3 },
    { name: "tablet", width: 960, height: 720, expectedSquadRows: 1 },
    { name: "small-pc-mobile-format", width: 900, height: 720, expectedSquadRows: 1, expectMobileFormat: true },
    { name: "mobile", width: 390, height: 844, expectedSquadRows: 3, expectMobileFormat: true },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(50);
    const layouts = await page.locator(".combat-mana-panel").evaluateAll((panels) => panels.map((panel) => {
      const rect = panel.getBoundingClientRect();
      const ability = panel.querySelector(".combat-ability-list").getBoundingClientRect();
      const squad = panel.querySelector(".combat-squad-grid").getBoundingClientRect();
      const abilitySlots = [...panel.querySelectorAll(".combat-ability-slot")].map((slot) => {
        const slotRect = slot.getBoundingClientRect();
        return { top: slotRect.top, bottom: slotRect.bottom, left: slotRect.left, right: slotRect.right, height: slotRect.height };
      });
      const squadSlots = [...panel.querySelectorAll(".combat-squad-slot")].map((slot) => {
        const slotRect = slot.getBoundingClientRect();
        return { top: slotRect.top, bottom: slotRect.bottom, left: slotRect.left, right: slotRect.right, width: slotRect.width, height: slotRect.height };
      });
      return {
        panel: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
        ability: { top: ability.top, bottom: ability.bottom, left: ability.left, right: ability.right },
        squad: { top: squad.top, bottom: squad.bottom, left: squad.left, right: squad.right },
        abilitySlots,
        squadSlots,
        squadRows: new Set(squadSlots.map((slot) => slot.top.toFixed(2))).size,
        abilityRowHeight: abilitySlots[0]?.height ?? 0,
      };
    }));

    const documentBounds = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      headerColumns: getComputedStyle(document.querySelector(".combat-header")).gridTemplateColumns.split(" ").length,
      boardColumns: getComputedStyle(document.querySelector(".combat-board")).gridTemplateColumns.split(" ").length,
    }));

    for (const layout of layouts) {
      const abilityGap = layout.squad.top - layout.ability.bottom;
      check(abilityGap >= 3, `Squad slots must stay below ability slots at ${viewport.name}: ${JSON.stringify({ layout, abilityGap })}`);
      check(layout.abilitySlots.every((slot) => slot.height >= 24 && slot.bottom <= layout.squad.top + 0.5), `Ability slots must remain readable and above the squad at ${viewport.name}: ${JSON.stringify(layout)}`);
      check(layout.squadSlots.every((slot) => slot.left >= layout.panel.left && slot.right <= layout.panel.right && slot.bottom <= layout.panel.bottom + 0.5), `Squad slots must stay inside the Rollcaster panel at ${viewport.name}: ${JSON.stringify(layout)}`);
      check(layout.squadSlots.every((slot) => Math.abs(slot.width - slot.height) <= 1), `Squad slots must remain square at ${viewport.name}: ${JSON.stringify(layout)}`);
      check(layout.squadRows === viewport.expectedSquadRows, `Squad layout should adapt to panel width at ${viewport.name}: ${JSON.stringify(layout)}`);
    }
    if (viewport.expectMobileFormat) {
      check(documentBounds.headerColumns === 2 && documentBounds.boardColumns === 2, `Small PC combat must use the mobile header and two-column board format at ${viewport.name}: ${JSON.stringify(documentBounds)}`);
    }
    check(documentBounds.scrollWidth <= documentBounds.clientWidth, `Combat panel fixture must not create horizontal viewport overflow at ${viewport.name}: ${JSON.stringify(documentBounds)}`);

    await page.screenshot({
      path: path.join(outputDir, `${viewport.name}.png`),
      animations: "disabled",
      fullPage: false,
    });
  }

  process.stdout.write("Combat panel layout checks passed.\n");
} finally {
  await browser.close();
}
