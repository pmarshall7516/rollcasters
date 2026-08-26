export type OpponentRevealEvent = {
  actorKey?: string;
  targetKeys: readonly string[];
  swap?: {
    outgoingKey?: string;
    incomingKey?: string;
  };
};

export type OpponentRevealState = {
  encounterKey: string;
  keys: Set<string>;
};

export function updateOpponentRevealState(
  current: OpponentRevealState | null,
  encounterKey: string,
  phase: string,
  activeOpponentKeys: readonly string[],
  events: readonly OpponentRevealEvent[],
): OpponentRevealState {
  const keys = current?.encounterKey === encounterKey
    ? new Set(current.keys)
    : new Set<string>();
  if (phase === "lead_selection") return { encounterKey, keys: new Set<string>() };
  activeOpponentKeys.forEach((key) => keys.add(key));
  for (const event of events) {
    for (const key of [event.actorKey, ...event.targetKeys, event.swap?.outgoingKey, event.swap?.incomingKey]) {
      if (key?.startsWith("o")) keys.add(key);
    }
  }
  return { encounterKey, keys };
}
