import {
  DEFAULT_LOCAL_SETTINGS,
  DEFAULT_WINDOW_PREFERENCES,
  readWindowPreferencesFromSettings,
  resolveNativeResizeMode,
  updateWindowPreferences,
} from "../src/lib/desktop-settings.js";
import { DEFAULT_WINDOWED_SIZE } from "../src/lib/desktop-window-geometry.js";

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

assertEqual(
  readWindowPreferencesFromSettings(null),
  DEFAULT_WINDOW_PREFERENCES,
  "Missing settings must boot the game in fullscreen.",
);
assertEqual(
  readWindowPreferencesFromSettings({
    version: 1,
    window: { mode: "windowed", width: 1440, height: 810 },
  }),
  { mode: "windowed", windowedSize: { width: 1440, height: 810 } },
  "Stored window settings must restore windowed mode and size.",
);
assertEqual(
  readWindowPreferencesFromSettings({ version: 1, window: { mode: "unknown", width: -1 } }),
  DEFAULT_WINDOW_PREFERENCES,
  "Invalid window settings must use safe fullscreen defaults.",
);
assertEqual(
  readWindowPreferencesFromSettings({ version: 3, window: { mode: "windowed", width: 1440, height: 810 } }),
  DEFAULT_WINDOW_PREFERENCES,
  "Unsupported settings versions must use safe fullscreen defaults.",
);

const updated = updateWindowPreferences(
  { version: 1, controls: { interact: "Enter" }, audio: { volume: 0.7 } },
  "windowed",
  { width: 1600, height: 900 },
);
assertEqual(
  updated,
  {
    version: 2,
    controls: { interact: "Enter" },
    audio: { volume: 0.7 },
    window: { mode: "windowed", width: 1600, height: 900 },
  },
  "Saving window settings must preserve future settings fields.",
);
assertEqual(
  updateWindowPreferences(null, DEFAULT_LOCAL_SETTINGS.window.mode, DEFAULT_WINDOWED_SIZE),
  DEFAULT_LOCAL_SETTINGS,
  "Saving defaults must create the versioned local settings shape.",
);
assertEqual(
  resolveNativeResizeMode("fullscreen", false),
  null,
  "A transient non-fullscreen resize must not overwrite a fullscreen preference.",
);
assertEqual(
  resolveNativeResizeMode("windowed", false),
  "windowed",
  "A non-fullscreen resize must remain a real windowed resize when windowed mode is active.",
);
assertEqual(
  resolveNativeResizeMode("windowed", true),
  null,
  "A transient fullscreen resize must not overwrite a windowed preference.",
);

console.log("Desktop local settings contract passed.");
