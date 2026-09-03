export type PlayerStateRevision = bigint | null;
export type PlayerStateRevisionCandidate = bigint | number | string | null | undefined;

export type VersionedPlayerMutationReceipt = {
  requestId: string;
  resultingRevision?: PlayerStateRevisionCandidate;
  [key: string]: unknown;
};

export function advancePlayerStateRevision(
  current: PlayerStateRevision,
  candidate: PlayerStateRevisionCandidate,
): PlayerStateRevision {
  const next = parsePlayerStateRevision(candidate);
  if (next === null) return current;
  return current === null || next > current ? next : current;
}

export async function runVersionedPlayerMutation<Receipt extends VersionedPlayerMutationReceipt>({
  requestId,
  getRevision,
  refreshRevision,
  send,
}: {
  requestId: string;
  getRevision: () => PlayerStateRevision;
  refreshRevision: () => Promise<void>;
  send: (expectedRevision: PlayerStateRevision, requestId: string) => Promise<Receipt>;
}): Promise<Receipt> {
  let retried = false;
  while (true) {
    try {
      // Read immediately before each attempt. The command may have waited in
      // the outbox behind another mutation since this function was called.
      return await send(getRevision(), requestId);
    } catch (error) {
      if (retried || !isPlayerRevisionConflict(error)) throw error;
      retried = true;
      await refreshRevision();
    }
  }
}

function parsePlayerStateRevision(value: PlayerStateRevisionCandidate): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function isPlayerRevisionConflict(error: unknown): boolean {
  if (error instanceof Error) return error.message.includes("PLAYER_REVISION_CONFLICT");
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  return [candidate.code, candidate.message, candidate.details]
    .some((value) => typeof value === "string" && value.includes("PLAYER_REVISION_CONFLICT"));
}
