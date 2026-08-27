import {
  CONTROL_PREFERENCE_KEY,
  DEFAULT_CONTROL_BINDINGS,
  controlLabel,
  readControlPreferences,
} from "../src/lib/control-preferences.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
} as unknown as Storage;

assertEqual(readControlPreferences(storage), DEFAULT_CONTROL_BINDINGS, "Missing preferences must use keyboard defaults.");
values.set(CONTROL_PREFERENCE_KEY, JSON.stringify({ "move-up": "ArrowUp", interact: "Enter" }));
assertEqual(readControlPreferences(storage), {
  ...DEFAULT_CONTROL_BINDINGS,
  "move-up": "ArrowUp",
  interact: "Enter",
}, "Stored bindings must override only the configured actions.");
values.set(CONTROL_PREFERENCE_KEY, "not-json");
assertEqual(readControlPreferences(storage), DEFAULT_CONTROL_BINDINGS, "Invalid preferences must fall back to defaults.");
assertEqual(controlLabel("KeyQ"), "Q", "Letter key codes must have readable labels.");
assertEqual(controlLabel("ShiftRight"), "Right Shift", "Modifier key codes must have readable labels.");

console.log("Control preference contract passed.");
