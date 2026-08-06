export type NotificationStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function challengeCompletionStorageKey(userId: string): string {
  return `rollcasters:seen-challenge-completions:${encodeURIComponent(userId)}`;
}

export function loadSeenChallengeCompletions(storage: NotificationStorage, userId: string): Set<string> {
  try {
    const raw = storage.getItem(challengeCompletionStorageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0) : []);
  } catch {
    return new Set();
  }
}

export function rememberSeenChallengeCompletion(
  storage: NotificationStorage,
  userId: string,
  seen: Set<string>,
  challengeId: string,
): void {
  seen.add(challengeId);
  try {
    storage.setItem(challengeCompletionStorageKey(userId), JSON.stringify([...seen]));
  } catch {
    // The in-memory set still prevents duplicate banners for this session.
  }
}
