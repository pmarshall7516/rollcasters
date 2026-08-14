import fs from "node:fs";
import path from "node:path";
import { root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

check(!source.includes("{!(combat.phase === \"event_playback\" && event?.kind === \"mana_refund\") && <button"),
  "The combat narration control must not be removed during mana-refund event playback.");
check(source.includes("event?.kind === \"mana_refund\" ? \"Mana restored.\""),
  "Mana-refund playback must keep readable narration inside the reserved text-box slot.");
check(source.includes("const manaRefundNarration = event?.kind === \"mana_refund\""),
  "The narration advance gate must identify the non-interactive mana-refund placeholder.");

console.log(JSON.stringify({ narrationSlotAlwaysMounted: true, manaRefundCopy: true }));
