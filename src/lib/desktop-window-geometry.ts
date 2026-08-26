export type WindowedSize = { width: number; height: number };
export type ResizeCorner = "north-west" | "north-east" | "south-west" | "south-east";
export type WindowRect = WindowedSize & { x: number; y: number };
export type WindowedLimits = {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
  workArea: { x: number; y: number; width: number; height: number };
};

export const WINDOW_ASPECT_RATIO = 16 / 9;
export const DEFAULT_WINDOWED_SIZE: WindowedSize = { width: 1280, height: 720 };

export function normalizeSize(size: WindowedSize): WindowedSize {
  const width = Math.max(1, Math.round(size.width));
  return { width, height: Math.max(1, Math.round(width / WINDOW_ASPECT_RATIO)) };
}

export function resizeFromCorner(
  start: WindowRect,
  corner: ResizeCorner,
  deltaX: number,
  deltaY: number,
  limits: WindowedLimits,
): WindowRect {
  const horizontal = corner.endsWith("east") ? deltaX : -deltaX;
  const vertical = corner.startsWith("south") ? deltaY : -deltaY;
  const requestedWidthDelta = Math.max(horizontal, vertical * WINDOW_ASPECT_RATIO);
  const maxWidthFromArea = corner.endsWith("east")
    ? limits.workArea.x + limits.workArea.width - start.x
    : start.x + start.width - limits.workArea.x;
  const maxHeightFromArea = corner.startsWith("south")
    ? limits.workArea.y + limits.workArea.height - start.y
    : start.y + start.height - limits.workArea.y;
  const maxWidth = Math.max(limits.minWidth, Math.min(limits.maxWidth, maxWidthFromArea, maxHeightFromArea * WINDOW_ASPECT_RATIO));
  const width = Math.min(maxWidth, Math.max(limits.minWidth, start.width + requestedWidthDelta));
  const height = Math.min(limits.maxHeight, Math.max(limits.minHeight, Math.round(width / WINDOW_ASPECT_RATIO)));
  const x = corner.endsWith("east") ? start.x : start.x + start.width - width;
  const y = corner.startsWith("south") ? start.y : start.y + start.height - height;
  return { x, y, width, height };
}

export function limitsForWorkArea(workArea: WindowedLimits["workArea"]): WindowedLimits {
  const maximumWidth = Math.max(1, Math.floor(Math.min(workArea.width, workArea.height * WINDOW_ASPECT_RATIO)));
  const maximumHeight = Math.max(1, Math.floor(maximumWidth / WINDOW_ASPECT_RATIO));
  const minimumWidth = Math.min(DEFAULT_WINDOWED_SIZE.width, maximumWidth);
  const minimumHeight = Math.min(DEFAULT_WINDOWED_SIZE.height, maximumHeight);
  return {
    minWidth: minimumWidth,
    minHeight: minimumHeight,
    maxWidth: maximumWidth,
    maxHeight: maximumHeight,
    workArea,
  };
}
