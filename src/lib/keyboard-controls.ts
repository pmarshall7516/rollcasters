export function focusedEnabledControl<T>(
  controls: readonly T[],
  focused: T | null | undefined,
  isEnabled: (control: T) => boolean,
): T | null {
  return focused && controls.includes(focused) && isEnabled(focused) ? focused : null;
}
