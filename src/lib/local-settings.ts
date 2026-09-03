import { isTauriDesktop } from "./desktop-updater.js";

export const LOCAL_SETTINGS_VERSION = 2;

let localSettings: unknown = null;
let settingsLoaded = false;
let settingsWriteQueue = Promise.resolve();

export function updateLocalSettings(
  current: unknown,
  update: (current: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const base = isRecord(current) ? { ...current } : {};
  const updated = update({ ...base, version: LOCAL_SETTINGS_VERSION });
  return { ...updated, version: LOCAL_SETTINGS_VERSION };
}

export async function loadLocalSettings(): Promise<unknown> {
  if (settingsLoaded) return localSettings;
  settingsLoaded = true;
  if (!isTauriDesktop()) {
    try {
      const raw = typeof window === "undefined" ? null : window.localStorage.getItem(browserSettingsKey());
      localSettings = raw ? JSON.parse(raw) : null;
    } catch {
      localSettings = null;
    }
    return localSettings;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  localSettings = await invoke("read_local_settings");
  return localSettings;
}

export function saveLocalSettings(
  update: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  if (!isTauriDesktop()) {
    localSettings = updateLocalSettings(localSettings, update);
    settingsLoaded = true;
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(browserSettingsKey(), JSON.stringify(localSettings));
    } catch {
      // Browser storage can be disabled; keep the current in-memory settings.
    }
    return Promise.resolve();
  }

  const write = settingsWriteQueue.then(async () => {
    if (!settingsLoaded) await loadLocalSettings();
    localSettings = updateLocalSettings(localSettings, update);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_local_settings", { settings: localSettings });
  });
  settingsWriteQueue = write.catch(() => undefined);
  return write;
}

function browserSettingsKey(): string {
  return `rollcasters:${import.meta.env?.VITE_GAME_PROFILE ?? "local"}:local-settings:v2`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
