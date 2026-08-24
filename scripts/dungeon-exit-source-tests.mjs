import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(source.includes("requestDungeonExit"), "Combat exits must pass through an explicit abandon confirmation handler.");
check(source.includes("Do you want to abandon the current run?"), "Combat exit confirmation must use the requested copy.");
check(source.includes('Yes') && source.includes('No'), "Combat exit confirmation must expose Yes and No actions.");
check(source.includes("onBack={() => requestDungeonExit(\"play\")}"), "The Dungeons button must confirm before abandoning the run.");
check(source.includes("onHome={() => requestDungeonExit(\"home\")}"), "The game logo must confirm before abandoning the run.");

console.log("Dungeon exit source tests passed.");
