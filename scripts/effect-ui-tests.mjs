import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "effect-ui");
const screenshot = path.join(outputDir, "status-and-owner-tooltips.png");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");

function icon(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="${color}"/><text x="32" y="39" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="24" font-weight="900">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const toxic = icon("T", "#5b9c55");
const dazed = icon("D", "#8a61d8");
const critter = icon("C", "#3d9ca5");
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setContent(`<!doctype html><html><head><style>${css}</style><style>
    body { padding: 230px 220px 70px; background: #080b1d; color: #f7f3ff; }
    main { display: grid; gap: 60px; }
    .battlefield { width: 560px; grid-template-columns: 1fr; }
    .battle-unit { width: 520px; }
    .preview-art { position: absolute; inset: 5px; width: calc(100% - 10px); height: calc(100% - 10px); object-fit: contain; }
    .owner-tooltip-grid { display: grid; grid-template-columns: repeat(3, 250px); gap: 20px; }
    .preview-owner { min-height: 84px; padding: 14px; border: 1px solid var(--border-soft); border-radius: 12px; background: #151b36; color: #fff; }
    .owner-tooltip-grid .game-tooltip { opacity: 1; visibility: visible; position: relative; left: auto; bottom: auto; width: 100%; margin-top: 10px; transform: none; }
  </style></head><body><main>
    <section class="battlefield"><div class="battle-column"><article class="battle-unit">
      <span class="combat-sprite-stack">
        <span class="combat-sprite-frame critter-combat-frame"><span class="sprite"><img class="preview-art" src="${critter}" alt="Bloomling"></span></span>
        <span class="status-icon-row" aria-label="Active statuses">
          <span class="tooltip-anchor" tabindex="0" data-status="toxic"><span class="status-icon"><span class="asset-icon"><img class="asset-icon__image" src="${toxic}" alt="Toxic"></span><small>2</small></span><span class="game-tooltip"><span class="tooltip-heading"><strong>Toxic</strong></span><span class="tooltip-description"><strong>Poison:</strong> Deals 8% maximum HP damage at the end of each turn.</span><span class="status-duration">2 turns remaining</span></span></span>
          <span class="tooltip-anchor" tabindex="0" data-status="dazed"><span class="status-icon"><span class="asset-icon"><img class="asset-icon__image" src="${dazed}" alt="Dazed"></span><small>∞</small></span><span class="game-tooltip"><span class="tooltip-heading"><strong>Dazed</strong></span><span class="tooltip-description"><strong>Stagger:</strong> Has a 30% chance to skip any combat action.</span><span class="status-duration">Indefinite</span></span></span>
        </span>
      </span>
      <div class="battle-unit-info"><span class="critter-name"><strong>Bloomling</strong></span><p>Lv 8 / Mana 2–6: 4</p><div class="hp-bar"><span style="width:72%"></span></div><p>72 / 100 HP</p></div>
    </article></div></section>
    <section class="owner-tooltip-grid" aria-label="Owner effect tooltips">
      <span class="tooltip-anchor"><button class="preview-owner">Skill: Vampire Bite</button><span class="game-tooltip"><span class="tooltip-heading"><strong>Vampire Bite - Attack - 55 Power</strong></span><span class="tooltip-description">Bite one enemy and drain its strength.</span><span class="tooltip-description"><strong>Vampire:</strong> Restores 25% of damage actually dealt.</span></span></span>
      <span class="tooltip-anchor"><button class="preview-owner">Ability: High Roller</button><span class="game-tooltip"><span class="tooltip-heading"><strong>High Roller</strong></span><span class="tooltip-description">Improves compatible Mana.</span><span class="tooltip-description"><strong>Loaded Dice:</strong> Bloom friendlies gain +2 minimum and +3 maximum.</span></span></span>
      <span class="tooltip-anchor"><button class="preview-owner">Relic: Expanded Pouch</button><span class="game-tooltip"><span class="tooltip-heading"><strong>Expanded Pouch</strong></span><span class="tooltip-description">A surprisingly roomy enchanted pouch.</span><span class="tooltip-description"><strong>Extra Dice:</strong> Equipped allies gain -1 minimum and +5 maximum.</span></span></span>
    </section>
  </main></body></html>`);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));

  const geometry = await page.evaluate(() => {
    const frame = document.querySelector(".critter-combat-frame").getBoundingClientRect();
    const row = document.querySelector(".status-icon-row").getBoundingClientRect();
    const icons = [...document.querySelectorAll("[data-status]")].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.status, left: rect.left, right: rect.right };
    });
    return { frame: { top: frame.top, right: frame.right }, row: { top: row.top, right: row.right }, icons };
  });
  if (!(geometry.row.top < geometry.frame.top && geometry.row.right >= geometry.frame.right)) {
    throw new Error(`Status icons are not anchored above the combat sprite's top-right corner: ${JSON.stringify(geometry)}`);
  }
  if (!(geometry.icons[0].right < geometry.icons[1].left)) {
    throw new Error(`Status icons overlap or are not consistently ordered: ${JSON.stringify(geometry.icons)}`);
  }
  const statusNames = await page.locator("[data-status]").evaluateAll((nodes) => nodes.map((node) => node.dataset.status));
  if (statusNames.join(",") !== "toxic,dazed") throw new Error(`Unexpected Status icon order: ${statusNames.join(",")}`);

  await page.locator("[data-status='toxic']").focus();
  await page.waitForTimeout(650);
  const statusTooltipState = await page.locator("[data-status='toxic'] .game-tooltip").evaluate((node) => {
    const style = getComputedStyle(node);
    return { visibility: style.visibility, opacity: style.opacity, display: style.display, active: document.activeElement?.getAttribute("data-status") };
  });
  const statusTooltipVisible = statusTooltipState.visibility === "visible" && Number(statusTooltipState.opacity) > 0.9;
  if (!statusTooltipVisible) throw new Error(`The focused Status icon did not expose its tooltip: ${JSON.stringify(statusTooltipState)}`);
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ screenshot, geometry, statusNames, statusTooltipVisible }));
} finally {
  await browser.close();
}
