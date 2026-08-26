import {
  createInitialCombatState,
  recomputeCombatStats,
  refreshSetupRuntimeEffects,
  resolveTurn,
  startTurn,
  splitCombatNarration,
  type CombatModifier,
  type CombatPresentationState,
  type CombatStatus,
  type CombatState,
  type RuntimeEffectInstance,
} from "./game.js";
import { battlefieldSlotsForCount, enemyEncounterForBattle, opponentsForBattle, parseBattleFormat } from "./dungeons.js";
import type {
  Catalog,
  CombatAction,
  Dungeon,
  DungeonBattleResult,
  DungeonRewardSummary,
  DungeonRunSnapshot,
  PlayerState,
} from "./types.js";

export type DungeonCombatPhase =
  | "lead_selection"
  | "entry_dialogue"
  | "await_roll"
  | "roll_result"
  | "select_player_actions"
  | "event_playback"
  | "forced_replacements"
  | "battle_result"
  | "outcome_dialogue"
  | "encounter_rewards"
  | "dungeon_complete"
  | "dungeon_failed";

export type DungeonCombatEvent = {
  id: string;
  turn: number;
  phase: string;
  message: string;
  requiresAdvance: boolean;
  kind: "skill" | "damage" | "heal" | "swap" | "block" | "wait" | "status" | "other" | "mana_refund";
  effectPolarity?: "positive" | "negative";
  actorKey?: string;
  targetKeys: string[];
  skillId?: string;
  damageRollPercent?: number;
  damageSpreadPercent?: number;
  manaRefund?: {
    side: "player" | "opponent";
    amount: number;
  };
  swap?: {
    outgoingKey: string;
    incomingKey: string;
    battlefieldSlot: number;
  };
  hpChanges: Array<{
    unitKey: string;
    before: number;
    after: number;
  }>;
  state?: CombatPresentationState;
};

export type DungeonRunState = {
  run: DungeonRunSnapshot;
  dungeon: Dungeon;
  battle: CombatState;
  pendingBattle: CombatState | null;
  phase: DungeonCombatPhase;
  selectedLeadIds: string[];
  requiredLeadCount: number;
  fixedLeadIds: string[];
  rollSummary: { player: number; opponent: number } | null;
  events: DungeonCombatEvent[];
  eventCursor: number;
  participatedUserCritterIds: string[];
  lastBattleRewards: DungeonRewardSummary | null;
  dungeonRewards: DungeonRewardSummary | null;
  nextDungeonId: string | null;
  nextPhaseAfterRewards: "lead_selection" | "entry_dialogue" | null;
  dialogueMoment: "entry" | "victory" | "defeat" | null;
};

function encounterDungeon(dungeon: Dungeon, run: DungeonRunSnapshot): Dungeon {
  const counts = parseBattleFormat(run.battleFormat);
  return {
    ...dungeon,
    battle_format: run.battleFormat,
    battle_count: run.battleCount,
    encounter_count: run.battleCount,
    player_active_count: counts.playerActiveCount,
    opponent_active_count: counts.opponentActiveCount,
  };
}

function createEncounterBattle(
  catalog: Catalog,
  player: PlayerState,
  dungeon: Dungeon,
  run: DungeonRunSnapshot,
  persistentHp?: Record<string, number>,
  dungeonSkillUsage: Record<string, number> = {},
  previousBattle?: CombatState,
): CombatState {
  const battle = createInitialCombatState(
    catalog,
    player,
    encounterDungeon(dungeon, run),
    `${run.id}:${run.battleIndex}`,
    opponentsForBattle(run),
    `${run.randomSeed}:${run.battleIndex}`,
    enemyEncounterForBattle(run)?.enemyRollcaster,
  );
  const opponentSlots = battlefieldSlotsForCount(parseBattleFormat(run.battleFormat).opponentActiveCount);
  const encounterBattle: CombatState = {
    ...battle,
    playerUnits: battle.playerUnits.map((unit) => ({
      ...unit,
      hp: Math.min(unit.maxHp, Math.max(0, persistentHp?.[unit.userCritter?.id ?? ""] ?? unit.maxHp)),
      shield: 0,
      maxShield: 0,
      active: false,
      battlefieldSlot: null,
    })),
    opponentUnits: battle.opponentUnits.map((unit, index) => ({
      ...unit,
      active: index < parseBattleFormat(run.battleFormat).opponentActiveCount,
      battlefieldSlot: opponentSlots[index] ?? null,
    })),
    phase: "ready",
    playerMana: 0,
    opponentMana: 0,
    turn: 1,
    skillUsage: { encounter: {}, dungeon: { ...dungeonSkillUsage } },
    rechargeUntilTurn: {},
  };
  return previousBattle ? carryPlayerStatuses(encounterBattle, previousBattle) : encounterBattle;
}

/**
 * Preserve live player Status instances between Dungeon encounters. Statuses
 * keep their current duration and attached runtime state, while references to
 * the prior encounter's opponents are intentionally discarded.
 */
function carryPlayerStatuses(nextBattle: CombatState, previousBattle: CombatState): CombatState {
  const nextPlayerKeyByUserCritterId = new Map(
    nextBattle.playerUnits
      .filter((unit) => unit.userCritter)
      .map((unit) => [unit.userCritter!.id, unit.key] as const),
  );
  const keyMap = new Map<string, string>();
  for (const previousUnit of previousBattle.playerUnits) {
    const userCritterId = previousUnit.userCritter?.id;
    const nextKey = userCritterId ? nextPlayerKeyByUserCritterId.get(userCritterId) : undefined;
    if (nextKey) keyMap.set(previousUnit.key, nextKey);
  }

  const carriedStatusEntries = previousBattle.statuses
    .filter((status) => (status.duration === null || Number(status.duration) > 0) && keyMap.has(status.holderKey))
    .map((status) => ({
      previous: status,
      current: {
        ...status,
        holderKey: keyMap.get(status.holderKey)!,
        sourceCritterKey: status.sourceCritterKey ? keyMap.get(status.sourceCritterKey) : undefined,
        effects: structuredClone(status.effects),
      },
    }));
  if (carriedStatusEntries.length === 0) return nextBattle;

  const statusInstanceIdMap = new Map(
    carriedStatusEntries.map(({ previous, current }) => [previous.instanceId, current.instanceId] as const),
  );
  const carriedStatusIds = new Set(carriedStatusEntries.map(({ current }) => current.instanceId));
  const mapSourceKey = (key: string | undefined) => key ? keyMap.get(key) : undefined;

  const carriedModifiers: CombatModifier[] = previousBattle.modifiers.flatMap((modifier) => {
    if (!modifier.statusInstanceId || !statusInstanceIdMap.has(modifier.statusInstanceId)) return [];
      const holderKey = keyMap.get(modifier.holderKey);
      const statusInstanceId = modifier.statusInstanceId ? statusInstanceIdMap.get(modifier.statusInstanceId) : undefined;
      return holderKey && statusInstanceId
        ? [{
            ...modifier,
            holderKey,
            sourceCritterKey: mapSourceKey(modifier.sourceCritterKey),
            statusInstanceId,
          }]
        : [];
  });

  const carriedRuntimeCandidates = previousBattle.runtimeEffects.filter((instance) => {
    if (instance.sourceOwnerType !== "status" || !instance.sourceCritterKey) return false;
    const status = previousBattle.statuses.find((candidate) => (
      candidate.statusId === instance.sourceOwnerId && candidate.holderKey === instance.sourceCritterKey
    ));
    if (!status || !carriedStatusIds.has(statusInstanceIdMap.get(status.instanceId) ?? "")) return false;
    return !instance.targetCritterKey || keyMap.has(instance.targetCritterKey);
  });
  let effectSequence = nextBattle.effectSequence;
  const runtimeIdMap = new Map<string, string>();
  for (const instance of carriedRuntimeCandidates) {
    effectSequence += 1;
    runtimeIdMap.set(instance.instanceId, `runtime:${effectSequence}:carry:${instance.sourceEffectId}`);
  }
  const carriedRuntimeEffects: RuntimeEffectInstance[] = carriedRuntimeCandidates.map((instance) => {
    const effect = nextBattle.runEffects.status[instance.sourceOwnerId]?.find((candidate) => candidate.id === instance.sourceEffectId);
    const activationScope = String(effect?.parameters.activation_limit_scope ?? "battle");
    const resetActivation = activationScope === "battle" || activationScope === "per_target_battle";
    const sourceCritterKey = mapSourceKey(instance.sourceCritterKey);
    const targetCritterKey = mapSourceKey(instance.targetCritterKey);
    return {
      ...instance,
      instanceId: runtimeIdMap.get(instance.instanceId)!,
      sourceCritterKey,
      targetCritterKey,
      appliedAtSequence: Number(runtimeIdMap.get(instance.instanceId)?.split(":")[1] ?? effectSequence),
      activationCount: resetActivation ? 0 : instance.activationCount,
      conditionalParentInstanceId: instance.conditionalParentInstanceId
        ? runtimeIdMap.get(instance.conditionalParentInstanceId)
        : undefined,
      state: {
        ...structuredClone(instance.state),
        ...(resetActivation ? { activationCountsByTarget: {} } : {}),
        cooldownRemaining: 0,
      },
    };
  });

  return recomputeCombatStats({
    ...nextBattle,
    statuses: carriedStatusEntries.map(({ current }) => current as CombatStatus),
    modifiers: [
      ...nextBattle.modifiers,
      ...carriedModifiers.map((modifier) => ({
        ...modifier,
        conditionalParentInstanceId: modifier.conditionalParentInstanceId
          ? runtimeIdMap.get(modifier.conditionalParentInstanceId)
          : undefined,
      })),
    ],
    runtimeEffects: [...nextBattle.runtimeEffects, ...carriedRuntimeEffects],
    effectSequence,
  });
}

function leadRequirement(battle: CombatState, run: DungeonRunSnapshot): number {
  const healthy = battle.playerUnits.filter((unit) => unit.hp > 0).length;
  return Math.min(parseBattleFormat(run.battleFormat).playerActiveCount, healthy);
}

function defaultLeadIds(battle: CombatState, count: number): string[] {
  return battle.playerUnits
    .filter((unit) => unit.hp > 0 && unit.userCritter)
    .slice(0, count)
    .map((unit) => unit.userCritter!.id);
}

export function createDungeonRunState(
  catalog: Catalog,
  player: PlayerState,
  dungeon: Dungeon,
  run: DungeonRunSnapshot,
): DungeonRunState {
  const battle = createEncounterBattle(catalog, player, dungeon, run);
  const requiredLeadCount = leadRequirement(battle, run);
  const healthyCount = battle.playerUnits.filter((unit) => unit.hp > 0).length;
  const automatic = requiredLeadCount > 0
    && healthyCount <= parseBattleFormat(run.battleFormat).playerActiveCount;
  const selectedLeadIds = automatic ? defaultLeadIds(battle, requiredLeadCount) : [];
  const initial: DungeonRunState = {
    run,
    dungeon,
    battle,
    pendingBattle: null,
    phase: automatic && requiredLeadCount > 0 ? "await_roll" : "lead_selection",
    selectedLeadIds,
    requiredLeadCount,
    fixedLeadIds: [],
    rollSummary: null,
    events: [],
    eventCursor: -1,
    participatedUserCritterIds: [],
    lastBattleRewards: null,
    dungeonRewards: null,
    nextDungeonId: null,
    nextPhaseAfterRewards: null,
    dialogueMoment: automatic && requiredLeadCount > 0 ? "entry" : null,
  };
  return automatic && requiredLeadCount > 0
    ? { ...activateSelectedLeads(initial, selectedLeadIds), phase: "entry_dialogue" }
    : initial;
}

function activateSelectedLeads(state: DungeonRunState, selectedLeadIds: string[]): DungeonRunState {
  const selected = new Set(selectedLeadIds);
  const configuredSlots = battlefieldSlotsForCount(parseBattleFormat(state.run.battleFormat).playerActiveCount);
  const fixedSlots = new Map(
    state.battle.playerUnits
      .filter((unit) =>
        unit.userCritter
        && state.fixedLeadIds.includes(unit.userCritter.id)
        && selected.has(unit.userCritter.id)
        && unit.battlefieldSlot !== null
        && configuredSlots.includes(unit.battlefieldSlot),
      )
      .map((unit) => [unit.userCritter!.id, unit.battlefieldSlot!] as const),
  );
  const occupiedSlots = new Set(fixedSlots.values());
  const availableSlots = configuredSlots.filter((slot) => !occupiedSlots.has(slot));
  const assignedSlots = new Map<string, number>(fixedSlots);
  for (const id of selectedLeadIds) {
    if (assignedSlots.has(id)) continue;
    const slot = availableSlots.shift();
    if (slot !== undefined) assignedSlots.set(id, slot);
  }
  const playerUnits = state.battle.playerUnits.map((unit) => {
    const active = Boolean(unit.userCritter && selected.has(unit.userCritter.id) && unit.hp > 0);
    return {
      ...unit,
      active,
      battlefieldSlot: active && unit.userCritter ? assignedSlots.get(unit.userCritter.id) ?? null : null,
    };
  });
  const participants = new Set(state.participatedUserCritterIds);
  for (const unit of playerUnits) {
    if (unit.active && unit.userCritter) participants.add(unit.userCritter.id);
  }
  const activatedBattle = refreshSetupRuntimeEffects(
    { ...state.battle, playerUnits },
    { applyRootShields: state.battle.turn === 1 },
  );
  return {
    ...state,
    battle: recomputeCombatStats(activatedBattle),
    selectedLeadIds,
    participatedUserCritterIds: [...participants],
    phase: "await_roll",
  };
}

export function toggleDungeonLead(state: DungeonRunState, userCritterId: string): DungeonRunState {
  if (state.phase !== "lead_selection" && state.phase !== "forced_replacements") return state;
  if (state.fixedLeadIds.includes(userCritterId)) return state;
  const unit = state.battle.playerUnits.find((candidate) => candidate.userCritter?.id === userCritterId);
  if (!unit || unit.hp <= 0) return state;
  const selected = new Set(state.selectedLeadIds);
  if (selected.has(userCritterId)) selected.delete(userCritterId);
  else if (selected.size < state.requiredLeadCount) selected.add(userCritterId);
  return { ...state, selectedLeadIds: [...selected] };
}

export function confirmDungeonLeads(state: DungeonRunState): DungeonRunState {
  if (state.selectedLeadIds.length !== state.requiredLeadCount || state.requiredLeadCount < 1) return state;
  const activated = activateSelectedLeads(state, state.selectedLeadIds);
  if (state.phase === "lead_selection") {
    return { ...activated, phase: "entry_dialogue", dialogueMoment: "entry" };
  }
  if (state.phase !== "forced_replacements") return state;

  const playback = createReplacementPlayback(state, state.battle, activated.battle, "player");
  return playback ?? { ...activated, phase: "await_roll", dialogueMoment: null };
}

export function currentDungeonDialogue(state: DungeonRunState) {
  const encounter = enemyEncounterForBattle(state.run);
  if (!encounter || !state.dialogueMoment) return null;
  const line = state.dialogueMoment === "entry"
    ? encounter.entryLine
    : state.dialogueMoment === "victory" ? encounter.victoryLine : encounter.defeatLine;
  return line ? { speaker: encounter.enemyRollcaster.name, line: line.line_text, moment: state.dialogueMoment } : null;
}

export function outcomePhaseForBattle(state: DungeonRunState, moment: "victory" | "defeat"): DungeonRunState {
  const dialogueState: DungeonRunState = {
    ...state,
    phase: "outcome_dialogue",
    dialogueMoment: moment,
  };
  return currentDungeonDialogue(dialogueState)
    ? dialogueState
    : { ...state, phase: "battle_result", dialogueMoment: null };
}

export function continueDungeonDialogue(state: DungeonRunState): DungeonRunState {
  if (state.phase === "entry_dialogue") return { ...state, phase: "await_roll", dialogueMoment: null };
  if (state.phase === "outcome_dialogue") return { ...state, phase: "battle_result", dialogueMoment: null };
  return state;
}

export function rollDungeonDice(state: DungeonRunState): DungeonRunState {
  if (state.phase !== "await_roll") return state;
  const before = state.battle;
  const resolved = startTurn(before);
  const player = resolved.playerUnits.reduce(
    (sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0),
    0,
  );
  const opponent = resolved.opponentUnits.reduce(
    (sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0),
    0,
  );
  const events = resolved.presentationEvents.map((presentation, index): DungeonCombatEvent => ({
    ...presentation,
    id: `${state.run.id}:${state.run.battleIndex}:${before.turn}:start:${index + 1}`,
    turn: before.turn,
    phase: "start_turn",
    requiresAdvance: true,
  }));
  const battle = events.length ? startTurnPlaybackBase(before, resolved, player, opponent) : resolved;
  return {
    ...state,
    battle,
    pendingBattle: events.length ? resolved : null,
    phase: "roll_result",
    rollSummary: { player, opponent },
    events,
    eventCursor: -1,
  };
}

export function continueAfterRoll(state: DungeonRunState): DungeonRunState {
  if (state.phase !== "roll_result") return state;
  if (state.pendingBattle && state.events.length) {
    return {
      ...state,
      battle: applyEventState(state.battle, state.events[0]),
      phase: "event_playback",
      eventCursor: 0,
    };
  }
  return { ...state, phase: "select_player_actions" };
}

function startTurnPlaybackBase(before: CombatState, resolved: CombatState, playerRoll: number, opponentRoll: number): CombatState {
  const rolledUnits = new Map([...resolved.playerUnits, ...resolved.opponentUnits].map((unit) => [unit.key, unit]));
  const withDice = (unit: CombatState["playerUnits"][number]) => {
    const rolled = rolledUnits.get(unit.key);
    return { ...unit, blocking: false, blockStreak: rolled?.blockStreak ?? unit.blockStreak, manaRoll: rolled?.manaRoll ?? 0 };
  };
  return {
    ...before,
    playerUnits: before.playerUnits.map(withDice),
    opponentUnits: before.opponentUnits.map(withDice),
    playerMana: before.playerMana + playerRoll,
    opponentMana: before.opponentMana + opponentRoll,
    rngState: resolved.rngState,
    phase: "selecting",
    presentationEvents: [],
    turnEvents: resolved.turnEvents,
    log: [`Turn ${before.turn}: player rolled ${playerRoll} mana, opponents rolled ${opponentRoll} mana.`, ...before.log],
  };
}

function resolvedMessages(before: CombatState, after: CombatState): string[] {
  const addedCount = Math.max(0, after.log.length - before.log.length);
  return after.log.slice(0, addedCount).reverse();
}

function restoreNarrationEvents(events: DungeonCombatEvent[], eventCursor: number): { events: DungeonCombatEvent[]; eventCursor: number } {
  const restored: DungeonCombatEvent[] = [];
  let restoredCursor = eventCursor < 0 ? -1 : 0;
  for (const [index, event] of events.entries()) {
    const messages = splitCombatNarration(event.message);
    if (index < eventCursor) restoredCursor += messages.length;
    else if (index === eventCursor) restoredCursor = restored.length;
    messages.forEach((message, messageIndex) => {
      restored.push({
        ...event,
        id: messageIndex === 0 ? event.id : `${event.id}:sentence:${messageIndex + 1}`,
        message,
      });
    });
  }
  return { events: restored, eventCursor: restoredCursor };
}

function applyEventState(battle: CombatState, event: DungeonCombatEvent | undefined, preserveFormation = false): CombatState {
  if (event?.state) {
    const units = new Map(event.state.units.map((unit) => [unit.key, unit]));
    const update = (unit: CombatState["playerUnits"][number]) => {
      const snapshot = units.get(unit.key);
      if (!snapshot) return unit;
      return {
        ...unit,
        hp: snapshot.hp,
        maxHp: snapshot.maxHp,
        shield: snapshot.shield,
        maxShield: snapshot.maxShield,
        blocking: snapshot.blocking,
        blockStreak: snapshot.blockStreak ?? unit.blockStreak,
        active: preserveFormation ? unit.active : snapshot.active,
        battlefieldSlot: preserveFormation ? unit.battlefieldSlot : snapshot.battlefieldSlot,
        persistentStats: { ...snapshot.persistentStats },
        stats: { ...snapshot.stats },
      };
    };
    return {
      ...battle,
      playerMana: event.state.playerMana,
      opponentMana: event.state.opponentMana,
      playerUnits: battle.playerUnits.map(update),
      opponentUnits: battle.opponentUnits.map(update),
      statuses: structuredClone(event.state.statuses),
      modifiers: structuredClone(event.state.modifiers),
      runtimeEffects: structuredClone(event.state.runtimeEffects),
    };
  }
  if (!event?.hpChanges.length) return battle;
  const hpByKey = new Map(event.hpChanges.map((change) => [change.unitKey, change.after]));
  const update = (unit: CombatState["playerUnits"][number]) => hpByKey.has(unit.key)
    ? { ...unit, hp: hpByKey.get(unit.key)! }
    : unit;
  return {
    ...battle,
    playerUnits: battle.playerUnits.map(update),
    opponentUnits: battle.opponentUnits.map(update),
  };
}

function applyEventSwap(battle: CombatState, event: DungeonCombatEvent | undefined): CombatState {
  const swap = event?.swap;
  if (!swap) return battle;
  const allUnits = [...battle.playerUnits, ...battle.opponentUnits];
  const outgoing = allUnits.find((unit) => unit.key === swap.outgoingKey);
  const incoming = allUnits.find((unit) => unit.key === swap.incomingKey);
  if (!outgoing || !incoming || incoming.hp <= 0) return battle;
  if (
    !outgoing.active
    && outgoing.battlefieldSlot === null
    && incoming.active
    && incoming.battlefieldSlot === swap.battlefieldSlot
  ) return battle;
  const update = (unit: CombatState["playerUnits"][number]) => {
    if (unit.key === swap.outgoingKey) return { ...unit, active: false, battlefieldSlot: null };
    if (unit.key === swap.incomingKey) return { ...unit, active: true, battlefieldSlot: swap.battlefieldSlot };
    return unit;
  };
  return recomputeCombatStats(refreshSetupRuntimeEffects({
    ...battle,
    playerUnits: battle.playerUnits.map(update),
    opponentUnits: battle.opponentUnits.map(update),
  }));
}

function presentationStateForBattle(battle: CombatState): CombatPresentationState {
  return {
    playerMana: battle.playerMana,
    opponentMana: battle.opponentMana,
    units: [...battle.playerUnits, ...battle.opponentUnits].map((unit) => ({
      key: unit.key,
      hp: unit.hp,
      maxHp: unit.maxHp,
      shield: unit.shield,
      maxShield: unit.maxShield,
      blocking: unit.blocking,
      blockStreak: unit.blockStreak,
      active: unit.active,
      battlefieldSlot: unit.battlefieldSlot,
      persistentStats: { ...unit.persistentStats },
      stats: { ...unit.stats },
    })),
    statuses: structuredClone(battle.statuses),
    modifiers: structuredClone(battle.modifiers),
    runtimeEffects: structuredClone(battle.runtimeEffects),
  };
}

function swapBattleFormation(
  battle: CombatState,
  outgoingKey: string,
  incomingKey: string,
  battlefieldSlot: number,
): CombatState {
  const update = (unit: CombatState["playerUnits"][number]) => {
    if (unit.key === outgoingKey) return { ...unit, active: false, battlefieldSlot: null };
    if (unit.key === incomingKey) return { ...unit, active: true, battlefieldSlot };
    return unit;
  };
  return recomputeCombatStats(refreshSetupRuntimeEffects({
    ...battle,
    playerUnits: battle.playerUnits.map(update),
    opponentUnits: battle.opponentUnits.map(update),
  }));
}

function sendOutMessage(state: DungeonRunState, side: "player" | "opponent", incomingName: string): string {
  if (side === "player") return `You sent in ${incomingName}.`;
  return `${enemyEncounterForBattle(state.run)?.enemyRollcaster.name ?? "The enemy"} sent out ${incomingName}.`;
}

function createReplacementPlayback(
  state: DungeonRunState,
  before: CombatState,
  after: CombatState,
  side: "player" | "opponent",
): DungeonRunState | null {
  const beforeUnits = side === "player" ? before.playerUnits : before.opponentUnits;
  const afterUnits = side === "player" ? after.playerUnits : after.opponentUnits;
  const incomingKeys = afterUnits
    .filter((unit) => unit.active && !beforeUnits.some((candidate) => candidate.key === unit.key && candidate.active))
    .sort((left, right) => (left.battlefieldSlot ?? Number.MAX_SAFE_INTEGER) - (right.battlefieldSlot ?? Number.MAX_SAFE_INTEGER))
    .map((unit) => unit.key);
  if (!incomingKeys.length) return null;

  let current = before;
  const events: DungeonCombatEvent[] = [];
  for (const incomingKey of incomingKeys) {
    const incoming = afterUnits.find((unit) => unit.key === incomingKey);
    if (!incoming || incoming.battlefieldSlot === null) continue;
    const outgoing = (side === "player" ? current.playerUnits : current.opponentUnits)
      .find((unit) => unit.active && unit.hp <= 0 && unit.battlefieldSlot === incoming.battlefieldSlot);
    if (!outgoing) continue;
    const next = swapBattleFormation(current, outgoing.key, incoming.key, incoming.battlefieldSlot);
    events.push({
      id: `${state.run.id}:${state.run.battleIndex}:${before.turn}:replacement:${events.length + 1}`,
      turn: before.turn,
      phase: "replacement",
      message: sendOutMessage(state, side, incoming.name),
      requiresAdvance: true,
      kind: "swap",
      actorKey: outgoing.key,
      targetKeys: [incoming.key],
      swap: { outgoingKey: outgoing.key, incomingKey: incoming.key, battlefieldSlot: incoming.battlefieldSlot },
      hpChanges: [],
      state: presentationStateForBattle(next),
    });
    current = next;
  }
  if (!events.length) return null;
  return {
    ...state,
    battle: before,
    pendingBattle: after,
    phase: "event_playback",
    events,
    eventCursor: 0,
    dialogueMoment: null,
  };
}

export function submitDungeonActions(state: DungeonRunState, actions: CombatAction[]): DungeonRunState {
  if (state.phase !== "select_player_actions") return state;
  const resolved = resolveTurn(state.battle, actions);
  const rawPresentationEvents = resolved.presentationEvents.length
    ? resolved.presentationEvents
    : resolvedMessages(state.battle, resolved)
      .filter((message) => !message.startsWith("Submitted actions") && message !== "Post-turn effects resolved.")
      .map((message) => ({
        kind: "other" as const,
        message,
        targetKeys: [],
        hpChanges: [],
      }));
  const presentationEvents = rawPresentationEvents.map((event) => {
    if (event.kind !== "swap") return event;
    const incomingKey = event.swap?.incomingKey ?? event.targetKeys[0];
    const incoming = incomingKey
      ? [...resolved.playerUnits, ...resolved.opponentUnits].find((unit) => unit.key === incomingKey)
      : undefined;
    const actor = event.actorKey
      ? [...resolved.playerUnits, ...resolved.opponentUnits].find((unit) => unit.key === event.actorKey)
      : undefined;
    return incoming && actor
      ? { ...event, message: sendOutMessage(state, actor.side, incoming.name) }
      : event;
  });
  const events = presentationEvents.map((presentation, index): DungeonCombatEvent => ({
    ...presentation,
    id: `${state.run.id}:${state.run.battleIndex}:${state.battle.turn}:${index + 1}`,
    turn: state.battle.turn,
    phase: "resolution",
    requiresAdvance: true,
  }));
  if (events.length === 0) return finishResolvedTurn({ ...state, battle: resolved });
  return {
    ...state,
    battle: applyEventState(state.battle, events[0], events[0].kind === "swap"),
    pendingBattle: resolved,
    phase: "event_playback",
    events,
    eventCursor: 0,
  };
}

export function currentDungeonEvent(state: DungeonRunState): DungeonCombatEvent | null {
  if (state.phase !== "event_playback") return null;
  const event = state.events[state.eventCursor];
  if (!event || event.kind !== "swap" || event.swap || !event.actorKey || !event.targetKeys[0]) {
    return event ?? null;
  }
  const allUnits = [...state.battle.playerUnits, ...state.battle.opponentUnits];
  const outgoing = allUnits.find((unit) => unit.key === event.actorKey);
  const incoming = allUnits.find((unit) => unit.key === event.targetKeys[0]);
  const battlefieldSlot = outgoing?.battlefieldSlot ?? incoming?.battlefieldSlot;
  if (!outgoing || !incoming || battlefieldSlot === null || battlefieldSlot === undefined) return event;
  return {
    ...event,
    swap: {
      outgoingKey: outgoing.key,
      incomingKey: incoming.key,
      battlefieldSlot,
    },
  };
}

export function revealDungeonSwapEvent(state: DungeonRunState): DungeonRunState {
  if (state.phase !== "event_playback") return state;
  const event = currentDungeonEvent(state);
  if (!event?.swap) return state;
  return {
    ...state,
    battle: applyEventSwap(state.battle, event),
  };
}

export function advanceDungeonEvent(state: DungeonRunState): DungeonRunState {
  if (state.phase !== "event_playback" || !state.pendingBattle) return state;
  if (state.eventCursor < state.events.length - 1) {
    const nextCursor = state.eventCursor + 1;
    const revealed = revealDungeonSwapEvent(state);
    return {
      ...revealed,
      battle: applyEventState(revealed.battle, state.events[nextCursor], state.events[nextCursor].kind === "swap"),
      eventCursor: nextCursor,
    };
  }
  if (state.events[0]?.phase === "start_turn") {
    return {
      ...state,
      battle: state.pendingBattle,
      pendingBattle: null,
      phase: "select_player_actions",
      events: [],
      eventCursor: -1,
    };
  }
  return finishResolvedTurn({
    ...state,
    battle: state.pendingBattle,
    pendingBattle: null,
    events: [],
    eventCursor: -1,
  });
}

function finishResolvedTurn(state: DungeonRunState): DungeonRunState {
  const participants = new Set(state.participatedUserCritterIds);
  for (const unit of state.battle.playerUnits) {
    if (unit.active && unit.userCritter) participants.add(unit.userCritter.id);
  }
  state = { ...state, participatedUserCritterIds: [...participants] };
  const activeHealthy = state.battle.playerUnits.filter((unit) => unit.active && unit.hp > 0);
  const allHealthy = state.battle.playerUnits.filter((unit) => unit.hp > 0);
  const opponentsAlive = state.battle.opponentUnits.some((unit) => unit.hp > 0);
  if (!opponentsAlive) return outcomePhaseForBattle(state, "defeat");
  if (allHealthy.length === 0) return outcomePhaseForBattle(state, "victory");
  const opponentCapacity = parseBattleFormat(state.run.battleFormat).opponentActiveCount;
  const healthyActiveOpponents = state.battle.opponentUnits.filter((unit) => unit.active && unit.hp > 0);
  const healthyOpponentCount = state.battle.opponentUnits.filter((unit) => unit.hp > 0).length;
  const requiredOpponents = Math.min(opponentCapacity, healthyOpponentCount);
  if (healthyActiveOpponents.length < requiredOpponents) {
    const configuredSlots = battlefieldSlotsForCount(opponentCapacity);
    const occupied = new Set(healthyActiveOpponents.map((unit) => unit.battlefieldSlot).filter((slot): slot is number => slot !== null));
    const available = configuredSlots.filter((slot) => !occupied.has(slot));
    const reserves = state.battle.opponentUnits.filter((unit) => !unit.active && unit.hp > 0);
    let reserveIndex = 0;
    const opponentUnits = state.battle.opponentUnits.map((unit) => {
      if (unit.active && unit.hp <= 0) return { ...unit, active: false, battlefieldSlot: null };
      if (unit.key === reserves[reserveIndex]?.key && available.length > 0) {
        const battlefieldSlot = available.shift() ?? null;
        reserveIndex += 1;
        return { ...unit, active: true, battlefieldSlot };
      }
      return unit;
    });
    const replacedBattle = recomputeCombatStats(refreshSetupRuntimeEffects({ ...state.battle, opponentUnits }));
    const playback = createReplacementPlayback(state, state.battle, replacedBattle, "opponent");
    if (playback) return playback;
    state = { ...state, battle: replacedBattle };
  }
  const required = Math.min(parseBattleFormat(state.run.battleFormat).playerActiveCount, allHealthy.length);
  if (activeHealthy.length < required) {
    const fixedLeadIds = activeHealthy
      .map((unit) => unit.userCritter?.id)
      .filter((id): id is string => Boolean(id));
    return {
      ...state,
      phase: "forced_replacements",
      requiredLeadCount: required,
      selectedLeadIds: fixedLeadIds,
      fixedLeadIds,
    };
  }
  return {
    ...state,
    phase: "await_roll",
    rollSummary: null,
  };
}

export function dungeonBattleOutcome(state: DungeonRunState): "won" | "lost" | null {
  if (state.phase !== "battle_result") return null;
  return state.battle.opponentUnits.some((unit) => unit.hp > 0) ? "lost" : "won";
}

export function dungeonBattleSubmission(state: DungeonRunState): {
  outcome: "won" | "lost";
  defeatedOpponentInstanceIds: string[];
  participantUserCritterIds: string[];
  squadHp: Record<string, number>;
} {
  const outcome = dungeonBattleOutcome(state);
  if (!outcome) throw new Error("The encounter has not reached a result.");
  const opponents = opponentsForBattle(state.run);
  return {
    outcome,
    defeatedOpponentInstanceIds: state.battle.opponentUnits
      .map((unit, index) => unit.hp <= 0 ? opponents[index]?.instanceId : null)
      .filter((id): id is string => Boolean(id)),
    participantUserCritterIds: state.participatedUserCritterIds,
    squadHp: Object.fromEntries(state.battle.playerUnits
      .filter((unit) => unit.userCritter)
      .map((unit) => [unit.userCritter!.id, unit.hp])),
  };
}

export function applyDungeonBattleResult(
  state: DungeonRunState,
  result: DungeonBattleResult,
  catalog: Catalog,
  player: PlayerState,
): DungeonRunState {
  if (result.run.status === "won") {
    return {
      ...state,
      run: result.run,
      phase: "dungeon_complete",
      lastBattleRewards: result.battleRewards,
      dungeonRewards: result.dungeonRewards ?? null,
      nextDungeonId: result.nextDungeonId ?? null,
    };
  }
  if (result.run.status === "lost") {
    return {
      ...state,
      run: result.run,
      phase: "dungeon_failed",
      lastBattleRewards: result.battleRewards,
      dungeonRewards: null,
    };
  }
  const persistentHp = Object.fromEntries(state.battle.playerUnits
    .filter((unit) => unit.userCritter)
    .map((unit) => [unit.userCritter!.id, unit.hp]));
  const battle = createEncounterBattle(
    catalog,
    player,
    state.dungeon,
    result.run,
    persistentHp,
    state.battle.skillUsage?.dungeon ?? {},
    state.battle,
  );
  const requiredLeadCount = leadRequirement(battle, result.run);
  const healthyCount = battle.playerUnits.filter((unit) => unit.hp > 0).length;
  const automatic = requiredLeadCount > 0
    && healthyCount <= parseBattleFormat(result.run.battleFormat).playerActiveCount;
  const selectedLeadIds = automatic ? defaultLeadIds(battle, requiredLeadCount) : [];
  const next: DungeonRunState = {
    ...state,
    run: result.run,
    battle,
    pendingBattle: null,
    phase: automatic ? "await_roll" : "lead_selection",
    selectedLeadIds,
    requiredLeadCount,
    fixedLeadIds: [],
    rollSummary: null,
    events: [],
    eventCursor: -1,
    participatedUserCritterIds: [],
    lastBattleRewards: result.battleRewards,
    nextPhaseAfterRewards: null,
    dialogueMoment: null,
  };
  const prepared = automatic
    ? { ...activateSelectedLeads(next, selectedLeadIds), phase: "entry_dialogue" as const, dialogueMoment: "entry" as const }
    : next;
  return {
    ...prepared,
    phase: "encounter_rewards",
    nextPhaseAfterRewards: prepared.phase === "entry_dialogue" ? "entry_dialogue" : "lead_selection",
  };
}

export function continueAfterEncounterRewards(state: DungeonRunState): DungeonRunState {
  if (state.phase !== "encounter_rewards" || !state.nextPhaseAfterRewards) return state;
  return {
    ...state,
    phase: state.nextPhaseAfterRewards,
    nextPhaseAfterRewards: null,
  };
}

function persistableBattle(battle: CombatState): Omit<CombatState, "catalog"> {
  const { catalog: _catalog, ...persistable } = battle;
  return persistable;
}

export function serializeDungeonRunState(state: DungeonRunState): Record<string, unknown> {
  const { run: _run, battle, pendingBattle, ...persistable } = state;
  return {
    ...persistable,
    battle: persistableBattle(battle),
    pendingBattle: pendingBattle ? persistableBattle(pendingBattle) : null,
  };
}

export function restoreDungeonRunState(
  value: unknown,
  catalog: Catalog,
  run: DungeonRunSnapshot,
): DungeonRunState | null {
  if (!value || typeof value !== "object") return null;
  const persisted = value as Partial<DungeonRunState> & {
    battle?: Omit<CombatState, "catalog">;
    pendingBattle?: Omit<CombatState, "catalog"> | null;
  };
  if (
    !persisted.dungeon
    || !persisted.battle
    || !Array.isArray(persisted.battle.playerUnits)
    || !Array.isArray(persisted.battle.opponentUnits)
    || typeof persisted.phase !== "string"
    || persisted.dungeon.id !== run.dungeonId
  ) return null;
  const restoredNarration = restoreNarrationEvents(
    Array.isArray(persisted.events) ? persisted.events : [],
    typeof persisted.eventCursor === "number" ? persisted.eventCursor : -1,
  );
  return {
    ...(persisted as DungeonRunState),
    run,
    events: restoredNarration.events,
    eventCursor: restoredNarration.eventCursor,
    battle: {
      ...persisted.battle,
      catalog,
      presentationEvents: persisted.battle.presentationEvents ?? [],
      effectActivations: persisted.battle.effectActivations ?? [],
      effectActivationKeys: persisted.battle.effectActivationKeys ?? [],
      runtimeEffects: persisted.battle.runtimeEffects ?? [],
      effectSequence: persisted.battle.effectSequence ?? 0,
      skillUsage: persisted.battle.skillUsage ?? { encounter: {}, dungeon: {} },
      rechargeUntilTurn: persisted.battle.rechargeUntilTurn ?? {},
      playerUnits: persisted.battle.playerUnits.map((unit) => ({ ...unit, shield: unit.shield ?? 0, maxShield: unit.maxShield ?? 0, blockStreak: unit.blockStreak ?? 0 })),
      opponentUnits: persisted.battle.opponentUnits.map((unit) => ({ ...unit, shield: unit.shield ?? 0, maxShield: unit.maxShield ?? 0, blockStreak: unit.blockStreak ?? 0 })),
    } as CombatState,
    pendingBattle: persisted.pendingBattle
      ? {
          ...persisted.pendingBattle,
          catalog,
          presentationEvents: persisted.pendingBattle.presentationEvents ?? [],
          effectActivations: persisted.pendingBattle.effectActivations ?? [],
          effectActivationKeys: persisted.pendingBattle.effectActivationKeys ?? [],
          runtimeEffects: persisted.pendingBattle.runtimeEffects ?? [],
          effectSequence: persisted.pendingBattle.effectSequence ?? 0,
          skillUsage: persisted.pendingBattle.skillUsage ?? { encounter: {}, dungeon: {} },
          rechargeUntilTurn: persisted.pendingBattle.rechargeUntilTurn ?? {},
          playerUnits: persisted.pendingBattle.playerUnits.map((unit) => ({ ...unit, shield: unit.shield ?? 0, maxShield: unit.maxShield ?? 0, blockStreak: unit.blockStreak ?? 0 })),
          opponentUnits: persisted.pendingBattle.opponentUnits.map((unit) => ({ ...unit, shield: unit.shield ?? 0, maxShield: unit.maxShield ?? 0, blockStreak: unit.blockStreak ?? 0 })),
        } as CombatState
      : null,
  };
}
