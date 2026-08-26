import { focusedEnabledControl } from "../src/lib/keyboard-controls.js";

type Control = { id: string; enabled: boolean };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const defaultControl: Control = { id: "default", enabled: true };
const hoveredControl: Control = { id: "hovered", enabled: true };
const disabledControl: Control = { id: "disabled", enabled: false };
const controls = [defaultControl, hoveredControl, disabledControl];

assert(
  focusedEnabledControl(controls, hoveredControl, (control) => control.enabled) === hoveredControl,
  "Interact must activate the current keyboard-focused combat control instead of the default control.",
);
assert(
  focusedEnabledControl(controls, disabledControl, (control) => control.enabled) === null,
  "A disabled keyboard-focused combat control must defer to the contextual fallback.",
);

console.log("Keyboard Interact focus selection regression passed.");
