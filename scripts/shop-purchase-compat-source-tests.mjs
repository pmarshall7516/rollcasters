import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function purchaseShopEntries");
const end = source.indexOf("export async function openLootbox", start);
const purchaseShopEntries = source.slice(start, end);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(start >= 0 && end > start, "The purchaseShopEntries client seam must remain present.");
check(
  /purchases\.length\s*===\s*1[\s\S]*purchaseShopEntry\(purchase\.entry_id,\s*purchase\.request_id,\s*purchase\.quantity\)/.test(purchaseShopEntries),
  "A single bulk purchase must bypass the optional purchase_shop_entries RPC.",
);
check(
  /shopPurchaseRpcErrorDisposition\(error,\s*1\)/.test(purchaseShopEntries),
  "A missing Shop batch RPC must be recognized as a compatibility case.",
);
check(
  /purchaseShopEntry\(purchase\.entry_id,\s*purchase\.request_id,\s*purchase\.quantity\)/.test(purchaseShopEntries),
  "A missing Shop batch RPC must fall back to the idempotent single-entry purchase path.",
);

console.log("Shop purchase compatibility source tests passed.");
