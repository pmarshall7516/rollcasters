import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync(new URL("../src/features/account/AccountCenter.tsx", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const startup = app.slice(app.indexOf("const initializeSession"), app.indexOf("accountCenterStartupPromise ??="));

assert.match(component, /Account Center/);
assert.match(component, /Add account/);
assert.match(component, /Log out/);
assert.match(component, /LogOut/);
assert.doesNotMatch(component, /Trash2/);
assert.doesNotMatch(component, /Remove from this device/);
assert.match(component, /Account limit reached/);
assert.match(component, /Sign in again/);
assert.match(app, /accountCenterManager/);
assert.match(app, /AccountCenter/);
assert.match(app, /accountCenterManager\.snapshot\(\)\.accounts\.length > 0 \? "center" : "form"/);
assert.match(app, /!isAuthed && authEntry === "center" && accountCenter\.accounts\.length > 0/);
assert.match(startup, /returnToAccountCenter/);
assert.doesNotMatch(startup, /establishGameplaySession/);

console.log("Account-center UI source contract passed.");
