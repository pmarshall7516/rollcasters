import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 300 } });

try {
  await page.setContent(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><style>${styles}
        body { margin: 0; padding: 12px; background: #080b1d; }
        .challenge-tracking { width: 360px; }
      </style></head>
      <body>
        <section class="challenge-tracking" aria-label="Challenge tracking">
          <div class="challenge-tracking-slots">
            <article class="tracked-challenge-card">
              <div class="sprite-frame"></div>
              <div class="tracked-challenge-copy">
                <strong class="collectible-name">Glimbit</strong>
                <span>Knock out qualifying enemies.</span>
                <div class="tracked-challenge-progress-row">
                  <span class="challenge-progress">4 / 10</span>
                  <button type="button" class="link-button tracked-untrack">Untrack</button>
                </div>
              </div>
            </article>
          </div>
        </section>
      </body>
    </html>
  `);

  const layout = await page.evaluate(() => {
    const card = document.querySelector(".tracked-challenge-card");
    const row = document.querySelector(".tracked-challenge-progress-row");
    const progress = document.querySelector(".challenge-progress");
    const button = document.querySelector(".tracked-untrack");
    const cardRect = card.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const progressRect = progress.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      cardHeight: cardRect.height,
      rowDisplay: getComputedStyle(row).display,
      rowJustify: getComputedStyle(row).justifyContent,
      buttonPosition: getComputedStyle(button).position,
      progressCenter: progressRect.top + progressRect.height / 2,
      buttonCenter: buttonRect.top + buttonRect.height / 2,
      rowRight: rowRect.right,
      buttonRight: buttonRect.right,
    };
  });

  check(layout.rowDisplay === "flex", `Progress controls must share a flex row: ${JSON.stringify(layout)}`);
  check(layout.rowJustify === "space-between", `Untrack must stay at the right edge of the progress row: ${JSON.stringify(layout)}`);
  check(layout.buttonPosition === "static", `Untrack must participate in the progress row flow: ${JSON.stringify(layout)}`);
  check(Math.abs(layout.progressCenter - layout.buttonCenter) <= 1, `Progress and Untrack must be on the same row: ${JSON.stringify(layout)}`);
  check(Math.abs(layout.rowRight - layout.buttonRight) <= 1, `Untrack must align with the progress row's right edge: ${JSON.stringify(layout)}`);
  check(layout.cardHeight < 100, `Main tracking cards should shrink after the button moves inline: ${JSON.stringify(layout)}`);

  process.stdout.write(`${JSON.stringify(layout)}\n`);
} finally {
  await browser.close();
}
