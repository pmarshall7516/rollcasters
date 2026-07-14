import type {
  Catalog,
  CombatAction,
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
  blocking: boolean;
  manaRoll: number;
};

export type CombatStatus = {
  instanceId: string;
  statusId: string;
  holderKey: string;
  duration: number;
  stacks: number;
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
    definitionVersion: number;
    runtimeKind: string;
    runtimeVersion: number;
    templateVersion: number;
    ownerType: EffectOwnerType;
    sourceOwnerId: string;
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
    stackingPolicy: NonNullable<Status["stacking_policy"]>;
    defaultDuration: number;
    maxStacks: number;
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
    definitionVersion: effect.definitionVersion,
    runtimeKind: effect.runtimeKind,
    runtimeVersion: effect.runtimeVersion,
    templateVersion: effect.templateVersion,
    ownerType: effect.ownerType,
    sourceOwnerId: source.ownerId,
    sourceOrder: source.sourceOrder,
    sortOrder: effect.sortOrder,
    parameters: structuredClone(effect.parameters),
  })));
  for (const skillId of relevantSkillIds) {
    for (const effect of runEffects.skill[skillId] ?? []) {
      snapshotEffects.push({
        id: effect.id, definitionVersion: effect.definitionVersion, runtimeKind: effect.runtimeKind,
        runtimeVersion: effect.runtimeVersion, templateVersion: effect.templateVersion,
        ownerType: effect.ownerType, sourceOwnerId: skillId, sourceOrder: 0,
        sortOrder: effect.sortOrder, parameters: structuredClone(effect.parameters),
      });
    }
  }
  for (const status of Object.values(statusRegistry).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const effect of runEffects.status[status.id] ?? []) {
      snapshotEffects.push({
        id: effect.id, definitionVersion: effect.definitionVersion, runtimeKind: effect.runtimeKind,
        runtimeVersion: effect.runtimeVersion, templateVersion: effect.templateVersion,
        ownerType: effect.ownerType, sourceOwnerId: status.id, sourceOrder: 0,
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
          stackingPolicy: status.stacking_policy ?? "refresh",
          defaultDuration: Math.max(1, status.default_duration ?? 3),
          maxStacks: Math.max(1, status.max_stacks ?? 1),
          version: status.version ?? 1,
        })),
    },
  };
  initialState = recomputeCombatStats(initialState);
  for (const source of activeSetupSources(initialState)) {
    for (const effect of source.effects) {
      if (effect.runtimeKind === "stat_modifier" || effect.runtimeKind === "mana_dice_modifier") continue;
      initialState = resolveEffect(initialState, effect, {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceCritterKey: source.sourceKey,
      });
    }
  }
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
    for (const effects of Object.values(registry[ownerType])) {
      for (const effect of effects) {
        assertEffectContract(effect, ownerType);
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
      });
      for (const unit of targets) effectsByTarget.set(unit.key, [...(effectsByTarget.get(unit.key) ?? []), effect]);
    }
  }

  const apply = (unit: CombatUnit): CombatUnit => {
    const persistentStats = applyStatEffects(unit.baseStats, effectsByTarget.get(unit.key) ?? []);
    const statusEffects = state.statuses
      .filter((instance) => instance.holderKey === unit.key)
      .flatMap((instance) => Array.from(
        { length: instance.stacks },
        () => instance.effects.filter((effect) => effect.runtimeKind === "stat_modifier" || effect.runtimeKind === "mana_dice_modifier"),
      ).flat());
    const modifierEffects = state.modifiers
      .filter((modifier) => modifier.holderKey === unit.key)
      .map((modifier) => modifier.effect);
    const stats = applyStatEffects(persistentStats, [...statusEffects, ...modifierEffects]);
    const hp = Math.min(stats.hp, Math.max(0, unit.hp + Math.max(0, stats.hp - unit.maxHp)));
    return { ...unit, persistentStats, stats, maxHp: stats.hp, hp };
  };
  return { ...state, playerUnits: state.playerUnits.map(apply), opponentUnits: state.opponentUnits.map(apply) };
}

function applyStatEffects(base: StatBlock, effects: ResolvedEffectRef[]): StatBlock {
  const next = { ...base };
  const flats: Record<string, number> = { hp: 0, atk: 0, def: 0, spd: 0 };
  const percentages: Record<string, number> = { hp: 0, atk: 0, def: 0, spd: 0 };
  for (const effect of effects) {
    if (effect.runtimeKind === "stat_modifier") {
      const stat = String(effect.parameters.stat);
      const bucket = effect.parameters.mode === "percentage" ? percentages : flats;
      bucket[stat] = (bucket[stat] ?? 0) + Number(effect.parameters.amount ?? 0);
    } else if (effect.runtimeKind === "mana_dice_modifier") {
      next.diceMin += Number(effect.parameters.minimum_delta ?? 0);
      next.diceMax += Number(effect.parameters.maximum_delta ?? 0);
    }
  }
  for (const stat of ["hp", "atk", "def", "spd"] as const) {
    next[stat] = Math.max(1, Math.round((next[stat] + flats[stat]) * (1 + percentages[stat])));
  }
  next.diceMin = Math.max(1, Math.round(next.diceMin));
  next.diceMax = Math.max(next.diceMin, Math.round(next.diceMax));
  next.blockCost = Math.max(0, next.blockCost);
  next.swapCost = Math.max(0, next.swapCost);
  return next;
}

export function startTurn(state: CombatState): CombatState {
  let next = resolveTimedEffects(state, "start_of_turn");
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

  const allActions = [...actions, ...enemyActions];
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

function resolveAction(state: CombatState, action: CombatAction): CombatState {
  const actor = findUnit(state, action.actorKey);
  if (!actor || actor.hp <= 0) return state;

  if (action.type !== "skip") {
    const skip = resolveSkipCheck(state, actor.key);
    state = skip.state;
    if (skip.skipped) return { ...state, log: [`${actor.name} is unable to act.`, ...state.log] };
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
    const targets = skillTargets(state, actor.key, skill, action.targetKey);
    if (!targets.length) return state;
    let next = targets.reduce((current, originalTarget) => {
      const target = findUnit(current, originalTarget.key);
      if (!target || target.hp <= 0) return current;
      if (skill.skill_type === "attack") {
        const damage = calculateDamage(actor, target, skill);
        const finalDamage = target.blocking ? Math.max(1, Math.floor(damage * 0.1)) : damage;
        return updateUnit(current, target.key, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - finalDamage) }), `${actor.name} used ${skill.name} on ${target.name} for ${finalDamage} damage.`);
      }
      const effectKind = String(skill.effect.kind ?? "");
      const amount = Number(skill.effect.amount ?? 0);
      if ((effectKind === "heal" || effectKind === "restore_hp") && amount > 0) {
        const healed = skill.effect.amount_type === "percent_max_hp" ? Math.max(1, Math.floor(target.maxHp * amount)) : amount;
        return updateUnit(current, target.key, (unit) => ({ ...unit, hp: Math.min(unit.maxHp, unit.hp + healed) }), `${actor.name} used ${skill.name} on ${target.name}, restoring ${healed} HP.`);
      }
      return { ...current, log: [`${actor.name} used ${skill.name} on ${target.name}.`, ...current.log] };
    }, state);
    const effects = next.runEffects.skill[skill.id] ?? [];
    if (effects.length) {
      for (const effect of effects) next = resolveEffect(next, effect, {
        sourceOwnerType: "skill",
        sourceOwnerId: skill.id,
        sourceCritterKey: actor.key,
        selectedTargetKey: action.targetKey,
      });
    }
    return next;
  }

  return state;
}

export function isSingleTarget(skill: Skill): boolean {
  return (skill.targeting ?? "single_enemy") === "single_enemy" || skill.targeting === "single_any";
}

export function skillTargets(state: CombatState, actorKey: string, skill: Skill, selectedKey?: string): CombatUnit[] {
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
  if (!selectedKey) return candidates;
  return candidates.filter((unit) => unit.key === selectedKey);
}

type RuntimeContext = {
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
  selectedTargetKey?: string;
  statusHolderKey?: string;
};

function effectTargets(state: CombatState, target: string, context: RuntimeContext): CombatUnit[] {
  const source = context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined;
  const friendlies = source?.side === "opponent" ? state.opponentUnits : state.playerUnits;
  const enemies = source?.side === "opponent" ? state.playerUnits : state.opponentUnits;
  const active = (unit: CombatUnit) => unit.active && unit.hp > 0;
  switch (target) {
    case "skill_user": {
      if (!source) throw new Error(`Missing source Critter for ${context.sourceOwnerType} effect from ${context.sourceOwnerId}.`);
      return active(source) ? [source] : [];
    }
    case "selected_target": {
      if (!context.selectedTargetKey) throw new Error(`Missing selected target for effect from ${context.sourceOwnerId}.`);
      const selected = findUnit(state, context.selectedTargetKey);
      return selected && active(selected) ? [selected] : [];
    }
    case "all_enemies": return enemies.filter(active);
    case "all_allies": return friendlies.filter((unit) => active(unit) && unit.key !== source?.key);
    case "all_friendlies":
    case "all_friendly_critters": return friendlies.filter(active);
    case "active_friendly_critter": return friendlies.filter(active).slice(0, 1);
    case "equipped_critter": {
      if (!source) throw new Error(`Missing equipped Critter for relic effect from ${context.sourceOwnerId}.`);
      return active(source) ? [source] : [];
    }
    case "status_holder": {
      if (!context.statusHolderKey) throw new Error(`Missing status holder for status effect from ${context.sourceOwnerId}.`);
      const holder = findUnit(state, context.statusHolderKey);
      return holder && holder.hp > 0 ? [holder] : [];
    }
    default: throw new Error(`Unsupported effect target: ${target}`);
  }
}

function resolveEffect(state: CombatState, effect: ResolvedEffectRef, context: RuntimeContext): CombatState {
  assertEffectContract(effect, context.sourceOwnerType);
  const targets = effectTargets(state, String(effect.parameters.target ?? ""), context);
  if (!targets.length) return state;
  const key = `${effect.runtimeKind}@${effect.runtimeVersion}`;
  if (key === "restore_hp@1") {
    return targets.reduce((next, original) => {
      const target = findUnit(next, original.key)!;
      const raw = effect.parameters.mode === "percent_max_hp"
        ? target.maxHp * Number(effect.parameters.amount ?? 0)
        : Number(effect.parameters.amount ?? 0);
      const amount = Math.max(0, Math.round(raw));
      return updateUnit(next, target.key, (unit) => ({ ...unit, hp: Math.min(unit.maxHp, unit.hp + amount) }), `${effect.name} restored ${amount} HP to ${target.name}.`);
    }, state);
  }
  if (key === "apply_status@1") {
    let next = state;
    for (const target of targets) {
      const roll = nextRandom(next.rngState);
      next = { ...next, rngState: roll.state };
      if (roll.value < Number(effect.parameters.chance ?? 0)) {
        next = applyStatus(next, String(effect.parameters.status_id), target.key, context);
      }
    }
    return next;
  }
  if (key === "damage_over_time@1" || key === "skip_action_chance@1") {
    const duration = Number(effect.parameters.duration ?? 1);
    if (context.sourceOwnerType === "status") return state;
    return targets.reduce((next, target) => addTimedEffect(next, effect, target.key, context, duration), state);
  }
  if (key === "stat_modifier@1" || key === "mana_dice_modifier@1") {
    const modifiers = targets.map((target, index): CombatModifier => ({
      instanceId: `${context.sourceOwnerType}:${context.sourceOwnerId}:${effect.id}:${target.key}:${state.turn}:${state.modifiers.length + index}`,
      holderKey: target.key,
      sourceOwnerType: context.sourceOwnerType,
      sourceOwnerId: context.sourceOwnerId,
      sourceCritterKey: context.sourceCritterKey,
      effect,
    }));
    return recomputeCombatStats({
      ...state,
      modifiers: [...state.modifiers, ...modifiers],
      log: [...targets.map((target) => `${effect.name} affected ${target.name}.`).reverse(), ...state.log],
    });
  }
  throw new Error(`Unsupported effect runtime: ${key}`);
}

function applyStatus(
  state: CombatState,
  statusId: string,
  holderKey: string,
  context: RuntimeContext,
): CombatState {
  const status = state.statusRegistry[statusId];
  if (!status) throw new Error(`Unknown status: ${statusId}`);
  const duration = Math.max(1, Number(status.default_duration ?? 3));
  const policy = status.stacking_policy ?? "refresh";
  const existingIndex = state.statuses.findIndex((item) => item.statusId === statusId && item.holderKey === holderKey);
  let statuses = [...state.statuses];
  if (existingIndex >= 0) {
    const existing = statuses[existingIndex];
    if (policy === "refresh") statuses[existingIndex] = { ...existing, duration };
    if (policy === "extend") statuses[existingIndex] = { ...existing, duration: existing.duration + duration };
    if (policy === "stack") statuses[existingIndex] = { ...existing, stacks: Math.min(status.max_stacks ?? 99, existing.stacks + 1), duration };
  } else {
    statuses.push({
      instanceId: `${statusId}:${holderKey}:${state.turn}`,
      statusId,
      holderKey,
      duration,
      stacks: 1,
      sourceOwnerType: "status",
      sourceOwnerId: statusId,
      sourceCritterKey: context.sourceCritterKey,
      effects: state.runEffects.status[statusId] ?? [],
    });
  }
  const holder = findUnit(state, holderKey);
  return recomputeCombatStats({ ...state, statuses, log: [`${holder?.name ?? holderKey} received ${status.name}.`, ...state.log] });
}

function addTimedEffect(state: CombatState, effect: ResolvedEffectRef, holderKey: string, context: RuntimeContext, duration: number): CombatState {
  const instance: CombatStatus = {
    instanceId: `effect:${effect.id}:${holderKey}:${state.turn}`,
    statusId: `effect:${effect.id}`,
    holderKey,
    duration,
    stacks: 1,
    sourceOwnerType: context.sourceOwnerType,
    sourceOwnerId: context.sourceOwnerId,
    sourceCritterKey: context.sourceCritterKey,
    effects: [effect],
  };
  return { ...state, statuses: [...state.statuses.filter((item) => item.instanceId !== instance.instanceId), instance] };
}

function resolveTimedEffects(state: CombatState, timing: "start_of_turn" | "end_of_turn"): CombatState {
  let next = state;
  for (const instance of state.statuses) {
    for (const effect of instance.effects) {
      if (effect.runtimeKind !== "damage_over_time" || effect.parameters.timing !== timing) continue;
      const holder = findUnit(next, instance.holderKey);
      if (!holder || holder.hp <= 0) continue;
      const raw = effect.parameters.mode === "percent_max_hp"
        ? holder.maxHp * Number(effect.parameters.amount ?? 0)
        : Number(effect.parameters.amount ?? 0);
      const damage = Math.max(0, Math.round(raw)) * instance.stacks;
      next = updateUnit(next, holder.key, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - damage) }), `${holder.name} took ${damage} damage from ${effect.name}.`);
    }
  }
  if (timing === "end_of_turn") {
    next = { ...next, statuses: next.statuses.map((item) => ({ ...item, duration: item.duration - 1 })).filter((item) => item.duration > 0) };
  }
  return recomputeCombatStats(next);
}

function resolveSkipCheck(state: CombatState, holderKey: string): { state: CombatState; skipped: boolean } {
  let next = state;
  for (const instance of state.statuses.filter((item) => item.holderKey === holderKey)) {
    for (const effect of instance.effects.filter((item) => item.runtimeKind === "skip_action_chance")) {
      for (let stack = 0; stack < instance.stacks; stack += 1) {
        const roll = nextRandom(next.rngState);
        next = { ...next, rngState: roll.state };
        if (roll.value < Number(effect.parameters.chance ?? 0)) return { state: next, skipped: true };
      }
    }
  }
  return { state: next, skipped: false };
}

function swapPlayerUnit(state: CombatState, actorKey: string, swapToId: string): CombatState {
  const activeIndex = state.playerUnits.findIndex((unit) => unit.key === actorKey);
  const benchIndex = state.playerUnits.findIndex((unit) => unit.userCritter?.id === swapToId && !unit.active && unit.hp > 0);
  if (activeIndex < 0 || benchIndex < 0) return state;

  const units = state.playerUnits.map((unit, index) => {
    if (index === activeIndex) return { ...unit, active: false };
    if (index === benchIndex) return { ...unit, active: true };
    return unit;
  });

  const beforeSources = new Set(activeSetupSources(state).map(setupSourceIdentity));
  let next: CombatState = {
    ...state,
    playerUnits: units,
    log: [`${state.playerUnits[activeIndex].name} swapped with ${state.playerUnits[benchIndex].name}.`, ...state.log],
  };
  next = recomputeCombatStats(next);
  const activatedSources = activeSetupSources(next).filter((source) => !beforeSources.has(setupSourceIdentity(source)));
  for (const source of activatedSources) {
    for (const effect of source.effects) {
      if (effect.runtimeKind === "stat_modifier" || effect.runtimeKind === "mana_dice_modifier") continue;
      next = resolveEffect(next, effect, {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceCritterKey: source.sourceKey,
      });
    }
  }
  return next;
}

function setupSourceIdentity(source: SetupEffectSource): string {
  return `${source.ownerType}:${source.ownerId}:${source.sourceKey ?? "team"}:${source.sourceOrder}`;
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
