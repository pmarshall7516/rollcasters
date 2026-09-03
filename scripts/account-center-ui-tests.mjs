import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync(new URL("../src/features/account/AccountCenter.tsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

assert.match(component, /Account Center/);
assert.match(component, /Add account/);
assert.match(component, /Remove from this device/);
assert.match(component, /Account limit reached/);
assert.match(component, /Sign in again/);
assert.match(app, /accountCenterManager/);
assert.match(app, /AccountCenter/);

console.log("Account-center UI source contract passed.");
