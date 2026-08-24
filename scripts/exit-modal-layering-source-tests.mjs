import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const modalStart = app.indexOf("function Modal({");
const modalEnd = app.indexOf("\nfunction Sprite", modalStart);
assert.ok(modalStart >= 0 && modalEnd > modalStart, "The shared Modal implementation must remain discoverable.");

const modal = app.slice(modalStart, modalEnd);
assert.match(modal, /return createPortal\(/, "Shared modals must render through a document-level portal.");
assert.match(modal, /document\.body/, "Shared modals must mount outside local stacking contexts.");
assert.match(modal, /className=\"modal-backdrop\"/, "The portal must contain the modal backdrop.");
assert.match(styles, /\.modal-backdrop \{ z-index: 1000;/, "The modal backdrop must sit above tooltips and application overlays.");

console.log("Exit modal layering contract passed.");
