import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(source.includes("const INTERACT_HOLD_START_DELAY_MS = 2_000;"), "Combat Interact hold must wait before auto-advancing.");
check(source.includes("const INTERACT_HOLD_REPEAT_INTERVAL_MS = 80;"), "Combat Interact hold must use a bounded repeat interval.");
check(source.includes("interactHoldDelayTimerRef.current = window.setTimeout(() => {"), "Combat Interact hold must arm its repeat loop through a delay timer.");
check(source.includes("window.addEventListener(\"keyup\", handleInteractKeyUp);"), "Combat Interact hold must stop on key release.");
check(source.includes("window.addEventListener(\"blur\", stopInteractHold);"), "Combat Interact hold must stop when the window loses focus.");
check(source.includes("interactActionRef.current();") && source.includes("window.setInterval(() => {"), "Holding Interact must re-evaluate and activate controls continuously.");
check(source.includes("control.getAttribute(\"aria-pressed\") !== \"true\""), "Lead selection hold must skip already-selected Critters.");
check(source.includes("control.dataset.combatFocusRole === \"lead-confirm\""), "Lead selection hold must confirm only after the requested leads are selected.");
check(source.includes("enabledControls.find((control) => control.dataset.combatFocusRole === \"skill\")"), "Combat Interact hold must skip unavailable Skills and choose an enabled Skill.");
check(source.includes("if (target?.closest(\"button, [role='button']\") && !targetCombatControl) return;"), "Combat Interact hold must preserve native activation for non-combat buttons such as the Dungeons back button.");
check(!source.includes("function handleSpacebar(event: KeyboardEvent)"), "Combat narration must share the held Interact controller instead of a competing Space listener.");

console.log(JSON.stringify({ combatInteractHold: true, startDelayMs: 2000, repeatIntervalMs: 80, gatedControls: true }));
