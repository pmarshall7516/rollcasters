import {
  createInitialCombatState,
  resolveTurn,
  startTurn,
  type CombatState,
} from "./game.js";
import { opponentsForBattle, parseBattleFormat } from "./dungeons.js";
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
  | "await_roll"
  | "roll_result"
  | "select_player_actions"
  | "event_playback"
  | "forced_replacements"
  | "battle_result"
  | "encounter_rewards"
  | "dungeon_complete"
  | "dungeon_failed";

export type DungeonCombatEvent = {
  id: string;
  turn: number;
  phase: string;
  message: string;
  requiresAdvance: boolean;
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
  nextPhaseAfterRewards: "lead_selection" | "await_roll" | null;
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
): CombatState {
  const battle = createInitialCombatState(
    catalog,
    player,
    encounterDungeon(dungeon, run),
    `${run.id}:${run.battleIndex}`,
    opponentsForBattle(run),
    `${run.randomSeed}:${run.battleIndex}`,
  );
  return {
    ...battle,
    playerUnits: battle.playerUnits.map((unit) => ({
      ...unit,
      hp: Math.min(unit.maxHp, Math.max(0, persistentHp?.[unit.userCritter?.id ?? ""] ?? unit.maxHp)),
      active: false,
      battlefieldSlot: null,
    })),
    opponentUnits: battle.opponentUnits.map((unit, index) => ({
      ...unit,
      active: index < parseBattleFormat(run.battleFormat).opponentActiveCount,
      battlefieldSlot: index,
    })),
    phase: "ready",
    playerMana: 0,
    opponentMana: 0,
    turn: 1,
  };
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
  const automatic = requiredLeadCount === 0
    || parseBattleFormat(run.battleFormat).playerActiveCount === 3;
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
  };
  return automatic && requiredLeadCount > 0
    ? activateSelectedLeads(initial, selectedLeadIds)
    : initial;
}

function activateSelectedLeads(state: DungeonRunState, selectedLeadIds: string[]): DungeonRunState {
  const selected = new Set(selectedLeadIds);
  let battlefieldSlot = 0;
  const playerUnits = state.battle.playerUnits.map((unit) => {
    const active = Boolean(unit.userCritter && selected.has(unit.userCritter.id) && unit.hp > 0);
    return {
      ...unit,
      active,
      battlefieldSlot: active ? battlefieldSlot++ : null,
    };
  });
  const participants = new Set(state.participatedUserCritterIds);
  for (const unit of playerUnits) {
    if (unit.active && unit.userCritter) participants.add(unit.userCritter.id);
  }
  return {
    ...state,
    battle: { ...state.battle, playerUnits },
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
  return activateSelectedLeads(state, state.selectedLeadIds);
}

export function rollDungeonDice(state: DungeonRunState): DungeonRunState {
  if (state.phase !== "await_roll") return state;
  const battle = startTurn(state.battle);
  const player = battle.playerUnits.reduce(
    (sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0),
    0,
  );
  const opponent = battle.opponentUnits.reduce(
    (sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0),
    0,
  );
  return {
    ...state,
    battle,
    phase: "roll_result",
    rollSummary: { player, opponent },
  };
}

export function continueAfterRoll(state: DungeonRunState): DungeonRunState {
  return state.phase === "roll_result"
    ? { ...state, phase: "select_player_actions" }
    : state;
}

function resolvedMessages(before: CombatState, after: CombatState): string[] {
  const addedCount = Math.max(0, after.log.length - before.log.length);
  return after.log.slice(0, addedCount).reverse();
}

export function submitDungeonActions(state: DungeonRunState, actions: CombatAction[]): DungeonRunState {
  if (state.phase !== "select_player_actions") return state;
  const resolved = resolveTurn(state.battle, actions);
  const messages = resolvedMessages(state.battle, resolved)
    .filter((message) => !message.startsWith("Submitted actions") && message !== "Post-turn effects resolved.");
  const events = messages.map((message, index): DungeonCombatEvent => ({
    id: `${state.run.id}:${state.run.battleIndex}:${state.battle.turn}:${index + 1}`,
    turn: state.battle.turn,
    phase: "resolution",
    message,
    requiresAdvance: true,
  }));
  if (events.length === 0) return finishResolvedTurn({ ...state, battle: resolved });
  return {
    ...state,
    pendingBattle: resolved,
    phase: "event_playback",
    events,
    eventCursor: 0,
  };
}

export function currentDungeonEvent(state: DungeonRunState): DungeonCombatEvent | null {
  return state.phase === "event_playback" ? state.events[state.eventCursor] ?? null : null;
}

export function advanceDungeonEvent(state: DungeonRunState): DungeonRunState {
  if (state.phase !== "event_playback" || !state.pendingBattle) return state;
  if (state.eventCursor < state.events.length - 1) {
    return { ...state, eventCursor: state.eventCursor + 1 };
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
  if (!opponentsAlive) return { ...state, phase: "battle_result" };
  if (allHealthy.length === 0) return { ...state, phase: "battle_result" };
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
  const battle = createEncounterBattle(catalog, player, state.dungeon, result.run, persistentHp);
  const requiredLeadCount = leadRequirement(battle, result.run);
  const automatic = parseBattleFormat(result.run.battleFormat).playerActiveCount === 3;
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
  };
  const prepared = automatic ? activateSelectedLeads(next, selectedLeadIds) : next;
  return {
    ...prepared,
    phase: "encounter_rewards",
    nextPhaseAfterRewards: prepared.phase === "await_roll" ? "await_roll" : "lead_selection",
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
  return {
    ...(persisted as DungeonRunState),
    run,
    battle: { ...persisted.battle, catalog } as CombatState,
    pendingBattle: persisted.pendingBattle
      ? { ...persisted.pendingBattle, catalog } as CombatState
      : null,
  };
}
