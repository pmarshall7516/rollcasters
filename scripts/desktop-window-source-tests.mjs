import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const windowSource = fs.readFileSync(new URL("../src/lib/desktop-window.ts", import.meta.url), "utf8");
const geometry = fs.readFileSync(new URL("../src/lib/desktop-window-geometry.ts", import.meta.url), "utf8");

assert.match(windowSource, /setSizeConstraints\(null\)[\s\S]*setFullscreen\(true\)/, "Fullscreen entry must clear windowed constraints before filling the display.");
assert.match(windowSource, /currentMonitor/, "Windowed limits must be derived from the active monitor.");
assert.match(windowSource, /onMoved/, "Moving a window between monitors must trigger a bounds check.");
assert.match(windowSource, /startDesktopCornerResize/, "Windowed resizing must be owned by the corner-resize path.");
assert.match(windowSource, /localStorage/, "Window mode and size must persist locally.");
assert.doesNotMatch(app, /desktop-window-chrome|DesktopWindowChrome/, "The custom top windowed bar must not be rendered.");
assert.doesNotMatch(app, /startDesktopWindowDragging|closeDesktopWindow|minimizeDesktopWindow/, "Removed custom bar controls must not remain wired into the app shell.");
assert.match(geometry, /WINDOW_ASPECT_RATIO = 16 \/ 9/, "Window geometry must use the shared 16:9 ratio.");
assert.match(geometry, /ResizeCorner = "north-west" \| "north-east" \| "south-west" \| "south-east"/, "Only four corner resize directions may be supported.");

const shopButton = app.indexOf("<Coins size={24} />");
const settingsButton = app.indexOf("<SettingsIcon size={24} />");
assert.ok(shopButton >= 0 && settingsButton > shopButton, "The Settings button must be placed beneath Shop in the main menu.");
assert.match(app, /title="Settings"/, "The Settings popup must be present.");
assert.match(app, /role="tab"[\s\S]*Controls/, "Controls must be a Settings tab.");
assert.match(app, /role="tab"[\s\S]*Window/, "Window must be a Settings tab.");
assert.match(app, /settings-layout/, "Settings tabs and content must use the split-pane layout.");
assert.match(app, /aria-orientation="vertical"/, "Settings tabs must be a vertical left-pane navigation.");
assert.match(app, /CONTROL_ACTIONS/, "The Controls tab must render the shared six-action binding list.");
assert.match(app, /Saved on this device/, "Control bindings must be described as local settings.");
assert.match(app, /Reset Defaults/, "The Controls tab must expose a reset-defaults action.");
assert.match(app, /Mouse clicks always activate the same controls/, "Mouse controls must remain fixed.");
assert.doesNotMatch(app, /Fill the active display at its native size\.|Starts at 1280 × 720 and keeps a clean 16:9 shape\.|Windowed size:/, "The Window tab must not show the removed explanatory lines.");

console.log("Desktop window source contract passed.");
