import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "output", "collection-layout");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const cardState = (content, showScrollbar = false, scrollable = false) => `<div class="collection-card-state ${showScrollbar ? "with-scrollbar" : ""}"><div class="collection-card-state-scroll">${content}</div>${showScrollbar ? `<span class="collection-card-scrollbar" role="scrollbar" aria-label="Scroll collectible challenges" aria-disabled="${!scrollable}"><span class="collection-card-scrollbar-thumb" style="height:${scrollable ? "28px" : "100%"};transform:translateY(0)"></span></span>` : ""}</div>`;
const card = (id, name) => {
  const owned = id === "004" || id === "005" || id === "009";
  const unlockable = name === "Critter" ? Number(id) % 4 !== 0 : Number(id) % 2 === 0;
  const challengeCount = name === "Critter" && id === "002" ? 8 : 1;
  const challengeState = unlockable
    ? `<div class="challenge-rows compact">${Array.from({ length: challengeCount }, (_, index) => {
      const firstBlockedIndex = challengeCount > 1 ? 2 : -1;
      const blocked = firstBlockedIndex >= 0 && index >= firstBlockedIndex;
      const boundary = index === firstBlockedIndex ? '<div class="challenge-gate-boundary"><span class="gate-blocked">Complete all above challenges first</span></div>' : "";
      return `${boundary}<div class="challenge-row ${blocked ? "blocked" : ""}"><span class="challenge-row-description">Complete unlock challenge ${index + 1} with wrapping copy</span><strong>${index} / 10</strong>${blocked ? "" : `<button class="grid-challenge-track" aria-pressed="${index === 0}">${index === 0 ? "Untrack" : "Track"}</button>`}</div>`;
    }).join("")}</div>`
    : '<p class="collection-status challenge-empty">Not currently unlockable</p>';
  const progression = name === "Critter"
    ? cardState(owned
      ? '<div class="collection-progression critter-progression"><p>Level 2</p><div class="xp-progress"><div class="xp-bar"><span style="width:20%"></span></div><p>20 / 100 XP</p></div></div>'
      : challengeState, !owned, !owned && challengeCount > 1)
    : name === "Rollcaster"
      ? cardState(`<div class="collection-progression">${owned ? '<p>Level 1</p>' : '<p class="collection-status">Locked</p>'}<div class="xp-progress"><div class="xp-bar"><span style="width:0%"></span></div><p>0 / 120 XP</p></div></div>`, !owned)
      : cardState(owned ? '<p>Owned 1 / 5</p>' : challengeState, !owned);
  return `
  <article class="catalog-card ${name.toLowerCase()}-card ${owned ? "" : `locked ${name === "Critter" ? "challenge-locked" : ""}`}" data-state="${owned ? "owned" : unlockable ? "unlockable" : "not-unlockable"}">
    <button class="catalog-card-details" aria-label="View ${name} details">⌕</button>
    <span class="collectible-id">${id}</span>
    <span class="card-sprite-frame ${name === "Rollcaster" ? "rollcaster-sprite-frame" : ""}"><span class="sprite"></span></span>
    <span class="card-name-row"><strong>${name}</strong></span>
    ${progression}
    ${name === "Critter" ? `<div class="stat-grid compact">
      <span class="stat-cell"><span class="stat-label">HP</span><strong>120</strong></span><span class="stat-cell"><span class="stat-label">ATK</span><strong>24</strong></span><span class="stat-cell"><span class="stat-label">DEF</span><strong>18</strong></span><span class="stat-cell"><span class="stat-label">SPD</span><strong>16</strong></span>
      <span class="stat-cell mana-dice-stat"><span class="stat-label">Mana</span><strong>10–12</strong></span><span class="stat-cell"><span class="stat-label">Block</span><strong>2</strong></span><span class="stat-cell"><span class="stat-label">Swap</span><strong>3</strong></span><span class="stat-cell"><span class="stat-label">Relics</span><strong>2</strong></span>
    </div><p class="point-counter"><strong>${owned ? 1 : 0}</strong> skill points</p>` : name === "Rollcaster" ? `<p class="point-counter"><strong>0</strong> ability points</p>` : `<span class="effect-list relic-card-effects"><span class="effect-list-row"><strong>Harden:</strong> Increases DEF by 10%.</span><span class="effect-list-row"><strong>Steady:</strong> Prevents one point of loss.</span></span>`}
  </article>`;
};

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 }, deviceScaleFactor: 1 });
  const cards = Array.from({ length: 9 }, (_, index) => card(String(index + 1).padStart(3, "0"), ["Rollcaster", "Critter", "Relic"][index % 3])).join("");
  const tabCards = {
    rollcasters: Array.from({ length: 3 }, (_, index) => card(String(index + 1).padStart(3, "0"), "Rollcaster")).join(""),
    critters: Array.from({ length: 9 }, (_, index) => card(String(index + 1).padStart(3, "0"), "Critter")).join(""),
    relics: Array.from({ length: 4 }, (_, index) => card(String(index + 1).padStart(3, "0"), "Relic")).join(""),
  };
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
    <main class="app-shell collection-shell">
      <header class="top-bar"><span>Rollcasters</span></header>
      <section class="screen-stack collection-screen">
        <div class="screen-heading row"><div><h1>Collection</h1><p>Review owned and locked game pieces.</p></div><button>Back</button></div>
        <div class="tabs"><button>Rollcasters</button><button class="active">Critters</button><button>Relics</button></div>
        <div class="collection-tools">
          <label class="collection-search"><input placeholder="Search critters by name or ID"></label>
          <div class="collection-filter-slot"></div>
        </div>
        <div class="collection-grid-content"><div class="collection-grid">${cards}</div></div>
      </section>
    </main>
  </body></html>`);
  await mkdir(outputDir, { recursive: true });

  async function inspect(name, width, height) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { document.querySelector(".collection-filter-slot").innerHTML = ""; });
    const beforeFilter = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return [value.left, value.top, value.width, value.height];
      };
      return { heading: rect(".screen-heading"), tabs: rect(".tabs"), tools: rect(".collection-tools"), search: rect(".collection-search"), content: rect(".collection-grid-content") };
    });
    await page.evaluate(() => {
      document.querySelector(".collection-filter-slot").innerHTML = '<details class="element-filter"><summary>Ember</summary></details>';
      document.querySelector(".collection-search input").placeholder = "Search critters by name or ID";
    });
    const result = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".collection-grid .catalog-card")];
      const mana = [...document.querySelectorAll(".mana-dice-stat")];
      const effects = [...document.querySelectorAll(".relic-card-effects")];
      const statuses = [...document.querySelectorAll(".collection-status")];
      const points = [...document.querySelectorAll(".point-counter")];
      const detailActions = [...document.querySelectorAll(".catalog-card-details")];
      const trackActions = [...document.querySelectorAll(".grid-challenge-track")];
      const challengeAlignments = [...document.querySelectorAll(".challenge-row")].map((entry) => {
        const description = entry.querySelector(".challenge-row-description").getBoundingClientRect();
        const progress = entry.querySelector(":scope > strong").getBoundingClientRect();
        const action = entry.querySelector(".grid-challenge-track")?.getBoundingClientRect();
        return {
          descriptionProgressCenterOffset: Math.abs((description.top + description.height / 2) - (progress.top + progress.height / 2)),
          descriptionActionCenterOffset: action ? Math.abs((description.top + description.height / 2) - (action.top + action.height / 2)) : null,
          actionLeftOfProgress: !action || action.right <= progress.left,
        };
      });
      const challengeBoundaries = [...document.querySelectorAll(".challenge-gate-boundary")].map((entry) => {
        const rect = entry.getBoundingClientRect();
        const previous = entry.previousElementSibling?.getBoundingClientRect();
        const next = entry.nextElementSibling?.getBoundingClientRect();
        return {
          text: entry.textContent.trim(),
          previousIsChallenge: entry.previousElementSibling?.classList.contains("challenge-row"),
          nextIsBlockedChallenge: entry.nextElementSibling?.matches(".challenge-row.blocked"),
          followsPrevious: !previous || previous.bottom <= rect.top + .5,
          precedesNext: Boolean(next && rect.bottom <= next.top + .5),
        };
      });
      const critterStatOffsets = [...document.querySelectorAll(".critter-card")].map((entry) => entry.querySelector(".stat-grid").getBoundingClientRect().top - entry.getBoundingClientRect().top);
      const critterStatWidths = [...document.querySelectorAll(".critter-card")].map((entry) => [...entry.querySelectorAll(".stat-grid > span")].map((cell) => cell.getBoundingClientRect().width));
      const relicEffectOffsets = [...document.querySelectorAll(".relic-card")].map((entry) => entry.querySelector(".effect-list-row").getBoundingClientRect().top - entry.getBoundingClientRect().top);
      const critterSpacing = [...document.querySelectorAll(".critter-card")].map((entry) => {
        const cardRect = entry.getBoundingClientRect();
        const stateRect = entry.querySelector(".collection-card-state").getBoundingClientRect();
        const statsRect = entry.querySelector(".stat-grid").getBoundingClientRect();
        const pointsRect = entry.querySelector(".point-counter").getBoundingClientRect();
        return {
          stateToStats: statsRect.top - stateRect.bottom,
          statsToPoints: pointsRect.top - statsRect.bottom,
          pointsToBottom: cardRect.bottom - pointsRect.bottom,
        };
      });
      const challengePanes = [...document.querySelectorAll(".critter-card.challenge-locked .collection-card-state")].map((state) => {
        const entry = state.querySelector(".collection-card-state-scroll");
        const scrollbar = state.querySelector(".collection-card-scrollbar");
        const thumb = state.querySelector(".collection-card-scrollbar-thumb");
        const initialScrollTop = entry.scrollTop;
        entry.scrollTop = entry.scrollHeight;
        const finalScrollTop = entry.scrollTop;
        entry.scrollTop = initialScrollTop;
        const stateRect = state.getBoundingClientRect();
        const scrollbarRect = scrollbar?.getBoundingClientRect();
        const thumbRect = thumb?.getBoundingClientRect();
        const progressValues = [...entry.querySelectorAll(".challenge-row > strong")];
        return {
          challengeCount: entry.querySelectorAll(".challenge-row").length,
          clientHeight: entry.clientHeight,
          scrollHeight: entry.scrollHeight,
          scrollable: entry.scrollHeight > entry.clientHeight && finalScrollTop > 0,
          nativeScrollbarHidden: getComputedStyle(entry).scrollbarWidth === "none" && getComputedStyle(entry, "::-webkit-scrollbar").display === "none",
          customScrollbarCount: scrollbar ? 1 : 0,
          scrollbarWidth: scrollbarRect?.width ?? 0,
          scrollbarHeight: scrollbarRect?.height ?? 0,
          thumbWidth: thumbRect?.width ?? 0,
          thumbHeight: thumbRect?.height ?? 0,
          thumbRadius: thumb ? getComputedStyle(thumb).borderRadius : null,
          thumbRightGap: thumbRect ? stateRect.right - thumbRect.right : null,
          thumbWithinPane: Boolean(thumbRect && thumbRect.top >= stateRect.top && thumbRect.bottom <= stateRect.bottom),
          progressRightGap: progressValues.length ? Math.min(...progressValues.map((value) => stateRect.right - value.getBoundingClientRect().right)) : null,
          overflowX: getComputedStyle(entry).overflowX,
          overflowY: getComputedStyle(entry).overflowY,
        };
      });
      const lockedScrollbarStates = [...document.querySelectorAll(".catalog-card.locked .collection-card-state")].map((state) => {
        const pane = state.querySelector(".collection-card-state-scroll");
        const scrollbar = state.querySelector(".collection-card-scrollbar");
        const thumb = state.querySelector(".collection-card-scrollbar-thumb");
        const scrollbarRect = scrollbar?.getBoundingClientRect();
        const thumbRect = thumb?.getBoundingClientRect();
        const scrollable = pane.scrollHeight > pane.clientHeight;
        return {
          scrollable,
          scrollbarCount: scrollbar ? 1 : 0,
          scrollbarWidth: scrollbarRect?.width ?? 0,
          thumbWidth: thumbRect?.width ?? 0,
          thumbHeight: thumbRect?.height ?? 0,
          trackHeight: scrollbarRect?.height ?? 0,
          fullThumb: Boolean(thumbRect && scrollbarRect && Math.abs(thumbRect.height - scrollbarRect.height) < .5),
          ariaDisabled: scrollbar?.getAttribute("aria-disabled"),
        };
      });
      const ownedScrollbarCount = document.querySelectorAll(".catalog-card:not(.locked) .collection-card-scrollbar").length;
      const grid = document.querySelector(".collection-grid");
      const content = document.querySelector(".collection-grid-content");
      const gridStyle = getComputedStyle(grid);
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return [value.left, value.top, value.width, value.height];
      };
      return {
        anchors: { heading: rect(".screen-heading"), tabs: rect(".tabs"), tools: rect(".collection-tools"), search: rect(".collection-search"), content: rect(".collection-grid-content") },
        cards: cards.map((entry) => {
          const rect = entry.getBoundingClientRect();
          const sprite = entry.querySelector(".card-sprite-frame").getBoundingClientRect();
          const style = getComputedStyle(entry);
          const contentWidth = rect.width
            - Number.parseFloat(style.borderLeftWidth)
            - Number.parseFloat(style.borderRightWidth)
            - Number.parseFloat(style.paddingLeft)
            - Number.parseFloat(style.paddingRight);
          const childrenFit = [...entry.children].every((child) => {
            const childRect = child.getBoundingClientRect();
            return childRect.left >= rect.left - .5 && childRect.right <= rect.right + .5 && childRect.top >= rect.top - .5 && childRect.bottom <= rect.bottom + .5;
          });
          return {
            type: [...entry.classList].find((name) => name.endsWith("-card") && name !== "catalog-card"),
            width: rect.width,
            height: rect.height,
            contentWidth,
            spriteWidth: sprite.width,
            spriteHeight: sprite.height,
            nameSize: Number.parseFloat(getComputedStyle(entry.querySelector(".card-name-row")).fontSize),
            contentFits: childrenFit && entry.scrollWidth <= entry.clientWidth && entry.scrollHeight <= entry.clientHeight,
          };
        }),
        documentScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
        noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        gridColumns: gridStyle.gridTemplateColumns.split(" ").length,
        gridColumnGap: Number.parseFloat(gridStyle.columnGap),
        nestedGridScrollable:
          content.scrollHeight > content.clientHeight &&
          ["auto", "scroll"].includes(getComputedStyle(content).overflowY),
        mana: mana.map((entry) => ({
          text: entry.textContent.trim(),
          fits: entry.scrollWidth <= entry.clientWidth,
          clientWidth: entry.clientWidth,
          scrollWidth: entry.scrollWidth,
          fontSize: Number.parseFloat(getComputedStyle(entry).fontSize),
          gap: Number.parseFloat(getComputedStyle(entry).gap),
          justifyContent: getComputedStyle(entry).justifyContent,
          whiteSpace: getComputedStyle(entry).whiteSpace,
          valueLines: entry.querySelector("strong").getClientRects().length,
          labelOffset: entry.querySelector(".stat-label").getBoundingClientRect().left - entry.getBoundingClientRect().left,
          valueOffset: entry.getBoundingClientRect().right - entry.querySelector("strong").getBoundingClientRect().right,
        })),
        effects: effects.map((entry) => ({
          text: entry.textContent.trim(),
          visible: entry.getBoundingClientRect().height > 0 && entry.scrollHeight <= entry.clientHeight,
          namedRows: [...entry.querySelectorAll(".effect-list-row")].every((row) => row.firstElementChild?.tagName === "STRONG"),
        })),
        pointCount: points.length,
        pointsVisible: points.every((entry) => entry.getBoundingClientRect().bottom <= entry.closest(".catalog-card").getBoundingClientRect().bottom),
        critterStatOffsets,
        critterStatWidths,
        relicEffectOffsets,
        critterSpacing,
        challengePanes,
        lockedScrollbarStates,
        ownedScrollbarCount,
        cardsAreArticles: cards.every((entry) => entry.tagName === "ARTICLE"),
        nestedButtonCount: document.querySelectorAll("button button").length,
        detailActions: detailActions.map((entry) => ({
          label: entry.getAttribute("aria-label"),
          width: entry.getBoundingClientRect().width,
          height: entry.getBoundingClientRect().height,
          fits: entry.getBoundingClientRect().right <= entry.closest(".catalog-card").getBoundingClientRect().right,
        })),
        trackActions: trackActions.map((entry) => ({
          descriptionCenter: (() => {
            const description = entry.closest(".challenge-row").querySelector(".challenge-row-description").getBoundingClientRect();
            return description.top + description.height / 2;
          })(),
          progressLeft: entry.closest(".challenge-row").querySelector(":scope > strong").getBoundingClientRect().left,
          text: entry.textContent.trim(),
          pressed: entry.getAttribute("aria-pressed"),
          center: entry.getBoundingClientRect().top + entry.getBoundingClientRect().height / 2,
          right: entry.getBoundingClientRect().right,
          width: entry.getBoundingClientRect().width,
          height: entry.getBoundingClientRect().height,
          labelFits: entry.scrollWidth <= entry.clientWidth,
          whiteSpace: getComputedStyle(entry).whiteSpace,
          backgroundColor: getComputedStyle(entry).backgroundColor,
          textColor: getComputedStyle(entry).color,
          fits: entry.getBoundingClientRect().right <= entry.closest(".collection-card-state").getBoundingClientRect().right + .5,
        })),
        challengeAlignments,
        challengeBoundaries,
        stableScrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter.includes("stable"),
        statuses: statuses.map((entry) => ({
          align: getComputedStyle(entry).textAlign,
          transform: getComputedStyle(entry).textTransform,
          weight: Number(getComputedStyle(entry).fontWeight),
        })),
      };
    });
    result.tabLayouts = {};
    for (const [tab, markup] of Object.entries(tabCards)) {
      await page.locator(".collection-grid").evaluate((grid, html) => { grid.innerHTML = html; }, markup);
      result.tabLayouts[tab] = await page.evaluate(() => {
        const grid = document.querySelector(".collection-grid");
        const gridRect = grid.getBoundingClientRect();
        const cards = [...grid.querySelectorAll(".catalog-card")].map((entry) => {
          const rect = entry.getBoundingClientRect();
          return { left: rect.left, width: rect.width, height: rect.height };
        });
        return {
          grid: { left: gridRect.left, right: gridRect.right, width: gridRect.width },
          columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          cards,
        };
      });
    }
    await page.locator(".collection-grid").evaluate((grid, html) => { grid.innerHTML = html; }, cards);
    const stressedChallengeState = page.locator('.critter-card:has(> .collectible-id:text-is("002")) .collection-card-state');
    const stressedChallengePane = stressedChallengeState.locator(".collection-card-state-scroll");
    await stressedChallengeState.evaluate((state) => {
      const pane = state.querySelector(".collection-card-state-scroll");
      const thumb = state.querySelector(".collection-card-scrollbar-thumb");
      const syncThumb = () => {
        const trackHeight = Math.max(0, pane.clientHeight - 4);
        const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
        const thumbHeight = Math.min(trackHeight, Math.max(22, trackHeight * pane.clientHeight / pane.scrollHeight));
        const thumbTravel = Math.max(0, trackHeight - thumbHeight);
        thumb.style.height = `${thumbHeight}px`;
        thumb.style.transform = `translateY(${maxScroll > 0 ? thumbTravel * pane.scrollTop / maxScroll : 0}px)`;
      };
      pane.addEventListener("scroll", syncThumb);
      syncThumb();
    });
    await stressedChallengePane.hover();
    await page.mouse.wheel(0, 180);
    await page.waitForTimeout(120);
    result.challengeWheelScrollTop = await stressedChallengePane.evaluate((entry) => entry.scrollTop);
    if (name === "reference" || name === "mobile") {
      result.scrolledChallengeScreenshot = path.join(outputDir, `challenge-pane-scrolled-${name}.png`);
      await stressedChallengePane.evaluate((entry) => { entry.scrollTop = entry.scrollHeight; });
      await page.waitForTimeout(120);
      await stressedChallengeState.screenshot({ path: result.scrolledChallengeScreenshot });
    }
    await stressedChallengePane.evaluate((entry) => { entry.scrollTop = 0; });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    result.pageScrollY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => window.scrollTo(0, 0));
    const screenshot = path.join(outputDir, `collection-layout-${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    return { name, screenshot, beforeFilter, ...result };
  }

  const viewports = [
    await inspect("reference", 2022, 873),
    await inspect("wide", 1920, 1080),
    await inspect("desktop", 1180, 720),
    await inspect("ipad-landscape", 1024, 768),
    await inspect("ipad-portrait", 820, 1180),
    await inspect("mobile", 360, 720),
  ];
  const failures = viewports.flatMap((viewport) => {
    const [firstCard, ...otherCards] = viewport.cards;
    const sameCards = otherCards.every((entry) => Math.abs(entry.width - firstCard.width) < 0.1 && Math.abs(entry.height - firstCard.height) < 0.1);
    const clamp = (minimum, value, maximum) => Math.min(maximum, Math.max(minimum, value));
    const expectedSpriteWidth = ({ reference: 212.31, wide: 201.6, mobile: 165.6 })[viewport.name] ?? 190;
    const uniformSpriteBoxes = viewport.cards.every((entry) =>
      Math.abs(entry.spriteWidth - firstCard.spriteWidth) < .1
      && Math.abs(entry.spriteHeight - firstCard.spriteHeight) < .1
      && Math.abs(entry.spriteWidth - entry.spriteHeight) < .1
    );
    const expectedCardHeight = viewport.anchors.content[2] - 4 <= 319
      ? (viewport.anchors.content[2] - 4) * 500 / 320
      : 500;
    const responsiveCards = viewport.cards.every((entry) =>
      Math.abs(entry.height - expectedCardHeight) < .1 &&
      Math.abs(entry.nameSize - (entry.contentWidth <= 319 ? entry.contentWidth * 18 / 320 : clamp(18, entry.contentWidth * .05, 22))) < .1 &&
      Math.abs(entry.spriteWidth - expectedSpriteWidth) < .1 &&
      entry.contentFits
    );
    const maximumManaEdgeOffset = viewport.name === "mobile" ? 10 : 6;
    const manaFits = viewport.mana.every((entry) => entry.text === "Mana10–12" && entry.fits && entry.fontSize >= (viewport.name === "mobile" ? 10 : 12) && entry.gap >= 4 && entry.justifyContent === "space-between" && entry.labelOffset >= 3 && entry.labelOffset <= maximumManaEdgeOffset && entry.valueOffset >= 0 && entry.valueOffset <= maximumManaEdgeOffset && entry.whiteSpace === "nowrap" && entry.valueLines === 1);
    const effectsVisible = viewport.effects.length === 3 && viewport.effects.every((entry) => entry.visible && entry.namedRows && !entry.text.startsWith("Effect:"));
    const pointCountersVisible = viewport.pointCount === 6 && viewport.pointsVisible;
    const critterStatsAligned = viewport.critterStatOffsets.every((offset) => Math.abs(offset - viewport.critterStatOffsets[0]) < 0.1);
    const critterStatsEqualWidth = viewport.critterStatWidths.every((widths) => widths.every((width) => Math.abs(width - widths[0]) < .1));
    const relicEffectsAligned = viewport.relicEffectOffsets.every((offset) => Math.abs(offset - viewport.relicEffectOffsets[0]) < 0.1);
    const minimumGap = viewport.name === "mobile" ? 10 : 13;
    const critterSpacingMatches = viewport.critterSpacing.every((spacing) => spacing.stateToStats >= minimumGap && spacing.statsToPoints >= minimumGap && spacing.pointsToBottom >= 0);
    const stressedChallengePane = viewport.challengePanes.find((pane) => pane.challengeCount === 8);
    const nonScrollableChallengePanes = viewport.challengePanes.filter((pane) => pane !== stressedChallengePane);
    const challengePaneMatches = Boolean(stressedChallengePane?.scrollable && stressedChallengePane.nativeScrollbarHidden && stressedChallengePane.customScrollbarCount === 1 && stressedChallengePane.scrollbarWidth === 10 && stressedChallengePane.scrollbarHeight > 0 && stressedChallengePane.thumbWidth === 4 && stressedChallengePane.thumbHeight >= 22 && stressedChallengePane.thumbHeight < stressedChallengePane.scrollbarHeight && stressedChallengePane.thumbRadius === "999px" && stressedChallengePane.thumbRightGap === 0 && stressedChallengePane.thumbWithinPane && stressedChallengePane.progressRightGap >= 10 && stressedChallengePane.overflowX === "hidden" && stressedChallengePane.overflowY === "auto" && viewport.challengeWheelScrollTop > 0 && nonScrollableChallengePanes.every((pane) => !pane.scrollable && pane.customScrollbarCount === 1 && Math.abs(pane.thumbHeight - pane.scrollbarHeight) < .5));
    const lockedScrollbarMatches = viewport.lockedScrollbarStates.length > 0 && viewport.ownedScrollbarCount === 0 && viewport.lockedScrollbarStates.every((entry) => entry.scrollbarCount === 1 && entry.scrollbarWidth === 10 && entry.thumbWidth === 4 && (entry.scrollable ? !entry.fullThumb && entry.ariaDisabled === "false" : entry.fullThumb && entry.ariaDisabled === "true"));
    const cardActionsMatch = viewport.cardsAreArticles && viewport.nestedButtonCount === 0 && viewport.detailActions.length === viewport.cards.length && viewport.detailActions.every((entry) => entry.label?.startsWith("View ") && entry.width === 28 && entry.height === 28 && entry.fits) && viewport.trackActions.length >= 3 && viewport.trackActions.some((entry) => entry.text === "Track" && entry.pressed === "false" && entry.backgroundColor === "rgb(203, 183, 255)") && viewport.trackActions.some((entry) => entry.text === "Untrack" && entry.pressed === "true" && entry.backgroundColor === "rgb(218, 203, 255)") && viewport.trackActions.every((entry) => entry.width === 60 && entry.height === 20 && entry.labelFits && entry.whiteSpace === "nowrap" && entry.textColor === (entry.pressed === "true" ? "rgb(32, 21, 55)" : "rgb(37, 18, 63)") && Math.abs(entry.center - entry.descriptionCenter) < .5 && entry.right <= entry.progressLeft && entry.fits);
    const challengeAlignmentMatches = viewport.challengeAlignments.length >= 8 && viewport.challengeAlignments.every((entry) => entry.descriptionProgressCenterOffset < .5 && (entry.descriptionActionCenterOffset === null || entry.descriptionActionCenterOffset < .5) && entry.actionLeftOfProgress);
    const challengeBoundaryMatches = viewport.challengeBoundaries.length === 1 && viewport.challengeBoundaries.every((entry) => entry.text === "Complete all above challenges first" && entry.previousIsChallenge && entry.nextIsBlockedChallenge && entry.followsPrevious && entry.precedesNext);
    const statusesMatch = viewport.statuses.every((entry) => entry.align === "center" && entry.transform === "uppercase" && entry.weight >= 700);
    const anchorsStable = JSON.stringify(viewport.beforeFilter) === JSON.stringify(viewport.anchors);
    const expectedColumns = { reference: 4, wide: 4, desktop: 3, "ipad-landscape": 2, "ipad-portrait": 2, mobile: 1 }[viewport.name];
    const tabEntries = Object.values(viewport.tabLayouts);
    const referenceColumns = viewport.tabLayouts.critters.cards;
    const tabCardsMatch = tabEntries.every((layout) => layout.columns === expectedColumns && layout.cards.every((entry) => Math.abs(entry.width - firstCard.width) < .1 && Math.abs(entry.height - firstCard.height) < .1));
    const gridEdgesMatch = tabEntries.every((layout) => JSON.stringify(layout.grid) === JSON.stringify(tabEntries[0].grid));
    const columnEdgesMatch = tabEntries.every((layout) => layout.cards.slice(0, expectedColumns).every((entry, index) => Math.abs(entry.left - referenceColumns[index].left) < .1));
    const fillsViewport = viewport.anchors.heading[0] <= Math.max(52, viewport.anchors.heading[2] * .03);
    const availableTrackWidth = expectedColumns === 1
      ? Math.min(viewport.anchors.content[2] - 4, 520)
      : (viewport.anchors.content[2] - 4 - (expectedColumns - 1) * 12) / expectedColumns;
    const tracksFillWidth = Math.abs(firstCard.width - availableTrackWidth) < 1;
    const minimumCardWidth = { reference: 450, wide: 430, desktop: 350, "ipad-landscape": 450, "ipad-portrait": 370, mobile: 310 }[viewport.name];
    const cardsAreWide = firstCard.width >= minimumCardWidth;
    const compactGap = Math.abs(viewport.gridColumnGap - 12) < .1;
    const layoutMatches = viewport.documentScrollable && viewport.noHorizontalOverflow && viewport.pageScrollY > 0 && viewport.gridColumns === expectedColumns && fillsViewport && !viewport.nestedGridScrollable && anchorsStable && viewport.stableScrollbarGutter;
    return sameCards && responsiveCards && uniformSpriteBoxes && tabCardsMatch && gridEdgesMatch && columnEdgesMatch && tracksFillWidth && cardsAreWide && compactGap && manaFits && effectsVisible && pointCountersVisible && critterStatsAligned && critterStatsEqualWidth && relicEffectsAligned && critterSpacingMatches && challengePaneMatches && lockedScrollbarMatches && cardActionsMatch && challengeAlignmentMatches && challengeBoundaryMatches && statusesMatch && layoutMatches
      ? []
      : [{ viewport: viewport.name, sameCards, responsiveCards, uniformSpriteBoxes, cards: viewport.cards, tabCardsMatch, gridEdgesMatch, columnEdgesMatch, tracksFillWidth, availableTrackWidth, cardsAreWide, minimumCardWidth, compactGap, gridColumnGap: viewport.gridColumnGap, manaFits, mana: viewport.mana, effectsVisible, pointCountersVisible, critterStatsAligned, critterStatsEqualWidth, relicEffectsAligned, relicEffectOffsets: viewport.relicEffectOffsets, critterSpacingMatches, critterSpacing: viewport.critterSpacing, challengePaneMatches, challengePanes: viewport.challengePanes, lockedScrollbarMatches, lockedScrollbarStates: viewport.lockedScrollbarStates, ownedScrollbarCount: viewport.ownedScrollbarCount, cardActionsMatch, cardsAreArticles: viewport.cardsAreArticles, nestedButtonCount: viewport.nestedButtonCount, detailActions: viewport.detailActions, trackActions: viewport.trackActions, challengeAlignmentMatches, challengeAlignments: viewport.challengeAlignments, challengeBoundaryMatches, challengeBoundaries: viewport.challengeBoundaries, statusesMatch, anchorsStable, fillsViewport, stableScrollbarGutter: viewport.stableScrollbarGutter, documentScrollable: viewport.documentScrollable, noHorizontalOverflow: viewport.noHorizontalOverflow, pageScrollY: viewport.pageScrollY, gridColumns: viewport.gridColumns, expectedColumns, nestedGridScrollable: viewport.nestedGridScrollable }];
  });

  if (failures.length) throw new Error(`Collection layout failures:\n${JSON.stringify(failures, null, 2)}`);
  console.log(JSON.stringify({ checkedViewports: viewports.length, viewports }, null, 2));
} finally {
  await browser.close();
}
