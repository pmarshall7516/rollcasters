import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const fixture = `<!doctype html>
  <html>
    <head><style>${css}</style></head>
    <body>
      <main class="app-shell">
        <header class="top-bar">
          <button class="brand-home-button">Logo</button>
          <div class="account-cluster">
            <div class="currency-cluster">
              <span class="coin-pill currency-pill">3,167</span>
              <span class="coin-pill currency-pill">5</span>
            </div>
            <div class="user-menu">
              <button class="user-pill user-menu-trigger" aria-expanded="true">junkq⌄</button>
              <div class="user-menu-dropdown">
                <button class="user-menu-item">↪ Log Out</button>
                <div class="user-menu-version">
                  <span>Game version</span>
                  <strong>v1.0.6</strong>
                </div>
              </div>
            </div>
            <button class="icon-button">×</button>
          </div>
        </header>
        <section class="home-layout">
          <div></div>
          <div></div>
          <section class="squad-panel" aria-label="Equipped squad">
            <article class="loadout-slot"><h2>Nutter</h2><p>Level 7</p></article>
          </section>
        </section>
      </main>
    </body>
  </html>`;

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const results = [];

  for (const width of [1280, 704, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(fixture);
    results.push(await page.evaluate(() => {
      const dropdown = document.querySelector(".user-menu-dropdown");
      const version = document.querySelector(".user-menu-version");
      const topBar = document.querySelector(".top-bar");
      const homeLayout = document.querySelector(".home-layout");
      const versionRect = version.getBoundingClientRect();
      const hit = document.elementFromPoint(versionRect.left + 10, versionRect.top + 10);

      return {
        width: window.innerWidth,
        hitInsideDropdown: Boolean(hit?.closest(".user-menu-dropdown")),
        topBarZIndex: Number.parseInt(getComputedStyle(topBar).zIndex, 10),
        homeLayoutZIndex: Number.parseInt(getComputedStyle(homeLayout).zIndex, 10),
        dropdownVisible: dropdown.getBoundingClientRect().height > 0,
      };
    }));
  }

  const failures = results.filter((result) => !result.dropdownVisible || !result.hitInsideDropdown || result.topBarZIndex <= result.homeLayoutZIndex);
  if (failures.length) {
    throw new Error(`User menu layering failed: ${JSON.stringify(failures)}`);
  }

  console.log(`User menu layering passed at ${results.map(({ width }) => `${width}px`).join(", ")}.`);
} finally {
  await browser.close();
}
