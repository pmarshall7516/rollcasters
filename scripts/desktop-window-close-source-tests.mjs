import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const handlerStart = app.indexOf("onCloseRequested");
const handlerEnd = app.indexOf("\n      }))", handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "The native close handler must remain discoverable.");

const closeHandler = app.slice(handlerStart, handlerEnd);
assert.match(closeHandler, /await getCurrentWindow\(\)\.destroy\(\)/, "The native close handler must force-close after cleanup.");
assert.doesNotMatch(closeHandler, /await getCurrentWindow\(\)\.close\(\)/, "The close handler must not re-emit closeRequested from inside closeRequested.");

console.log("Native desktop window close contract passed.");
