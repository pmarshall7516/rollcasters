import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const outputDir = path.join(root, "output", "settings-layout");
const css = await readFile(path.join(root, "src", "styles.css"), "utf8");
const html = `<!doctype html><html><head><style>${css}</style></head><body>
  <main class="app-shell">
    <div class="modal-backdrop">
      <div class="modal settings-modal">
        <div class="modal-header"><div><p class="eyebrow">Rollcasters</p><h2>Settings</h2><p>Adjust your game window and view the current controls.</p></div><button class="icon-button" aria-label="Close">×</button></div>
        <div class="settings-layout">
          <nav class="settings-tabs" role="tablist" aria-orientation="vertical"><button class="active" role="tab">◌ Controls</button><button role="tab">⚙ Window</button></nav>
          <div class="settings-content"><section class="settings-section"><div class="settings-section-heading"><div><p class="eyebrow">Saved on this device</p><h3>Controls</h3></div><span class="settings-status">Keyboard</span></div><p class="settings-help">Select a control, then press the keyboard key you want to use.</p><div class="control-list"><button class="control-row"><span>Move Up</span><strong>W</strong></button><button class="control-row"><span>Move Down</span><strong>S</strong></button><button class="control-row"><span>Move Left</span><strong>A</strong></button><button class="control-row"><span>Move Right</span><strong>D</strong></button><button class="control-row"><span>Interact / Advance</span><strong>Space</strong></button><button class="control-row"><span>Back</span><strong>Left Shift</strong></button></div><div class="settings-control-actions"><button class="secondary-button">Reset Defaults</button></div></section></div>
        </div>
      </div>
    </div>
  </main>
</body></html>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const metrics = await page.evaluate(() => {
    const modal = document.querySelector(".settings-modal").getBoundingClientRect();
    const tabs = document.querySelector(".settings-tabs").getBoundingClientRect();
    const content = document.querySelector(".settings-content").getBoundingClientRect();
    return {
      modal,
      tabs,
      content,
      tabCount: document.querySelectorAll(".settings-tabs [role='tab']").length,
      removedTextPresent: document.body.textContent.includes("Fill the active display at its native size.")
        || document.body.textContent.includes("Starts at 1280 × 720 and keeps a clean 16:9 shape.")
        || document.body.textContent.includes("Windowed size:"),
    };
  });
  assert.ok(metrics.modal.width >= 900, `Settings modal should be larger than the old 650px frame: ${metrics.modal.width}`);
  assert.equal(metrics.tabCount, 2, "Settings should keep both tabs.");
  assert.ok(metrics.tabs.right < metrics.content.left, "The tabs must occupy a distinct left pane before the tab content.");
  assert.ok(metrics.tabs.height >= 100, "The vertical tab pane must lay out as a column.");
  assert.equal(metrics.removedTextPresent, false, "The removed Window descriptions must not be rendered.");
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, "settings-split-pane.png") });
  console.log(JSON.stringify({ ...metrics, modal: { width: metrics.modal.width, height: metrics.modal.height }, tabs: { width: metrics.tabs.width, height: metrics.tabs.height }, content: { width: metrics.content.width, height: metrics.content.height } }, null, 2));
  console.log("Settings split-pane layout checks passed.");
} finally {
  await browser.close();
}
