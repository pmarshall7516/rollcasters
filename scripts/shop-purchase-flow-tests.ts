import {
  aggregateShopPurchaseReceipts,
  indexedShopPurchaseRequestId,
  partialShopPurchaseReceipt,
  isAmbiguousShopPurchaseError,
  shopPurchaseRpcErrorDisposition,
} from "../src/lib/shop.js";
import type { ShopPurchaseReceipt } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const first: ShopPurchaseReceipt = {
  request_id: "11111111-1111-4111-8111-111111111111",
  entry_id: "entry-1",
  shop_type: "lootbox",
  target_category: "lootbox",
  target_id: "001",
  currency_id: "coins",
  price: "40",
  balance: "160",
  granted: "1",
  discarded: "0",
  unlock_event_id: null,
  created_at: "2026-08-14T00:00:00.000Z",
};

const second = { ...first, request_id: "22222222-2222-4222-8222-222222222222", price: "40", balance: "120" };
const aggregate = aggregateShopPurchaseReceipts([first, second], first.request_id);
check(aggregate.request_id === first.request_id, "A fallback batch must keep its stable outer request id.");
check(aggregate.price === "80" && aggregate.balance === "120" && aggregate.granted === "2", "Fallback receipts must aggregate the durable price, balance, and granted quantity.");

const indexedFirst = indexedShopPurchaseRequestId(first.request_id, 0);
const indexedSecond = indexedShopPurchaseRequestId(first.request_id, 1);
check(indexedFirst === first.request_id && indexedSecond !== indexedFirst, "Legacy fallback calls must use stable distinct idempotency keys.");
check(indexedSecond === indexedShopPurchaseRequestId(first.request_id, 1), "Indexed fallback request IDs must be deterministic for retries.");

const partialError = Object.assign(new Error("INSUFFICIENT_FUNDS"), { partialReceipt: first });
check(partialShopPurchaseReceipt(partialError)?.granted === "1", "Partial fallback failures must expose committed receipts for reconciliation.");

check(
  shopPurchaseRpcErrorDisposition({ code: "PGRST202", message: "Could not find the function public.purchase_shop_entry in the schema cache." }, 3) === "legacy",
  "A missing quantity RPC must fall back for a spam-purchase batch instead of rolling back its optimistic state.",
);
check(
  shopPurchaseRpcErrorDisposition(new Error("Could not find the function public.purchase_shop_entries(p_purchase) in the schema cache."), 1) === "legacy",
  "The exact deployed batch-RPC schema-cache error must use the compatibility path even when thrown as an Error.",
);
check(
  shopPurchaseRpcErrorDisposition({ code: "42501", message: "permission denied" }, 3) === "throw",
  "Non-compatibility RPC errors must still reject the purchase batch.",
);
check(
  isAmbiguousShopPurchaseError({ code: "57014", message: "canceling statement due to statement timeout" }),
  "A statement timeout must enter receipt recovery rather than become a definitive purchase failure.",
);
check(
  !isAmbiguousShopPurchaseError({ code: "INSUFFICIENT_FUNDS", message: "INSUFFICIENT_FUNDS" }),
  "A typed business rejection must not be treated as an ambiguous committed purchase.",
);

console.log("Shop purchase flow tests passed.");
