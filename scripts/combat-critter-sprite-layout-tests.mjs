import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "output", "combat-critter-sprite-layout");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function battleUnit(opponent) {
  return `
    <article class="battle-unit${opponent ? " opponent" : ""}">
      <div class="combat-unit-top">
        <span class="combat-sprite-stack">
          <span class="combat-effect-hover-zone">
            <span class="combat-sprite-frame critter-combat-frame">
              <span class="sprite sprite-medium element-basic${opponent ? " flipped" : ""}" data-sprite-box>
                <img class="sprite-box__image" data-sprite-image alt="${opponent ? "Enemy" : "Player"} Critter" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='120' viewBox='0 0 160 120'%3E%3Crect width='160' height='120' fill='%234fe4e1'/%3E%3C/svg%3E" />
              </span>
            </span>
          </span>
        </span>
        <div class="battle-unit-info">
          <span class="combat-identity-row"><span class="critter-name">Critter</span><strong class="combat-level">Lv 10</strong><span class="mana-roll-stat">2–6</span></span>
          <div class="hp-bar"><span style="width: 80%"></span></div>
          <div class="combat-health-row"><p>100 / 100 HP</p></div>
        </div>
      </div>
      <div class="combat-action-space"></div>
    </article>`;
}

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.setContent(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><style>${styles}
        body { margin: 0; overflow: hidden; background: #080b1d; }
        .combat-screen { width: 100%; max-width: none; }
        .combat-board { width: 100%; grid-template-columns: minmax(330px, 1fr) minmax(330px, 1fr); }
      </style></head>
      <body>
        <section class="combat-screen">
          <div class="combat-board">
            <div class="battle-column player-column">${battleUnit(false)}</div>
            <div class="battle-column opponent-column">${battleUnit(true)}</div>
          </div>
        </section>
      </body>
    </html>
  `);

  const viewports = [
    { name: "wide-desktop", width: 1500, height: 900 },
    { name: "narrow-desktop", width: 1100, height: 780 },
    { name: "tablet", width: 960, height: 720 },
    { name: "small-pc-mobile-format", width: 900, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const measurements = await page.locator(".battle-unit").evaluateAll((units) => units.map((unit) => {
      const frame = unit.querySelector(".critter-combat-frame").getBoundingClientRect();
      const sprite = unit.querySelector(".sprite").getBoundingClientRect();
      const image = unit.querySelector(".sprite-box__image").getBoundingClientRect();
      const spriteStyle = getComputedStyle(unit.querySelector(".sprite"));
      const imageStyle = getComputedStyle(unit.querySelector(".sprite-box__image"));
      return {
        opponent: unit.classList.contains("opponent"),
        frame: { width: frame.width, height: frame.height },
        sprite: { width: sprite.width, height: sprite.height },
        image: { width: image.width, height: image.height },
        gridColumn: spriteStyle.gridColumn,
        gridRow: spriteStyle.gridRow,
        transform: spriteStyle.transform,
        objectFit: imageStyle.objectFit,
      };
    }));

    const player = measurements.find((measurement) => !measurement.opponent);
    const enemy = measurements.find((measurement) => measurement.opponent);
    check(player && enemy, `Both combat sides must render at ${viewport.name}.`);
    check(
      Math.abs(player.frame.width - enemy.frame.width) <= 0.01
        && Math.abs(player.frame.height - enemy.frame.height) <= 0.01
        && Math.abs(player.sprite.width - enemy.sprite.width) <= 0.01
        && Math.abs(player.sprite.height - enemy.sprite.height) <= 0.01
        && Math.abs(player.image.width - enemy.image.width) <= 0.01
        && Math.abs(player.image.height - enemy.image.height) <= 0.01,
      `Enemy Critter frame and sprite must match the player at ${viewport.name}: ${JSON.stringify(measurements)}`,
    );
    check(player.gridColumn === "auto" && player.gridRow === "auto", `Player sprite must remain an ordinary frame grid item at ${viewport.name}: ${JSON.stringify(player)}`);
    check(enemy.gridColumn === "auto" && enemy.gridRow === "auto", `Enemy sprite must not inherit the outer opponent grid placement at ${viewport.name}: ${JSON.stringify(enemy)}`);
    check(player.transform === "none", `Player Critter art must not be flipped at ${viewport.name}: ${JSON.stringify(player)}`);
    check(enemy.transform === "matrix(-1, 0, 0, 1, 0, 0)", `Enemy Critter art must be horizontally flipped at ${viewport.name}: ${JSON.stringify(enemy)}`);
    check(player.objectFit === "contain" && enemy.objectFit === "contain", `Both Critter sprites must use contained artwork at ${viewport.name}: ${JSON.stringify(measurements)}`);

    await page.screenshot({
      path: path.join(outputDir, `${viewport.name}.png`),
      animations: "disabled",
      fullPage: false,
    });
  }

  process.stdout.write("Combat Critter sprite layout checks passed.\n");
} finally {
  await browser.close();
}
