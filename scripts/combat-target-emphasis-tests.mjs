import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const outputDir = path.join(root, "output", "combat-target-emphasis");
fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(!app.includes("Legal target"), "Combat target selection must not render the Legal target pill.");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 320 } });

try {
  await page.setContent(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><style>${styles}
        body { margin: 0; padding: 48px; background: #080b1d; }
        .combat-screen { max-width: none; }
        .battle-unit { --combat-unit-height: 216px; width: 320px; }
        .fixture-sprite { width: 100%; height: 100%; border-radius: inherit; background: #28345f; }
      </style></head>
      <body>
        <section class="combat-screen">
          <article class="battle-unit legal-target" data-combat-control="true" tabindex="0">
            <div class="combat-unit-top">
              <span class="combat-sprite-stack"><span class="combat-sprite-frame critter-combat-frame"><span class="fixture-sprite"></span></span></span>
              <div class="battle-unit-info"><span class="combat-identity-row"><span class="critter-name">Target</span></span><div class="hp-bar"><span></span></div><div class="combat-health-row"><p>40 / 40 HP</p></div></div>
            </div>
            <div class="combat-action-space"></div>
          </article>
        </section>
      </body>
    </html>
  `);

  const target = page.locator(".battle-unit");
  const readState = () => target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      boxShadow: style.boxShadow,
      animationName: style.animationName,
      outlineStyle: style.outlineStyle,
    };
  });

  const base = await readState();
  check(base.animationName === "combat-target-pulse", `Legal targets should retain the base yellow pulse: ${JSON.stringify(base)}`);
  check(base.boxShadow.includes("255, 240, 168"), `Legal targets should use the yellow glow: ${JSON.stringify(base)}`);
  await page.screenshot({ path: path.join(outputDir, "target-base.png"), animations: "disabled" });

  await target.hover();
  const hovered = await readState();
  check(hovered.animationName === "none", `Mouse hover should switch to the enhanced selected state: ${JSON.stringify(hovered)}`);
  check(hovered.boxShadow.includes("255, 240, 168") && !hovered.boxShadow.includes("167, 121, 255"), `Mouse hover should only enhance the yellow glow: ${JSON.stringify(hovered)}`);
  check(hovered.outlineStyle === "none", `Mouse hover should not add a separate outline: ${JSON.stringify(hovered)}`);
  await page.screenshot({ path: path.join(outputDir, "target-hover.png"), animations: "disabled" });

  await target.evaluate((element) => element.classList.add("combat-keyboard-focused"));
  const focused = await readState();
  check(focused.animationName === "none", `Keyboard focus should use the enhanced selected state: ${JSON.stringify(focused)}`);
  check(focused.boxShadow.includes("255, 240, 168") && !focused.boxShadow.includes("167, 121, 255"), `Keyboard focus should only enhance the yellow glow: ${JSON.stringify(focused)}`);
  check(focused.outlineStyle === "none", `Keyboard focus should not add a separate outline: ${JSON.stringify(focused)}`);
  await page.screenshot({ path: path.join(outputDir, "target-keyboard-focused.png"), animations: "disabled" });

  process.stdout.write(`${JSON.stringify({ base, hovered, focused })}\n`);
} finally {
  await browser.close();
}
