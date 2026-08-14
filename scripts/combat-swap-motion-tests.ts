import { combatSwapTravelOffset } from "../src/lib/presentation.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const source = { x: 420, y: 300 };
const destination = { x: 860, y: 240 };
const outgoing = combatSwapTravelOffset(source, destination, "out", 2);
const incoming = combatSwapTravelOffset(source, destination, "in", 2);

check(outgoing.x === 220 && outgoing.y === -30, `Outgoing Swap motion must use the field-to-squad vector: ${JSON.stringify(outgoing)}`);
check(incoming.x === 220 && incoming.y === -30, `Incoming Swap motion must start at the squad and travel back to the field: ${JSON.stringify(incoming)}`);

console.log(JSON.stringify({ outgoing, incoming }));
