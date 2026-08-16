import fs from "node:fs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const supabase = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

check(
  /async function purchaseShopItem\([\s\S]*await purchaseShopEntry\([\s\S]*applyShopPurchaseReceipt/.test(app),
  "Each Purchase click must await one server-authoritative purchase before updating local Shop state.",
);
check(
  !/function flushPendingShopPurchases|pendingShopPurchases|optimisticShopData/.test(app),
  "Shop must not maintain a deferred optimistic purchase ledger that can diverge from Collection state.",
);
check(
  /clearLegacyShopPurchaseLedger\(userId\)/.test(app),
  "Loading an account must remove any stale deferred Shop ledger left by an older client.",
);
check(
  /client\.rpc\("purchase_shop_entry"[\s\S]*p_quantity: quantity/.test(supabase),
  "A selected bulk quantity must use the idempotent quantity purchase RPC when deployed.",
);
check(
  /className="lootbox-result-actions"[\s\S]{0,240}>Back<[\s\S]{0,320}Open Another/.test(app),
  "Lootbox results must place Back and Open Another in the shared result action row.",
);
check(
  /const projected = quantity > 1[\s\S]{0,180}: statusAvailability\.current;/.test(app)
    && /projected=\{projected\}/.test(app)
    && /className="shop-progress-projected"/.test(app)
    && /\.shop-progress-projected/.test(styles),
  "Shard and Relic Shop bars must render projected fill only after the selected quantity rises above one.",
);
check(
  /lootbox-modal-purchase-row[\s\S]{0,240}<ShopQuantityControl/.test(app),
  "The themed shared quantity control must also render in the Lootbox purchase popup.",
);

console.log("Immediate Shop purchase source tests passed.");
