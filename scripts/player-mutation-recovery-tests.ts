import { advancePlayerStateRevision, runVersionedPlayerMutation } from "../src/lib/player-mutation-sync.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(advancePlayerStateRevision(9n, 8n) === 9n, "An older server revision must not move the client cursor backward.");
check(advancePlayerStateRevision(null, "4") === 4n, "The first valid server revision must initialize the client cursor.");

let revision = 4n;
let refreshes = 0;
const attempts: Array<{ expectedRevision: bigint; requestId: string }> = [];
const receipt = await runVersionedPlayerMutation({
  requestId: "request-1",
  getRevision: () => revision,
  refreshRevision: async () => {
    refreshes += 1;
    revision = 7n;
  },
  send: async (expectedRevision, requestId) => {
    attempts.push({ expectedRevision, requestId });
    if (attempts.length === 1) throw new Error("PLAYER_REVISION_CONFLICT");
    return { requestId, resultingRevision: 8n };
  },
});

check(refreshes === 1, "A revision conflict must refresh authoritative state once.");
check(attempts.length === 2 && attempts[0].expectedRevision === 4n && attempts[1].expectedRevision === 7n, "Retries must capture the refreshed revision at send time.");
check(attempts.every((attempt) => attempt.requestId === "request-1"), "A retry must reuse the original idempotency key.");
check(receipt.resultingRevision === 8n, "A successful retry must return its authoritative receipt.");

let secondConflictCount = 0;
try {
  await runVersionedPlayerMutation({
    requestId: "request-2",
    getRevision: () => 8n,
    refreshRevision: async () => undefined,
    send: async () => {
      secondConflictCount += 1;
      throw new Error("PLAYER_REVISION_CONFLICT");
    },
  });
  throw new Error("A second revision conflict must be surfaced.");
} catch (error) {
  check(error instanceof Error && error.message === "PLAYER_REVISION_CONFLICT", "Only the retryable first conflict may be recovered.");
}
check(secondConflictCount === 2, "A conflicted mutation must make at most one retry.");

console.log("Player mutation recovery tests passed.");
