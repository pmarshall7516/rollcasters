import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(root, "output", "combat-swap-ui");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

fs.mkdirSync(outputDir, { recursive: true });

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.setContent(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          ${styles}
          body {
            min-height: 100vh;
            margin: 0;
            padding: 32px;
            overflow: hidden;
            background: #080b1d;
          }
          .swap-fixture {
            width: min(1180px, calc(100vw - 64px));
            margin: 0 auto;
          }
          .swap-fixture .combat-screen {
            --combat-unit-height: 216px;
            --combat-sprite-size: 78px;
            height: auto;
          }
          .swap-fixture .combat-board {
            grid-template-columns: 180px minmax(0, 1fr) minmax(0, 1fr) 180px;
            grid-template-rows: auto;
            gap: 14px;
          }
          .swap-fixture .combat-mana-panel {
            min-height: 690px;
          }
          .swap-fixture .battle-column {
            grid-template-rows: repeat(3, 216px);
            gap: 14px;
          }
          .swap-fixture .combat-empty-slot {
            opacity: .34;
          }
          .fixture-sprite {
            display: grid;
            width: 100%;
            height: 100%;
            place-items: center;
            border-radius: inherit;
            background: radial-gradient(circle, #7de8ff 0 18%, #7451d8 20% 48%, #171d3d 50%);
            color: white;
            font: 900 20px/1 sans-serif;
          }
          .swap-fixture .combat-narration {
            margin-top: 14px;
          }
        </style>
      </head>
      <body>
        <main class="swap-fixture">
          <section class="combat-screen">
            <div class="combat-viewport-fit">
              <div class="combat-header">
                <span></span>
                <div><p class="eyebrow">Swap playback fixture</p><h1>Moonlit Hollow</h1><p>Encounter 1 / 2 · Turn 2 · 1v1</p></div>
                <span class="combat-phase-badge">event playback</span>
              </div>
              <div class="combat-board">
                <aside class="combat-mana-panel rollcaster-mana-panel">
                  <span class="combat-sprite-frame rollcaster-combat-frame"><span class="fixture-sprite">RC</span></span>
                  <h3>Roland</h3>
                  <strong class="combat-mana-total">Mana 7</strong>
                </aside>
                <div class="battle-column player-column">
                  <article class="battle-unit combat-empty-slot" aria-label="Inactive player slot"></article>
                  <article class="battle-unit" data-combat-unit-key="outgoing">
                    <div class="combat-unit-top">
                      <span class="combat-sprite-stack">
                        <span class="combat-sprite-frame critter-combat-frame"><span class="fixture-sprite">OUT</span></span>
                      </span>
                      <div class="battle-unit-info">
                        <span class="combat-identity-row"><span class="critter-name">Ramber</span><strong class="combat-level">Lv 12</strong><span class="mana-roll-stat">2–6</span></span>
                        <div class="hp-bar healthy" role="progressbar" aria-label="Ramber health" aria-valuemin="0" aria-valuemax="142" aria-valuenow="118"><span style="width:83%"></span></div>
                        <p>118 / 142 HP</p>
                      </div>
                    </div>
                    <div class="combat-action-space"><span></span><span class="combat-action-summary">Swapping to Cragram</span></div>
                  </article>
                  <article class="battle-unit combat-empty-slot" aria-label="Inactive player slot"></article>
                </div>
                <div class="battle-column opponent-column">
                  <article class="battle-unit combat-empty-slot opponent"></article>
                  <article class="battle-unit opponent">
                    <div class="combat-unit-top">
                      <span class="combat-sprite-stack"><span class="combat-sprite-frame critter-combat-frame"><span class="fixture-sprite">FOE</span></span></span>
                      <div class="battle-unit-info"><span class="combat-identity-row"><span class="critter-name">Emberling</span><strong>Lv 10</strong></span><div class="hp-bar healthy"><span style="width:91%"></span></div><p>91 / 100 HP</p></div>
                    </div>
                    <div class="combat-action-space"><span></span><span class="combat-action-summary">Enemy intent hidden</span></div>
                  </article>
                  <article class="battle-unit combat-empty-slot opponent"></article>
                </div>
                <aside class="combat-mana-panel enemy-mana-panel"><span class="enemy-mana-emblem">☠</span><h3>Enemy Mana</h3><strong class="combat-mana-total">Mana 4</strong></aside>
              </div>
              <button class="combat-narration advanceable" disabled><span>Ramber swapped with Cragram.</span><span>›</span></button>
            </div>
          </section>
        </main>
      </body>
    </html>
  `);

  const motion = await page.evaluate(() => {
    const unit = document.querySelector("[data-combat-unit-key='outgoing']");
    const source = unit.querySelector(".critter-combat-frame").getBoundingClientRect();
    const destination = document.querySelector(".rollcaster-combat-frame").getBoundingClientRect();
    const x = destination.left + destination.width / 2 - (source.left + source.width / 2);
    const y = destination.top + destination.height / 2 - (source.top + source.height / 2);
    unit.style.setProperty("--combat-swap-x", `${x}px`);
    unit.style.setProperty("--combat-swap-y", `${y}px`);
    unit.classList.add("swapping-out");
    window.swapVisualState = "outgoing";
    window.setTimeout(() => {
      unit.classList.remove("swapping-out");
      unit.classList.add("swapping-in");
      unit.dataset.combatUnitKey = "incoming";
      unit.querySelector(".fixture-sprite").textContent = "IN";
      unit.querySelector(".critter-name").textContent = "Cragram";
      unit.querySelector(".combat-level").textContent = "Lv 11";
      unit.querySelector(".mana-roll-stat").textContent = "1–7";
      const hp = unit.querySelector("[role='progressbar']");
      hp.setAttribute("aria-label", "Cragram health");
      hp.setAttribute("aria-valuemax", "136");
      hp.setAttribute("aria-valuenow", "136");
      hp.querySelector("span").style.width = "100%";
      unit.querySelector(".battle-unit-info > p").textContent = "136 / 136 HP";
      unit.querySelector(".combat-action-summary").textContent = "Swap complete";
      window.swapVisualState = "incoming";
    }, 720);
    window.setTimeout(() => {
      document.querySelector(".combat-narration").disabled = false;
      window.swapVisualState = "settled";
    }, 1180);
    return { x, y, distance: Math.hypot(x, y) };
  });

  check(motion.distance > 100, `The fixture needs a meaningful Rollcaster-directed travel vector: ${JSON.stringify(motion)}`);
  await page.waitForTimeout(470);
  const outgoing = await page.evaluate(() => {
    const unit = document.querySelector(".battle-unit.swapping-out");
    const stack = unit?.querySelector(".combat-sprite-stack");
    return {
      animationName: stack ? getComputedStyle(stack).animationName : "",
      transform: stack ? getComputedStyle(stack).transform : "",
      narrationDisabled: document.querySelector(".combat-narration").disabled,
      visualState: window.swapVisualState,
    };
  });
  check(
    outgoing.visualState === "outgoing"
      && outgoing.animationName === "combat-swap-to-rollcaster"
      && outgoing.transform !== "none"
      && outgoing.narrationDisabled,
    `Outgoing playback must animate toward the Rollcaster while narration is locked: ${JSON.stringify(outgoing)}`,
  );
  await page.screenshot({
    path: path.join(outputDir, "swap-outgoing.png"),
    animations: "allow",
    fullPage: false,
  });

  await page.waitForFunction(() => window.swapVisualState === "incoming");
  await page.waitForTimeout(220);
  const incoming = await page.evaluate(() => {
    const unit = document.querySelector("[data-combat-unit-key='incoming']");
    const hp = unit?.querySelector("[role='progressbar']");
    return {
      name: unit?.querySelector(".critter-name")?.textContent,
      level: unit?.querySelector(".combat-level")?.textContent,
      manaRange: unit?.querySelector(".mana-roll-stat")?.textContent,
      hpLabel: hp?.getAttribute("aria-label"),
      hpNow: hp?.getAttribute("aria-valuenow"),
      hpMax: hp?.getAttribute("aria-valuemax"),
      narrationDisabled: document.querySelector(".combat-narration").disabled,
      revealAnimation: unit ? getComputedStyle(unit).animationName : "",
    };
  });
  check(
    incoming.name === "Cragram"
      && incoming.level === "Lv 11"
      && incoming.manaRange === "1–7"
      && incoming.hpLabel === "Cragram health"
      && incoming.hpNow === "136"
      && incoming.hpMax === "136"
      && incoming.narrationDisabled
      && incoming.revealAnimation === "combat-swap-slot-reveal",
    `Incoming playback must show complete slot information before narration unlocks: ${JSON.stringify(incoming)}`,
  );
  await page.screenshot({
    path: path.join(outputDir, "swap-incoming.png"),
    animations: "allow",
    fullPage: false,
  });

  await page.waitForFunction(() => window.swapVisualState === "settled");
  check(await page.locator(".combat-narration").isEnabled(), "Combat narration must unlock only after the incoming reveal settles.");

  process.stdout.write(`${JSON.stringify({ motion, outgoing, incoming })}\n`);
} finally {
  await browser.close();
}
