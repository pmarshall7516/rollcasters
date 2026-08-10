import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const outputDir = path.join(root, "output", "combat-action-layout");
fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 382, height: 119 } });

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
            <div class="combat-header"><span></span><div><h1>Combat</h1></div><span></span></div>
            <div class="combat-board">
              <aside class="combat-mana-panel rollcaster-mana-panel"></aside>
              <div class="battle-column player-column">
                <article class="battle-unit combat-unit-interactive">
                  <div class="combat-unit-top">
                    <span class="combat-sprite-stack"><span class="combat-effect-hover-zone"><span class="combat-sprite-frame critter-combat-frame"><span class="fixture-sprite"></span></span></span></span>
                    <div class="battle-unit-info"><span class="combat-identity-row"><span class="critter-name">Glimbit</span><strong>Lv 1</strong></span><div class="hp-bar"><span></span></div><div class="combat-health-row"><p>44 / 44 HP</p></div></div>
                  </div>
                  <div class="combat-action-space">
                    <div class="combat-primary-actions">
                      <button>Skill</button><button>Block</button><button>Swap</button><button>Skip</button>
                    </div>
                  </div>
                </article>
                <article class="battle-unit combat-empty-slot"></article>
                <article class="battle-unit combat-empty-slot"></article>
              </div>
              <div class="battle-column opponent-column"><article class="battle-unit combat-empty-slot"></article><article class="battle-unit combat-empty-slot"></article><article class="battle-unit combat-empty-slot"></article></div>
              <aside class="combat-mana-panel enemy-mana-panel"></aside>
            </div>
          </div>
        </section>
      </body>
    </html>
  `);

  const layout = await page.evaluate(() => {
    const space = document.querySelector(".combat-action-space").getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".combat-primary-actions > button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    return { space: { top: space.top, bottom: space.bottom, height: space.height }, buttons };
  });

  const firstRowBottom = Math.max(layout.buttons[0].bottom, layout.buttons[1].bottom);
  const secondRowTop = Math.min(layout.buttons[2].top, layout.buttons[3].top);
  check(layout.space.height >= 44, `The active action area must retain its anchored height: ${JSON.stringify(layout)}`);
  check(layout.buttons.every((button) => button.height >= 20), `Primary action buttons must remain readable: ${JSON.stringify(layout)}`);
  check(secondRowTop >= firstRowBottom, `Primary action rows must not overlap: ${JSON.stringify(layout)}`);
  check(secondRowTop - layout.buttons[0].top >= 18, `Primary action rows must stay visibly separated: ${JSON.stringify(layout)}`);
  await page.screenshot({ path: path.join(outputDir, "primary.png"), animations: "disabled", fullPage: true });

  const skills = await page.evaluate(() => {
    const space = document.querySelector(".combat-action-space");
    space.innerHTML = `
      <button class="combat-back-row">‹ Back to Action Menu</button>
      <div class="combat-skill-actions">
        ${["Slam", "-----", "-----", "-----"].map((label) => `<span class="tooltip-anchor"><button class="skill-tile">${label}</button></span>`).join("")}
      </div>
    `;
    const buttons = [...space.querySelectorAll(".combat-skill-actions .skill-tile")].map((button) => {
      const rect = button.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    });
    return { buttons };
  });
  const skillFirstRowBottom = Math.max(skills.buttons[0].bottom, skills.buttons[1].bottom);
  const skillSecondRowTop = Math.min(skills.buttons[2].top, skills.buttons[3].top);
  check(skillSecondRowTop >= skillFirstRowBottom, `Skill action rows must not overlap: ${JSON.stringify(skills)}`);
  check(
    Math.abs(skills.buttons[0].top - layout.buttons[0].top) <= 1,
    `Primary actions must stay anchored to the same action row as skills: ${JSON.stringify({ layout, skills })}`,
  );
  await page.screenshot({ path: path.join(outputDir, "skills.png"), animations: "disabled", fullPage: true });

  process.stdout.write(`${JSON.stringify({ layout, skills })}\n`);
} finally {
  await browser.close();
}
