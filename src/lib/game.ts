import type {
  Catalog,
  CombatAction,
  CombatProgressEvent,
  Critter,
  CritterProgression,
  Dungeon,
  DungeonOpponent,
  ElementDef,
  EffectOwnerType,
  PlayerState,
  ResolvedEffectRef,
  Skill,
  Status,
  UserCritter,
} from "./types.js";
import { assertEffectContract } from "./effects.js";

export type StatBlock = {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  diceMin: number;
  diceMax: number;
  blockCost: number;
  swapCost: number;
  relicSlots: number;
};

export type CombatUnit = {
  key: string;
  side: "player" | "opponent";
  name: string;
  critter: Critter;
  userCritter?: UserCritter;
  level: number;
  baseStats: StatBlock;
  stats: StatBlock;
  persistentStats: StatBlock;
  hp: number;
  maxHp: number;
  skills: Skill[];
  active: boolean;
  battlefieldSlot: number | null;
  blocking: boolean;
  manaRoll: number;
};

export type CombatStatus = {
  instanceId: string;
  statusId: string;
  holderKey: string;
  duration: number | null;
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
  effects: ResolvedEffectRef[];
};

export type CombatModifier = {
  instanceId: string;
  holderKey: string;
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
  effect: ResolvedEffectRef;
};

type SetupEffectSource = {
  ownerType: "relic" | "ability";
  ownerId: string;
  sourceKey?: string;
  effects: ResolvedEffectRef[];
  sourceOrder: number;
};

type RunEffectRegistry = Record<EffectOwnerType, Record<string, ResolvedEffectRef[]>>;

export type RunEffectSnapshot = {
  seed: number;
  effects: Array<{
    id: string;
    name: string;
    description: string;
    templateId: string;
    runtimeKind: string;
    runtimeVersion: number;
    ownerType: EffectOwnerType;
    ownerId: string;
    sourceOrder: number;
    sortOrder: number;
    parameters: Record<string, unknown>;
  }>;
  opponentOverrides: Array<{ opponentId: string; statKey: string; value: number }>;
  loadouts: {
    playerSkillSlots: PlayerState["skillSlots"];
    playerAbilitySlots: PlayerState["abilitySlots"];
    playerRelicSlots: PlayerState["relicSlots"];
    opponents: Array<{ opponentId: string; skillIds: string[]; relicIds: string[] }>;
  };
  statuses: Array<{
    id: string;
    name: string;
    description: string;
    assetPath: string | null;
    version: number;
  }>;
};

export type CombatState = {
  dungeon: Dungeon;
  playerUnits: CombatUnit[];
  opponentUnits: CombatUnit[];
  playerMana: number;
  opponentMana: number;
  turn: number;
  log: string[];
  phase: "ready" | "selecting" | "resolved" | "won" | "lost";
  runId?: string;
  catalog: Catalog;
  statuses: CombatStatus[];
  modifiers: CombatModifier[];
  setupSources: SetupEffectSource[];
  runEffects: RunEffectRegistry;
  statusRegistry: Record<string, Status>;
  rngState: number;
  snapshot: RunEffectSnapshot;
  turnEvents: CombatProgressEvent[];
};

export function byId<T extends { id: string }>(items: T[], id: string | null | undefined): T | undefined {
  if (!id) return undefined;
  return items.find((item) => item.id === id);
}

export function elementName(catalog: Catalog, elementId: string): string {
  return byId<ElementDef>(catalog.elements, elementId)?.name ?? elementId;
}

export function progressionFor(
  rows: CritterProgression[],
  critterId: string,
  level: number,
): CritterProgression[] {
  return rows
    .filter((row) => row.critter_id === critterId && row.level <= level)
    .sort((a, b) => a.level - b.level);
}

export function critterStats(catalog: Catalog, critter: Critter, level: number): StatBlock {
  const rows = progressionFor(catalog.critterProgression, critter.id, level);
  const total = rows.reduce(
    (acc, row) => ({
      hp: acc.hp + row.hp_delta,
      atk: acc.atk + row.atk_delta,
      def: acc.def + row.def_delta,
      spd: acc.spd + row.spd_delta,
      diceMin: acc.diceMin + row.dice_min_delta,
      diceMax: acc.diceMax + row.dice_max_delta,
      blockCost: acc.blockCost + row.block_cost_delta,
      swapCost: acc.swapCost + row.swap_cost_delta,
      relicSlots: row.total_unlocked_relic_slots,
    }),
    {
      hp: critter.base_hp,
      atk: critter.base_atk,
      def: critter.base_def,
      spd: critter.base_spd,
      diceMin: critter.base_dice_min,
      diceMax: critter.base_dice_max,
      blockCost: critter.base_block_cost,
      swapCost: critter.base_swap_cost,
      relicSlots: 1,
    },
  );

  const diceMin = Math.max(1, Math.floor(total.diceMin));
  const diceMax = Math.max(diceMin, Math.floor(total.diceMax));

  return {
    hp: Math.max(1, total.hp),
    atk: Math.max(1, total.atk),
    def: Math.max(1, total.def),
    spd: Math.max(1, total.spd),
    diceMin,
    diceMax,
    blockCost: Math.max(0, total.blockCost),
    swapCost: Math.max(0, total.swapCost),
    relicSlots: Math.max(0, total.relicSlots),
  };
}

export function equippedSkillIds(player: PlayerState, userCritterId: string): string[] {
  return player.skillSlots
    .filter((slot) => slot.user_critter_id === userCritterId && slot.skill_id)
    .sort((a, b) => a.slot_index - b.slot_index)
    .map((slot) => slot.skill_id!)
    .filter(Boolean);
}

export function squadCritters(player: PlayerState): UserCritter[] {
  return player.squadSlots
    .slice()
    .sort((a, b) => a.slot_index - b.slot_index)
    .map((slot) => player.critters.find((critter) => critter.id === slot.user_critter_id))
    .filter((critter): critter is UserCritter => Boolean(critter));
}

export function createInitialCombatState(
  catalog: Catalog,
  player: PlayerState,
  dungeon: Dungeon,
  runId: string,
  selectedOpponents?: DungeonOpponent[],
): CombatState {
  const squad = squadCritters(player);
  let playerUnits: CombatUnit[] = squad.map((owned, index) => {
    const critter = byId(catalog.critters, owned.critter_id)!;
    const stats = critterStats(catalog, critter, owned.level);
    const skills = equippedSkillIds(player, owned.id)
      .map((skillId) => byId(catalog.skills, skillId))
      .filter((skill): skill is Skill => Boolean(skill));

    return {
      key: `p${index + 1}`,
      side: "player" as const,
      name: critter.name,
      critter,
      userCritter: owned,
      level: owned.level,
      baseStats: stats,
      stats,
      persistentStats: stats,
      hp: stats.hp,
      maxHp: stats.hp,
      skills,
      active: index < dungeon.player_active_count,
      battlefieldSlot: index < dungeon.player_active_count ? index : null,
      blocking: false,
      manaRoll: 0,
    };
  });

  const opponentRows = selectedOpponents?.length ? structuredClone(selectedOpponents) : pickOpponents(catalog, dungeon);
  let opponentUnits: CombatUnit[] = opponentRows.map((opponent, index) => {
    const critter = byId(catalog.critters, opponent.critter_id)!;
    const stats = applyDungeonOverrides(
      critterStats(catalog, critter, opponent.critter_level),
      catalog.dungeonOpponentStatOverrides.filter((row) => row.opponent_id === opponent.id),
    );
    const skills = opponent.skill_ids
      .map((skillId) => byId(catalog.skills, skillId))
      .filter((skill): skill is Skill => Boolean(skill));

    return {
      key: `o${index + 1}`,
      side: "opponent" as const,
      name: critter.name,
      critter,
      level: opponent.critter_level,
      baseStats: stats,
      stats,
      persistentStats: stats,
      hp: stats.hp,
      maxHp: stats.hp,
      skills,
      active: index < dungeon.opponent_active_count,
      battlefieldSlot: index < dungeon.opponent_active_count ? index : null,
      blocking: false,
      manaRoll: 0,
    };
  });

  const relevantSkillIds = new Set([...playerUnits, ...opponentUnits].flatMap((unit) => unit.skills.map((skill) => skill.id)));
  const runEffects = createRunEffectRegistry(catalog, relevantSkillIds);
  const statusRegistry = Object.fromEntries(
    catalog.statuses
      .filter((status) => status.is_active !== false && status.is_archived !== true)
      .map((status) => [status.id, structuredClone(status)]),
  );
  validateRunEffects(runEffects, statusRegistry);

  const setupSources: SetupEffectSource[] = [];
  for (const [unitIndex, unit] of playerUnits.entries()) {
    if (!unit.userCritter) continue;
    for (const slot of player.relicSlots
      .filter((candidate) => candidate.user_critter_id === unit.userCritter!.id && candidate.relic_id)
      .sort((a, b) => a.slot_index - b.slot_index)) {
      setupSources.push({ ownerType: "relic", ownerId: slot.relic_id!, sourceKey: unit.key, effects: runEffects.relic[slot.relic_id!] ?? [], sourceOrder: unitIndex * 100 + slot.slot_index });
    }
  }
  opponentRows.forEach((opponent, index) => {
    opponent.relic_ids.forEach((relicId, slotIndex) => {
      setupSources.push({ ownerType: "relic", ownerId: relicId, sourceKey: `o${index + 1}`, effects: runEffects.relic[relicId] ?? [], sourceOrder: 10_000 + index * 100 + slotIndex });
    });
  });
  const activeRollcaster = player.rollcasters.find((owned) => owned.id === player.profile.active_rollcaster_id);
  if (activeRollcaster) {
    for (const slot of player.abilitySlots
      .filter((candidate) => candidate.user_rollcaster_id === activeRollcaster.id && candidate.ability_id)
      .sort((a, b) => a.slot_index - b.slot_index)) {
      setupSources.push({ ownerType: "ability", ownerId: slot.ability_id!, effects: runEffects.ability[slot.ability_id!] ?? [], sourceOrder: slot.slot_index });
    }
  }
  setupSources.sort((a, b) => (a.ownerType === b.ownerType ? a.sourceOrder - b.sourceOrder : a.ownerType === "relic" ? -1 : 1));

  const seed = hashSeed(runId);
  const snapshotEffects = setupSources.flatMap((source) => source.effects.map((effect) => ({
    id: effect.id,
    name: effect.name,
    description: effect.description,
    templateId: effect.templateId,
    runtimeKind: effect.runtimeKind,
    runtimeVersion: effect.runtimeVersion,
    ownerType: effect.ownerType,
    ownerId: source.ownerId,
    sourceOrder: source.sourceOrder,
    sortOrder: effect.sortOrder,
    parameters: structuredClone(effect.parameters),
  })));
  for (const skillId of relevantSkillIds) {
    for (const effect of runEffects.skill[skillId] ?? []) {
      snapshotEffects.push({
        id: effect.id, name: effect.name, description: effect.description, templateId: effect.templateId,
        runtimeKind: effect.runtimeKind, runtimeVersion: effect.runtimeVersion,
        ownerType: effect.ownerType, ownerId: skillId, sourceOrder: 0,
        sortOrder: effect.sortOrder, parameters: structuredClone(effect.parameters),
      });
    }
  }
  for (const status of Object.values(statusRegistry).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const effect of runEffects.status[status.id] ?? []) {
      snapshotEffects.push({
        id: effect.id, name: effect.name, description: effect.description, templateId: effect.templateId,
        runtimeKind: effect.runtimeKind, runtimeVersion: effect.runtimeVersion,
        ownerType: effect.ownerType, ownerId: status.id, sourceOrder: 0,
        sortOrder: effect.sortOrder, parameters: structuredClone(effect.parameters),
      });
    }
  }

  let initialState: CombatState = {
    dungeon,
    playerUnits,
    opponentUnits,
    playerMana: 0,
    opponentMana: 0,
    turn: 1,
    log: [`Entered ${dungeon.id} - ${dungeon.name}.`],
    phase: "ready",
    runId,
    catalog,
    statuses: [],
    modifiers: [],
    setupSources,
    runEffects,
    statusRegistry,
    rngState: seed,
    snapshot: {
      seed,
      effects: snapshotEffects,
      opponentOverrides: catalog.dungeonOpponentStatOverrides
        .filter((row) => opponentRows.some((opponent) => opponent.id === row.opponent_id))
        .map((row) => ({ opponentId: row.opponent_id, statKey: row.stat_key, value: row.value })),
      loadouts: {
        playerSkillSlots: structuredClone(player.skillSlots),
        playerAbilitySlots: structuredClone(player.abilitySlots),
        playerRelicSlots: structuredClone(player.relicSlots),
        opponents: opponentRows.map((opponent) => ({ opponentId: opponent.id, skillIds: [...opponent.skill_ids], relicIds: [...opponent.relic_ids] })),
      },
      statuses: Object.values(statusRegistry)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((status) => ({
          id: status.id,
          name: status.name,
          description: status.description,
          assetPath: status.asset_path ?? null,
          version: status.version ?? 1,
        })),
    },
    turnEvents: [],
  };
  initialState = recomputeCombatStats(initialState);
  return initialState;
}

function pickOpponents(catalog: Catalog, dungeon: Dungeon): DungeonOpponent[] {
  const pool = catalog.dungeonOpponents
    .filter((opponent) => opponent.dungeon_id === dungeon.id)
    .sort((a, b) => (a.sequence_index ?? 999) - (b.sequence_index ?? 999));
  const bossRows = pool.filter((opponent) => opponent.pool_type === "boss_order");
  const regularRows = pool.filter((opponent) => opponent.pool_type === "regular_pool");
  const targetCount = Math.max(1, dungeon.encounter_count * dungeon.opponent_active_count);
  const source = bossRows.length > 0 ? bossRows : regularRows;
  return source.slice(0, targetCount);
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function nextRandom(state: number): { value: number; state: number } {
  let next = state >>> 0 || 0x9e3779b9;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  next >>>= 0;
  return { value: next / 0x100000000, state: next };
}

function cloneEffect(effect: ResolvedEffectRef): ResolvedEffectRef {
  return { ...effect, parameters: structuredClone(effect.parameters) };
}

function cloneEffectMap(
  source: Record<string, ResolvedEffectRef[]>,
  include?: ReadonlySet<string>,
): Record<string, ResolvedEffectRef[]> {
  return Object.fromEntries(
    Object.entries(source)
      .filter(([ownerId]) => !include || include.has(ownerId))
      .map(([ownerId, effects]) => [ownerId, effects.map(cloneEffect)]),
  );
}

function createRunEffectRegistry(catalog: Catalog, relevantSkillIds: ReadonlySet<string>): RunEffectRegistry {
  return {
    skill: cloneEffectMap(catalog.effectsBySkill, relevantSkillIds),
    ability: cloneEffectMap(catalog.effectsByAbility),
    relic: cloneEffectMap(catalog.effectsByRelic),
    status: cloneEffectMap(catalog.effectsByStatus),
  };
}

function validateRunEffects(registry: RunEffectRegistry, statuses: Record<string, Status>): void {
  for (const ownerType of ["skill", "ability", "relic", "status"] as const) {
    for (const [ownerId, effects] of Object.entries(registry[ownerType])) {
      for (const effect of effects) {
        assertEffectContract(effect, ownerType);
        if (effect.ownerId !== ownerId) {
          throw new Error(`Inline effect ${effect.id} belongs to ${effect.ownerType} ${effect.ownerId}, not ${ownerId}.`);
        }
        if (effect.runtimeKind === "apply_status" && !statuses[String(effect.parameters.status_id)]) {
          throw new Error(`Effect ${effect.id} references missing or inactive status ${String(effect.parameters.status_id)}.`);
        }
      }
    }
  }
}

function applyDungeonOverrides(stats: StatBlock, rows: Catalog["dungeonOpponentStatOverrides"]): StatBlock {
  const next = { ...stats };
  const keys: Record<string, keyof StatBlock> = {
    hp: "hp", atk: "atk", def: "def", spd: "spd", dice_min: "diceMin", dice_max: "diceMax",
    block_cost: "blockCost", swap_cost: "swapCost",
  };
  for (const row of rows) next[keys[row.stat_key]] = row.value;
  next.hp = Math.max(1, next.hp);
  next.atk = Math.max(1, next.atk);
  next.def = Math.max(1, next.def);
  next.spd = Math.max(1, next.spd);
  next.diceMin = Math.max(1, next.diceMin);
  next.diceMax = Math.max(next.diceMin, next.diceMax);
  next.blockCost = Math.max(0, next.blockCost);
  next.swapCost = Math.max(0, next.swapCost);
  return next;
}

function activeSetupSources(state: CombatState): SetupEffectSource[] {
  return state.setupSources.filter((source) => {
    if (source.ownerType === "ability") return true;
    const wearer = source.sourceKey ? findUnit(state, source.sourceKey) : undefined;
    return Boolean(wearer?.active && wearer.hp > 0);
  });
}

function recomputeCombatStats(state: CombatState): CombatState {
  const effectsByTarget = new Map<string, ResolvedEffectRef[]>();
  for (const source of activeSetupSources(state)) {
    for (const effect of source.effects) {
      assertEffectContract(effect, source.ownerType);
      if (effect.runtimeKind !== "stat_modifier" && effect.runtimeKind !== "mana_dice_modifier") continue;
      const targets = effectTargets(state, String(effect.parameters.target), {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceCritterKey: source.sourceKey,
        elementIds: Array.isArray(effect.parameters.element_ids)
          ? effect.parameters.element_ids.filter((id): id is string => typeof id === "string")
          : undefined,
      });
      for (const unit of targets) effectsByTarget.set(unit.key, [...(effectsByTarget.get(unit.key) ?? []), effect]);
    }
  }

  const apply = (unit: CombatUnit): CombatUnit => {
    const persistentStats = applyStatEffects(unit.baseStats, effectsByTarget.get(unit.key) ?? []);
    const modifierEffects = state.modifiers
      .filter((modifier) => modifier.holderKey === unit.key)
      .map((modifier) => modifier.effect);
    const stats = applyStatEffects(persistentStats, modifierEffects);
    const hp = Math.min(stats.hp, Math.max(0, unit.hp + Math.max(0, stats.hp - unit.maxHp)));
    return { ...unit, persistentStats, stats, maxHp: stats.hp, hp };
  };
  return { ...state, playerUnits: state.playerUnits.map(apply), opponentUnits: state.opponentUnits.map(apply) };
}

function applyStatEffects(base: StatBlock, effects: ResolvedEffectRef[]): StatBlock {
  const next = { ...base };
  for (const effect of effects) {
    if (effect.runtimeKind === "stat_modifier") {
      const stat = String(effect.parameters.stat) as "hp" | "atk" | "def" | "spd";
      const amount = Number(effect.parameters.amount ?? 0);
      const delta = effect.parameters.value_mode === "percentage" ? roundHalfUp(next[stat] * amount) : amount;
      next[stat] = Math.max(1, next[stat] + delta);
    } else if (effect.runtimeKind === "mana_dice_modifier") {
      next.diceMin += Number(effect.parameters.minimum_delta ?? 0);
      next.diceMax += Number(effect.parameters.maximum_delta ?? 0);
    }
  }
  next.diceMin = Math.max(1, roundHalfUp(next.diceMin));
  next.diceMax = Math.max(next.diceMin, roundHalfUp(next.diceMax));
  next.blockCost = Math.max(0, next.blockCost);
  next.swapCost = Math.max(0, next.swapCost);
  return next;
}

export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

export function startTurn(state: CombatState): CombatState {
  let next = resolveTimedEffects({ ...state, turnEvents: [] }, "start_of_turn");
  let rngState = next.rngState;
  const playerUnits = next.playerUnits.map((unit) =>
    unit.active && unit.hp > 0
      ? (() => { const roll = rollManaDieSeeded(unit.stats.diceMin, unit.stats.diceMax, rngState); rngState = roll.state; return { ...unit, blocking: false, manaRoll: roll.value }; })()
      : unit,
  );
  const opponentUnits = next.opponentUnits.map((unit) =>
    unit.active && unit.hp > 0
      ? (() => { const roll = rollManaDieSeeded(unit.stats.diceMin, unit.stats.diceMax, rngState); rngState = roll.state; return { ...unit, blocking: false, manaRoll: roll.value }; })()
      : unit,
  );
  const playerRoll = playerUnits.reduce((sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0), 0);
  const opponentRoll = opponentUnits.reduce(
    (sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0),
    0,
  );

  return {
    ...next,
    playerUnits,
    opponentUnits,
    playerMana: next.playerMana + playerRoll,
    opponentMana: next.opponentMana + opponentRoll,
    rngState,
    phase: "selecting",
    log: [
      `Turn ${next.turn}: player rolled ${playerRoll} mana, opponents rolled ${opponentRoll} mana.`,
      ...next.log,
    ],
  };
}

export function resolveTurn(state: CombatState, actions: CombatAction[]): CombatState {
  const cost = actions.reduce((sum, action) => sum + action.cost, 0);
  if (cost > state.playerMana) return state;

  let next: CombatState = {
    ...state,
    playerMana: state.playerMana - cost,
    log: [`Submitted actions for ${cost} mana.`, ...state.log],
  };

  const enemyActions = chooseEnemyActions(next);
  const enemyCost = enemyActions.reduce((sum, action) => sum + action.cost, 0);
  next = {
    ...next,
    opponentMana: Math.max(0, next.opponentMana - enemyCost),
  };

  const allActions = [...actions, ...enemyActions].map((action) => prepareActionTarget(next, action));
  next = resolveActionStage(next, allActions, "swap");
  next = resolveActionStage(next, allActions, "block");
  next = resolveActionStage(next, allActions, "skip");
  next = resolveActionStage(next, allActions, "skill");
  next = resolvePostTurn(next);

  const playerAlive = next.playerUnits.some((unit) => unit.hp > 0);
  const opponentsAlive = next.opponentUnits.some((unit) => unit.hp > 0);
  if (!playerAlive || !opponentsAlive) {
    return { ...next, phase: playerAlive ? "won" : "lost", log: [playerAlive ? "Dungeon cleared." : "Defeat.", ...next.log] };
  }

  return { ...next, turn: next.turn + 1, phase: "ready" };
}

function chooseEnemyActions(state: CombatState): CombatAction[] {
  let mana = state.opponentMana;

  return state.opponentUnits
    .filter((unit) => unit.active && unit.hp > 0)
    .map((unit) => {
      const skill = unit.skills.find((candidate) => candidate.mana_cost <= mana) ?? unit.skills[0];
      if (skill && skill.mana_cost <= mana) {
        mana -= skill.mana_cost;
        const target = skillTargets(state, unit.key, skill)[0];
        return {
          actorKey: unit.key,
          type: "skill" as const,
          skillId: skill.id,
          targetKey: isSingleTarget(skill) ? target?.key : undefined,
          cost: skill.mana_cost,
        };
      }
      return { actorKey: unit.key, type: "skip" as const, cost: 0 };
    });
}

function resolveActionStage(state: CombatState, actions: CombatAction[], stage: CombatAction["type"]): CombatState {
  const ordered = actions
    .filter((action) => action.type === stage)
    .sort((a, b) => speedFor(state, b.actorKey) - speedFor(state, a.actorKey));

  return ordered.reduce((current, action) => recomputeCombatStats(resolveAction(current, action)), state);
}

function prepareActionTarget(state: CombatState, action: CombatAction): CombatAction {
  if (!action.targetKey || action.targetSlotIndex !== undefined) return action;
  const target = findUnit(state, action.targetKey);
  if (!target || target.battlefieldSlot === null) return action;
  return { ...action, targetSlotSide: target.side, targetSlotIndex: target.battlefieldSlot };
}

function resolveAction(state: CombatState, action: CombatAction): CombatState {
  const actor = findUnit(state, action.actorKey);
  if (!actor || actor.hp <= 0 || !actor.active) return state;

  if (action.type !== "skip") {
    const skip = resolveSkipCheck(state, actor.key, action.type);
    state = skip.state;
    if (skip.skipped) {
      const refunded = refundActionCost(state, actor.side, action.cost);
      return { ...refunded, log: [`${actor.name}'s ${action.type} was skipped by ${skip.effectName}; ${action.cost} mana was refunded.`, ...refunded.log] };
    }
  }

  if (action.type === "skip") {
    return { ...state, log: [`${actor.name} waits.`, ...state.log] };
  }

  if (action.type === "block") {
    return updateUnit(state, action.actorKey, (unit) => ({ ...unit, blocking: true }), `${actor.name} blocks.`);
  }

  if (action.type === "swap" && action.swapToId) {
    return swapPlayerUnit(state, action.actorKey, action.swapToId);
  }

  if (action.type === "skill" && action.skillId) {
    const skill = actor.skills.find((candidate) => candidate.id === action.skillId);
    if (!skill) return state;
    const targetSlot = action.targetSlotSide !== undefined && action.targetSlotIndex !== undefined
      ? { side: action.targetSlotSide, index: action.targetSlotIndex }
      : undefined;
    const targets = skillTargets(state, actor.key, skill, action.targetKey, targetSlot);
    if (!targets.length) return state;
    let damageDone = 0;
    let next = targets.reduce((current, originalTarget) => {
      const target = findUnit(current, originalTarget.key);
      if (!target || target.hp <= 0) return current;
      if (skill.skill_type === "attack") {
        const damage = calculateDamage(actor, target, skill);
        const finalDamage = target.blocking ? Math.max(1, Math.floor(damage * 0.1)) : damage;
        const actualDamage = Math.min(target.hp, finalDamage);
        damageDone += actualDamage;
        const updated = updateUnit(current, target.key, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - finalDamage) }), `${actor.name} used ${skill.name} on ${target.name} for ${finalDamage} damage.`);
        return appendDamageProgressEvents(updated, actor, target, actualDamage, target.hp - actualDamage <= 0);
      }
      return { ...current, log: [`${actor.name} used ${skill.name} on ${target.name}.`, ...current.log] };
    }, state);
    if (actor.side === "player") {
      next = appendProgressEvent(next, {
        event_type: "use_skill",
        source_critter_id: actor.critter.id,
        target_critter_id: null,
        skill_id: skill.id,
        amount: 1,
      });
    }
    next = recomputeCombatStats(next);
    const effects = next.runEffects.skill[skill.id] ?? [];
    if (effects.length) {
      for (const effect of effects) next = resolveEffect(next, effect, {
        sourceOwnerType: "skill",
        sourceOwnerId: skill.id,
        sourceCritterKey: actor.key,
        skillTargetKeys: targets.map((target) => target.key),
        damageDone,
      });
    }
    return next;
  }

  return state;
}

function refundActionCost(state: CombatState, side: CombatUnit["side"], cost: number): CombatState {
  if (cost <= 0) return state;
  return side === "player"
    ? { ...state, playerMana: state.playerMana + cost }
    : { ...state, opponentMana: state.opponentMana + cost };
}

export function isSingleTarget(skill: Skill): boolean {
  return (skill.targeting ?? "single_enemy") === "single_enemy" || skill.targeting === "single_any";
}

export function skillTargets(
  state: CombatState,
  actorKey: string,
  skill: Skill,
  selectedKey?: string,
  selectedSlot?: { side: CombatUnit["side"]; index: number },
): CombatUnit[] {
  const actor = findUnit(state, actorKey);
  if (!actor) return [];
  const friendlies = actor.side === "player" ? state.playerUnits : state.opponentUnits;
  const enemies = actor.side === "player" ? state.opponentUnits : state.playerUnits;
  const onField = (unit: CombatUnit) => unit.active && unit.hp > 0;
  const targeting = skill.targeting ?? "single_enemy";
  if (targeting === "all_enemies") return enemies.filter(onField);
  if (targeting === "all_friendlies") return friendlies.filter(onField);
  if (targeting === "self_only") return onField(actor) ? [actor] : [];
  if (targeting === "all_allies") return friendlies.filter((unit) => onField(unit) && unit.key !== actor.key);
  if (targeting === "all_others") return [...friendlies, ...enemies].filter((unit) => onField(unit) && unit.key !== actor.key);
  const candidates = targeting === "single_any" ? [...friendlies, ...enemies].filter(onField) : enemies.filter(onField);
  if (selectedSlot) return candidates.filter((unit) => unit.side === selectedSlot.side && unit.battlefieldSlot === selectedSlot.index);
  if (!selectedKey) return candidates;
  return candidates.filter((unit) => unit.key === selectedKey);
}

type RuntimeContext = {
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
  skillTargetKeys?: string[];
  statusHolderKey?: string;
  damageDone?: number;
  elementIds?: string[];
};

function effectTargets(state: CombatState, target: string, context: RuntimeContext): CombatUnit[] {
  const holder = context.statusHolderKey ? findUnit(state, context.statusHolderKey) : undefined;
  const source = holder ?? (context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined);
  const friendlies = source?.side === "opponent" ? state.opponentUnits : state.playerUnits;
  const enemies = source?.side === "opponent" ? state.playerUnits : state.opponentUnits;
  const active = (unit: CombatUnit) => unit.active && unit.hp > 0;
  switch (target) {
    case "self": {
      if (!source) throw new Error(`Missing source Critter for ${context.sourceOwnerType} effect from ${context.sourceOwnerId}.`);
      return active(source) ? [source] : [];
    }
    case "all_enemies": return enemies.filter(active);
    case "all_allies": return friendlies.filter((unit) => active(unit) && unit.key !== source?.key);
    case "all_friendlies": return friendlies.filter(active);
    case "target_enemies": {
      const selected = new Set(context.skillTargetKeys ?? []);
      return enemies.filter((unit) => active(unit) && selected.has(unit.key));
    }
    case "all_element_friendlies":
    case "all_element_enemies": {
      const elements = new Set(context.elementIds ?? []);
      const candidates = target === "all_element_friendlies" ? friendlies : enemies;
      return candidates.filter((unit) => active(unit) && elements.has(unit.critter.element_id));
    }
    case "equipped_critter": {
      if (!source) throw new Error(`Missing equipped Critter for relic effect from ${context.sourceOwnerId}.`);
      return active(source) ? [source] : [];
    }
    case "equipped_allies": return friendlies.filter((unit) => active(unit) && unit.key !== source?.key);
    case "equipped_friendlies": return friendlies.filter(active);
    case "status_holder": {
      if (!holder) throw new Error(`Missing status holder for status effect from ${context.sourceOwnerId}.`);
      return active(holder) ? [holder] : [];
    }
    case "status_holder_allies": return holder && active(holder) ? friendlies.filter((unit) => active(unit) && unit.key !== holder.key) : [];
    case "status_holder_friendlies": return holder && active(holder) ? friendlies.filter(active) : [];
    case "status_holder_enemies": return holder && active(holder) ? enemies.filter(active) : [];
    default: throw new Error(`Unsupported effect target: ${target}`);
  }
}

function resolveEffect(state: CombatState, effect: ResolvedEffectRef, context: RuntimeContext): CombatState {
  assertEffectContract(effect, context.sourceOwnerType);
  const targets = effectTargets(state, String(effect.parameters.target ?? ""), {
    ...context,
    elementIds: Array.isArray(effect.parameters.element_ids)
      ? effect.parameters.element_ids.filter((id): id is string => typeof id === "string")
      : undefined,
  });
  if (!targets.length) return state;
  const key = `${effect.runtimeKind}@${effect.runtimeVersion}`;
  const chance = rollChance(state, Number(effect.parameters.chance));
  let next = chance.state;
  if (!chance.activated) return next;
  if (key === "restore_hp@1") {
    return targets.reduce((current, original) => {
      const target = findUnit(current, original.key)!;
      const raw = effect.parameters.value_mode === "percent_max_hp"
        ? target.maxHp * Number(effect.parameters.amount ?? 0)
        : effect.parameters.value_mode === "percent_damage_done"
          ? Number(context.damageDone ?? 0) * Number(effect.parameters.amount ?? 0)
          : Number(effect.parameters.amount ?? 0);
      const amount = Math.max(0, roundHalfUp(raw));
      const restored = Math.min(amount, target.maxHp - target.hp);
      return updateUnit(current, target.key, (unit) => ({ ...unit, hp: unit.hp + restored }), `${effect.name} restored ${restored} HP to ${target.name}.`);
    }, next);
  }
  if (key === "apply_status@1") {
    const duration = effect.parameters.indefinite ? null : Number(effect.parameters.turns);
    for (const target of targets) {
      next = applyStatus(next, String(effect.parameters.status_id), target.key, context, duration);
    }
    return next;
  }
  if (key === "stat_modifier@1") {
    const modifiers = targets.map((target, index): CombatModifier => ({
      instanceId: `${context.sourceOwnerType}:${context.sourceOwnerId}:${effect.id}:${target.key}:${state.turn}:${state.modifiers.length + index}`,
      holderKey: target.key,
      sourceOwnerType: context.sourceOwnerType,
      sourceOwnerId: context.sourceOwnerId,
      sourceCritterKey: context.sourceCritterKey,
      effect: cloneEffect(effect),
    }));
    return recomputeCombatStats({
      ...next,
      modifiers: [...next.modifiers, ...modifiers],
      log: [...targets.map((target) => `${effect.name} affected ${target.name}.`).reverse(), ...next.log],
    });
  }
  throw new Error(`Unsupported effect runtime: ${key}`);
}

function rollChance(state: CombatState, chance: number): { state: CombatState; activated: boolean } {
  const roll = nextRandom(state.rngState);
  return { state: { ...state, rngState: roll.state }, activated: roll.value < chance };
}

function applyStatus(
  state: CombatState,
  statusId: string,
  holderKey: string,
  context: RuntimeContext,
  duration: number | null,
): CombatState {
  const status = state.statusRegistry[statusId];
  if (!status) throw new Error(`Unknown status: ${statusId}`);
  const existingIndex = state.statuses.findIndex((item) => item.statusId === statusId && item.holderKey === holderKey);
  let statuses = [...state.statuses];
  if (existingIndex >= 0) {
    statuses[existingIndex] = {
      ...statuses[existingIndex],
      duration,
      sourceOwnerType: context.sourceOwnerType,
      sourceOwnerId: context.sourceOwnerId,
      sourceCritterKey: context.sourceCritterKey,
    };
  } else {
    statuses.push({
      instanceId: `${statusId}:${holderKey}`,
      statusId,
      holderKey,
      duration,
      sourceOwnerType: context.sourceOwnerType,
      sourceOwnerId: context.sourceOwnerId,
      sourceCritterKey: context.sourceCritterKey,
      effects: state.runEffects.status[statusId] ?? [],
    });
  }
  const holder = findUnit(state, holderKey);
  return recomputeCombatStats({ ...state, statuses, log: [`${holder?.name ?? holderKey} received ${status.name}.`, ...state.log] });
}

function resolveTimedEffects(state: CombatState, timing: "start_of_turn" | "end_of_turn"): CombatState {
  let next = state;
  for (const instance of state.statuses) {
    for (const effect of instance.effects) {
      if (effect.runtimeKind !== "damage_over_time" || effect.parameters.timing !== timing) continue;
      const holder = findUnit(next, instance.holderKey);
      if (!holder || !holder.active || holder.hp <= 0) continue;
      const chance = rollChance(next, Number(effect.parameters.chance));
      next = chance.state;
      if (!chance.activated) continue;
      const targets = effectTargets(next, String(effect.parameters.target), {
        sourceOwnerType: "status",
        sourceOwnerId: instance.statusId,
        statusHolderKey: instance.holderKey,
      });
      for (const original of targets) {
        const target = findUnit(next, original.key);
        if (!target) continue;
        const raw = effect.parameters.value_mode === "percent_max_hp"
          ? target.maxHp * Number(effect.parameters.amount ?? 0)
          : Number(effect.parameters.amount ?? 0);
        const damage = Math.max(0, roundHalfUp(raw));
        const actualDamage = Math.min(target.hp, damage);
        next = updateUnit(next, target.key, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - damage) }), `${target.name} took ${damage} damage from ${effect.name}.`);
        const source = instance.sourceCritterKey ? findUnit(next, instance.sourceCritterKey) : undefined;
        if (source) next = appendDamageProgressEvents(next, source, target, actualDamage, target.hp - actualDamage <= 0);
      }
    }
  }
  if (timing === "end_of_turn") {
    next = {
      ...next,
      statuses: next.statuses
        .map((item) => item.duration === null ? item : { ...item, duration: item.duration - 1 })
        .filter((item) => item.duration === null || item.duration > 0),
    };
  }
  return recomputeCombatStats(next);
}

function resolveSkipCheck(
  state: CombatState,
  actorKey: string,
  actionType: Exclude<CombatAction["type"], "skip">,
): { state: CombatState; skipped: boolean; effectName: string } {
  let next = state;
  for (const instance of state.statuses) {
    const holder = findUnit(next, instance.holderKey);
    if (!holder || !holder.active || holder.hp <= 0) continue;
    for (const effect of instance.effects.filter((item) => item.runtimeKind === "skip_action_chance")) {
      const configuredAction = String(effect.parameters.combat_action);
      if (configuredAction !== "all" && configuredAction !== actionType) continue;
      const targets = effectTargets(next, String(effect.parameters.target), {
        sourceOwnerType: "status",
        sourceOwnerId: instance.statusId,
        statusHolderKey: instance.holderKey,
      });
      if (!targets.some((target) => target.key === actorKey)) continue;
      const chance = rollChance(next, Number(effect.parameters.chance));
      next = chance.state;
      if (chance.activated) return { state: next, skipped: true, effectName: effect.name };
    }
  }
  return { state: next, skipped: false, effectName: "a status effect" };
}

function swapPlayerUnit(state: CombatState, actorKey: string, swapToId: string): CombatState {
  const activeIndex = state.playerUnits.findIndex((unit) => unit.key === actorKey);
  const benchIndex = state.playerUnits.findIndex((unit) => unit.userCritter?.id === swapToId && !unit.active && unit.hp > 0);
  if (activeIndex < 0 || benchIndex < 0) return state;
  const battlefieldSlot = state.playerUnits[activeIndex].battlefieldSlot;

  const units = state.playerUnits.map((unit, index) => {
    if (index === activeIndex) return { ...unit, active: false, battlefieldSlot: null };
    if (index === benchIndex) return { ...unit, active: true, battlefieldSlot };
    return unit;
  });

  let next: CombatState = {
    ...state,
    playerUnits: units,
    log: [`${state.playerUnits[activeIndex].name} swapped with ${state.playerUnits[benchIndex].name}.`, ...state.log],
  };
  next = recomputeCombatStats(next);
  return next;
}

function resolvePostTurn(state: CombatState): CombatState {
  const next = resolveTimedEffects(state, "end_of_turn");
  return { ...next, log: ["Post-turn effects resolved.", ...next.log] };
}

function calculateDamage(attacker: CombatUnit, defender: CombatUnit, skill: Skill): number {
  const base = Math.floor(((((2 * attacker.level) / 5 + 2) * skill.power * attacker.stats.atk) / defender.stats.def) / 50 + 2);
  const sameElementBonus = skill.element_id === attacker.critter.element_id ? 1.2 : 1;
  return Math.max(1, Math.floor(base * sameElementBonus));
}

function updateUnit(state: CombatState, key: string, updater: (unit: CombatUnit) => CombatUnit, log: string): CombatState {
  const update = (unit: CombatUnit) => (unit.key === key ? updater(unit) : unit);
  return {
    ...state,
    playerUnits: state.playerUnits.map(update),
    opponentUnits: state.opponentUnits.map(update),
    log: [log, ...state.log],
  };
}

function appendProgressEvent(state: CombatState, event: Omit<CombatProgressEvent, "event_key">): CombatState {
  const sequence = state.turnEvents.length + 1;
  return {
    ...state,
    turnEvents: [...state.turnEvents, {
      ...event,
      event_key: `turn:${state.turn}:${sequence}:${event.event_type}`,
    }],
  };
}

function appendDamageProgressEvents(
  state: CombatState,
  source: CombatUnit,
  target: CombatUnit,
  actualDamage: number,
  knockedOut: boolean,
): CombatState {
  if (actualDamage <= 0 || source.side === target.side) return state;
  let next = state;
  if (source.side === "player" && target.side === "opponent") {
    next = appendProgressEvent(next, {
      event_type: "deal_damage",
      source_critter_id: source.critter.id,
      target_critter_id: target.critter.id,
      skill_id: null,
      amount: actualDamage,
    });
    if (knockedOut) {
      next = appendProgressEvent(next, {
        event_type: "knock_out_critters",
        source_critter_id: source.critter.id,
        target_critter_id: target.critter.id,
        skill_id: null,
        amount: 1,
      });
    }
  } else if (source.side === "opponent" && target.side === "player") {
    next = appendProgressEvent(next, {
      event_type: "take_damage",
      source_critter_id: source.critter.id,
      target_critter_id: target.critter.id,
      skill_id: null,
      amount: actualDamage,
    });
  }
  return next;
}

function findUnit(state: CombatState, key: string): CombatUnit | undefined {
  return [...state.playerUnits, ...state.opponentUnits].find((unit) => unit.key === key);
}

function speedFor(state: CombatState, key: string): number {
  return findUnit(state, key)?.stats.spd ?? 0;
}

export function rollManaDie(min: number, max: number, random: () => number = Math.random): number {
  const lower = Math.max(1, Math.floor(min));
  const upper = Math.max(lower, Math.floor(max));
  return lower + Math.floor(random() * (upper - lower + 1));
}

function rollManaDieSeeded(min: number, max: number, rngState: number): { value: number; state: number } {
  const roll = nextRandom(rngState);
  return { value: rollManaDie(min, max, () => roll.value), state: roll.state };
}
