import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(appSource.includes('kind: "error"') && appSource.includes('"Purchase error"'), "Purchase failures must use the generic transient error notification.");
check(appSource.includes("createShopErrorNotification"), "Purchase failures must be normalized before entering the banner queue.");
check(appSource.includes("onNotify(createShopErrorNotification(error))"), "Shop purchase failures must enter the notification queue.");
check(appSource.includes("onPurchaseError={(purchaseFailure) => onNotify(createShopErrorNotification(purchaseFailure))}"), "Lootbox purchase-sync failures must enter the notification queue.");
check(appSource.includes("/purchase_shop_entries|purchase_shop_entry|purchase could not be completed/i"), "Raw Shop RPC failures must not remain in the Lootbox modal.");
check(!appSource.includes("const [purchaseError, setPurchaseError]"), "Shop purchase failures must not use persistent local error state.");
check(!appSource.includes("purchaseError && <p className=\"notice error\""), "Shop purchase failures must not render a persistent inline banner.");
check(
  cssSource.includes(".error-notification")
    && cssSource.includes(".error-notification .unlock-notification-label { color: var(--danger); }"),
  "Purchase error notifications must use the red danger treatment.",
);

console.log("Purchase error notification tests passed.");
