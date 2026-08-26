import { DEFAULT_WINDOWED_SIZE, WINDOW_ASPECT_RATIO, limitsForWorkArea, normalizeSize, resizeFromCorner, type WindowRect } from "../src/lib/desktop-window-geometry.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

const desktopLimits = limitsForWorkArea({ x: 0, y: 0, width: 1920, height: 1040 });
assertEqual(desktopLimits, {
  minWidth: DEFAULT_WINDOWED_SIZE.width,
  minHeight: DEFAULT_WINDOWED_SIZE.height,
  maxWidth: 1848,
  maxHeight: 1039,
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
}, "Windowed limits must fit inside the monitor work area.");

const normalized = normalizeSize({ width: 1600, height: 500 });
assertEqual(normalized.width / normalized.height, WINDOW_ASPECT_RATIO, "Normalized window sizes must remain 16:9.");
assertEqual(normalized, { width: 1600, height: 900 }, "Window sizes must normalize to the requested width.");

const startSouthEast: WindowRect = { x: 320, y: 140, width: 1280, height: 720 };
const grownSouthEast = resizeFromCorner(startSouthEast, "south-east", 320, 0, desktopLimits);
assertEqual(grownSouthEast, { x: 320, y: 140, width: 1600, height: 900 }, "South-east resizing must preserve the top-left anchor and aspect ratio.");

const startNorthWest: WindowRect = { x: 320, y: 320, width: 1280, height: 720 };
const grownNorthWest = resizeFromCorner(startNorthWest, "north-west", -320, -180, desktopLimits);
assertEqual(grownNorthWest, { x: 0, y: 140, width: 1600, height: 900 }, "North-west resizing must preserve the bottom-right anchor and aspect ratio.");

const minimumNorthEast = resizeFromCorner(startNorthWest, "north-east", -2000, 2000, desktopLimits);
assertEqual(minimumNorthEast, { x: 320, y: 320, width: 1280, height: 720 }, "Corner resizing must clamp to the minimum clean frame.");

console.log("Desktop window geometry and preference checks passed.");
