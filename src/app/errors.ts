export function errorMessage(error: unknown, fallback: string): string {
  const raw = rawErrorMessage(error, fallback);
  return isStatementTimeoutMessage(raw)
    ? "The save service is busy right now. Please try again."
    : raw;
}

export function rawErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

export function isStatementTimeoutMessage(message: string): boolean {
  return message.toLowerCase().includes("canceling statement due to statement timeout");
}

export function dungeonEntryErrorMessage(error: unknown): string {
  const raw = rawErrorMessage(error, "Unable to start dungeon.");
  if (raw.includes("DUNGEON_ENTRY_TIMEOUT") || isStatementTimeoutMessage(raw)) {
    return "Dungeon entry is taking longer than expected. No combat was started; please try again.";
  }
  return errorMessage(error, "Unable to start dungeon.");
}

export function loadoutErrorMessage(error: unknown, fallback: string): string {
  const raw = errorMessage(error, fallback);
  const messages: Record<string, string> = {
    SKILL_NOT_IN_PUBLISHED_RELEASE: "This Skill is not part of the current published release.",
    ABILITY_NOT_IN_PUBLISHED_RELEASE: "This Ability is not part of the current published release.",
    SKILL_NOT_ALLOWED_FOR_CRITTER: "This Skill is not available for this Critter.",
    ABILITY_NOT_ALLOWED_FOR_ROLLCASTER: "This Ability is not available for this Rollcaster.",
    PLAYER_REVISION_CONFLICT: "Your loadout changed elsewhere. Reloading the latest state…",
    SESSION_DISPLACED: "This account moved to another session.",
  };
  const code = Object.keys(messages).find((candidate) => raw.includes(candidate));
  return code ? messages[code] : raw;
}
