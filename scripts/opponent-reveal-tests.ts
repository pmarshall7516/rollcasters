import { updateOpponentRevealState } from "../src/lib/combat-visibility.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const firstEncounter = updateOpponentRevealState(
  null,
  "run-1:1",
  "await_roll",
  ["o1", "o2"],
  [{ actorKey: "o1", targetKeys: ["p1"], swap: { incomingKey: "o3" } }],
);
check(
  [...firstEncounter.keys].sort().join(",") === "o1,o2,o3",
  "The first encounter should retain every enemy Critter that has been seen.",
);

const secondEncounter = updateOpponentRevealState(
  firstEncounter,
  "run-1:2",
  "await_roll",
  ["o1", "o2"],
  [],
);
check(
  [...secondEncounter.keys].sort().join(",") === "o1,o2",
  "A later encounter must not inherit an earlier encounter's revealed enemy Critters.",
);
check(!secondEncounter.keys.has("o3"), "An unseen reserve Critter must remain hidden in the later encounter.");

const secondLeadSelection = updateOpponentRevealState(
  secondEncounter,
  "run-1:2",
  "lead_selection",
  [],
  [],
);
check(secondLeadSelection.keys.size === 0, "Enemy Critters must stay hidden until the player confirms leads.");

console.log("Opponent reveal regression tests passed.");
