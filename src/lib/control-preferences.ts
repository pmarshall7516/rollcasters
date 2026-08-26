import { useSyncExternalStore } from "react";

export type ControlAction = "move-up" | "move-down" | "move-left" | "move-right" | "interact" | "back";
export type ControlBindings = Record<ControlAction, string>;

export const CONTROL_PREFERENCE_KEY = `rollcasters:${import.meta.env?.VITE_GAME_PROFILE ?? "local"}:control-preferences:v1`;

export const CONTROL_ACTIONS: ReadonlyArray<{ id: ControlAction; label: string }> = [
  { id: "move-up", label: "Move Up" },
  { id: "move-down", label: "Move Down" },
  { id: "move-left", label: "Move Left" },
  { id: "move-right", label: "Move Right" },
  { id: "interact", label: "Interact / Advance" },
  { id: "back", label: "Back" },
];

export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
  "move-up": "KeyW",
  "move-down": "KeyS",
  "move-left": "KeyA",
  "move-right": "KeyD",
  interact: "Space",
  back: "ShiftLeft",
};

const listeners = new Set<() => void>();
let snapshot = readControlPreferences(availableStorage());

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useControlBindings(): ControlBindings {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function readControlPreferences(storage?: Storage | null): ControlBindings {
  if (!storage) return { ...DEFAULT_CONTROL_BINDINGS };
  try {
    const raw = storage.getItem(CONTROL_PREFERENCE_KEY);
    if (!raw) return { ...DEFAULT_CONTROL_BINDINGS };
    const parsed = JSON.parse(raw) as Partial<Record<ControlAction, unknown>>;
    return CONTROL_ACTIONS.reduce((bindings, { id }) => {
      const code = parsed[id];
      bindings[id] = typeof code === "string" && code.length > 0 ? code : DEFAULT_CONTROL_BINDINGS[id];
      return bindings;
    }, {} as ControlBindings);
  } catch {
    return { ...DEFAULT_CONTROL_BINDINGS };
  }
}

export function setControlBinding(action: ControlAction, code: string): ControlBindings {
  const next = { ...snapshot, [action]: code };
  snapshot = next;
  persistControlPreferences(next);
  listeners.forEach((listener) => listener());
  return next;
}

export function resetControlBindings(): ControlBindings {
  const next = { ...DEFAULT_CONTROL_BINDINGS };
  snapshot = next;
  persistControlPreferences(next);
  listeners.forEach((listener) => listener());
  return next;
}

export function controlLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code.startsWith("Key") && code.length === 4) return code.slice(3).toUpperCase();
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad") && code.length > 6) return `Num ${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;

  const labels: Record<string, string> = {
    ArrowUp: "Up Arrow",
    ArrowDown: "Down Arrow",
    ArrowLeft: "Left Arrow",
    ArrowRight: "Right Arrow",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    ControlLeft: "Left Ctrl",
    ControlRight: "Right Ctrl",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
    MetaLeft: "Left Cmd",
    MetaRight: "Right Cmd",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Escape: "Escape",
    CapsLock: "Caps Lock",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
  };
  return labels[code] ?? code;
}

export function isBindableKeyboardEvent(event: KeyboardEvent): boolean {
  return event.code.length > 0 && event.code !== "Unidentified" && event.key !== "Dead";
}

function persistControlPreferences(bindings: ControlBindings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONTROL_PREFERENCE_KEY, JSON.stringify(bindings));
  } catch {
    // Local storage can be disabled in browser harnesses and privacy modes.
  }
}

function availableStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
