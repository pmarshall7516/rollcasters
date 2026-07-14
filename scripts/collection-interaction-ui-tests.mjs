import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "collection-interaction-ui");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const skill = (name, classes = "", disabled = false) => `<button class="skill-tile ${classes}" ${disabled ? "disabled" : ""}><span class="skill-title"><strong>${name}</strong></span><span class="skill-power">PWR 50</span><span class="skill-mana">3</span>${classes.includes("equipped") ? '<span class="selection-check">✓</span>' : ""}</button>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${css}.ui-test-layout{display:grid;grid-template-columns:1fr 1fr;gap:22px}.ui-test-layout h3{margin:18px 0 8px}</style></head><body>
    <main class="app-shell">
      <div class="modal ui-test-modal">
        <div class="modal-header"><div><p class="eyebrow">Loadout & collection</p><h2>Ramber</h2><p>Item details</p></div><button class="icon-button">×</button></div>
        <section class="ui-test-layout">
          <div>
            <h3>Skills</h3>
            <div class="mini-grid">
              <div class="detail-tile unlocked">${skill("Slam", "read-only")}<span class="unlock-requirement">Unlock level 1 · 0 points</span></div>
              <div class="detail-tile locked unlockable">${skill("Headbutt", "read-only")}<span class="unlock-requirement">Unlock level 3 · 2 points</span><button class="primary-button skill-unlock-button">Unlock · 2</button></div>
              <div class="detail-tile locked level-locked">${skill("Fire Rush", "read-only")}<span class="unlock-requirement">Unlock level 5 · 4 points</span></div>
            </div>
            <h3>Abilities</h3>
            <div class="mini-grid">
              <div class="detail-ability-tile unlocked"><article class="detail-ability-card unlocked"><span class="detail-ability-heading"><strong>Sharpen</strong></span><span>Each Critter gains ATK.</span><span class="effect-list"><span class="effect-list-row"><strong>Sharpen Squad:</strong> Each Critter gains +3 ATK.</span></span></article><span class="unlock-requirement">Unlock level 1 · 0 ability points</span></div>
              <div class="detail-ability-tile locked"><article class="detail-ability-card locked"><span class="detail-ability-heading"><strong>Harden</strong></span><span>Each Critter gains DEF.</span></article><span class="unlock-requirement">Unlock level 3 · 2 ability points</span></div>
            </div>
          </div>
          <div class="loadout-slot">
            <h3>Equipped Skills</h3>
            <div class="dialog-skill-grid">
              ${skill("Slam", "selected equipped")}
              ${skill("Headbutt", "equipped", true)}
              ${skill("Fire Rush")}
            </div>
            <h3>Equipped Ability</h3>
            <button class="ability-candidate selected equipped"><span><strong>Sharpen</strong><small>Equipped in this slot; select again to remove.</small></span><span>✓</span></button>
            <h3>Calculated Stats</h3>
            <div class="stat-grid compact">
              <span class="stat-cell">HP <strong>30</strong></span>
              <span class="stat-cell modified" tabindex="0">ATK <strong class="negative">24</strong><span class="game-tooltip stat-breakdown"><span class="stat-breakdown-line"><span>25 (Base)</span><strong class="negative"> -1 (Heavy Charm)</strong></span></span></span>
              <span class="stat-cell modified def-stat" tabindex="0">DEF <strong class="mixed">21</strong><span class="game-tooltip stat-breakdown"><span class="stat-breakdown-line"><span>20 (Base)</span><strong class="positive"> +3 (Guard Charm)</strong><strong class="negative"> -2 (Risky Ward)</strong></span></span></span>
              <span class="stat-cell">SPD <strong>15</strong></span>
              <span class="stat-cell modified mana-dice-stat" tabindex="0">Mana Dice <strong><span>1</span>–<span class="positive">9</span></strong><span class="game-tooltip stat-breakdown"><span class="stat-breakdown-line"><strong>Maximum: </strong><span>6 (Base)</span><strong class="positive"> +3 (High Roll)</strong></span></span></span>
              <span class="stat-cell">Block <strong>2</strong></span><span class="stat-cell">Swap <strong>2</strong></span><span class="stat-cell">Relics <strong>1</strong></span>
            </div>
            <h3>Relic Effects</h3>
            <span class="effect-list effect-summary"><span class="effect-list-row"><strong>Minor Hardening:</strong> Equipped Critter gains +5 DEF.</span><span class="effect-list-row"><strong>Steady Guard:</strong> Reduces incoming damage.</span></span>
          </div>
        </section>
        <div style="height:260px" aria-hidden="true"></div>
      </div>
    </main>
  </body></html>`);
  await mkdir(outputDir, { recursive: true });
  await page.locator(".def-stat").focus();
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const modal = document.querySelector(".ui-test-modal");
    const unlockable = document.querySelector(".detail-tile.unlockable");
    const unlockButton = document.querySelector(".skill-unlock-button");
    const unlockRect = unlockable.querySelector(".skill-tile").getBoundingClientRect();
    const buttonRect = unlockButton.getBoundingClientRect();
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return {
      modal: { width: modal.getBoundingClientRect().width, height: modal.getBoundingClientRect().height, scrollable: modal.scrollHeight > modal.clientHeight, scrollbarWidth: getComputedStyle(modal).scrollbarWidth },
      unlockedSkillOpacity: Number(style(".detail-tile.unlocked .skill-tile").opacity),
      unlockButtonOpaque: Number(getComputedStyle(unlockButton).opacity) === 1,
      unlockButtonCentered: Math.abs((buttonRect.left + buttonRect.width / 2) - (unlockRect.left + unlockRect.width / 2)) < 1 && Math.abs((buttonRect.top + buttonRect.height / 2) - (unlockRect.top + unlockRect.height / 2)) < 1,
      selectedSkillBorder: style(".skill-tile.selected").borderColor,
      selectedAbilityBorder: style(".ability-candidate.selected").borderColor,
      tooltipVisible: style(".def-stat > .stat-breakdown").visibility === "visible" && Number(style(".def-stat > .stat-breakdown").opacity) === 1,
      activeClass: document.activeElement?.className,
      focusMatches: document.querySelector(".def-stat").matches(":focus"),
      tones: { positive: style(".mana-dice-stat .positive").color, negative: style(".stat-cell .negative").color, mixed: style(".stat-cell .mixed").color },
      uniformHomeStatBorders: style(".loadout-slot .stat-cell:not(.modified)").borderColor === style(".loadout-slot .stat-cell.modified").borderColor,
      effectRowsNamed: [...document.querySelectorAll(".effect-summary .effect-list-row")].every((row) => row.firstElementChild?.tagName === "STRONG" && !row.textContent.startsWith("Effect:")),
      abilityRequirementsBelowCards: [...document.querySelectorAll(".detail-ability-tile")].every((tile) => {
        const cardRect = tile.querySelector(".detail-ability-card").getBoundingClientRect();
        const requirementRect = tile.querySelector(".unlock-requirement").getBoundingClientRect();
        return requirementRect.top >= cardRect.bottom && requirementRect.width > 0;
      }),
    };
  });

  if (result.modal.width !== 900 || result.modal.height !== 760 || !result.modal.scrollable || result.modal.scrollbarWidth !== "none") throw new Error(`Modal pane contract failed: ${JSON.stringify(result.modal)}`);
  if (result.unlockedSkillOpacity !== 1 || !result.unlockButtonOpaque || !result.unlockButtonCentered) throw new Error(`Skill detail presentation failed: ${JSON.stringify(result)}`);
  if (!result.tooltipVisible || !result.effectRowsNamed || !result.abilityRequirementsBelowCards || !result.uniformHomeStatBorders) throw new Error(`Tooltip, effect rows, ability metadata, or stat borders failed: ${JSON.stringify(result)}`);

  const screenshot = path.join(outputDir, "skills-abilities-stats-modal.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ screenshot, ...result }, null, 2));
} finally {
  await browser.close();
}
