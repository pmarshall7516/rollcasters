import { challengeEventIncrement, type ChallengeEvent } from "./challenges.js";
import { challengeGoal, safeBigInt } from "./collectibles.js";
import type {
  CollectiblePlayerSnapshot,
  CollectibleUnlockChallenge,
  CombatProgressEvent,
  Dungeon,
  UserCollectibleChallengeProgress,
  UserTrackedCollectibleChallenge,
} from "./types.js";

export type LocalChallengePreviewState = {
  progress: UserCollectibleChallengeProgress[];
  tracked: UserTrackedCollectibleChallenge[];
  untrackedChallengeIds: string[];
  processedEventKeys: string[];
};

export function emptyLocalChallengePreviewState(): LocalChallengePreviewState {
  return { progress: [], tracked: [], untrackedChallengeIds: [], processedEventKeys: [] };
}

function progressRow(
  challenge: CollectibleUnlockChallenge,
  current: bigint,
  completed = false,
): UserCollectibleChallengeProgress {
  const goal = challengeGoal(challenge);
  const capped = goal > 0n && current > goal ? goal : current;
  const goalReached = goal > 0n && capped >= goal;
  return {
    challenge_id: challenge.id,
    current: String(capped),
    goal: String(goal),
    goal_reached: goalReached,
    eligible: true,
    completed: completed || goalReached,
    blocked_by_gate_order: null,
    trackable: !(completed || goalReached),
  };
}

export function trackLocalChallenge(
  state: LocalChallengePreviewState,
  challenge: CollectibleUnlockChallenge,
): LocalChallengePreviewState {
  if (state.tracked.some((row) => row.challenge_id === challenge.id)) return state;
  const nextSlot = state.tracked.reduce((highest, row) => Math.max(highest, row.slot_order), 0) + 1;
  const existingProgress = state.progress.find((row) => row.challenge_id === challenge.id);
  return {
    ...state,
    tracked: [...state.tracked, { challenge_id: challenge.id, slot_order: nextSlot }],
    untrackedChallengeIds: state.untrackedChallengeIds.filter((id) => id !== challenge.id),
    progress: existingProgress
      ? state.progress
      : [...state.progress, progressRow(challenge, 0n)],
  };
}

export function untrackLocalChallenge(
  state: LocalChallengePreviewState,
  challengeId: string,
): LocalChallengePreviewState {
  return {
    ...state,
    tracked: state.tracked.filter((row) => row.challenge_id !== challengeId),
    untrackedChallengeIds: state.untrackedChallengeIds.includes(challengeId)
      ? state.untrackedChallengeIds
      : [...state.untrackedChallengeIds, challengeId],
  };
}

function normalizedEventType(eventType: CombatProgressEvent["event_type"]): string {
  const aliases: Partial<Record<CombatProgressEvent["event_type"], ChallengeEvent["type"]>> = {
    deal_damage: "hp_damage_dealt",
    take_damage: "hp_damage_taken",
    use_skill: "skill_resolved",
    knock_out_critters: "critter_knocked_out",
  };
  return aliases[eventType] ?? eventType;
}

function challengeEventFor(event: CombatProgressEvent): ChallengeEvent {
  return {
    eventId: event.event_key,
    type: normalizedEventType(event.event_type) as ChallengeEvent["type"],
    sourceCritterId: event.source_critter_id ?? undefined,
    targetCritterId: event.target_critter_id ?? undefined,
    skillId: event.skill_id ?? undefined,
    amount: event.amount,
    payload: event.payload,
  };
}

export function applyLocalChallengeEvents(
  state: LocalChallengePreviewState,
  challenges: CollectibleUnlockChallenge[],
  events: CombatProgressEvent[],
  dungeons: Pick<Dungeon, "id" | "sort_order">[] = [],
): LocalChallengePreviewState {
  const challengesById = new Map(challenges.map((challenge) => [challenge.id, challenge]));
  const dungeonOrders = new Map(dungeons.map((dungeon) => [dungeon.id, dungeon.sort_order]));
  const trackedIds = new Set(state.tracked.map((row) => row.challenge_id));
  const processed = new Set(state.processedEventKeys);
  const progressById = new Map(state.progress.map((row) => [row.challenge_id, row]));

  for (const event of events) {
    if (processed.has(event.event_key)) continue;
    processed.add(event.event_key);
    const normalized = challengeEventFor(event);
    for (const challengeId of trackedIds) {
      const challenge = challengesById.get(challengeId);
      if (!challenge) continue;
      const increment = BigInt(Math.max(0, Math.floor(challengeEventIncrement(challenge, normalized, dungeonOrders))));
      if (increment <= 0n) continue;
      const previous = progressById.get(challengeId) ?? progressRow(challenge, 0n);
      progressById.set(challengeId, progressRow(
        challenge,
        safeBigInt(previous.current) + increment,
        previous.completed,
      ));
    }
  }

  return {
    ...state,
    progress: [...progressById.values()],
    processedEventKeys: [...processed].slice(-512),
  };
}

export function mergeLocalChallengeSnapshot(
  serverSnapshot: CollectiblePlayerSnapshot,
  localState: LocalChallengePreviewState,
): CollectiblePlayerSnapshot {
  const localProgressById = new Map(localState.progress.map((row) => [row.challenge_id, row]));
  const progress = serverSnapshot.progress.map((serverRow) => {
    const localRow = localProgressById.get(serverRow.challenge_id);
    if (!localRow) return serverRow;
    localProgressById.delete(serverRow.challenge_id);
    const serverCurrent = safeBigInt(serverRow.current);
    const localCurrent = safeBigInt(localRow.current);
    const current = serverCurrent > localCurrent ? serverCurrent : localCurrent;
    return {
      ...serverRow,
      ...localRow,
      current: String(current),
      completed: serverRow.completed || localRow.completed,
      goal_reached: serverRow.goal_reached === true || localRow.goal_reached === true,
    };
  });
  progress.push(...localProgressById.values());

  const blocked = new Set(localState.untrackedChallengeIds);
  const tracked = serverSnapshot.tracked.filter((row) => !blocked.has(row.challenge_id));
  const trackedIds = new Set(tracked.map((row) => row.challenge_id));
  let nextSlot = tracked.reduce((highest, row) => Math.max(highest, row.slot_order), 0);
  for (const row of localState.tracked) {
    if (trackedIds.has(row.challenge_id)) continue;
    nextSlot += 1;
    tracked.push({ ...row, slot_order: nextSlot });
    trackedIds.add(row.challenge_id);
  }

  return { ...serverSnapshot, progress, tracked };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readLocalChallengePreviewState(storage: Storage | null, key: string): LocalChallengePreviewState {
  if (!storage) return emptyLocalChallengePreviewState();
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (!isRecord(parsed)) return emptyLocalChallengePreviewState();
    return {
      progress: Array.isArray(parsed.progress) ? parsed.progress as UserCollectibleChallengeProgress[] : [],
      tracked: Array.isArray(parsed.tracked) ? parsed.tracked as UserTrackedCollectibleChallenge[] : [],
      untrackedChallengeIds: Array.isArray(parsed.untrackedChallengeIds)
        ? parsed.untrackedChallengeIds.filter((id): id is string => typeof id === "string")
        : [],
      processedEventKeys: Array.isArray(parsed.processedEventKeys)
        ? parsed.processedEventKeys.filter((id): id is string => typeof id === "string").slice(-512)
        : [],
    };
  } catch {
    return emptyLocalChallengePreviewState();
  }
}

export function writeLocalChallengePreviewState(
  storage: Storage | null,
  key: string,
  state: LocalChallengePreviewState,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Local preview persistence is best effort; the server remains untouched.
  }
}
