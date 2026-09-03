import fs from "node:fs";

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

check(appSource.includes('kind: "error"') && appSource.includes('"Lootbox error"'), "Lootbox failures must use the generic transient error notification.");
check(appSource.includes("createLootboxErrorNotification"), "Lootbox failures must be normalized before entering the notification queue.");
check(appSource.includes("onOpenError={(openingFailure) => enqueueNotification(createLootboxErrorNotification(openingFailure))}"), "Lootbox opening failures must enter the notification queue.");
const openBox = appSource.match(/async function openBox\(force = false\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
check(!openBox.includes("setError("), "Lootbox opening failures must not use persistent app or modal error state.");
check(!appSource.includes('error&&<p className="notice error" role="alert">{error}</p>'), "Lootbox modals must not render a persistent inline error banner.");
check(cssSource.includes(".unlock-notification") && cssSource.includes(".error-notification"), "Lootbox errors must use the transient top-left notification treatment.");

console.log("Lootbox error notification tests passed.");
