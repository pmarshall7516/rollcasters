import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const outputDir = path.join(root, "output", "combat-mana-selection");
fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(
  app.includes("const displayedPlayerMana = selectingActions ? Math.max(0, battle.playerMana - totalCost) : battle.playerMana;"),
  "The player combat Mana display must subtract queued action costs only during action selection.",
);
check(app.includes("setManaSubmitAnimating(true);"), "Submitting a complete action set must start the Mana animation.");
check(app.includes("manaReserved && !manaSubmitting"), "The reserved Mana color must give way to the submit animation.");
check(app.includes("if (!manaSubmitAnimating || combat.phase === \"select_player_actions\") return;"), "Submit blue state must persist while the combat turn is loading.");
check(!app.includes("setManaSubmitAnimating(false), 900"), "Submit blue state must not time out before the combat phase advances.");
check(!styles.includes("@keyframes combat-mana-submit-color"), "Submit must not fade the Mana color through yellow again.");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 560, height: 260 } });

try {
  await page.setContent(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><style>${styles}
        body { margin: 0; padding: 40px; background: #080b1d; }
        .combat-screen { max-width: none; }
        .combat-mana-panel { width: 180px; height: auto; }
      </style></head>
      <body>
        <section class="combat-screen">
          <aside class="combat-mana-panel rollcaster-mana-panel">
            <div class="combat-mana-total-wrap">
              <strong class="combat-mana-total mana-reserved" aria-label="Player Mana: 3 remaining">
                <span class="combat-mana-value">3</span>
              </strong>
            </div>
          </aside>
        </section>
      </body>
    </html>
  `);

  const reserved = await page.locator(".combat-mana-total").evaluate((element) => {
    const value = element.querySelector(".combat-mana-value");
    return {
      label: element.getAttribute("aria-label"),
      color: value ? getComputedStyle(value).color : "",
      animation: getComputedStyle(element).animationName,
    };
  });
  check(reserved.label === "Player Mana: 3 remaining", `Reserved Mana must expose its remaining-balance label: ${JSON.stringify(reserved)}`);
  check(reserved.color === "rgb(255, 240, 168)", `Reserved Mana must be yellow before submit: ${JSON.stringify(reserved)}`);
  check(reserved.animation === "none", `Reserved Mana must not shake before submit: ${JSON.stringify(reserved)}`);
  await page.screenshot({ path: path.join(outputDir, "reserved.png"), animations: "disabled" });

  await page.locator(".combat-mana-total").evaluate((element) => element.classList.add("mana-submit-shake"));
  const submitting = await page.locator(".combat-mana-total").evaluate((element) => {
    const value = element.querySelector(".combat-mana-value");
    return {
      shake: getComputedStyle(element).animationName,
      valueAnimation: value ? getComputedStyle(value).animationName : "",
      color: value ? getComputedStyle(value).color : "",
    };
  });
  check(submitting.shake === "combat-mana-submit-shake", `Submit must shake the Mana total: ${JSON.stringify(submitting)}`);
  check(submitting.valueAnimation === "none", `Submit must switch the Mana color without a second animation: ${JSON.stringify(submitting)}`);
  check(submitting.color === "rgb(79, 228, 225)", `Submit must switch the Mana value directly back to blue: ${JSON.stringify(submitting)}`);
  await page.screenshot({ path: path.join(outputDir, "submit-shake.png"), fullPage: false });

  await page.waitForTimeout(950);
  const settled = await page.locator(".combat-mana-total").evaluate((element) => {
    const value = element.querySelector(".combat-mana-value");
    return {
      color: value ? getComputedStyle(value).color : "",
      transform: getComputedStyle(element).transform,
    };
  });
  check(settled.color === "rgb(79, 228, 225)", `The submitted Mana value must fade back to blue: ${JSON.stringify(settled)}`);
  check(
    settled.transform === "none" || settled.transform === "matrix(1, 0, 0, 1, 0, 0)",
    `The Mana shake must settle back to its resting position: ${JSON.stringify(settled)}`,
  );
  await page.screenshot({ path: path.join(outputDir, "submit-settled.png"), animations: "disabled" });

  process.stdout.write(`${JSON.stringify({ reserved, submitting, settled })}\n`);
} finally {
  await browser.close();
}
