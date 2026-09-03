import { useSyncExternalStore } from "react";
import { isTauriDesktop } from "./desktop-updater";
import {
  DEFAULT_WINDOW_PREFERENCES,
  readWindowPreferencesFromSettings,
  resolveNativeResizeMode,
  updateWindowPreferences,
  type WindowPreferences,
} from "./desktop-settings";
import {
  DEFAULT_WINDOWED_SIZE,
  WINDOW_ASPECT_RATIO,
  limitsForWorkArea,
  normalizeSize,
  resizeFromCorner,
  type ResizeCorner,
  type WindowRect,
  type WindowedSize,
} from "./desktop-window-geometry";

export type { ResizeCorner } from "./desktop-window-geometry";

export type { WindowMode } from "./desktop-settings";
import type { WindowMode } from "./desktop-settings";
export type PointerScreenPosition = { screenX: number; screenY: number };
export type DesktopWindowSnapshot = {
  mode: WindowMode;
  windowedSize: WindowedSize;
  ready: boolean;
};

export const WINDOWED_PREFERENCE_KEY = `rollcasters:${import.meta.env?.VITE_GAME_PROFILE ?? "local"}:window-preferences:v1`;

const listeners = new Set<() => void>();
const initialPreferences = isTauriDesktop() ? DEFAULT_WINDOW_PREFERENCES : readLegacyWindowPreferences(availableStorage()) ?? DEFAULT_WINDOW_PREFERENCES;
let snapshot: DesktopWindowSnapshot = {
  mode: initialPreferences.mode,
  windowedSize: initialPreferences.windowedSize,
  ready: !isTauriDesktop(),
};
let initialization: Promise<void> | null = null;
let nativeModeChangeInFlight = false;
let localSettings: unknown = null;
let settingsWriteQueue = Promise.resolve();

function publish(next: Partial<DesktopWindowSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDesktopWindow(): DesktopWindowSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

function readLegacyWindowPreferences(storage?: Storage | null): WindowPreferences | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WINDOWED_PREFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { mode?: unknown; width?: unknown; height?: unknown };
    const isPreviousDefault = parsed.width === 1280 && parsed.height === 720;
    const width = !isPreviousDefault && finitePositiveNumber(parsed.width) ? parsed.width : DEFAULT_WINDOWED_SIZE.width;
    const height = !isPreviousDefault && finitePositiveNumber(parsed.height) ? parsed.height : width / WINDOW_ASPECT_RATIO;
    const mode = parsed.mode === "windowed" ? "windowed" : "fullscreen";
    return { mode, windowedSize: normalizeSize({ width, height }) };
  } catch {
    return null;
  }
}

function clearLegacyWindowPreferences(storage?: Storage | null) {
  if (!storage) return;
  try {
    storage.removeItem(WINDOWED_PREFERENCE_KEY);
  } catch {
    // Local storage can be disabled in browser harnesses and privacy modes.
  }
}

function persistBrowserPreferences(mode: WindowMode, windowedSize: WindowedSize) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WINDOWED_PREFERENCE_KEY, JSON.stringify({ mode, width: windowedSize.width, height: windowedSize.height }));
  } catch {
    // Local storage can be disabled in browser harnesses and privacy modes.
  }
}

async function readLocalSettings(): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("read_local_settings");
}

function persistPreferences(mode: WindowMode, windowedSize: WindowedSize): Promise<void> {
  if (!isTauriDesktop()) {
    persistBrowserPreferences(mode, windowedSize);
    return Promise.resolve();
  }
  localSettings = updateWindowPreferences(localSettings, mode, windowedSize);
  const nextSettings = localSettings;
  const write = settingsWriteQueue.then(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_local_settings", { settings: nextSettings });
  });
  settingsWriteQueue = write.catch(() => undefined);
  return write;
}

function availableStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function finitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function logicalMonitorBounds(monitor: {
  scaleFactor: number;
  workArea: { position: { x: number; y: number }; size: { width: number; height: number } };
}) {
  const scale = monitor.scaleFactor || 1;
  return {
    x: monitor.workArea.position.x / scale,
    y: monitor.workArea.position.y / scale,
    width: monitor.workArea.size.width / scale,
    height: monitor.workArea.size.height / scale,
  };
}

function logicalMonitorScreenBounds(monitor: {
  scaleFactor: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
}) {
  const scale = monitor.scaleFactor || 1;
  return {
    x: monitor.position.x / scale,
    y: monitor.position.y / scale,
    width: monitor.size.width / scale,
    height: monitor.size.height / scale,
  };
}

function notifyViewportChanged() {
  if (typeof window === "undefined") return;
  const refresh = () => window.dispatchEvent(new Event("resize"));
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(refresh);
  } else {
    refresh();
  }
}

async function nativeWindow() {
  if (!isTauriDesktop()) return null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

async function currentWindowedLimits() {
  const [{ currentMonitor }] = await Promise.all([
    import("@tauri-apps/api/window"),
  ]);
  const monitor = await currentMonitor();
  if (!monitor) return limitsForWorkArea({ x: 0, y: 0, width: DEFAULT_WINDOWED_SIZE.width, height: DEFAULT_WINDOWED_SIZE.height });
  return limitsForWorkArea(logicalMonitorBounds(monitor));
}

export async function initializeDesktopWindow(): Promise<void> {
  if (!isTauriDesktop() || initialization) return initialization ?? Promise.resolve();
  initialization = (async () => {
    const appWindow = await nativeWindow();
    if (!appWindow) return;
    let settings: unknown = null;
    try {
      settings = await readLocalSettings();
    } catch (error) {
      console.error("Unable to read Rollcasters local settings.", error);
    }
    localSettings = settings;
    const legacyPreferences = readLegacyWindowPreferences(availableStorage());
    const migratedLegacyPreferences = settings === null && legacyPreferences !== null;
    const preferences = settings === null
      ? legacyPreferences ?? DEFAULT_WINDOW_PREFERENCES
      : readWindowPreferencesFromSettings(settings);
    publish({ mode: preferences.mode, windowedSize: preferences.windowedSize });
    const appliedSize = await applyNativeWindowMode(appWindow, preferences.mode, preferences.windowedSize, true);
    publish({ windowedSize: appliedSize });
    try {
      await persistPreferences(preferences.mode, appliedSize);
      if (migratedLegacyPreferences) clearLegacyWindowPreferences(availableStorage());
    } catch (error) {
      console.error("Unable to save Rollcasters local settings.", error);
    }
    const unlisten = await appWindow.onResized(async ({ payload }) => {
      if (nativeModeChangeInFlight) return;
      const fullscreen = await appWindow.isFullscreen();
      const mode = resolveNativeResizeMode(snapshot.mode, fullscreen);
      if (mode !== "windowed") return;
      const scale = await appWindow.scaleFactor();
      const size = normalizeSize({ width: payload.width / scale, height: payload.height / scale });
      publish({ mode: "windowed", windowedSize: size });
      void persistPreferences("windowed", size).catch((error) => console.error("Unable to save Rollcasters local settings.", error));
    });
    void unlisten;
    let monitorAdjustmentInFlight = false;
    const unlistenMove = await appWindow.onMoved(async () => {
      if (monitorAdjustmentInFlight || snapshot.mode !== "windowed") return;
      monitorAdjustmentInFlight = true;
      try {
        const [{ currentMonitor }, physicalSize, physicalPosition, scale] = await Promise.all([
          import("@tauri-apps/api/window"),
          appWindow.innerSize(),
          appWindow.innerPosition(),
          appWindow.scaleFactor(),
        ]);
        const monitor = await currentMonitor();
        const limits = monitor
          ? limitsForWorkArea(logicalMonitorBounds(monitor))
          : await currentWindowedLimits();
        const size = resizeFromCorner(
          { x: limits.workArea.x, y: limits.workArea.y, ...normalizeSize({ width: physicalSize.width / scale, height: physicalSize.height / scale }) },
          "south-east",
          0,
          0,
          limits,
        );
        const currentX = physicalPosition.x / scale;
        const currentY = physicalPosition.y / scale;
        const x = clamp(currentX, limits.workArea.x, limits.workArea.x + limits.workArea.width - size.width);
        const y = clamp(currentY, limits.workArea.y, limits.workArea.y + limits.workArea.height - size.height);
        const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
        if (size.width !== physicalSize.width / scale || size.height !== physicalSize.height / scale) {
          await appWindow.setSize(new LogicalSize(size.width, size.height));
        }
        if (x !== currentX || y !== currentY) {
          await appWindow.setPosition(new LogicalPosition(x, y));
        }
        publish({ windowedSize: size });
        void persistPreferences("windowed", size).catch((error) => console.error("Unable to save Rollcasters local settings.", error));
      } finally {
        monitorAdjustmentInFlight = false;
      }
    });
    void unlistenMove;
    publish({ ready: true });
  })().catch((error) => {
    console.error("Unable to initialize the Rollcasters desktop window.", error);
    void nativeWindow().then((appWindow) => appWindow?.show()).catch(() => undefined);
    publish({ ready: true });
  });
  return initialization;
}

async function applyNativeWindowMode(
  appWindow: NonNullable<Awaited<ReturnType<typeof nativeWindow>>>,
  mode: WindowMode,
  requestedSize: WindowedSize,
  center: boolean,
): Promise<WindowedSize> {
  const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
  if (mode === "fullscreen") {
    const [{ currentMonitor }] = await Promise.all([
      import("@tauri-apps/api/window"),
    ]);
    const monitor = await currentMonitor();
    const screenBounds = monitor ? logicalMonitorScreenBounds(monitor) : null;
    await appWindow.setSizeConstraints(null);
    await appWindow.setDecorations(false);
    await appWindow.setResizable(false);
    await appWindow.setFullscreen(true);
    // Tauri's borderless fullscreen transition is asynchronous on Windows.
    // Reapply the physical monitor's logical bounds after entering fullscreen
    // so a prior windowed work-area size cannot leave a strip of the desktop
    // visible at the edge of the display.
    if (screenBounds) {
      await appWindow.setPosition(new LogicalPosition(screenBounds.x, screenBounds.y));
      await appWindow.setSize(new LogicalSize(screenBounds.width, screenBounds.height));
    }
    await appWindow.show();
    return requestedSize;
  }

  const limits = await currentWindowedLimits();
  const size = resizeFromCorner(
    { x: limits.workArea.x, y: limits.workArea.y, ...normalizeSize(requestedSize) },
    "south-east",
    0,
    0,
    limits,
  );
  await appWindow.setFullscreen(false);
  await appWindow.setDecorations(false);
  await appWindow.setResizable(false);
  await appWindow.setSizeConstraints({
    minWidth: limits.minWidth,
    minHeight: limits.minHeight,
    maxWidth: limits.maxWidth,
    maxHeight: limits.maxHeight,
  });
  await appWindow.setSize(new LogicalSize(size.width, size.height));
  if (center) {
    await appWindow.setPosition(new LogicalPosition(
      limits.workArea.x + (limits.workArea.width - size.width) / 2,
      limits.workArea.y + (limits.workArea.height - size.height) / 2,
    ));
  }
  await appWindow.show();
  return size;
}

export async function setDesktopWindowMode(mode: WindowMode): Promise<void> {
  if (!isTauriDesktop()) {
    persistBrowserPreferences(mode, snapshot.windowedSize);
    publish({ mode, ready: true });
    return;
  }
  if (initialization) await initialization;
  const appWindow = await nativeWindow();
  if (!appWindow) return;
  const size = snapshot.windowedSize;
  nativeModeChangeInFlight = true;
  try {
    const appliedSize = await applyNativeWindowMode(appWindow, mode, size, true);
    publish({ mode, windowedSize: appliedSize, ready: true });
    await persistPreferences(mode, appliedSize);
    notifyViewportChanged();
  } finally {
    nativeModeChangeInFlight = false;
  }
}

export async function startDesktopCornerResize(corner: ResizeCorner, event: PointerScreenPosition): Promise<void> {
  const appWindow = await nativeWindow();
  if (!appWindow || snapshot.mode !== "windowed") return;
  const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
  const [physicalSize, physicalPosition, monitor, scale] = await Promise.all([
    appWindow.innerSize(),
    appWindow.innerPosition(),
    (await import("@tauri-apps/api/window")).currentMonitor(),
    appWindow.scaleFactor(),
  ]);
  const limits = monitor
    ? limitsForWorkArea(logicalMonitorBounds(monitor))
    : limitsForWorkArea({ x: 0, y: 0, width: DEFAULT_WINDOWED_SIZE.width, height: DEFAULT_WINDOWED_SIZE.height });
  const start: WindowRect = {
    x: physicalPosition.x / scale,
    y: physicalPosition.y / scale,
    width: physicalSize.width / scale,
    height: physicalSize.height / scale,
  };
  let latest: WindowRect | null = null;
  let writeInFlight = false;
  let stopped = false;
  let frame = 0;

  const flush = async () => {
    if (writeInFlight || !latest) return;
    writeInFlight = true;
    const next = latest;
    latest = null;
    try {
      await appWindow.setSize(new LogicalSize(next.width, next.height));
      if (corner.startsWith("north") || corner.endsWith("west")) {
        await appWindow.setPosition(new LogicalPosition(next.x, next.y));
      }
      publish({ windowedSize: { width: next.width, height: next.height } });
      void persistPreferences("windowed", { width: next.width, height: next.height }).catch((error) => console.error("Unable to save Rollcasters local settings.", error));
    } finally {
      writeInFlight = false;
      if (latest && !stopped) frame = window.requestAnimationFrame(() => void flush());
    }
  };
  const onMove = (moveEvent: PointerEvent) => {
    latest = resizeFromCorner(start, corner, moveEvent.screenX - event.screenX, moveEvent.screenY - event.screenY, limits);
    if (!frame) frame = window.requestAnimationFrame(() => {
      frame = 0;
      void flush();
    });
  };
  const onStop = () => {
    stopped = true;
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onStop);
    window.removeEventListener("pointercancel", onStop);
    void flush();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onStop, { once: true });
  window.addEventListener("pointercancel", onStop, { once: true });
  latest = resizeFromCorner(start, corner, 0, 0, limits);
  void flush();
}
