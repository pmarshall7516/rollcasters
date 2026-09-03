import {
  DEFAULT_WINDOWED_SIZE,
  normalizeSize,
  type WindowedSize,
} from "./desktop-window-geometry.js";

export const LOCAL_SETTINGS_VERSION = 1;

export type WindowMode = "fullscreen" | "windowed";
export type WindowPreferences = { mode: WindowMode; windowedSize: WindowedSize };
export type LocalSettings = {
  version: number;
  window: { mode: WindowMode; width: number; height: number };
  [key: string]: unknown;
};

export const DEFAULT_WINDOW_PREFERENCES: WindowPreferences = {
  mode: "fullscreen",
  windowedSize: DEFAULT_WINDOWED_SIZE,
};

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  version: LOCAL_SETTINGS_VERSION,
  window: {
    mode: DEFAULT_WINDOW_PREFERENCES.mode,
    width: DEFAULT_WINDOW_PREFERENCES.windowedSize.width,
    height: DEFAULT_WINDOW_PREFERENCES.windowedSize.height,
  },
};

export function readWindowPreferencesFromSettings(settings: unknown): WindowPreferences {
  if (!isRecord(settings) || settings.version !== LOCAL_SETTINGS_VERSION || !isRecord(settings.window)) return DEFAULT_WINDOW_PREFERENCES;
  const storedWindow = settings.window;
  if (storedWindow.mode !== "fullscreen" && storedWindow.mode !== "windowed") {
    return DEFAULT_WINDOW_PREFERENCES;
  }
  if (!finitePositiveNumber(storedWindow.width) || !finitePositiveNumber(storedWindow.height)) return DEFAULT_WINDOW_PREFERENCES;
  return {
    mode: storedWindow.mode,
    windowedSize: normalizeSize({ width: storedWindow.width, height: storedWindow.height as number }),
  };
}

export function updateWindowPreferences(
  settings: unknown,
  mode: WindowMode,
  windowedSize: WindowedSize,
): LocalSettings {
  const base = isRecord(settings) ? { ...settings } : {};
  const normalizedSize = normalizeSize(windowedSize);
  return {
    ...base,
    version: LOCAL_SETTINGS_VERSION,
    window: {
      mode,
      width: normalizedSize.width,
      height: normalizedSize.height,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
