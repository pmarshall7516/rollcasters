import { combatLoadingNarration } from "../src/lib/presentation.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(combatLoadingNarration("turn", 1) === "Loading.", "Turn submission must keep the existing Loading copy.");
check(combatLoadingNarration("result", 3) === "Waiting...", "Result recording must provide animated Waiting copy.");
check(combatLoadingNarration("result", 99) === "Waiting...", "Loading copy must cap its animated dots.");

console.log(JSON.stringify({ resultLoading: true, completionScroll: false }));
