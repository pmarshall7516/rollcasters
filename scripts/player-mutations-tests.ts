import { createPlayerMutationOutbox } from "../src/lib/player-mutations.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const outbox = createPlayerMutationOutbox({ squad: "001", skill: "slam" });
const sent: string[] = [];
void outbox.mutatePlayer({
  requestId: "squad-1",
  resourceKey: "squad:1",
  apply: (state) => ({ ...state, squad: "002" }),
  send: async () => { sent.push("squad-1"); throw new Error("offline"); },
}).catch(() => undefined);
outbox.mutatePlayer({
  requestId: "skill-1",
  resourceKey: "skill:critter:1",
  apply: (state) => ({ ...state, skill: "sharpen" }),
  send: async () => { sent.push("skill-1"); return { requestId: "skill-1", resultingRevision: 2 }; },
});
await outbox.flushPlayerMutations();
check(sent.join(",") === "squad-1,skill-1", "Player mutations must be sent in order.");
check(outbox.getState().squad === "001" && outbox.getState().skill === "sharpen", "A failed command must roll back without losing a later optimistic edit.");
check(outbox.pendingStateFor("squad:1").error instanceof Error, "Rejected mutations must retain contextual error state.");

const collapsed = createPlayerMutationOutbox({ slot: "a" });
let release!: () => void;
const firstSend = new Promise<void>((resolve) => { release = resolve; });
void collapsed.mutatePlayer({ requestId: "first", resourceKey: "slot:1", apply: (state) => ({ slot: "b" }), send: async () => { await firstSend; return { requestId: "first" }; } }).catch(() => undefined);
void collapsed.mutatePlayer({ requestId: "second", resourceKey: "slot:1", apply: (state) => ({ slot: "c" }), send: async () => ({ requestId: "second" }) });
release();
await collapsed.flushPlayerMutations();
check(collapsed.getState().slot === "c", "Only unsent edits to the same slot may collapse, preserving the newest intent.");

console.log("Player mutation outbox tests passed.");
