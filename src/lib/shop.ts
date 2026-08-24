import type { AppData, ShopEntry, ShopPurchaseReceipt } from "./types.js";

function asBigInt(value: string | number | bigint | null | undefined): bigint {
  try {
    return BigInt(value ?? 0);
  } catch {
    return 0n;
  }
}

function normalizedQuantity(quantity: number): bigint {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Shop purchase quantity must be a positive integer.");
  }
  return BigInt(quantity);
}

type ShopPurchaseRpcError = unknown;

function shopPurchaseRpcErrorParts(error: ShopPurchaseRpcError): { code: string; message: string } {
  if (error instanceof Error) return { code: "", message: error.message };
  if (typeof error === "string") return { code: "", message: error };
  if (!error || typeof error !== "object") return { code: "", message: "" };
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code: typeof candidate.code === "string" ? candidate.code : "",
    message: typeof candidate.message === "string" ? candidate.message : "",
  };
}

export function shopPurchaseRpcErrorCode(error: ShopPurchaseRpcError): string {
  return shopPurchaseRpcErrorParts(error).code;
}

/**
 * A transport failure is not a business rejection: the transaction may have
 * committed even though PostgREST did not return its body. Keep this narrow so
 * validation, auth, release, and balance errors remain immediately actionable.
 */
export function isAmbiguousShopPurchaseError(error: ShopPurchaseRpcError): boolean {
  const { code, message } = shopPurchaseRpcErrorParts(error);
  const status = error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status)
    : NaN;
  return code === "57014"
    || (Number.isFinite(status) && status >= 500)
    || /statement timeout|timed out|timeout|network|failed to fetch|connection reset|connection refused|gateway|upstream/i.test(message);
}

export function pendingShopPurchaseError(requestId: string): Error & { requestId: string } {
  const error = new Error("SHOP_PURCHASE_PENDING") as Error & { requestId: string };
  error.requestId = requestId;
  return error;
}

export function shopPurchaseRpcErrorDisposition(error: ShopPurchaseRpcError, quantity: number): "none" | "legacy" | "throw" {
  normalizedQuantity(quantity);
  if (!error) return "none";
  const { code, message } = shopPurchaseRpcErrorParts(error);
  return code === "42883"
    || code === "PGRST202"
    || /could not find the function|function .* does not exist|schema cache/i.test(message)
    ? "legacy"
    : "throw";
}

export function aggregateShopPurchaseReceipts(receipts: ShopPurchaseReceipt[], requestId = receipts[0]?.request_id): ShopPurchaseReceipt {
  const first = receipts[0];
  const last = receipts[receipts.length - 1];
  if (!first || !last || !requestId) throw new Error("Cannot aggregate an empty shop purchase receipt list.");
  return {
    ...last,
    request_id: requestId,
    price: receipts.reduce((total, receipt) => total + asBigInt(receipt.price), 0n).toString(),
    granted: receipts.reduce((total, receipt) => total + asBigInt(receipt.granted), 0n).toString(),
    discarded: receipts.reduce((total, receipt) => total + asBigInt(receipt.discarded), 0n).toString(),
    unlock_event_id: [...receipts].reverse().find((receipt) => receipt.unlock_event_id)?.unlock_event_id ?? null,
  };
}

export function indexedShopPurchaseRequestId(requestId: string, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error("Shop purchase request index must be a non-negative integer.");
  const compact = requestId.split("-").join("");
  if (!/^[0-9a-f]{32}$/i.test(compact)) throw new Error("Shop purchase request id must be a UUID.");
  const suffix = (BigInt(`0x${compact.slice(-12)}`) + BigInt(index)).toString(16).padStart(12, "0").slice(-12);
  const next = `${compact.slice(0, -12)}${suffix}`;
  return `${next.slice(0, 8)}-${next.slice(8, 12)}-${next.slice(12, 16)}-${next.slice(16, 20)}-${next.slice(20)}`;
}

export function partialShopPurchaseReceipt(error: unknown): ShopPurchaseReceipt | null {
  if (!error || typeof error !== "object") return null;
  const receipt = (error as { partialReceipt?: unknown }).partialReceipt;
  if (!receipt || typeof receipt !== "object") return null;
  const candidate = receipt as Partial<ShopPurchaseReceipt>;
  return typeof candidate.request_id === "string"
    && typeof candidate.entry_id === "string"
    && typeof candidate.price === "string"
    && typeof candidate.balance === "string"
    && typeof candidate.granted === "string"
    ? receipt as ShopPurchaseReceipt
    : null;
}

export function shopPurchasePrice(entry: ShopEntry, quantity: number): bigint {
  return asBigInt(entry.price) * normalizedQuantity(quantity);
}

export function shopPurchaseItemQuantity(entry: ShopEntry, quantity: number): bigint {
  return asBigInt(entry.quantity) * normalizedQuantity(quantity);
}

function optimisticShopPurchaseGrant(data: AppData, entry: ShopEntry, quantity: number): { granted: bigint; discarded: bigint } {
  const requested = shopPurchaseItemQuantity(entry, quantity);
  if (entry.shop_type !== "shard") return { granted: requested, discarded: 0n };
  const current = asBigInt(data.player?.collectibleSnapshot.shards.find((row) => (
    row.collectible_type === entry.target_category && row.collectible_id === entry.target_id
  ))?.quantity);
  const challenge = data.catalog.collectibleUnlockChallenges.find((row) => (
    row.collectible_type === entry.target_category
    && row.collectible_id === entry.target_id
    && row.challenge_type === "shop_shards"
  ));
  const remaining = asBigInt(challenge?.required_amount) - current;
  const granted = remaining <= 0n ? 0n : requested < remaining ? requested : remaining;
  return { granted, discarded: requested - granted };
}

export function createOptimisticShopPurchaseReceipt(
  data: AppData,
  entry: ShopEntry,
  quantity: number,
  requestId: string,
): ShopPurchaseReceipt {
  if (!data.player) throw new Error("AUTH_REQUIRED");
  const price = shopPurchasePrice(entry, quantity);
  const balance = asBigInt(data.player.collectibleSnapshot.currencies.find((row) => row.currency_id === entry.currency_id)?.balance);
  if (balance < price) throw new Error("INSUFFICIENT_FUNDS");
  const { granted, discarded } = optimisticShopPurchaseGrant(data, entry, quantity);
  return {
    request_id: requestId,
    entry_id: entry.id,
    shop_type: entry.shop_type,
    target_category: entry.target_category,
    target_id: entry.target_id,
    currency_id: entry.currency_id,
    price: price.toString(),
    balance: (balance - price).toString(),
    granted: granted.toString(),
    discarded: discarded.toString(),
    unlock_event_id: null,
    created_at: new Date().toISOString(),
  };
}

function updateCurrency(data: AppData, currencyId: string, balance: bigint): AppData {
  if (!data.player) return data;
  const currencies = data.player.collectibleSnapshot.currencies;
  const nextCurrencies = currencies.some((row) => row.currency_id === currencyId)
    ? currencies.map((row) => row.currency_id === currencyId ? { ...row, balance: balance.toString() } : row)
    : [...currencies, { currency_id: currencyId, balance: balance.toString() }];
  return {
    ...data,
    player: {
      ...data.player,
      collectibleSnapshot: {
        ...data.player.collectibleSnapshot,
        currencies: nextCurrencies,
      },
    },
  };
}

function updateInventory(data: AppData, entry: ShopEntry, granted: bigint): AppData {
  if (!data.player || granted <= 0n) return data;
  const player = data.player;
  const snapshot = player.collectibleSnapshot;
  if (entry.shop_type === "shard") {
    const current = asBigInt(snapshot.shards.find((row) => (
      row.collectible_type === entry.target_category && row.collectible_id === entry.target_id
    ))?.quantity);
    const next = current + granted;
    const shards = snapshot.shards.some((row) => row.collectible_type === entry.target_category && row.collectible_id === entry.target_id)
      ? snapshot.shards.map((row) => row.collectible_type === entry.target_category && row.collectible_id === entry.target_id
        ? { ...row, quantity: next.toString() }
        : row)
      : [...snapshot.shards, { collectible_type: entry.target_category, collectible_id: entry.target_id, quantity: next.toString() }];
    return {
      ...data,
      player: { ...player, collectibleSnapshot: { ...snapshot, shards } },
    };
  }

  if (entry.shop_type === "lootbox") {
    const current = asBigInt(snapshot.lootboxes.find((row) => row.lootbox_id === entry.target_id)?.quantity);
    const next = current + granted;
    const lootboxes = snapshot.lootboxes.some((row) => row.lootbox_id === entry.target_id)
      ? snapshot.lootboxes.map((row) => row.lootbox_id === entry.target_id ? { ...row, quantity: next.toString() } : row)
      : [...snapshot.lootboxes, { lootbox_id: entry.target_id, quantity: next.toString() }];
    return {
      ...data,
      player: { ...player, collectibleSnapshot: { ...snapshot, lootboxes } },
    };
  }

  const current = asBigInt(player.relicInventory.find((row) => row.relic_id === entry.target_id)?.quantity);
  const next = current + granted;
  const relicInventory = player.relicInventory.some((row) => row.relic_id === entry.target_id)
    ? player.relicInventory.map((row) => row.relic_id === entry.target_id ? { ...row, quantity: Number(next) } : row)
    : [...player.relicInventory, { user_id: player.profile.user_id, relic_id: entry.target_id, quantity: Number(next), discovered_at: null }];
  return { ...data, player: { ...player, relicInventory } };
}

/**
 * Projects a queued purchase over the last authoritative snapshot. This is
 * intentionally client-only; the server receipt remains the source of truth.
 */
export function applyOptimisticShopPurchase(data: AppData, entry: ShopEntry, quantity: number): AppData {
  if (!data.player) return data;
  const receipt = createOptimisticShopPurchaseReceipt(data, entry, quantity, "00000000-0000-4000-8000-000000000000");
  return applyShopPurchaseReceipt(data, entry, receipt);
}

/**
 * Applies the exact durable result returned by the quantity RPC. This lets
 * the UI stay authoritative even if the follow-up snapshot refresh is slow.
 */
export function applyShopPurchaseReceipt(data: AppData, entry: ShopEntry, receipt: ShopPurchaseReceipt): AppData {
  const withBalance = updateCurrency(data, receipt.currency_id, asBigInt(receipt.balance));
  return updateInventory(withBalance, entry, asBigInt(receipt.granted));
}
