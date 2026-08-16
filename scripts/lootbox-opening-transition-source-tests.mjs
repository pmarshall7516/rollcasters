import fs from "node:fs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const openAnother = app.match(/function openAnother\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";

check(openAnother.includes("void openBox(true)"), "Open Another must start the next Lootbox opening request.");
check(!openAnother.includes('setPhase("idle")'), "Open Another must not render the idle Lootbox popup before the next animation.");
check(app.includes('setPhase("shaking")'), "The opening request must enter the Lootbox animation sequence after its reward is loaded.");

console.log("Lootbox opening transition source tests passed.");
