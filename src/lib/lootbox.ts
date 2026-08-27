import type { LootboxOpeningReceipt } from "./types.js";

export type LootboxOpeningOperation = (
  lootboxId: string,
  requestId: string,
) => Promise<LootboxOpeningReceipt>;

export type LootboxOpeningRecoveryOptions = {
  maxAttempts?: number;
  delays?: number[];
  delay?: (delayMs: number) => Promise<void>;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "";
}

export function isRetryableLootboxOpeningError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : NaN;
  const text = errorText(error).toLowerCase();
  return code === "408"
    || code === "429"
    || code === "57014"
    || (Number.isFinite(status) && status >= 500)
    || text.includes("timeout")
    || text.includes("timed out")
    || text.includes("network")
    || text.includes("fetch")
    || text.includes("connection reset")
    || text.includes("connection closed")
    || text.includes("gateway")
    || text.includes("upstream");
}

function wait(delayMs: number): Promise<void> {
  return delayMs > 0
    ? new Promise((resolve) => window.setTimeout(resolve, delayMs))
    : Promise.resolve();
}

/**
 * Lootbox openings are idempotent at the database boundary. Replaying the
 * same request ID lets a timed-out client recover a committed receipt without
 * charging another box or granting the reward twice.
 */
export async function recoverLootboxOpening(
  operation: LootboxOpeningOperation,
  lootboxId: string,
  requestId: string,
  options: LootboxOpeningRecoveryOptions = {},
): Promise<LootboxOpeningReceipt> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const delays = options.delays ?? [0, 250, 750, 1500];
  const delay = options.delay ?? wait;
  let lastError: unknown = new Error("Lootbox opening failed.");

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await delay(delays[attempt] ?? delays[delays.length - 1] ?? 1500);
    try {
      return await operation(lootboxId, requestId);
    } catch (error) {
      lastError = error;
      if (!isRetryableLootboxOpeningError(error) || attempt === maxAttempts - 1) throw error;
    }
  }

  throw lastError;
}
