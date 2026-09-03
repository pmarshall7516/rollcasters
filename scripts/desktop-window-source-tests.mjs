import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const windowSource = fs.readFileSync(new URL("../src/lib/desktop-window.ts", import.meta.url), "utf8");
const settingsSource = fs.readFileSync(new URL("../src/lib/local-settings.ts", import.meta.url), "utf8");
const geometry = fs.readFileSync(new URL("../src/lib/desktop-window-geometry.ts", import.meta.url), "utf8");
const native = fs.readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const updater = fs.readFileSync(new URL("../src/lib/desktop-updater.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.match(windowSource, /setSizeConstraints\(null\)[\s\S]*setFullscreen\(true\)/, "Fullscreen entry must clear windowed constraints before filling the display.");
assert.match(windowSource, /currentMonitor/, "Windowed limits must be derived from the active monitor.");
assert.match(windowSource, /onMoved/, "Moving a window between monitors must trigger a bounds check.");
assert.match(windowSource, /startDesktopCornerResize/, "Windowed resizing must be owned by the corner-resize path.");
assert.match(windowSource, /loadLocalSettings/, "Desktop startup must load the native local settings file.");
assert.match(settingsSource, /read_local_settings/, "Local settings repository must load the native local settings file.");
assert.match(settingsSource, /write_local_settings/, "Local settings repository must save the native local settings file.");
assert.match(native, /app_config_dir\(\)/, "Local settings must live in Tauri's per-user app config directory.");
assert.match(native, /settings\.json/, "Desktop settings must use a stable local JSON file.");
assert.match(updater, /isWindowsDesktop/, "Desktop chrome must be scoped to the Windows desktop build.");
assert.match(app, /DesktopWindowChrome/, "Windowed Windows builds must render the desktop drag bar.");
assert.match(app, /data-tauri-drag-region="deep"/, "The desktop drag bar must be a deep Tauri drag region.");
assert.match(styles, /app-shell\[data-window-mode="windowed"\]\[data-desktop-platform="windows"\]/, "Only Windows windowed mode may reserve space for the drag bar.");
assert.match(styles, /\.desktop-window-chrome/, "The Windows windowed drag bar must have a dedicated compact style.");
assert.match(windowSource, /nativeModeChangeInFlight/, "Native resize events must be ignored while changing display mode.");
assert.match(windowSource, /monitor\.size/, "Fullscreen placement must use the full monitor size rather than its work area.");
assert.match(windowSource, /window\.dispatchEvent\(new Event\("resize"\)\)/, "Display mode changes must refresh the web viewport layout.");
assert.match(geometry, /WINDOW_ASPECT_RATIO = 16 \/ 9/, "Window geometry must use the shared 16:9 ratio.");
assert.match(geometry, /DEFAULT_WINDOWED_SIZE: WindowedSize = \{ width: 1600, height: 900 \}/, "Windowed mode must start from the larger 1600x900 frame.");
assert.match(windowSource, /isPreviousDefault/, "Existing 1280x720 default preferences must upgrade to the larger windowed frame.");
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
