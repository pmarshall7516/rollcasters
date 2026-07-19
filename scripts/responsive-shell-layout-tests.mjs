import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "responsive-shell-layout");
const [css, appSource] = await Promise.all([
  readFile(path.join(root, "src", "styles.css"), "utf8"),
  readFile(path.join(root, "src", "App.tsx"), "utf8"),
]);
const logo = await readFile(path.join(root, "src", "assets", "rollcasters-logo.png"));
const logoUrl = "https://rollcasters.test/rollcasters-logo.png";

const unit = (opponent = false) => `<article class="battle-unit ${opponent ? "opponent" : ""}">
  ${opponent ? "" : '<span class="combat-sprite-frame critter-combat-frame"><span class="sprite"></span></span>'}
  <div class="battle-unit-info"><span class="critter-name"><strong>${opponent ? "Rival" : "Toxichick"}</strong></span><p>Lv 3 / Mana 2–6: 4</p><div class="hp-bar"><span style="width:72%"></span></div></div>
  ${opponent ? '<span class="combat-sprite-frame critter-combat-frame"><span class="sprite"></span></span>' : ""}
</article>`;

const combatHtml = `<!doctype html><html><head><style>${css}</style></head><body><main class="app-shell">
  <header class="top-bar currency-rich">
    <div class="refresh-indicator" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 1-15.2 6.5L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.2 5.5L21 8"/><path d="M21 3v5h-5"/></svg><span>Refreshing</span><span class="sr-only"> game data</span></div>
    <button class="brand-home-button" aria-label="Rollcasters home"><span class="brand-lockup"><img class="brand-logo signed-in" src="${logoUrl}" alt="Rollcasters"></span></button>
    <div class="account-cluster">
      <div class="currency-cluster" aria-label="Currency balances">
        <span class="coin-pill currency-pill" data-currency-id="coins" style="color:#FFD65A">◆ <span>999</span></span>
        <span class="coin-pill currency-pill" data-currency-id="prismite" style="color:#7DE8FF">♦ <span>14</span></span>
        <span class="coin-pill currency-pill" data-currency-id="moonstone" style="color:#C6A8FF">● <span>7</span></span>
        <span class="coin-pill currency-pill" data-currency-id="embers" style="color:#FF9B62">✦ <span>2</span></span>
      </div>
      <span class="user-pill">Player</span>
      <button class="icon-button">×</button>
    </div>
  </header>
  <section class="combat-screen">
    <header class="combat-header"><h1>Dungeon Battle</h1><div class="mana-readout"><span>Mana 8</span><span>Turn 3</span></div></header>
    <div class="battlefield">
      <aside class="battle-rollcaster"><span class="combat-sprite-frame rollcaster-combat-frame"><span class="sprite"></span></span><p>Shanks</p></aside>
      <div class="battle-column">${unit()}${unit()}</div>
      <div class="battle-column opponent-column">${unit(true)}${unit(true)}</div>
    </div>
    <div class="turn-panel"><div class="selection-summary"><span>Attack selected</span></div><button class="primary-button">Continue</button></div>
    <div class="combat-log"><p>Toxichick used Venom Peck.</p></div>
  </section>
</main></body></html>`;

const outcomeHeader = `<header class="top-bar">
  <button class="brand-home-button" aria-label="Rollcasters home"><span class="brand-lockup"><img class="brand-logo signed-in" src="${logoUrl}" alt="Rollcasters"></span></button>
  <div class="account-cluster">
    <div class="currency-cluster" aria-label="Currency balances">
      <span class="coin-pill currency-pill" data-currency-id="coins" style="color:#FFD65A">◆ <span>999</span></span>
      <span class="coin-pill currency-pill" data-currency-id="prismite" style="color:#7DE8FF">♦ <span>14</span></span>
    </div>
    <span class="user-pill">Player</span>
    <button class="icon-button">×</button>
  </div>
</header>`;

const homeHeaderHtml = `<!doctype html><html><head><style>${css}</style></head><body><main class="app-shell">
  ${outcomeHeader}
</main></body></html>`;

const outcomeXpCards = ["Shanks", "Chance", "Spreagle", "Cragram"].map((name, index) => `<article class="combat-xp-card ${index === 0 ? "rollcaster" : ""}">
  <span class="sprite-frame sprite-frame-sm"><span class="sprite"></span></span>
  <div class="combat-xp-card-copy">
    <span class="combat-xp-identity"><strong>${name}</strong><small>Lv 2</small></span>
    <div class="combat-xp-bar xp-bar"><span style="width:${25 + index * 15}%"></span></div>
    <span class="combat-xp-values"><small>20 / 100 XP</small><strong>No XP gained</strong></span>
  </div>
</article>`).join("");

const outcomeHtml = `<!doctype html><html><head><style>${css}</style></head><body><main class="app-shell combat-shell">
  ${outcomeHeader}
  <section class="combat-screen dungeon-outcome-screen failure">
    <div class="dungeon-outcome-emblem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="9" r="7"/><path d="M9 14v4m6-4v4M9 9h.01M15 9h.01"/></svg></div>
    <p class="eyebrow">Expedition failed</p>
    <h1>Your squad has fallen.</h1>
    <p>Rewards from defeated opponents are saved. Retrying starts a fresh run at full HP.</p>
    <div class="dungeon-outcome-rewards">
      <section><h2>Final Encounter</h2><p class="dungeon-no-drops">No encounter drops were earned.</p></section>
    </div>
    <section class="combat-xp-section" aria-label="Party experience">
      <div class="combat-xp-heading"><h3>Party XP</h3></div>
      <div class="combat-xp-grid">${outcomeXpCards}</div>
    </section>
    <div class="dungeon-outcome-actions"><button class="secondary-button">Back to Home</button><button class="primary-button">Retry Dungeon</button></div>
  </section>
</main></body></html>`;

const modalHtml = `<!doctype html><html><head><style>${css}</style></head><body><main class="app-shell">
  <div class="modal-backdrop"><section class="modal">
    <div class="modal-header"><div><h2>Choose a Critter</h2><p>Choose an eligible item for this loadout slot.</p></div><button class="icon-button">×</button></div>
    <div class="candidate-grid">${Array.from({ length: 8 }, (_, index) => `<button class="candidate-card"><span class="sprite-frame sprite-frame-md"><span class="sprite"></span></span><strong>Critter ${index + 1}</strong><span>Level ${index + 1}</span></button>`).join("")}</div>
  </section></div>
</main></body></html>`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.route(logoUrl, (route) => route.fulfill({ status: 200, contentType: "image/png", body: logo }));
  await mkdir(outputDir, { recursive: true });
  const viewports = [
    { name: "wide", width: 1920, height: 1080 },
    { name: "ipad-landscape", width: 1024, height: 768 },
    { name: "ipad-portrait", width: 820, height: 1180 },
    { name: "mobile", width: 390, height: 844 },
  ];

  const combatResults = [];
  await page.setContent(combatHtml);
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      const top = rect(".top-bar");
      const screen = rect(".combat-screen");
      const brand = rect(".brand-home-button");
      const account = rect(".account-cluster");
      const refresh = rect(".refresh-indicator");
      const logo = document.querySelector(".brand-logo");
      const refreshLabel = document.querySelector(".refresh-indicator > span:not(.sr-only)");
      const refreshIconStyle = getComputedStyle(document.querySelector(".refresh-indicator svg"));
      const currencyPills = [...document.querySelectorAll(".currency-pill")];
      const overlaps = (left, right) => left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
      return {
        top,
        screen,
        battlefieldColumns: getComputedStyle(document.querySelector(".battlefield")).gridTemplateColumns.split(" ").length,
        rollcasterVisible: getComputedStyle(document.querySelector(".battle-rollcaster")).display !== "none",
        headerItemsSeparate: !overlaps(brand, account),
        refreshSeparate: !overlaps(refresh, brand) && !overlaps(refresh, account),
        accountBelowBrand: account.top >= brand.bottom,
        refreshOnBrandRow: Math.abs((refresh.top + refresh.bottom) / 2 - (brand.top + brand.bottom) / 2) < 1,
        refreshAnimated: refreshIconStyle.animationName === "refresh-spin" && refreshIconStyle.animationIterationCount === "infinite",
        refreshLabelVisible: getComputedStyle(refreshLabel).display !== "none",
        refreshStatusText: document.querySelector(".refresh-indicator").textContent.trim().replace(/\s+/g, " "),
        imageLogoVisible: logo instanceof HTMLImageElement && logo.complete && logo.naturalWidth > 0 && logo.getBoundingClientRect().width > 0,
        imageLogoUnfiltered: logo instanceof HTMLImageElement && getComputedStyle(logo).filter === "none",
        textFallbackAbsent: document.querySelector(".brand-logo-fallback") === null,
        currencyIds: currencyPills.map((pill) => pill.dataset.currencyId),
        currencyColors: currencyPills.map((pill) => getComputedStyle(pill).color),
        currencyClusterScrollSafe: document.querySelector(".currency-cluster").scrollWidth >= document.querySelector(".currency-cluster").clientWidth,
        matchingShellEdges: Math.abs(top.left - screen.left) < .1 && Math.abs(top.right - screen.right) < .1,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    const screenshot = path.join(outputDir, `combat-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    combatResults.push({ ...viewport, screenshot, ...metrics });
  }

  const combatFailures = combatResults.filter((result) => {
    const expectedColumns = result.width > 960 ? 3 : 1;
    const expectedRollcaster = result.width > 960;
    const expectedRefreshLabel = result.width > 600;
    const fillsViewport = result.screen.left <= Math.max(52, result.width * .03);
    const currenciesCorrect = result.currencyIds.join(",") === "coins,prismite,moonstone,embers" &&
      result.currencyColors.join(",") === "rgb(255, 214, 90),rgb(125, 232, 255),rgb(198, 168, 255),rgb(255, 155, 98)";
    return !(result.battlefieldColumns === expectedColumns && result.rollcasterVisible === expectedRollcaster && result.headerItemsSeparate && result.refreshSeparate && result.accountBelowBrand && result.refreshOnBrandRow && result.refreshAnimated && result.refreshLabelVisible === expectedRefreshLabel && result.refreshStatusText === "Refreshing game data" && result.imageLogoVisible && result.imageLogoUnfiltered && result.textFallbackAbsent && currenciesCorrect && result.currencyClusterScrollSafe && result.matchingShellEdges && fillsViewport && result.noHorizontalOverflow);
  });

  const modalResults = [];
  await page.setContent(modalHtml);
  for (const viewport of viewports.slice(1)) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const metrics = await page.evaluate(() => {
      const modal = document.querySelector(".modal").getBoundingClientRect();
      return {
        modal: { left: modal.left, right: modal.right, top: modal.top, bottom: modal.bottom, width: modal.width, height: modal.height },
        columns: getComputedStyle(document.querySelector(".candidate-grid")).gridTemplateColumns.split(" ").length,
        withinViewport: modal.left >= 0 && modal.top >= 0 && modal.right <= window.innerWidth && modal.bottom <= window.innerHeight,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    const screenshot = path.join(outputDir, `modal-${viewport.name}.png`);
    await page.screenshot({ path: screenshot });
    modalResults.push({ ...viewport, screenshot, ...metrics });
  }

  const modalFailures = modalResults.filter((result) => !(result.withinViewport && result.noHorizontalOverflow && result.columns >= 1));
  const outcomeResults = [];
  const outcomeViewports = [
    { name: "desktop", width: 1330, height: 1236 },
    { name: "mobile", width: 390, height: 844 },
  ];
  for (const viewport of outcomeViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.setContent(homeHeaderHtml);
    await page.waitForFunction(() => document.querySelector(".brand-logo")?.complete);
    const homeLogo = await page.locator(".brand-logo").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    await page.setContent(outcomeHtml);
    await page.waitForFunction(() => document.querySelector(".brand-logo")?.complete);
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector(".dungeon-outcome-screen").getBoundingClientRect();
      const logo = document.querySelector(".brand-logo").getBoundingClientRect();
      const title = document.querySelector(".dungeon-outcome-screen h1").getBoundingClientRect();
      const reward = document.querySelector(".dungeon-outcome-rewards > section").getBoundingClientRect();
      const actions = document.querySelector(".dungeon-outcome-actions").getBoundingClientRect();
      return {
        panel: { top: panel.top, bottom: panel.bottom, width: panel.width, height: panel.height },
        logo: { width: logo.width, height: logo.height },
        titleFontSize: Number.parseFloat(getComputedStyle(document.querySelector(".dungeon-outcome-screen h1")).fontSize),
        titleContained: title.left >= panel.left && title.right <= panel.right,
        rewardWidth: reward.width,
        rewardCenterDelta: Math.abs((reward.left + reward.width / 2) - (panel.left + panel.width / 2)),
        bottomInset: panel.bottom - actions.bottom,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      };
    });
    const screenshot = path.join(outputDir, `dungeon-failure-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: false, animations: "disabled" });
    outcomeResults.push({ ...viewport, screenshot, homeLogo, ...metrics });
  }

  const outcomeFailures = outcomeResults.filter((result) => !(
    Math.abs(result.logo.width - result.homeLogo.width) < .1
      && Math.abs(result.logo.height - result.homeLogo.height) < .1
      && result.titleFontSize <= 46
      && result.titleContained
      && result.rewardWidth <= 620.1
      && result.rewardCenterDelta < .6
      && result.bottomInset <= 36
      && result.noHorizontalOverflow
  ));
  const failures = [
    ...combatFailures.map((result) => ({ surface: "combat", ...result })),
    ...modalFailures.map((result) => ({ surface: "modal", ...result })),
    ...outcomeFailures.map((result) => ({ surface: "dungeon-outcome", ...result })),
  ];
  if (/\{loading\s*&&\s*<div\s+className="notice"/.test(appSource)) {
    failures.push({ surface: "app", issue: "Page-width loading notice is still rendered." });
  }
  if (failures.length) throw new Error(`Responsive shell layout failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(JSON.stringify({ combat: combatResults, modals: modalResults, outcomes: outcomeResults }, null, 2));
} finally {
  await browser.close();
}
