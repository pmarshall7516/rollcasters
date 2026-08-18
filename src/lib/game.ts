import type {
  Catalog,
  CombatAction,
  CombatProgressEvent,
  Critter,
  CritterProgression,
  Dungeon,
  DungeonEnemyRollcaster,
  DungeonOpponent,
  EclipseOrderType,
  ElementDef,
  EffectOwnerType,
  PlayerState,
  ResolvedEffectRef,
  Skill,
  Status,
  UserCritter,
} from "./types.js";
import { assertEffectContract, effectMatchesSourceCritter, effectMatchesSourceSkill, normalizeEffectElementParameters, skillElementIds, sourceCritterTagIds, sourceSkillTagIds, targetCritterTagIds, targetElementIds } from "./effects.js";
import { battlefieldSlotsForCount } from "./dungeons.js";

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

export type ActionCostAction = {
  type: "skill" | "block" | "swap" | "skip";
  skillId?: string;
  skillType?: Skill["skill_type"];
  skillElementId?: string;
  skillTagIds?: string[];
};

export type ActionCostSource = {
  amount: number;
  sourceName: string;
};

export type ActionCostBreakdown = {
  base: number;
  final: number;
  sources: ActionCostSource[];
};

export type ActionCostModifier = {
  parameters: Record<string, unknown>;
  sourceName: string;
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
  shield: number;
  maxShield: number;
  skills: Skill[];
  active: boolean;
  battlefieldSlot: number | null;
  blocking: boolean;
  blockStreak: number;
  manaRoll: number;
};

/**
 * Returns the living active Critters in the order shown on the battlefield.
 *
 * Combat units are stored in squad order so that loadout identity remains
 * stable across swaps. Action selection, however, must follow the fixed
 * battlefield slots from top to bottom.
 */
export function orderedActiveCombatUnits(units: CombatUnit[]): CombatUnit[] {
  return units
    .filter((unit) => unit.active && unit.hp > 0)
    .slice()
    .sort((left, right) => (
      (left.battlefieldSlot ?? Number.MAX_SAFE_INTEGER) - (right.battlefieldSlot ?? Number.MAX_SAFE_INTEGER)
      || left.key.localeCompare(right.key)
    ));
}

export type CombatStatus = {
  instanceId: string;
  statusId: string;
  holderKey: string;
  duration: number | null;
  /** Number of completed turn-end boundaries while this instance was afflicted. */
  turnsElapsed?: number;
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
  effects: ResolvedEffectRef[];
};

export type RuntimeEffectInstance = {
  instanceId: string;
  sourceEffectId: string;
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceSide?: CombatUnit["side"];
  sourceCritterKey?: string;
  targetCritterKey?: string;
  runtimeKind: string;
  runtimeVersion: number;
  classification?: "positive" | "negative" | "mixed";
  appliedAtSequence: number;
  remaining?: number;
  activationCount: number;
  conditionalParentInstanceId?: string;
  state: Record<string, unknown>;
};

export type CombatModifier = {
  instanceId: string;
  holderKey: string;
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
  statusInstanceId?: string;
  /** An incremental Status modifier that intentionally survives Status removal. */
  retainedAfterStatusRemoval?: boolean;
  conditionalParentInstanceId?: string;
  effect: ResolvedEffectRef;
};

export type CombatEffectSummary = {
  id: string;
  kind: "effect" | "status";
  name: string;
  description: string;
  amountLabel: string | null;
  classification: "positive" | "negative" | "mixed";
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  duration: number | null | undefined;
};

export type CombatPresentationEvent = {
  kind: "skill" | "damage" | "heal" | "swap" | "block" | "wait" | "status" | "other" | "mana_refund";
  message: string;
  effectPolarity?: "positive" | "negative";
  actorKey?: string;
  targetKeys: string[];
  skillId?: string;
  /** The bounded random percentage used for a Skill's base damage roll. */
  damageRollPercent?: number;
  /** The Pokémon-style spread-move power multiplier, when it weakens an attack. */
  damageSpreadPercent?: number;
  effectiveness?: number;
  effectivenessClass?: EffectivenessClass;
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

export type CombatPresentationState = {
  playerMana: number;
  opponentMana: number;
  units: Array<{
    key: string;
    hp: number;
    maxHp: number;
    shield: number;
    maxShield: number;
    blocking: boolean;
    blockStreak: number;
    active: boolean;
    battlefieldSlot: number | null;
    persistentStats: StatBlock;
    stats: StatBlock;
  }>;
  statuses: CombatStatus[];
  modifiers: CombatModifier[];
  runtimeEffects: RuntimeEffectInstance[];
};

type SetupEffectSource = {
  ownerType: "relic" | "ability";
  ownerId: string;
  side: CombatUnit["side"];
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
  enemyPolicyKey?: DungeonEnemyRollcaster["policy_key"];
  enemyRollcasterType?: EclipseOrderType;
  snapshot: RunEffectSnapshot;
  turnEvents: CombatProgressEvent[];
  presentationEvents: CombatPresentationEvent[];
  /** Effect IDs that triggered during the current resolution window. Conditional parents are recorded only when their condition matches. */
  effectActivations: string[];
  /** Source-qualified effect activations for telemetry that distinguishes identical effects on different owners or critters. */
  effectActivationKeys: string[];
  runtimeEffects: RuntimeEffectInstance[];
  effectSequence: number;
  skillUsage: {
    encounter: Record<string, number>;
    dungeon: Record<string, number>;
  };
  rechargeUntilTurn: Record<string, number>;
};

export function effectActivationKey(
  effect: Pick<ResolvedEffectRef, "ownerType" | "ownerId" | "id">,
  sourceCritterKey?: string,
): string {
  return JSON.stringify([effect.ownerType, effect.ownerId, sourceCritterKey ?? null, effect.id]);
}

function recordEffectActivation(
  state: CombatState,
  effect: Pick<ResolvedEffectRef, "ownerType" | "ownerId" | "id">,
  sourceCritterKey?: string,
): CombatState {
  return {
    ...state,
    effectActivations: [...state.effectActivations, effect.id],
    effectActivationKeys: [...(state.effectActivationKeys ?? []), effectActivationKey(effect, sourceCritterKey)],
  };
}

export type SkillAvailability = {
  valid: boolean;
  reason?: string;
  remainingUses?: number;
  scope?: "encounter" | "dungeon";
};

export type EffectivenessClass =
  | "extra-effective"
  | "effective"
  | "neutral"
  | "resisted"
  | "extra-resisted";

export type SkillDamage = {
  damage: number;
  maxDamage: number;
  damageRollPercent: number;
  targetCount: number;
  spreadMultiplier: number;
  effectiveness: number;
  classification: EffectivenessClass;
  suffix: string;
  stab: boolean;
};

export function byId<T extends { id: string }>(items: T[], id: string | null | undefined): T | undefined {
  if (!id) return undefined;
  return items.find((item) => item.id === id);
}

export function elementName(catalog: Catalog, elementId: string): string {
  return byId<ElementDef>(catalog.elements, elementId)?.name ?? elementId;
}

export function critterElementIds(
  critter: Pick<Critter, "element_1_id" | "element_2_id">,
): string[] {
  return critter.element_2_id
    ? [critter.element_1_id, critter.element_2_id]
    : [critter.element_1_id];
}

export function critterTagIds(critter: Pick<Critter, "tag_ids">): string[] {
  return Array.isArray(critter.tag_ids) ? critter.tag_ids : [];
}

export function critterHasElement(
  critter: Pick<Critter, "element_1_id" | "element_2_id">,
  elementId: string,
): boolean {
  return critter.element_1_id === elementId || critter.element_2_id === elementId;
}

export function matchesSelectedElements(
  critter: Pick<Critter, "element_1_id" | "element_2_id">,
  selectedIds: Set<string>,
): boolean {
  return selectedIds.size === 0
    || critterElementIds(critter).some((elementId) => selectedIds.has(elementId));
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

  const { diceMin, diceMax } = normalizeManaDiceBounds(total.diceMin, total.diceMax, Math.floor);

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
  seedKey = runId,
  enemyRollcaster?: Pick<DungeonEnemyRollcaster, "ability_ids" | "eclipse_order_type"> & Partial<Pick<DungeonEnemyRollcaster, "policy_key">>,
): CombatState {
  const squad = squadCritters(player);
  const playerBattlefieldSlots = battlefieldSlotsForCount(dungeon.player_active_count);
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
      shield: 0,
      maxShield: 0,
      skills,
      active: index < dungeon.player_active_count,
      battlefieldSlot: index < dungeon.player_active_count ? playerBattlefieldSlots[index] : null,
    blocking: false,
    blockStreak: 0,
    manaRoll: 0,
    };
  });

  const opponentRows = selectedOpponents?.length ? structuredClone(selectedOpponents) : pickOpponents(catalog, dungeon);
  const opponentBattlefieldSlots = battlefieldSlotsForCount(dungeon.opponent_active_count);
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
      shield: 0,
      maxShield: 0,
      skills,
      active: index < dungeon.opponent_active_count,
      battlefieldSlot: index < dungeon.opponent_active_count ? opponentBattlefieldSlots[index] : null,
      blocking: false,
      blockStreak: 0,
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
      setupSources.push({ ownerType: "relic", ownerId: slot.relic_id!, side: "player", sourceKey: unit.key, effects: runEffects.relic[slot.relic_id!] ?? [], sourceOrder: unitIndex * 100 + slot.slot_index });
    }
  }
  opponentRows.forEach((opponent, index) => {
    opponent.relic_ids.forEach((relicId, slotIndex) => {
      setupSources.push({ ownerType: "relic", ownerId: relicId, side: "opponent", sourceKey: `o${index + 1}`, effects: runEffects.relic[relicId] ?? [], sourceOrder: 10_000 + index * 100 + slotIndex });
    });
  });
  const activeRollcaster = player.rollcasters.find((owned) => owned.id === player.profile.active_rollcaster_id);
  if (activeRollcaster) {
    for (const slot of player.abilitySlots
      .filter((candidate) => candidate.user_rollcaster_id === activeRollcaster.id && candidate.ability_id)
      .sort((a, b) => a.slot_index - b.slot_index)) {
      setupSources.push({ ownerType: "ability", ownerId: slot.ability_id!, side: "player", effects: runEffects.ability[slot.ability_id!] ?? [], sourceOrder: slot.slot_index });
    }
  }
  for (const [slotIndex, abilityId] of (enemyRollcaster?.ability_ids ?? []).entries()) {
    setupSources.push({ ownerType: "ability", ownerId: abilityId, side: "opponent", effects: runEffects.ability[abilityId] ?? [], sourceOrder: 20_000 + slotIndex });
  }
  setupSources.sort((a, b) => (a.ownerType === b.ownerType ? a.sourceOrder - b.sourceOrder : a.ownerType === "relic" ? -1 : 1));

  const seed = hashSeed(seedKey);
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
    enemyPolicyKey: enemyRollcaster?.policy_key,
    enemyRollcasterType: enemyRollcaster?.eclipse_order_type,
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
    presentationEvents: [],
    effectActivations: [],
    effectActivationKeys: [],
    runtimeEffects: [],
    effectSequence: 0,
    skillUsage: { encounter: {}, dungeon: {} },
    rechargeUntilTurn: {},
  };
  initialState = recomputeCombatStats(initialState);
  initialState = installRootEffects(initialState);
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
  return { ...effect, parameters: normalizeEffectElementParameters(effect.runtimeKind, structuredClone(effect.parameters)) };
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

function effectForReference(state: CombatState, ownerType: EffectOwnerType, ownerId: string, effectId: string): ResolvedEffectRef | undefined {
  return (state.runEffects[ownerType][ownerId] ?? []).find((candidate) => candidate.id === effectId);
}

function addRuntimeEffect(
  state: CombatState,
  effect: ResolvedEffectRef,
  context: RuntimeContext,
  stateData: Record<string, unknown> = {},
  remaining?: number,
): CombatState {
  const sequence = state.effectSequence + 1;
  const instance: RuntimeEffectInstance = {
    instanceId: `runtime:${sequence}:${effect.id}`,
    sourceEffectId: effect.id,
    sourceOwnerType: context.sourceOwnerType,
    sourceOwnerId: context.sourceOwnerId,
    sourceSide: context.sourceSide,
    sourceCritterKey: context.sourceCritterKey,
    targetCritterKey: context.skillTargetKeys?.[0],
    runtimeKind: effect.runtimeKind,
    runtimeVersion: effect.runtimeVersion,
    classification: effect.classification,
    appliedAtSequence: sequence,
    remaining,
    activationCount: 0,
    conditionalParentInstanceId: context.conditionalParentInstanceId,
    state: stateData,
  };
  return { ...state, effectSequence: sequence, runtimeEffects: [...state.runtimeEffects, instance] };
}

type DelayedAdvanceEvent = {
  delayType: string;
  timing?: "start_of_turn" | "end_of_turn";
  actorKey?: string;
  targetKeys?: string[];
  ignoreAppliedAfter?: number;
};

function delayedParameters(instance: RuntimeEffectInstance): Record<string, unknown> {
  return instance.state.parameters as Record<string, unknown> | undefined ?? {};
}

function delayedUnitLabel(delayType: string): string {
  return delayType === "turns" ? "turns"
    : delayType === "rounds" ? "rounds"
      : delayType === "actions" ? "actions"
        : delayType === "attacks_received" ? "attacks received"
          : delayType === "skills_used" ? "skills used"
            : delayType === "blocks_performed" ? "blocks performed"
              : delayType === "swaps_performed" ? "swaps performed"
                : delayType;
}

function delayedTargetKeys(
  state: CombatState,
  parent: ResolvedEffectRef,
  instance: RuntimeEffectInstance,
): string[] {
  const parameters = delayedParameters(instance);
  if (parameters.target_tracking === "new_valid") {
    return effectTargets(state, String(parent.parameters.target ?? ""), {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceSide: instance.sourceSide,
      sourceCritterKey: instance.sourceCritterKey,
      elementIds: effectElementIdsForTargeting(parent),
      tagIds: effectTagIdsForTargeting(parent),
    }).map((target) => target.key);
  }
  if (!instance.targetCritterKey) return [];
  const target = findUnit(state, instance.targetCritterKey);
  return target && target.hp > 0 ? [target.key] : [];
}

function delayedTimerCancelled(state: CombatState, instance: RuntimeEffectInstance): boolean {
  const parameters = delayedParameters(instance);
  const source = instance.sourceCritterKey ? findUnit(state, instance.sourceCritterKey) : undefined;
  const target = instance.targetCritterKey ? findUnit(state, instance.targetCritterKey) : undefined;
  const condition = String(parameters.cancel_condition ?? "none");
  if (condition === "source_defeated" && (!source || source.hp <= 0)) return true;
  if (condition === "target_defeated" && (!target || target.hp <= 0)) return true;
  if (condition === "target_leaves_active" && (!target || !target.active)) return true;
  if (condition === "shield_breaks" && Number(instance.state.initialShield ?? 0) > 0 && (!target || target.shield <= 0)) return true;
  return false;
}

function delayedEventMatches(instance: RuntimeEffectInstance, event: DelayedAdvanceEvent): boolean {
  const parameters = delayedParameters(instance);
  const delayType = String(parameters.delay_type ?? "turns");
  if (delayType !== event.delayType) return false;
  if (delayType === "turns" && String(parameters.delay_timing ?? "end_of_turn") !== String(event.timing)) return false;
  if (["turns", "rounds", "actions"].includes(delayType)) return true;
  if (delayType === "attacks_received") {
    return !instance.targetCritterKey || Boolean(event.targetKeys?.includes(instance.targetCritterKey));
  }
  return !instance.targetCritterKey || instance.targetCritterKey === event.actorKey;
}

function scheduleDelayedEffect(
  state: CombatState,
  effect: ResolvedEffectRef,
  context: RuntimeContext,
  targets: CombatUnit[],
): CombatState {
  const delay = Math.max(1, Number(effect.parameters.delay_value ?? 1));
  const targetTracking = String(effect.parameters.target_tracking ?? "original");
  const allowMultiple = effect.parameters.allow_multiple_at_once === true;
  const targetKeys = targetTracking === "new_valid"
    ? [undefined]
    : targets.map((target) => target.key);
  let next = state;
  for (const targetKey of targetKeys) {
    if (!allowMultiple && next.runtimeEffects.some((instance) => (
      instance.runtimeKind === "delayed_effect"
      && instance.sourceOwnerType === context.sourceOwnerType
      && instance.sourceOwnerId === context.sourceOwnerId
      && instance.sourceEffectId === effect.id
      && instance.sourceCritterKey === context.sourceCritterKey
      && instance.remaining !== undefined
      && (instance.targetCritterKey ?? undefined) === targetKey
    ))) continue;
    const target = targetKey ? findUnit(next, targetKey) : undefined;
    next = addRuntimeEffect(
      next,
      effect,
      { ...context, skillTargetKeys: targetKey ? [targetKey] : undefined },
      {
        delayed: true,
        parameters: structuredClone(effect.parameters),
        delayElapsed: 0,
        delayMax: delay,
        initialShield: target?.shield ?? 0,
      },
      delay,
    );
  }
  return next;
}

function advanceDelayedEffects(state: CombatState, event: DelayedAdvanceEvent): CombatState {
  let next = state;
  for (const instance of [...state.runtimeEffects]) {
    if (instance.runtimeKind !== "delayed_effect" || instance.remaining === undefined || instance.state.delayed !== true) continue;
    if (event.ignoreAppliedAfter !== undefined && instance.appliedAtSequence > event.ignoreAppliedAfter) continue;
    const parent = effectForReference(next, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
    if (!parent) continue;
    if (delayedTimerCancelled(next, instance)) {
      next = { ...next, runtimeEffects: next.runtimeEffects.filter((candidate) => candidate.instanceId !== instance.instanceId) };
      continue;
    }
    if (!delayedEventMatches(instance, event)) continue;

    const parameters = delayedParameters(instance);
    const maximum = Math.max(1, Number(instance.state.delayMax ?? parameters.delay_value ?? 1));
    const remaining = Math.max(0, Number(instance.remaining) - 1);
    const elapsed = Math.min(maximum, maximum - remaining);
    next = {
      ...next,
      runtimeEffects: next.runtimeEffects.map((candidate) => candidate.instanceId === instance.instanceId
        ? { ...candidate, remaining, state: { ...candidate.state, delayElapsed: elapsed, delayMax: maximum } }
        : candidate),
    };

    const targetKeys = delayedTargetKeys(next, parent, instance);
    const target = targetKeys.map((key) => findUnit(next, key)).find((candidate): candidate is CombatUnit => Boolean(candidate));
    if (parameters.visible_countdown === true && target) {
      const message = `${combatantPossessive(target)} ${parent.name || "Delayed Effect"} timer is at ${elapsed}/${maximum} ${delayedUnitLabel(String(parameters.delay_type ?? "turns"))}.`;
      next = appendPresentationEvent(next, {
        kind: "other",
        effectPolarity: "negative",
        message,
        actorKey: instance.sourceCritterKey,
        targetKeys: [target.key],
        hpChanges: [],
      });
    }
    if (remaining > 0) continue;

    if (!targetKeys.length) {
      next = { ...next, runtimeEffects: next.runtimeEffects.filter((candidate) => candidate.instanceId !== instance.instanceId) };
      continue;
    }
    const description = String(parameters.trigger_description ?? parent.description ?? "").trim();
    if (description) {
      next = appendPresentationEvent(next, {
        kind: "other",
        effectPolarity: parent.classification === "positive" ? "positive" : "negative",
        message: description,
        actorKey: instance.sourceCritterKey,
        targetKeys,
        hpChanges: [],
      });
    }
    next = resolveChildEffects(next, parent, {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceSide: instance.sourceSide,
      sourceCritterKey: instance.sourceCritterKey,
      skillTargetKeys: targetKeys,
      parentInstanceId: instance.instanceId,
    }, parent.parameters.child_effect_ids);
    const repeat = parent.parameters.repeat === true;
    const stillPresent = next.runtimeEffects.some((candidate) => candidate.instanceId === instance.instanceId);
    if (repeat && stillPresent) {
      next = {
        ...next,
        runtimeEffects: next.runtimeEffects.map((candidate) => candidate.instanceId === instance.instanceId
          ? { ...candidate, remaining: maximum, state: { ...candidate.state, delayElapsed: 0, delayMax: maximum } }
          : candidate),
      };
    } else {
      next = { ...next, runtimeEffects: next.runtimeEffects.filter((candidate) => candidate.instanceId !== instance.instanceId) };
    }
  }
  return next;
}

function resolveChildEffects(state: CombatState, parent: ResolvedEffectRef, context: RuntimeContext, ids: unknown): CombatState {
  const childIds = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  if (childIds.length === 0 || (context.resolutionDepth ?? 0) >= 16) return state;
  let next = state;
  const stack = new Set<string>(context.parentInstanceId ? [context.parentInstanceId] : []);
  for (const childId of childIds) {
    const child = effectForReference(next, parent.ownerType, parent.ownerId, childId);
    if (!child || child.execution !== "child" || stack.has(child.id)) continue;
    next = resolveEffect(next, child, { ...context, parentInstanceId: child.id, resolutionDepth: (context.resolutionDepth ?? 0) + 1 });
  }
  return next;
}

type SetupRuntimeRefreshOptions = {
  applyRootShields?: boolean;
};

type ConditionalRefreshTiming = "initial" | "before_action" | "turn_start" | "turn_end";

function refreshConditionalSetupEffects(state: CombatState, actionContext: ActionResolutionContext = {}, timing: ConditionalRefreshTiming = "before_action"): CombatState {
  let next = state;
  for (const source of activeSetupSources(next)) {
    for (const effect of source.effects) {
      if (effect.execution === "child" || effect.runtimeKind !== "conditional_effect") continue;
      const checkTiming = String(effect.parameters.check_timing ?? "continuous");
      if (timing !== "initial" && checkTiming !== "continuous" && checkTiming !== timing) continue;
      const context: RuntimeContext = {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceSide: source.side,
        sourceCritterKey: source.sourceKey,
        ...actionContext,
      };
      let parent = next.runtimeEffects.find((instance) => instance.sourceOwnerType === source.ownerType && instance.sourceOwnerId === source.ownerId && instance.sourceEffectId === effect.id);
      if (!parent) {
        next = addRuntimeEffect(next, effect, context, { sourceOrder: source.sourceOrder, parameters: structuredClone(effect.parameters) });
        parent = next.runtimeEffects[next.runtimeEffects.length - 1];
      }
      const effectTarget = String(effect.parameters.effect_target ?? effect.parameters.target ?? "");
      const conditionTarget = String(effect.parameters.condition_target ?? effectTarget);
      const effectTargetsForParent = effectTargets(next, effectTarget, {
        ...context,
        elementIds: effectElementIdsForTargeting(effect),
        tagIds: targetCritterTagIds(effect),
      });
      if (!effectTargetsForParent.length) continue;
      const conditionTargets = effectTargets(next, conditionTarget, {
        ...context,
        elementIds: undefined,
        tagIds: undefined,
      });
      const active = conditionalEffectMatches(next, effect, conditionTargets, context);
      if (parent.state.conditionalActive === active) continue;
      if (active) next = recordEffectActivation(next, effect, context.sourceCritterKey);
      next = {
        ...next,
        modifiers: next.modifiers.filter((modifier) => active || effect.parameters.remove_effects_when_false !== true || modifier.conditionalParentInstanceId !== parent!.instanceId),
        runtimeEffects: next.runtimeEffects.filter((instance) => active || effect.parameters.remove_effects_when_false !== true || instance.conditionalParentInstanceId !== parent!.instanceId),
      };
      next = resolveChildEffects(next, effect, {
        ...context,
        skillTargetKeys: effectTargetsForParent.map((target) => target.key),
        parentInstanceId: parent.instanceId,
        conditionalParentInstanceId: parent.instanceId,
      }, active ? effect.parameters.true_effect_ids : effect.parameters.false_effect_ids);
      next = {
        ...next,
        runtimeEffects: next.runtimeEffects.map((instance) => instance.instanceId === parent!.instanceId
          ? { ...instance, state: { ...instance.state, conditionalActive: active } }
          : instance),
      };
    }
  }
  return next;
}

function installRootEffects(state: CombatState, options: SetupRuntimeRefreshOptions = {}): CombatState {
  let next = state;
  for (const source of activeSetupSources(state)) {
    for (const effect of source.effects) {
      if (effect.execution === "child") continue;
      const context: RuntimeContext = {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceSide: source.side,
        sourceCritterKey: source.sourceKey,
      };
      const sourceCritter = source.sourceKey ? findUnit(next, source.sourceKey)?.critter : undefined;
      if (!effectMatchesSourceCritter(effect, sourceCritter)) continue;
      if (effect.runtimeKind === "shield_modifier" && options.applyRootShields !== false) next = resolveEffect(next, effect, context);
      else if (effect.runtimeKind === "direct_health_modifier" && ["attacker", "attacker_and_targets"].includes(String(effect.parameters.target))) {
        // A root Direct Health Modifier targeting the attacker is an
        // attack-triggered retaliation (for example, Spiky Shield's Thorns).
        // Keep it installed until an incoming attack supplies the attacker
        // context instead of trying to resolve it during setup.
        next = addRuntimeEffect(next, effect, context, { sourceOrder: source.sourceOrder });
      }
      else if (effect.runtimeKind === "effect_amplification") {
        next = resolveEffect(next, effect, context);
      }
      else if (effect.runtimeKind === "delayed_effect") {
        next = resolveEffect(next, effect, context);
      }
      else if (["reactive_trigger", "retaliation", "repeating_effect", "conditional_effect", "effect_duration", "effect_immunity", "damage_modifier", "damage_prevention", "action_cost_modifier"].includes(effect.runtimeKind)) {
        next = addRuntimeEffect(next, effect, context, { sourceOrder: source.sourceOrder, parameters: structuredClone(effect.parameters) });
      }
    }
  }
  return refreshConditionalSetupEffects(next, {}, "initial");
}

function applyDungeonOverrides(stats: StatBlock, rows: Catalog["dungeonOpponentStatOverrides"]): StatBlock {
  const next = { ...stats };
  const keys: Record<string, keyof StatBlock> = {
    hp: "hp", atk: "atk", def: "def", spd: "spd", dice_min: "diceMin", dice_max: "diceMax",
    block_cost: "blockCost", swap_cost: "swapCost", relic_slots: "relicSlots",
  };
  for (const row of rows) {
    const key = keys[row.stat_key];
    if (key) next[key] = row.value;
  }
  next.hp = Math.max(1, next.hp);
  next.atk = Math.max(1, next.atk);
  next.def = Math.max(1, next.def);
  next.spd = Math.max(1, next.spd);
  ({ diceMin: next.diceMin, diceMax: next.diceMax } = normalizeManaDiceBounds(next.diceMin, next.diceMax));
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

function statSetupSources(state: CombatState): SetupEffectSource[] {
  return state.setupSources.filter((source) => source.ownerType === "ability" || source.ownerType === "relic");
}

export function recomputeCombatStats(state: CombatState): CombatState {
  const effectsByTarget = new Map<string, ResolvedEffectRef[]>();
  for (const source of statSetupSources(state)) {
    for (const effect of source.effects) {
      assertEffectContract(effect, source.ownerType);
      if (effect.execution === "child") continue;
      if (effect.runtimeKind !== "stat_modifier" && effect.runtimeKind !== "mana_dice_modifier") continue;
      const sourceCritter = source.sourceKey ? findUnit(state, source.sourceKey)?.critter : undefined;
      if (!effectMatchesSourceCritter(effect, sourceCritter)) continue;
      const targets = effectTargets(state, String(effect.parameters.target), {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceSide: source.side,
        sourceCritterKey: source.sourceKey,
        allowInactiveSource: source.ownerType === "relic",
        elementIds: targetElementIds(effect),
        tagIds: targetCritterTagIds(effect),
      });
      for (const unit of targets) effectsByTarget.set(unit.key, [...(effectsByTarget.get(unit.key) ?? []), effect]);
    }
  }

  const livingActiveKeys = new Set(
    [...state.playerUnits, ...state.opponentUnits]
      .filter((unit) => unit.active && unit.hp > 0)
      .map((unit) => unit.key),
  );
  // Setup modifiers belong only to living active units. Status modifiers are
  // retained while their Status instance exists so a holder or recipient can
  // leave the battlefield and regain the same modifier when swapped back in.
  const modifiers = state.modifiers.filter((modifier) => (
    livingActiveKeys.has(modifier.holderKey)
    || Boolean(modifier.statusInstanceId)
    || modifier.retainedAfterStatusRemoval === true
  ));

  const apply = (unit: CombatUnit): CombatUnit => {
    const persistentStats = applyStatEffects(unit.baseStats, effectsByTarget.get(unit.key) ?? []);
    const modifierEffects = modifiers
      .filter((modifier) => modifier.holderKey === unit.key)
      .map((modifier) => modifier.effect);
    const stats = applyStatEffects(persistentStats, modifierEffects, persistentStats);
    const hp = Math.min(stats.hp, Math.max(0, unit.hp + Math.max(0, stats.hp - unit.maxHp)));
    const maxShield = Math.max(0, unit.maxShield);
    return { ...unit, persistentStats, stats, maxHp: stats.hp, hp, maxShield, shield: Math.min(maxShield, unit.shield) };
  };
  return { ...state, modifiers, playerUnits: state.playerUnits.map(apply), opponentUnits: state.opponentUnits.map(apply) };
}

/** Reinstall root Relic/Ability runtime Effects after lead activation or a formation change. */
export function refreshSetupRuntimeEffects(state: CombatState, options: SetupRuntimeRefreshOptions = {}): CombatState {
  const setupEffectIds = new Set(
    state.setupSources.flatMap((source) => source.effects
      .filter((effect) => effect.execution !== "child")
      .map((effect) => effect.id)),
  );
  const setupConditionalParentInstances = new Set(
    state.runtimeEffects
      .filter((instance) => setupEffectIds.has(instance.sourceEffectId) && instance.runtimeKind === "conditional_effect")
      .map((instance) => instance.instanceId),
  );
  const withoutSetup = {
    ...state,
    modifiers: state.modifiers.filter((modifier) => !modifier.conditionalParentInstanceId || !setupConditionalParentInstances.has(modifier.conditionalParentInstanceId)),
    runtimeEffects: state.runtimeEffects.filter((instance) => (
      ((instance.sourceOwnerType !== "relic" && instance.sourceOwnerType !== "ability") || !setupEffectIds.has(instance.sourceEffectId))
      && (!instance.conditionalParentInstanceId || !setupConditionalParentInstances.has(instance.conditionalParentInstanceId))
    )),
  };
  return installRootEffects(withoutSetup, { ...options, applyRootShields: options.applyRootShields === true });
}

export function combatEffectSummaries(state: CombatState, unitKey: string): CombatEffectSummary[] {
  const unit = findUnit(state, unitKey);
  if (!unit || !unit.active || unit.hp <= 0) return [];
  const rows: CombatEffectSummary[] = [];
  const seen = new Set<string>();
  const addEffect = (
    effect: ResolvedEffectRef,
    sourceOwnerType: EffectOwnerType,
    sourceOwnerId: string,
    id: string,
    before?: StatBlock,
    after?: StatBlock,
    duration?: number | null,
  ) => {
    const dedupeKey = `${sourceOwnerType}:${sourceOwnerId}:${effect.id}:${unitKey}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const amountLabel = combatEffectAmountLabel(effect, unit, before, after);
    rows.push({
      id,
      kind: "effect",
      name: effect.name,
      description: effect.description,
      amountLabel,
      classification: combatEffectClassification(effect, amountLabel),
      sourceOwnerType,
      sourceOwnerId,
      duration,
    });
  };

  let persistent = { ...unit.baseStats };
  for (const source of statSetupSources(state)) {
    for (const effect of source.effects) {
      if (effect.execution === "child") continue;
      const sourceCritter = source.sourceKey ? findUnit(state, source.sourceKey)?.critter : undefined;
      if (!effectMatchesSourceCritter(effect, sourceCritter)) continue;
      const target = String(effect.parameters.target ?? "");
      // Conditional parents use condition_target/effect_target and install
      // their child effects separately; they are not themselves unit effects.
      if (!target) continue;
      const targets = effectTargets(state, target, {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceSide: source.side,
        sourceCritterKey: source.sourceKey,
        allowInactiveSource: source.ownerType === "relic",
        elementIds: targetElementIds(effect),
        tagIds: targetCritterTagIds(effect),
      });
      if (!targets.some((target) => target.key === unitKey)) continue;
      const next = applyStatEffects(persistent, [effect]);
      addEffect(effect, source.ownerType, source.ownerId, `setup:${source.ownerType}:${source.ownerId}:${effect.id}`, persistent, next);
      persistent = next;
    }
  }

  const modifierGroups = new Map<string, { first: CombatModifier; effects: ResolvedEffectRef[] }>();
  for (const modifier of state.modifiers.filter((candidate) => candidate.holderKey === unitKey)) {
    const stat = String(modifier.effect.parameters.stat ?? "");
    const key = `${modifier.sourceOwnerType}:${modifier.sourceOwnerId}:${modifier.effect.runtimeKind}:${stat}`;
    const group = modifierGroups.get(key);
    if (group) group.effects.push(modifier.effect);
    else modifierGroups.set(key, { first: modifier, effects: [modifier.effect] });
  }
  let modified = { ...unit.persistentStats };
  for (const { first, effects } of modifierGroups.values()) {
    const next = applyStatEffects(modified, effects, unit.persistentStats);
    addEffect(first.effect, first.sourceOwnerType, first.sourceOwnerId, first.instanceId, modified, next);
    modified = next;
  }

  for (const instance of state.statuses.filter((candidate) => candidate.holderKey === unitKey)) {
    const status = state.statusRegistry[instance.statusId];
    if (status) {
      rows.push({
        id: instance.instanceId,
        kind: "status",
        name: status.name,
        description: status.description,
        amountLabel: null,
        classification: statusClassification(instance.effects),
        sourceOwnerType: instance.sourceOwnerType,
        sourceOwnerId: instance.sourceOwnerId,
        duration: instance.duration,
      });
    }
    for (const effect of instance.effects) {
      if (effect.execution === "child") continue;
      const target = String(effect.parameters.target ?? "");
      if (!target) continue;
      const targets = effectTargets(state, target, {
        sourceOwnerType: "status",
        sourceOwnerId: instance.statusId,
        sourceCritterKey: instance.holderKey,
        statusHolderKey: instance.holderKey,
      });
      if (targets.some((target) => target.key === unitKey)) {
        addEffect(effect, "status", instance.statusId, `${instance.instanceId}:${effect.id}`, undefined, undefined, instance.duration);
      }
    }
  }

  for (const instance of state.runtimeEffects) {
    const effect = effectForReference(state, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
    if (!effect) continue;
    const target = String(effect.parameters.target ?? "");
    const applies = instance.targetCritterKey === unitKey || (!instance.targetCritterKey && Boolean(target) && effectTargets(state, target, {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceSide: instance.sourceSide,
      sourceCritterKey: instance.sourceCritterKey,
      skillTargetKeys: instance.targetCritterKey ? [instance.targetCritterKey] : undefined,
      elementIds: effectElementIdsForTargeting(effect),
      tagIds: effectTagIdsForTargeting(effect),
    }).some((target) => target.key === unitKey));
    if (applies) addEffect(effect, instance.sourceOwnerType, instance.sourceOwnerId, instance.instanceId, undefined, undefined, instance.remaining);
  }

  return rows;
}

function combatEffectClassification(
  effect: ResolvedEffectRef,
  amountLabel: string | null,
): "positive" | "negative" | "mixed" {
  if (amountLabel) {
    const signs = new Set(amountLabel.match(/[+−]/g) ?? []);
    const isCost = ["BLOCK COST", "SWAP COST", "SKILL COST", "MANA COST"].some((label) => amountLabel.includes(label));
    if (signs.size === 1) {
      const increasesBenefit = signs.has("+") !== isCost;
      return increasesBenefit ? "positive" : "negative";
    }
    if (signs.size > 1) return "mixed";
  }
  if (effect.runtimeKind === "action_cost_modifier" && ["flat", "percentage"].includes(String(effect.parameters.modifier_type))) {
    const modifierValue = Number(effect.parameters.modifier_value);
    if (Number.isFinite(modifierValue) && modifierValue !== 0) return modifierValue < 0 ? "positive" : "negative";
  }
  return effect.classification ?? "mixed";
}

function combatEffectAmountLabel(effect: ResolvedEffectRef, unit: CombatUnit, before?: StatBlock, after?: StatBlock): string | null {
  if (effect.runtimeKind === "stat_modifier" && effect.parameters.stat === "skill_cost") {
    const amount = Number(effect.parameters.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) return null;
    const value = effect.parameters.value_mode === "percentage" ? `${signedAmount(amount * 100)}%` : signedAmount(amount);
    return `${value} SKILL COST`;
  }
  if (before && after && (effect.runtimeKind === "stat_modifier" || effect.runtimeKind === "stat_modifier_v2" || effect.runtimeKind === "mana_dice_modifier")) {
    const statLabels: Array<[keyof StatBlock, string]> = effect.runtimeKind === "mana_dice_modifier"
      ? [["diceMin", "MIN MANA"], ["diceMax", "MAX MANA"]]
      : [[({ block_cost: "blockCost", swap_cost: "swapCost", relic_slots: "relicSlots", mana_dice_min: "diceMin", mana_dice_max: "diceMax" } as Record<string, keyof StatBlock>)[String(effect.parameters.stat)] ?? String(effect.parameters.stat) as keyof StatBlock, String(effect.parameters.stat).replace(/_/g, " ").toUpperCase()]];
    const labels = statLabels
      .map(([key, label]) => ({ delta: after[key] - before[key], label }))
      .filter((item) => item.delta !== 0)
      .map((item) => `${signedAmount(item.delta)} ${item.label}`);
    return labels.join(" · ") || null;
  }
  const amount = Number(effect.parameters.amount ?? effect.parameters.value ?? effect.parameters.shield_value);
  if (!Number.isFinite(amount)) return null;
  if (effect.runtimeKind === "damage_over_time") {
    const value = effect.parameters.value_mode === "percent_max_hp" ? roundHalfUp(unit.maxHp * amount) : roundHalfUp(amount);
    return `${signedAmount(-Math.abs(value))} HP / TURN`;
  }
  if (effect.runtimeKind === "restore_hp") return `${signedAmount(Math.abs(roundHalfUp(amount)))} HP`;
  if (effect.runtimeKind === "shield_modifier") return `${signedAmount(roundHalfUp(amount))} SHIELD`;
  return null;
}

function signedAmount(value: number): string {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
}

function statusClassification(effects: ResolvedEffectRef[]): "positive" | "negative" | "mixed" {
  const classifications = new Set(effects.map((effect) => effect.classification).filter(Boolean));
  return classifications.size === 1 ? [...classifications][0]! : "mixed";
}

function applyStatEffects(base: StatBlock, effects: ResolvedEffectRef[], percentageBase: StatBlock = base): StatBlock {
  const next = { ...base };
  for (const effect of effects) {
    if (effect.runtimeKind === "stat_modifier" || effect.runtimeKind === "stat_modifier_v2") {
      const stat = ({ block_cost: "blockCost", swap_cost: "swapCost", relic_slots: "relicSlots", mana_dice_min: "diceMin", mana_dice_max: "diceMax" } as Record<string, keyof StatBlock>)[String(effect.parameters.stat)] ?? String(effect.parameters.stat) as keyof StatBlock;
      if (!(stat in next)) continue;
      const amount = Number(effect.parameters.amount ?? 0);
      const roundedPercentage = roundHalfUp(percentageBase[stat] * amount);
      const delta = effect.parameters.value_mode === "percentage"
        ? roundedPercentage === 0 && amount !== 0 ? Math.sign(amount) : roundedPercentage
        : amount;
      if (stat === "relicSlots") next[stat] = Math.max(0, Math.min(10, next[stat] + delta));
      else if (stat === "blockCost" || stat === "swapCost") next[stat] = Math.max(0, next[stat] + delta);
      else if (stat in next) next[stat] = Math.max(1, next[stat] + delta);
    } else if (effect.runtimeKind === "mana_dice_modifier") {
      next.diceMin += Number(effect.parameters.minimum_delta ?? 0);
      next.diceMax += Number(effect.parameters.maximum_delta ?? 0);
    }
  }
  ({ diceMin: next.diceMin, diceMax: next.diceMax } = normalizeManaDiceBounds(next.diceMin, next.diceMax));
  next.blockCost = Math.max(0, next.blockCost);
  next.swapCost = Math.max(0, next.swapCost);
  return next;
}

export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
}

/** Keep Mana dice ranges valid without allowing a boosted minimum above the maximum. */
export function normalizeManaDiceBounds(
  minimum: number,
  maximum: number,
  round: (value: number) => number = roundHalfUp,
): { diceMin: number; diceMax: number } {
  const diceMax = Math.max(1, round(maximum));
  const diceMin = Math.min(diceMax, Math.max(1, round(minimum)));
  return { diceMin, diceMax };
}

export function startTurn(state: CombatState): CombatState {
  // Dice resolve first. Start-of-turn effects are then staged as presentation
  // events so both combat UIs can play their text and reactions before action
  // selection begins.
  const turnState = { ...state, turnEvents: [], presentationEvents: [] };
  let rngState = turnState.rngState;
  const playerUnits = turnState.playerUnits.map((unit) =>
    unit.active && unit.hp > 0
      ? (() => { const roll = rollManaDieSeeded(unit.stats.diceMin, unit.stats.diceMax, rngState); rngState = roll.state; return { ...unit, blocking: false, manaRoll: roll.value }; })()
      : { ...unit, blocking: false, blockStreak: 0 },
  );
  const opponentUnits = turnState.opponentUnits.map((unit) =>
    unit.active && unit.hp > 0
      ? (() => { const roll = rollManaDieSeeded(unit.stats.diceMin, unit.stats.diceMax, rngState); rngState = roll.state; return { ...unit, blocking: false, manaRoll: roll.value }; })()
      : { ...unit, blocking: false, blockStreak: 0 },
  );
  const playerRoll = playerUnits.reduce((sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0), 0);
  const opponentRoll = opponentUnits.reduce(
    (sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0),
    0,
  );

  const rolledState: CombatState = {
    ...turnState,
    playerUnits,
    opponentUnits,
    playerMana: turnState.playerMana + playerRoll,
    opponentMana: turnState.opponentMana + opponentRoll,
    rngState,
    phase: "selecting",
    log: [
      `Turn ${turnState.turn}: player rolled ${playerRoll} mana, opponents rolled ${opponentRoll} mana.`,
      ...turnState.log,
    ],
  };
  let withDice = resolveTimedEffects(rolledState, "start_of_turn");
  for (const unit of playerUnits.filter((candidate) => candidate.active && candidate.hp > 0)) {
    withDice = appendProgressEvent(withDice, {
      event_type: "dice_resolved",
      source_critter_id: unit.critter.id,
      target_critter_id: null,
      skill_id: null,
      amount: unit.manaRoll,
      payload: { die_type: `d${unit.stats.diceMax}`, natural_value: unit.manaRoll, modified_value: unit.manaRoll, natural_maximum: unit.stats.diceMax, turn_mana_total: playerRoll },
    });
  }

  return withDice;
}

export function resolveTurn(state: CombatState, actions: CombatAction[]): CombatState {
  const enemyDecision = state.enemyPolicyKey === "random_action_v1" ? chooseEnemyActions(state) : chooseLegacyEnemyActions(state);
  const enemyActions = enemyDecision.actions;
  return resolveCombatActions(state, actions, enemyActions, enemyDecision.rngState);
}

function normalizeCombatActions(state: CombatState, actions: CombatAction[]): CombatAction[] {
  return actions.map((action): CombatAction => {
    if (isActorRecharging(state, action.actorKey)) return { actorKey: action.actorKey, type: "skip", cost: 0 };
    if (action.type === "skill" && action.skillId && !skillAvailability(state, action.actorKey, action.skillId).valid) {
      return { actorKey: action.actorKey, type: "skip", cost: 0 };
    }
    return { ...action, cost: calculateActionCost(state, action) };
  });
}

/**
 * Canonical turn resolver for clients that supply both sides' decisions.
 * The game UI, visual simulator, batch simulator, Effects Lab, and AI trainer
 * all route through this function so action staging and effect timing cannot drift.
 */
export function resolveCombatActions(
  state: CombatState,
  playerActions: CombatAction[],
  opponentActions: CombatAction[],
  rngState: number = state.rngState,
): CombatState {
  const turnStart = state;
  const normalizedPlayer = normalizeCombatActions(state, playerActions);
  const normalizedOpponent = normalizeCombatActions(state, opponentActions);
  const playerCost = normalizedPlayer.reduce((sum, action) => sum + action.cost, 0);
  const opponentCost = normalizedOpponent.reduce((sum, action) => sum + action.cost, 0);
  if (playerCost > state.playerMana || opponentCost > state.opponentMana) return state;

  let next: CombatState = {
    ...state,
    playerMana: state.playerMana - playerCost,
    opponentMana: state.opponentMana - opponentCost,
    rngState,
    log: [`Submitted actions for ${playerCost} mana.`, ...state.log],
    presentationEvents: [],
    effectActivations: [],
    effectActivationKeys: [],
  };

  for (const action of normalizedPlayer) {
    if (action.cost <= 0 || action.type === "skip") continue;
    const actor = findUnit(next, action.actorKey);
    if (!actor || actor.side !== "player") continue;
    next = appendProgressEvent(next, {
      event_type: "resource_spent",
      source_critter_id: actor.critter.id,
      target_critter_id: null,
      skill_id: action.skillId ?? null,
      amount: action.cost,
      payload: {
        spending_context: "combat",
        resource_type: "mana",
        dungeon_id: state.dungeon.id,
        critter_id: actor.critter.id,
        ability_id: null,
        action_type: action.type,
      },
    });
  }

  const allActions = [...normalizedPlayer, ...normalizedOpponent].map((action) => prepareActionTarget(next, action));
  next = resolveActionStage(next, allActions, "swap");
  next = resolveActionStage(next, allActions, "block");
  next = resolveActionStage(next, allActions, "skip");
  next = resolveActionStage(next, allActions, "skill");
  next = resolvePostTurn(next);

  const orderedOutcome = combatOutcomeFromOrderedEvents(turnStart, next);
  const playerAlive = next.playerUnits.some((unit) => unit.hp > 0);
  const opponentsAlive = next.opponentUnits.some((unit) => unit.hp > 0);
  if (!playerAlive || !opponentsAlive) {
    const outcome = orderedOutcome ?? (playerAlive ? "won" : "lost");
    const playerWon = outcome === "won";
    const completed = playerWon ? appendProgressEvent(next, {
      event_type: "battle_completed",
      source_critter_id: null,
      target_critter_id: null,
      skill_id: null,
      amount: playerWon ? 1 : 0,
      payload: {
        won: playerWon,
        enemy_rollcaster_type: next.enemyRollcasterType ?? null,
        squad: next.playerUnits.map((unit) => ({ critter_id: unit.critter.id, element_ids: critterElementIds(unit.critter), survived: unit.hp > 0 })),
        survivors_complete: next.playerUnits.filter((unit) => unit.active).every((unit) => unit.hp > 0),
      },
    }) : next;
    return { ...completed, phase: outcome, log: [playerWon ? "Dungeon cleared." : "Defeat.", ...completed.log] };
  }

  return { ...next, turn: next.turn + 1, phase: "ready" };
}

/**
 * Resolve terminal precedence from the ordered combat event stream. Primary
 * Skill damage is emitted before recoil, retaliation, and timed status damage,
 * so the first event that eliminates a side decides the battle even if a later
 * secondary event also knocks out the surviving side.
 */
export function combatOutcomeFromOrderedEvents(before: CombatState, after: CombatState): "won" | "lost" | null {
  const hp = new Map([...before.playerUnits, ...before.opponentUnits].map((unit) => [unit.key, unit.hp]));
  const side = new Map([...before.playerUnits, ...before.opponentUnits].map((unit) => [unit.key, unit.side]));
  const alive = (targetSide: "player" | "opponent") => [...side].some(([key, value]) => value === targetSide && (hp.get(key) ?? 0) > 0);
  for (const event of after.presentationEvents) {
    for (const change of event.hpChanges) hp.set(change.unitKey, change.after);
    const playerAlive = alive("player");
    const opponentAlive = alive("opponent");
    if (playerAlive && opponentAlive) continue;
    if (playerAlive) return "won";
    if (opponentAlive) return "lost";
    const actorSide = event.actorKey ? side.get(event.actorKey) : undefined;
    if (actorSide) return actorSide === "player" ? "won" : "lost";
  }
  return null;
}

/** Apply a starting Status through the same runtime path used by combat. */
export function simApplyStatus(state: CombatState, statusId: string, holderKey: string, duration: number | null = null): CombatState {
  return applyStatus(state, statusId, holderKey, {
    sourceOwnerType: "status",
    sourceOwnerId: statusId,
    sourceCritterKey: holderKey,
    statusHolderKey: holderKey,
    resolutionDepth: 1,
  }, duration);
}

export function actionCostModifierApplies(parameters: Record<string, unknown>, action: ActionCostAction): boolean {
  // cost_type was a redundant legacy field. Honor it only for old snapshots;
  // newly-authored modifiers are fully described by applicable_action.
  if (parameters.cost_type !== undefined) {
    const costType = String(parameters.cost_type);
    if (costType === "skill_mana" && action.type !== "skill") return false;
    if (costType === "block" && action.type !== "block") return false;
    if (costType === "swap" && action.type !== "swap") return false;
  }

  const applicable = String(parameters.applicable_action ?? "all_actions");
  if (applicable === "skills_all") {
    return action.type === "skill" && skillMatchesElementFilter(parameters, action);
  }
  if (applicable === "skills_support") {
    return action.type === "skill" && action.skillType === "support" && skillMatchesElementFilter(parameters, action);
  }
  if (applicable === "skills_attack") {
    return action.type === "skill" && action.skillType === "attack" && skillMatchesElementFilter(parameters, action);
  }
  // Keep already-published content readable while new authoring uses the
  // narrower Skills (All/Support/Attack) vocabulary.
  if (applicable === "matching_skills") return action.type === "skill" && skillMatchesElementFilter(parameters, action);
  if (applicable === "attacks") return action.type === "skill" && action.skillType === "attack" && skillMatchesElementFilter(parameters, action);
  if (applicable === "blocks") return action.type === "block";
  if (applicable === "swaps") return action.type === "swap";
  return applicable === "all_actions";
}

function skillMatchesElementFilter(parameters: Record<string, unknown>, action: ActionCostAction): boolean {
  const elementIds = skillElementIds(parameters);
  const tagIds = Array.isArray(parameters.skill_tag_ids) ? parameters.skill_tag_ids.filter((id): id is string => typeof id === "string") : [];
  const matchesElement = elementIds.length === 0 || (action.skillElementId !== undefined && elementIds.includes(action.skillElementId));
  const matchesTag = tagIds.length === 0 || tagIds.some((id) => (action.skillTagIds ?? []).includes(id));
  return matchesElement && matchesTag;
}

function statusStatModifierAsActionCost(effect: ResolvedEffectRef): ActionCostModifier | undefined {
  if (effect.runtimeKind !== "stat_modifier" || effect.parameters.stat !== "skill_cost") return undefined;
  const scope = String(effect.parameters.skill_scope ?? "all");
  return {
    parameters: {
      applicable_action: scope === "attack" ? "skills_attack" : scope === "support" ? "skills_support" : "skills_all",
      modifier_type: effect.parameters.value_mode,
      modifier_value: effect.parameters.amount,
      skill_element_ids: effect.parameters.skill_element_ids,
      skill_tag_ids: effect.parameters.skill_tag_ids,
    },
    sourceName: effect.name,
  };
}

export function applyActionCostModifiers(base: number, modifiers: ActionCostModifier[]): ActionCostBreakdown {
  let cost = Math.max(0, base);
  const sources: ActionCostSource[] = [];
  for (const modifier of modifiers) {
    const before = cost;
    const value = Number(modifier.parameters.modifier_value ?? 0);
    if (modifier.parameters.modifier_type === "percentage") cost += roundHalfUp(cost * value);
    else if (modifier.parameters.modifier_type === "set") cost = value;
    else if (modifier.parameters.modifier_type === "minimum") cost = Math.max(cost, value);
    else if (modifier.parameters.modifier_type === "maximum") cost = Math.min(cost, value);
    else cost += value;
    const minimum = modifier.parameters.minimum_cost;
    const maximum = modifier.parameters.maximum_cost;
    // Bounds cap the modifier's movement; they must not turn a discount into
    // an increase (or a surcharge into a discount) when the base is already
    // outside the authored boundary.
    if (cost < before && typeof minimum === "number" && Number.isFinite(minimum)) cost = Math.min(before, Math.max(cost, minimum));
    if (cost > before && typeof maximum === "number" && Number.isFinite(maximum)) cost = Math.max(before, Math.min(cost, maximum));
    const amount = cost - before;
    if (amount !== 0) sources.push({ amount, sourceName: modifier.sourceName });
  }
  return { base, final: Math.max(0, roundHalfUp(cost)), sources };
}

function runtimeActionCostAppliesToActor(state: CombatState, instance: RuntimeEffectInstance, actorKey: string): boolean {
  if (instance.targetCritterKey) return instance.targetCritterKey === actorKey;
  const parameters = instance.state.parameters as Record<string, unknown> | undefined;
  const target = String(parameters?.target ?? "");
  if (!target) return true;
  const effect = effectForReference(state, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
  try {
    return effectTargets(state, target, {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceSide: instance.sourceSide,
      sourceCritterKey: instance.sourceCritterKey,
      statusHolderKey: instance.sourceOwnerType === "status" ? instance.sourceCritterKey : undefined,
      elementIds: effect ? targetElementIds(effect) : undefined,
      tagIds: effect ? targetCritterTagIds(effect) : undefined,
    }).some((unit) => unit.key === actorKey);
  } catch {
    // Keep older snapshots with incomplete targeting context usable. The
    // server remains authoritative for the final cost.
    return true;
  }
}

export function calculateActionCostBreakdown(state: CombatState, action: CombatAction): ActionCostBreakdown {
  // Skip is the combat escape hatch: it must remain legal even when global
  // action-cost surcharges exceed the side's available Mana.
  if (action.type === "skip") return { base: 0, final: 0, sources: [] };
  const actor = findUnit(state, action.actorKey);
  if (!actor) return { base: Math.max(0, action.cost), final: Math.max(0, action.cost), sources: [] };
  const base = action.type === "skill" && action.skillId
    ? actor.skills.find((skill) => skill.id === action.skillId)?.mana_cost ?? action.cost
    : action.type === "block" ? actor.stats.blockCost
      : action.type === "swap" ? actor.stats.swapCost
        : 0;
  const skill = action.type === "skill" && action.skillId
    ? actor.skills.find((candidate) => candidate.id === action.skillId)
    : undefined;
  const modifiers = state.runtimeEffects
    .filter((instance) => instance.runtimeKind === "action_cost_modifier")
    .filter((instance) => runtimeActionCostAppliesToActor(state, instance, actor.key))
    .map((instance) => {
      const parameters = instance.state.parameters as Record<string, unknown> | undefined;
      if (!parameters || !actionCostModifierApplies(parameters, { type: action.type, skillId: action.skillId, skillType: skill?.skill_type, skillElementId: skill?.element_id, skillTagIds: skill?.tag_ids })) return null;
      const effect = effectForReference(state, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
      return {
        parameters,
        sourceName: effectSourceName(state, instance.sourceOwnerType, instance.sourceOwnerId, effect?.name ?? instance.sourceOwnerId),
      } satisfies ActionCostModifier;
    })
    .filter((modifier): modifier is ActionCostModifier => Boolean(modifier));
  const statusModifiers = state.modifiers
    .filter((modifier) => modifier.holderKey === actor.key)
    .flatMap((modifier) => {
      const cost = statusStatModifierAsActionCost(modifier.effect);
      return cost ? [{ ...cost, sourceName: effectSourceName(state, modifier.sourceOwnerType, modifier.sourceOwnerId, modifier.effect.name) }] : [];
    });
  return applyActionCostModifiers(base, [...modifiers, ...statusModifiers]);
}

export function calculateActionCost(state: CombatState, action: CombatAction): number {
  return calculateActionCostBreakdown(state, action).final;
}

export function chooseRandomEnemyActions(state: CombatState): CombatAction[] {
  return chooseEnemyActions(state).actions;
}

function chooseLegacyEnemyActions(state: CombatState): { actions: CombatAction[]; rngState: number } {
  let mana = state.opponentMana;
  const actions = orderedActiveCombatUnits(state.opponentUnits)
    .filter((unit) => unit.active && unit.hp > 0)
    .map((unit) => {
      const skill = unit.skills.find((candidate) => {
        const action = { actorKey: unit.key, type: "skill" as const, skillId: candidate.id, cost: candidate.mana_cost };
        return skillAvailability(state, unit.key, candidate.id).valid && skillTargets(state, unit.key, candidate).length > 0 && calculateActionCost(state, action) <= mana;
      });
      if (!skill) {
        const block = { actorKey: unit.key, type: "block" as const, cost: unit.stats.blockCost };
        const blockCost = calculateActionCost(state, block);
        return blockCost <= mana ? { ...block, cost: blockCost } : { actorKey: unit.key, type: "skip" as const, cost: 0 };
      }
      const targets = skillTargets(state, unit.key, skill);
      const base = { actorKey: unit.key, type: "skill" as const, skillId: skill.id, cost: skill.mana_cost };
      const cost = calculateActionCost(state, base);
      mana -= cost;
      return isSingleTarget(skill) ? { ...base, targetKey: targets[0]?.key, cost } : { ...base, cost };
    });
  return { actions, rngState: state.rngState };
}

function chooseEnemyActions(state: CombatState): { actions: CombatAction[]; rngState: number } {
  let mana = state.opponentMana;
  let rngState = state.rngState;

  const actions = orderedActiveCombatUnits(state.opponentUnits)
    .filter((unit) => unit.active && unit.hp > 0)
    .map((unit) => {
      if (isActorRecharging(state, unit.key)) return { actorKey: unit.key, type: "skip" as const, cost: 0 };
      const candidates: CombatAction[] = [];
      for (const skill of unit.skills.filter((candidate) => skillAvailability(state, unit.key, candidate.id).valid)) {
        const targets = skillTargets(state, unit.key, skill);
        if (!targets.length) continue;
        const base = { actorKey: unit.key, type: "skill" as const, skillId: skill.id, cost: skill.mana_cost };
        const cost = calculateActionCost(state, base);
        if (cost > mana) continue;
        if (isSingleTarget(skill)) {
          const targetRoll = nextRandom(rngState);
          rngState = targetRoll.state;
          const target = targets[Math.floor(targetRoll.value * targets.length)];
          candidates.push({ ...base, targetKey: target?.key, cost });
        } else candidates.push({ ...base, cost });
      }
      // Random Action is intentionally an offensive baseline. It never
      // blocks or swaps; when no affordable Skill exists it waits.
      if (!candidates.length) return { actorKey: unit.key, type: "skip" as const, cost: 0 };
      const actionRoll = nextRandom(rngState);
      rngState = actionRoll.state;
      const selected = candidates[Math.floor(actionRoll.value * candidates.length)] ?? candidates[0];
      mana -= selected.cost;
      return selected;
    });
  return { actions, rngState };
}

function resolveActionStage(state: CombatState, actions: CombatAction[], stage: CombatAction["type"]): CombatState {
  let rngState = state.rngState;
  const ordered = actions
    .filter((action) => action.type === stage)
    .map((action) => {
      const tieRoll = nextRandom(rngState);
      rngState = tieRoll.state;
      return { action, tieBreaker: tieRoll.value };
    })
    .sort((left, right) =>
      speedFor(state, right.action.actorKey) - speedFor(state, left.action.actorKey)
      || right.tieBreaker - left.tieBreaker,
    )
    .map(({ action }) => action);

  const positionByActorKey = new Map(ordered.map((action, position) => [action.actorKey, position]));
  return ordered.reduce((current, action, position) => {
    const actor = findUnit(current, action.actorKey);
    const effectSequenceBeforeAction = current.effectSequence;
    const actionTargetKeys = action.type === "skill" ? actionSkillTargetKeys(current, action) : [];
    const targetPositions = stage === "skill" ? actionSkillTargetKeys(state, action)
      .map((targetKey) => positionByActorKey.get(targetKey))
      .filter((targetPosition): targetPosition is number => targetPosition !== undefined) : [];
    const targetPosition = targetPositions[0];
    const resolved = recomputeCombatStats(resolveAction(current, action, stage === "skill"
      ? {
          actionOrder: {
            position,
            total: ordered.length,
            first: position === 0,
            last: position === ordered.length - 1,
            beforeSkillTarget: targetPosition !== undefined && position < targetPosition,
            afterSkillTarget: targetPosition !== undefined && position > targetPosition,
          },
        }
      : undefined));
    if (!actor || !actor.active || actor.hp <= 0) return resolved;
    let next = decrementTargetTurnRuntimeEffects(resolved, action.actorKey);
    const delayedEvents: DelayedAdvanceEvent[] = [{ delayType: "actions", ignoreAppliedAfter: effectSequenceBeforeAction }];
    if (action.type === "skill") {
      delayedEvents.push({ delayType: "skills_used", actorKey: action.actorKey, ignoreAppliedAfter: effectSequenceBeforeAction });
      const skill = actor.skills.find((candidate) => candidate.id === action.skillId);
      if (skill?.skill_type === "attack") delayedEvents.push({ delayType: "attacks_received", targetKeys: actionTargetKeys, ignoreAppliedAfter: effectSequenceBeforeAction });
    } else if (action.type === "block" && findUnit(next, action.actorKey)?.blocking) {
      delayedEvents.push({ delayType: "blocks_performed", actorKey: action.actorKey, ignoreAppliedAfter: effectSequenceBeforeAction });
    } else if (action.type === "swap" && findUnit(next, action.actorKey)?.active === false) {
      delayedEvents.push({ delayType: "swaps_performed", actorKey: action.actorKey, ignoreAppliedAfter: effectSequenceBeforeAction });
    }
    return delayedEvents.reduce((currentState, event) => advanceDelayedEffects(currentState, event), next);
  }, { ...state, rngState });
}

function actionSkillTargetKeys(state: CombatState, action: CombatAction): string[] {
  if (action.type !== "skill" || !action.skillId) return [];
  const actor = findUnit(state, action.actorKey);
  const skill = actor?.skills.find((candidate) => candidate.id === action.skillId);
  if (!actor || !skill) return [];
  const selectedSlot = action.targetSlotSide !== undefined && action.targetSlotIndex !== undefined
    ? { side: action.targetSlotSide, index: action.targetSlotIndex }
    : undefined;
  return skillTargets(state, action.actorKey, skill, action.targetKey, selectedSlot).map((target) => target.key);
}

function decrementTargetTurnRuntimeEffects(state: CombatState, actorKey: string): CombatState {
  let changed = false;
  const runtimeEffects = state.runtimeEffects
    .map((instance) => {
      if (instance.targetCritterKey !== actorKey || instance.remaining === undefined) return instance;
      const parameters = instance.state.parameters as Record<string, unknown> | undefined;
      if (String(parameters?.duration_clock ?? "global_round") !== "target_turn") return instance;
      changed = true;
      return { ...instance, remaining: instance.remaining - 1 };
    })
    .filter((instance) => instance.remaining === undefined || instance.remaining > 0);
  return changed ? { ...state, runtimeEffects } : state;
}

function prepareActionTarget(state: CombatState, action: CombatAction): CombatAction {
  if (!action.targetKey || action.targetSlotIndex !== undefined) return action;
  const target = findUnit(state, action.targetKey);
  if (!target || target.battlefieldSlot === null) return action;
  return { ...action, targetSlotSide: target.side, targetSlotIndex: target.battlefieldSlot };
}

function hasRuntimeStatus(state: CombatState, unitKey: string, ids: string[]): boolean {
  const wanted = new Set(ids.filter(Boolean));
  return wanted.size > 0 && state.statuses.some((status) => status.holderKey === unitKey && wanted.has(status.statusId));
}

function conditionIds(parameters: Record<string, unknown>): string[] {
  const primary = String(parameters.condition_value ?? "").trim();
  const additional = String(parameters.condition_ids ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return [...new Set([primary, ...additional].filter(Boolean))];
}

function conditionStatusIds(parameters: Record<string, unknown>): string[] {
  const configured = Array.isArray(parameters.condition_status_ids)
    ? parameters.condition_status_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  return configured.length ? [...new Set(configured)] : conditionIds(parameters);
}

function conditionStatKeys(parameters: Record<string, unknown>): string[] {
  const configured = Array.isArray(parameters.condition_stats)
    ? parameters.condition_stats.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  return configured.length ? [...new Set(configured)] : [];
}

function statModifierCategory(stat: string): string | undefined {
  if (["atk", "def", "spd"].includes(stat)) return stat;
  if (["mana_dice_min", "mana_dice_max"].includes(stat)) return "mana_dice";
  if (["block_cost", "swap_cost", "skill_cost"].includes(stat)) return stat;
  return undefined;
}

function modifierPolarity(stat: string, amount: number): "positive" | "negative" | undefined {
  if (!Number.isFinite(amount) || amount === 0) return undefined;
  // Raising a combat stat is positive; raising a resource cost is negative.
  const cost = ["block_cost", "swap_cost", "skill_cost"].includes(stat);
  const improves = cost ? amount < 0 : amount > 0;
  return improves ? "positive" : "negative";
}

function effectHasStatPolarity(effect: ResolvedEffectRef, selected: Set<string>, desired: string): boolean {
  const matches = (category: string | undefined, amount: number) => Boolean(
    category && (selected.has("any") || selected.has(category)) && modifierPolarity(category, amount) === desired,
  );
  if (effect.runtimeKind === "stat_modifier" || effect.runtimeKind === "stat_modifier_v2") {
    return matches(statModifierCategory(String(effect.parameters.stat ?? "")), Number(effect.parameters.amount ?? 0));
  }
  if (effect.runtimeKind === "mana_dice_modifier") {
    return matches("mana_dice", Number(effect.parameters.minimum_delta ?? 0))
      || matches("mana_dice", Number(effect.parameters.maximum_delta ?? 0));
  }
  return false;
}

function actionCostEffectHasPolarity(
  parameters: Record<string, unknown>,
  unit: CombatUnit,
  selected: Set<string>,
  desired: string,
): boolean {
  if (!(selected.has("any") || selected.has("skill_cost"))) return false;
  const applicable = String(parameters.applicable_action ?? "all_actions");
  if (!["all_actions", "skills_all", "skills_support", "skills_attack", "matching_skills", "attacks"].includes(applicable)) return false;
  const skills = unit.skills.filter((skill) => actionCostModifierApplies(parameters, {
    type: "skill",
    skillId: skill.id,
    skillType: skill.skill_type,
    skillElementId: skill.element_id,
    skillTagIds: skill.tag_ids,
  }));
  return skills.some((skill) => {
    const before = skill.mana_cost;
    const after = applyActionCostModifiers(before, [{ parameters, sourceName: "" }]).final;
    return modifierPolarity("skill_cost", after - before) === desired;
  });
}

function hasStatModifier(state: CombatState, unit: CombatUnit, parameters: Record<string, unknown>, desired: string): boolean {
  const selected = new Set(conditionStatKeys(parameters));
  if (!selected.size) return false;
  const directModifiers = state.modifiers
    .filter((modifier) => modifier.holderKey === unit.key)
    .map((modifier) => modifier.effect);
  if (directModifiers.some((effect) => effectHasStatPolarity(effect, selected, desired))) return true;

  for (const source of statSetupSources(state)) {
    for (const effect of source.effects) {
      if (effect.execution === "child" || !["stat_modifier", "mana_dice_modifier"].includes(effect.runtimeKind)) continue;
      if (!effectMatchesSourceCritter(effect, source.sourceKey ? findUnit(state, source.sourceKey)?.critter : undefined)) continue;
      let targets: CombatUnit[] = [];
      try {
        targets = effectTargets(state, String(effect.parameters.target ?? ""), {
          sourceOwnerType: source.ownerType,
          sourceOwnerId: source.ownerId,
          sourceSide: source.side,
          sourceCritterKey: source.sourceKey,
          allowInactiveSource: source.ownerType === "relic",
          elementIds: targetElementIds(effect),
          tagIds: targetCritterTagIds(effect),
        });
      } catch {
        targets = [];
      }
      if (targets.some((target) => target.key === unit.key) && effectHasStatPolarity(effect, selected, desired)) return true;
    }
  }

  for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "action_cost_modifier")) {
    if (!runtimeActionCostAppliesToActor(state, instance, unit.key)) continue;
    const effectParameters = instance.state.parameters as Record<string, unknown> | undefined;
    if (effectParameters && actionCostEffectHasPolarity(effectParameters, unit, selected, desired)) return true;
  }
  return false;
}

function damageModifierMatches(
  state: CombatState,
  instance: RuntimeEffectInstance,
  parameters: Record<string, unknown>,
  attacker: CombatUnit,
  defender: CombatUnit,
  context: RuntimeContext,
): boolean {
  const sourceKind = context.damageSource ?? "skill";
  const applicableSource = String(parameters.applicable_source ?? "any_damage");
  if (applicableSource !== "any_damage" && applicableSource !== sourceKind && !(sourceKind === "skill" && applicableSource === "attack")) return false;
  if (parameters.usage_limit !== undefined && parameters.usage_limit !== null && instance.activationCount >= Number(parameters.usage_limit)) return false;
  const direction = String(parameters.direction ?? "dealt");
  const subject = direction === "received" ? defender : attacker;
  const source = instance.sourceCritterKey ? findUnit(state, instance.sourceCritterKey) : undefined;
  const requiredSourceTags = sourceCritterTagIds({ parameters } as ResolvedEffectRef);
  const requiredTargetTags = targetCritterTagIds({ parameters } as ResolvedEffectRef);
  if (requiredSourceTags.length && !requiredSourceTags.some((tagId) => critterTagIds(attacker.critter).includes(tagId))) return false;
  if (requiredTargetTags.length && !requiredTargetTags.some((tagId) => critterTagIds(defender.critter).includes(tagId))) return false;
  const requiredSkillTags = sourceSkillTagIds({ parameters } as ResolvedEffectRef);
  if (requiredSkillTags.length) {
    const sourceSkill = context.sourceOwnerType === "skill" ? state.catalog.skills.find((skill) => skill.id === context.sourceOwnerId) : undefined;
    if (!effectMatchesSourceSkill({ parameters } as ResolvedEffectRef, sourceSkill)) return false;
  }
  const targetState = String(parameters.applicable_target ?? "any");
  if (targetState === "self" && subject.key !== source?.key) return false;
  if (targetState === "allies" && subject.side !== source?.side) return false;
  if (targetState === "enemies" && subject.side === source?.side) return false;
  if (targetState === "shielded" && defender.shield <= 0) return false;
  if (targetState === "unshielded" && defender.shield > 0) return false;
  if (targetState === "with_status" && !hasRuntimeStatus(state, subject.key, [...conditionIds(parameters), String(parameters.required_status_id ?? "")])) return false;
  const condition = String(parameters.condition ?? "none");
  if (condition === "target_below_half_hp" && defender.hp >= defender.maxHp / 2) return false;
  if (condition === "target_above_half_hp" && defender.hp <= defender.maxHp / 2) return false;
  if (condition === "source_below_half_hp" && attacker.hp >= attacker.maxHp / 2) return false;
  return true;
}

function expireCurrentActionEffects(state: CombatState, actorKey: string): CombatState {
  return {
    ...state,
    runtimeEffects: state.runtimeEffects.filter((instance) => {
      if (instance.sourceCritterKey !== actorKey) return true;
      const effect = effectForReference(state, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
      return String(effect?.parameters.duration_type ?? "") !== "current_action";
    }),
  };
}

function resolveIncomingDamage(
  state: CombatState,
  attacker: CombatUnit,
  defender: CombatUnit,
  attempted: number,
  context: RuntimeContext,
): { state: CombatState; hpDamage: number; shieldDamage: number; finalDamage: number; blockPrevented: number } {
  let finalDamage = Math.max(0, attempted);
  const blockPrevented = defender.blocking && finalDamage > 0 ? Math.max(0, finalDamage - Math.max(1, Math.floor(finalDamage * 0.1))) : 0;
  if (defender.blocking && finalDamage > 0) finalDamage = Math.max(1, Math.floor(finalDamage * 0.1));
  for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "damage_modifier")) {
    const p = instance.state.parameters as Record<string, unknown>;
    if (p.direction === "dealt" && instance.sourceCritterKey !== attacker.key) continue;
    if (p.direction === "received" && instance.targetCritterKey !== defender.key) continue;
    if (!damageModifierMatches(state, instance, p, attacker, defender, context)) continue;
    const value = Number(p.modifier_value ?? 0);
    finalDamage = p.modifier_type === "percentage" ? finalDamage + roundHalfUp(finalDamage * value) : finalDamage + value;
    if (p.minimum_final_damage !== undefined && p.minimum_final_damage !== null) finalDamage = Math.max(finalDamage, Number(p.minimum_final_damage));
    if (p.maximum_final_damage !== undefined && p.maximum_final_damage !== null) finalDamage = Math.min(finalDamage, Number(p.maximum_final_damage));
    if (p.usage_limit !== undefined && p.usage_limit !== null) {
      state = {
        ...state,
        runtimeEffects: state.runtimeEffects.map((candidate) => candidate.instanceId === instance.instanceId
          ? { ...candidate, activationCount: candidate.activationCount + 1 }
          : candidate),
      };
    }
  }
  for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "damage_prevention")) {
    const p = instance.state.parameters as Record<string, unknown>;
    if (instance.targetCritterKey && instance.targetCritterKey !== defender.key) continue;
    const requirement = String(p.trigger_requirement ?? "none");
    if (requirement === "below_half_hp" && defender.hp >= defender.maxHp / 2) continue;
    if (requirement === "shield_absent" && defender.shield > 0) continue;
    const prevented = p.prevention_type === "complete" ? finalDamage : p.prevention_type === "percentage" ? roundHalfUp(finalDamage * Number(p.prevented_amount ?? 0)) : Number(p.prevented_amount ?? 0);
    finalDamage = Math.max(0, finalDamage - Math.min(finalDamage, prevented));
  }
  finalDamage = Math.max(0, roundHalfUp(finalDamage));
  const shieldDamage = defender.shield > 0 && finalDamage > 0 ? Math.min(defender.shield, finalDamage) : 0;
  // A Shield absorbs a complete incoming hit. Any remaining amount does not
  // spill into HP until a later hit, matching the authored runtime contract.
  const hpDamage = shieldDamage > 0 ? 0 : Math.min(defender.hp, finalDamage);
  let next = shieldDamage > 0
    ? applyShieldValue(state, defender.key, "subtract", shieldDamage)
    : updateUnit(state, defender.key, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - hpDamage) }), `${combatantName(defender)} took ${hpDamage} damage.`);
  next = recomputeCombatStats(next);
  return { state: next, hpDamage, shieldDamage, finalDamage, blockPrevented };
}

type ActionResolutionContext = Pick<RuntimeContext, "actionOrder">;

function resolveAction(state: CombatState, action: CombatAction, actionContext: ActionResolutionContext = {}): CombatState {
  const actor = findUnit(state, action.actorKey);
  if (!actor) return state;
  if (actor.hp <= 0) {
    const refund = Math.max(0, action.cost);
    if (refund === 0) return state;
    const refundedState = refund === 0
      ? state
      : actor.side === "player"
        ? { ...state, playerMana: state.playerMana + refund }
        : { ...state, opponentMana: state.opponentMana + refund };
    return appendPresentationEvent(
      refundedState,
      {
        kind: "mana_refund",
        message: "",
        actorKey: actor.key,
        targetKeys: [],
        manaRefund: { side: actor.side, amount: refund },
        hpChanges: [],
      },
    );
  }
  if (!actor.active) return state;

  // A streak measures consecutive Block actions by this Critter. Any other
  // action gives the next Block its full 1/1 chance again.
  if (action.type !== "block") state = clearBlockStreak(state, actor.key);

  if (action.type !== "skip") {
    const skip = resolveSkipCheck(state, actor.key, action.type);
    state = skip.state;
    if (skip.skipped) {
      if (action.type === "block") state = clearBlockStreak(state, actor.key);
      const message = `${combatantPossessive(actor)} ${action.type} was skipped by ${skip.effectName}; the reserved mana was spent.`;
      return appendPresentationEvent(
        { ...state, log: [message, ...state.log] },
        { kind: "status", message, actorKey: actor.key, targetKeys: [actor.key], hpChanges: [] },
      );
    }
  }

  if (action.type === "skip") {
    const message = isActorRecharging(state, actor.key)
      ? `${combatantName(actor)} must recharge and cannot act.`
      : `${combatantName(actor)} waits.`;
    return appendPresentationEvent(
      { ...state, log: [message, ...state.log] },
      { kind: "wait", message, actorKey: actor.key, targetKeys: [], hpChanges: [] },
    );
  }

  if (action.type === "block") {
    const denominator = Math.max(1, actor.blockStreak + 1);
    const chance = 1 / denominator;
    const roll = nextRandom(state.rngState);
    const succeeded = roll.value < chance;
    const blockMessage = `${combatantName(actor)} blocks.`;
    const failureMessage = `${actor.name}'s block failed.`;
    const blockedState = updateUnit({ ...state, rngState: roll.state }, action.actorKey, (unit) => ({
      ...unit,
      blocking: succeeded,
      blockStreak: succeeded ? unit.blockStreak + 1 : 0,
    }), succeeded ? blockMessage : failureMessage);
    const blocked = succeeded && actor.side === "player" ? appendProgressEvent(blockedState, {
      event_type: "block_completed",
      source_critter_id: actor.critter.id,
      target_critter_id: null,
      skill_id: null,
      amount: 1,
      payload: { blocks_performed: 1 },
    }) : blockedState;
    const announced = appendPresentationEvent(
      succeeded ? blocked : { ...blocked, log: [failureMessage, blockMessage, ...state.log] },
      { kind: "block", message: blockMessage, actorKey: actor.key, targetKeys: [actor.key], hpChanges: [] },
    );
    return succeeded
      ? announced
      : appendPresentationEvent(announced, {
          kind: "block",
          message: failureMessage,
          actorKey: actor.key,
          targetKeys: [actor.key],
          hpChanges: [],
        });
  }

  if (action.type === "swap" && (action.swapInKey || action.swapToId)) {
    const incomingKey = action.swapInKey
      ?? state.playerUnits.find((unit) => unit.userCritter?.id === action.swapToId)?.key;
    if (!incomingKey) return state;
    const swapped = swapCombatUnitByKey(state, action.actorKey, incomingKey);
    const incoming = [...swapped.playerUnits, ...swapped.opponentUnits].find((unit) => unit.key === incomingKey);
    return incoming && actor.side === "player" ? appendProgressEvent(swapped, {
      event_type: "swap_completed",
      source_critter_id: actor.critter.id,
      target_critter_id: incoming.critter.id,
      skill_id: null,
      amount: 1,
      payload: {
        incoming_critter_id: incoming.critter.id,
        incoming_element_ids: critterElementIds(incoming.critter),
        unique: true,
      },
    }) : swapped;
  }

  if (action.type === "skill" && action.skillId) {
    const skill = actor.skills.find((candidate) => candidate.id === action.skillId);
    if (!skill) return state;
    const targetSlot = action.targetSlotSide !== undefined && action.targetSlotIndex !== undefined
      ? { side: action.targetSlotSide, index: action.targetSlotIndex }
      : undefined;
    const targets = skillTargets(state, actor.key, skill, action.targetKey, targetSlot);
    if (!targets.length) {
      const message = `${combatantPossessive(actor)} ${skill.name} had no valid target; the reserved mana was spent.`;
      return appendPresentationEvent(
        { ...state, log: [message, ...state.log] },
        { kind: "other", message, actorKey: actor.key, targetKeys: [], skillId: skill.id, hpChanges: [] },
      );
    }
    const skillMessage = `${combatantName(actor)} used ${skill.name}!`;
    let actionState = appendPresentationEvent(state, {
      kind: "skill",
      message: skillMessage,
      actorKey: actor.key,
      targetKeys: targets.map((target) => target.key),
      skillId: skill.id,
      hpChanges: [],
    });
    actionState = refreshConditionalSetupEffects(actionState, actionContext);
    const effects = state.runEffects.skill[skill.id] ?? [];
    const preDamageEffectIds = new Set(
      skill.skill_type === "attack"
        ? effects
          .filter((effect) => effect.execution !== "child" && (
            (effect.runtimeKind === "shield_modifier" && effect.parameters.operation === "destroy")
            || ["conditional_effect", "damage_modifier", "damage_prevention"].includes(effect.runtimeKind)
          ))
          .map((effect) => effect.id)
        : [],
    );
    const postAttackSwapEffectIds = new Set(
      skill.skill_type === "attack"
        ? effects
          .filter((effect) => effect.execution !== "child" && effect.runtimeKind === "swap_after_attack")
          .map((effect) => effect.id)
        : [],
    );
    let preDamageState = actionState;
    for (const effect of effects.filter((candidate) => preDamageEffectIds.has(candidate.id))) {
      preDamageState = resolveEffect(preDamageState, effect, {
        sourceOwnerType: "skill",
        sourceOwnerId: skill.id,
        sourceCritterKey: actor.key,
        skillTargetKeys: targets.map((target) => target.key),
        attackerKey: actor.key,
        ...actionContext,
      });
    }
    let damageDone = 0;
    let next = targets.reduce((current, originalTarget) => {
      const target = findUnit(current, originalTarget.key);
      if (!target || target.hp <= 0) return current;
      if (skill.skill_type === "attack") {
        const damageRoll = nextRandom(current.rngState);
        const resolvedDamage = calculateSkillDamage(current.catalog, actor, target, skill, () => damageRoll.value, targets.length);
        const damage = resolveIncomingDamage(
          { ...current, rngState: damageRoll.state },
          actor,
          target,
          resolvedDamage.damage,
          { sourceOwnerType: "skill", sourceOwnerId: skill.id, sourceCritterKey: actor.key, skillTargetKeys: targets.map((item) => item.key), damageSource: "skill", ...actionContext },
        );
        const actualDamage = damage.hpDamage;
        // Recoil, drain, and other post-attack effects scale from durability
        // actually removed, whether the hit landed on HP or Shield.
        damageDone += damage.hpDamage + damage.shieldDamage;
        const afterHp = findUnit(damage.state, target.key)?.hp ?? target.hp;
        const shieldBroken = damage.shieldDamage > 0 && (findUnit(damage.state, target.key)?.shield ?? target.shield) <= 0;
        const impactMessage = damage.shieldDamage > 0
          ? `${combatantPossessive(target)} Shield absorbed ${damage.shieldDamage} damage.${resolvedDamage.suffix ? ` ${resolvedDamage.suffix}` : ""}`
          : `${combatantName(target)} took ${actualDamage} damage.${resolvedDamage.suffix ? ` ${resolvedDamage.suffix}` : ""}`;
        const updated = {
          ...damage.state,
          log: [`${combatantName(actor)} used ${skill.name} on ${combatantName(target, false)} for ${damage.finalDamage} damage.${resolvedDamage.suffix ? ` ${resolvedDamage.suffix}` : ""}`, ...damage.state.log],
        };
        let withPresentation = appendPresentationEvent(updated, {
          kind: "damage",
          message: impactMessage,
          actorKey: actor.key,
          targetKeys: [target.key],
          skillId: skill.id,
          damageRollPercent: resolvedDamage.damageRollPercent,
          damageSpreadPercent: resolvedDamage.spreadMultiplier < 1
            ? Math.round(resolvedDamage.spreadMultiplier * 100)
            : undefined,
          effectiveness: resolvedDamage.effectiveness,
          effectivenessClass: resolvedDamage.classification,
          hpChanges: [{ unitKey: target.key, before: target.hp, after: afterHp }],
        });
        if (shieldBroken) {
          const breakMessage = `${combatantPossessive(target)} Shield broke.`;
          withPresentation = appendPresentationEvent(
            { ...withPresentation, log: [breakMessage, ...withPresentation.log] },
            {
              kind: "status",
              effectPolarity: "negative",
              message: breakMessage,
              actorKey: actor.key,
              targetKeys: [target.key],
              skillId: skill.id,
              hpChanges: [],
            },
          );
        }
        let progress = appendDamageProgressEvents(withPresentation, actor, target, actualDamage, afterHp <= 0, skill);
        if (damage.blockPrevented > 0 && target.side === "player") {
          progress = appendProgressEvent(progress, {
            event_type: "block_completed",
            source_critter_id: target.critter.id,
            target_critter_id: actor.critter.id,
            skill_id: skill.id,
            amount: damage.blockPrevented,
            payload: { damage_prevented: damage.blockPrevented, fully_blocked: damage.finalDamage === 0, survived: afterHp > 0 },
          });
        }
        // The incoming damage must be visible before any equipment/status
        // reaction it causes. The reaction is still resolved synchronously,
        // so it is available before the next queued action is processed.
        const reacted = resolveReactiveEffects(progress, "owner_attacked", actor, target, damage.finalDamage, actualDamage, damage.shieldDamage);
        return afterHp <= 0
          ? resolveReactiveEffects(reacted, "owner_defeats_enemy", actor, target, damage.finalDamage, actualDamage, damage.shieldDamage)
          : reacted;
      }
      return { ...current, log: [`${combatantName(actor)} used ${skill.name} on ${combatantName(target, false)}.`, ...current.log] };
    }, preDamageState);
    if (actor.side === "player") {
      next = appendProgressEvent(next, {
        event_type: "skill_resolved",
        source_critter_id: actor.critter.id,
        target_critter_id: targets[0]?.critter.id ?? null,
        skill_id: skill.id,
        amount: 1,
        payload: {
          source_element_ids: critterElementIds(actor.critter),
          target_element_ids: targets.flatMap((target) => critterElementIds(target.critter)),
          source_critter_tag_ids: critterTagIds(actor.critter),
          target_critter_tag_ids: [...new Set(targets.flatMap((target) => critterTagIds(target.critter)))],
          skill_tag_ids: skill.tag_ids,
          skill_element_id: skill.element_id,
        },
      });
    }
    next = recomputeCombatStats(next);
    for (const effect of effects.filter((candidate) => postAttackSwapEffectIds.has(candidate.id))) {
      next = resolveEffect(next, effect, {
        sourceOwnerType: "skill",
        sourceOwnerId: skill.id,
        sourceCritterKey: actor.key,
        skillTargetKeys: targets.map((target) => target.key),
        attackerKey: actor.key,
        swapTargetKey: action.swapTargetKey,
        damageDone,
        ...actionContext,
      });
    }
    if (effects.length) {
      for (const effect of effects.filter((effect) => effect.execution !== "child" && effect.runtimeKind !== "skill_usage_restriction" && !preDamageEffectIds.has(effect.id) && !postAttackSwapEffectIds.has(effect.id))) next = resolveEffect(next, effect, {
        sourceOwnerType: "skill",
        sourceOwnerId: skill.id,
        sourceCritterKey: actor.key,
        skillTargetKeys: targets.map((target) => target.key),
        attackerKey: actor.key,
        damageDone,
        ...actionContext,
      });
    }
    return recordSkillUseAndRestrictions(expireCurrentActionEffects(next, actor.key), actor.key, skill.id, effects);
  }

  return state;
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
  const hasRevival = (state.runEffects.skill[skill.id] ?? [])
    .some((effect) => effect.runtimeKind === "critter_revival");
  const knockedOutFriendly = (unit: CombatUnit) => hasRevival && unit.side === actor.side && unit.hp <= 0;
  const targeting = skill.targeting ?? "single_enemy";
  if (targeting === "all_enemies") return enemies.filter(onField);
  if (targeting === "all_critters") return [...friendlies, ...enemies].filter((unit) => onField(unit) || knockedOutFriendly(unit));
  if (targeting === "all_friendlies") return friendlies.filter((unit) => onField(unit) || knockedOutFriendly(unit));
  if (targeting === "self_only") return onField(actor) ? [actor] : [];
  if (targeting === "all_allies") return friendlies.filter((unit) => unit.key !== actor.key && (onField(unit) || knockedOutFriendly(unit)));
  if (targeting === "all_others") return [...friendlies, ...enemies].filter((unit) => unit.key !== actor.key && (onField(unit) || knockedOutFriendly(unit)));
  const candidates = targeting === "single_any"
    ? [...friendlies, ...enemies].filter((unit) => onField(unit) || knockedOutFriendly(unit))
    : enemies.filter(onField);
  if (selectedSlot) return candidates.filter((unit) => unit.side === selectedSlot.side && unit.battlefieldSlot === selectedSlot.index);
  if (!selectedKey) return candidates;
  return candidates.filter((unit) => unit.key === selectedKey);
}

export function skillHasPostAttackSwap(state: CombatState, actorKey: string, skillId: string): boolean {
  const actor = findUnit(state, actorKey);
  if (!actor) return false;
  const skill = actor.skills.find((candidate) => candidate.id === skillId);
  if (!skill || skill.skill_type !== "attack") return false;
  return (state.runEffects.skill[skillId] ?? []).some((effect) => (
    effect.execution !== "child"
      && effect.runtimeKind === "swap_after_attack"
      && Number(effect.parameters.chance ?? 1) > 0
      && effectMatchesSourceCritter(effect, actor.critter)
      && effectMatchesSourceSkill(effect, skill)
  ));
}

export function healthyFriendlySwapTargets(state: CombatState, actorKey: string): CombatUnit[] {
  const actor = findUnit(state, actorKey);
  if (!actor) return [];
  const friendlies = actor.side === "player" ? state.playerUnits : state.opponentUnits;
  return friendlies.filter((unit) => unit.key !== actorKey && !unit.active && unit.hp > 0);
}

function skillUsageKey(actorKey: string, skillId: string): string {
  return `${actorKey}:${skillId}`;
}

function skillRestrictionEffects(state: CombatState, skillId: string, actorKey?: string): ResolvedEffectRef[] {
  const sourceCritter = actorKey ? findUnit(state, actorKey)?.critter : undefined;
  const skill = state.catalog.skills.find((candidate) => candidate.id === skillId);
  return (state.runEffects.skill[skillId] ?? [])
    .filter((effect) => effect.runtimeKind === "skill_usage_restriction" && effect.execution !== "child")
    .filter((effect) => effectMatchesSourceCritter(effect, sourceCritter))
    .filter((effect) => effectMatchesSourceSkill(effect, skill));
}

export function isActorRecharging(state: CombatState, actorKey: string): boolean {
  return Number(state.rechargeUntilTurn?.[actorKey] ?? 0) >= state.turn;
}

export function skillAvailability(state: CombatState, actorKey: string, skillId: string): SkillAvailability {
  const actor = findUnit(state, actorKey);
  if (!actor || !actor.active || actor.hp <= 0 || !actor.skills.some((skill) => skill.id === skillId)) {
    return { valid: false, reason: "This Skill is not available to this Critter." };
  }
  if (isActorRecharging(state, actorKey)) {
    return { valid: false, reason: `${actor.name} must recharge this turn.` };
  }
  const key = skillUsageKey(actorKey, skillId);
  let tightest: SkillAvailability | null = null;
  for (const effect of skillRestrictionEffects(state, skillId, actorKey)) {
    const rawLimit = effect.parameters.usage_limit;
    if (rawLimit === null || rawLimit === undefined) continue;
    const limit = Number(rawLimit);
    const scope = String(effect.parameters.usage_limit_scope) === "dungeon" ? "dungeon" : "encounter";
    const used = Number(state.skillUsage?.[scope]?.[key] ?? 0);
    const remaining = Math.max(0, limit - used);
    if (!tightest || remaining < (tightest.remainingUses ?? Number.MAX_SAFE_INTEGER)) {
      tightest = {
        valid: remaining > 0,
        remainingUses: remaining,
        scope,
        reason: remaining > 0
          ? undefined
          : `${scope === "dungeon" ? "Dungeon" : "Encounter"} use limit reached.`,
      };
    }
  }
  return tightest ?? { valid: true };
}

function recordSkillUseAndRestrictions(
  state: CombatState,
  actorKey: string,
  skillId: string,
  effects: ResolvedEffectRef[],
): CombatState {
  const sourceCritter = findUnit(state, actorKey)?.critter;
  const restrictions = effects
    .filter((effect) => effect.runtimeKind === "skill_usage_restriction" && effect.execution !== "child")
    .filter((effect) => effectMatchesSourceCritter(effect, sourceCritter))
    .filter((effect) => effectMatchesSourceSkill(effect, state.catalog.skills.find((skill) => skill.id === skillId)));
  if (!restrictions.length) return state;
  const key = skillUsageKey(actorKey, skillId);
  let next: CombatState = {
    ...state,
    skillUsage: {
      encounter: {
        ...(state.skillUsage?.encounter ?? {}),
        [key]: Number(state.skillUsage?.encounter?.[key] ?? 0) + 1,
      },
      dungeon: {
        ...(state.skillUsage?.dungeon ?? {}),
        [key]: Number(state.skillUsage?.dungeon?.[key] ?? 0) + 1,
      },
    },
  };
  let rechargeUntil = Number(next.rechargeUntilTurn?.[actorKey] ?? 0);
  for (const effect of restrictions) {
    const turns = Math.max(0, Number(effect.parameters.recharge_turns ?? 0));
    if (turns <= 0) continue;
    const chance = rollChance(next, Number(effect.parameters.recharge_chance ?? 0));
    next = chance.state;
    if (chance.activated) rechargeUntil = Math.max(rechargeUntil, state.turn + turns);
  }
  return rechargeUntil > Number(next.rechargeUntilTurn?.[actorKey] ?? 0)
    ? { ...next, rechargeUntilTurn: { ...(next.rechargeUntilTurn ?? {}), [actorKey]: rechargeUntil } }
    : next;
}

type RuntimeContext = {
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceSide?: CombatUnit["side"];
  sourceCritterKey?: string;
  skillTargetKeys?: string[];
  statusHolderKey?: string;
  statusInstanceId?: string;
  damageDone?: number;
  elementIds?: string[];
  tagIds?: string[];
  attackerKey?: string;
  defenderKey?: string;
  actionId?: string;
  calculatedValue?: number;
  damageAttempted?: number;
  hpDamage?: number;
  shieldDamage?: number;
  eventType?: string;
  parentInstanceId?: string;
  resolutionDepth?: number;
  activationAlreadyRolled?: boolean;
  allowInactiveSource?: boolean;
  actionOrder?: {
    position: number;
    total: number;
    first: boolean;
    last: boolean;
    beforeSkillTarget: boolean;
    afterSkillTarget: boolean;
  };
  damageSource?: "attack" | "skill" | "status" | "retaliation" | "direct_damage";
  conditionalParentInstanceId?: string;
  swapTargetKey?: string;
};

function effectTargets(state: CombatState, target: string, context: RuntimeContext): CombatUnit[] {
  const holder = context.statusHolderKey ? findUnit(state, context.statusHolderKey) : undefined;
  const source = holder ?? (context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined);
  const sourceSide = source?.side ?? context.sourceSide ?? (context.sourceOwnerType === "ability" ? "player" : "opponent");
  const friendlies = sourceSide === "opponent" ? state.opponentUnits : state.playerUnits;
  const enemies = sourceSide === "opponent" ? state.playerUnits : state.opponentUnits;
  const active = (unit: CombatUnit) => unit.active && unit.hp > 0;
  const ordered = (units: CombatUnit[]) => [...units].sort((a, b) =>
    (a.side === b.side ? 0 : a.side === "player" ? -1 : 1)
    || (a.battlefieldSlot ?? 99) - (b.battlefieldSlot ?? 99)
    || a.key.localeCompare(b.key),
  );
  const contextTarget = (key?: string) => key ? findUnit(state, key) : undefined;
  const filterByElements = (units: CombatUnit[]) => {
    const selected = new Set(context.elementIds ?? []);
    return selected.size === 0
      ? units
      : units.filter((unit) => matchesSelectedElements(unit.critter, selected));
  };
  const filterByTags = (units: CombatUnit[]) => {
    const selected = new Set(context.tagIds ?? []);
    return selected.size === 0 ? units : units.filter((unit) => critterTagIds(unit.critter).some((tagId) => selected.has(tagId)));
  };
  const finish = (units: CombatUnit[]) => filterByTags(filterByElements(units));
  switch (target) {
    case "self":
    case "using_critter": {
      if (!source) throw new Error(`Missing source Critter for ${context.sourceOwnerType} effect from ${context.sourceOwnerId}.`);
      return finish(active(source) || (context.allowInactiveSource && source.hp > 0) ? [source] : []);
    }
    case "all_critters": return finish(ordered([...friendlies, ...enemies].filter(active)));
    case "all_others": return finish(ordered([...friendlies, ...enemies].filter((unit) => active(unit) && unit.key !== source?.key)));
    case "all_enemies":
    case "using_critter_enemies":
    case "equipped_critter_enemies": return finish(ordered(enemies.filter(active)));
    case "all_allies":
    case "using_critter_allies_without_equipped":
    case "equipped_critter_allies_without_equipped": return finish(ordered(friendlies.filter((unit) => active(unit) && unit.key !== source?.key)));
    case "all_friendlies":
    case "using_critter_allies_with_equipped":
    case "equipped_critter_allies_with_equipped": return finish(ordered(friendlies.filter(active)));
    case "all_squad_friendlies": return finish(ordered(friendlies.filter((unit) => unit.hp > 0)));
    case "attacker_and_targets": {
      const selected = new Set([context.attackerKey, ...(context.skillTargetKeys ?? [])].filter((key): key is string => Boolean(key)));
      return finish(ordered([...friendlies, ...enemies].filter((unit) => active(unit) && selected.has(unit.key))));
    }
    case "targets":
    case "skill_targets": {
      const selected = new Set(context.skillTargetKeys ?? []);
      return finish(ordered([...friendlies, ...enemies].filter((unit) => active(unit) && selected.has(unit.key))));
    }
    case "target_friendlies": {
      const selected = new Set(context.skillTargetKeys ?? []);
      return finish(ordered(friendlies.filter((unit) => active(unit) && selected.has(unit.key))));
    }
    case "target_enemies": {
      const selected = new Set(context.skillTargetKeys ?? []);
      return finish(ordered(enemies.filter((unit) => active(unit) && selected.has(unit.key))));
    }
    case "all_element_friendlies":
    case "all_element_enemies": {
      if (!context.elementIds?.length) return [];
      const candidates = target === "all_element_friendlies" ? friendlies : enemies;
      return finish(ordered(candidates.filter(active)));
    }
    case "equipped_critter": {
      if (!source) throw new Error(`Missing equipped Critter for relic effect from ${context.sourceOwnerId}.`);
      return finish(active(source) || (context.allowInactiveSource && source.hp > 0) ? [source] : []);
    }
    case "equipped_allies": return finish(ordered(friendlies.filter((unit) => active(unit) && unit.key !== source?.key)));
    case "equipped_friendlies": return finish(ordered(friendlies.filter(active)));
    case "selected_ally": {
      const selected = contextTarget(context.skillTargetKeys?.find((key) => findUnit(state, key)?.side === source?.side));
      return finish(selected && active(selected) ? [selected] : []);
    }
    case "selected_healthy_ally": {
      const selected = contextTarget(context.swapTargetKey);
      return finish(selected && source && selected.side === source.side && selected.key !== source.key && !selected.active && selected.hp > 0 ? [selected] : []);
    }
    case "selected_enemy": {
      const selected = contextTarget(context.skillTargetKeys?.find((key) => findUnit(state, key)?.side !== source?.side));
      return finish(selected && active(selected) ? [selected] : []);
    }
    case "active_ally": return finish(ordered(friendlies.filter(active)).slice(0, 1));
    case "active_enemy": return finish(ordered(enemies.filter(active)).slice(0, 1));
    case "attacker": return finish(contextTarget(context.attackerKey) && active(contextTarget(context.attackerKey)!) ? [contextTarget(context.attackerKey)!] : []);
    case "defender": return finish(contextTarget(context.defenderKey) && active(contextTarget(context.defenderKey)!) ? [contextTarget(context.defenderKey)!] : []);
    case "effect_owner": return finish(source && active(source) ? [source] : []);
    case "status_holder": {
      if (!holder) throw new Error(`Missing status holder for status effect from ${context.sourceOwnerId}.`);
      return finish(active(holder) ? [holder] : []);
    }
    case "status_holder_allies_without_holder": return finish(holder && active(holder) ? friendlies.filter((unit) => active(unit) && unit.key !== holder.key) : []);
    case "status_holder_allies_with_holder": return finish(holder && active(holder) ? friendlies.filter(active) : []);
    case "status_holder_enemies": return finish(holder && active(holder) ? enemies.filter(active) : []);
    default: throw new Error(`Unsupported effect target: ${target}`);
  }
}

function effectElementIdsForTargeting(effect: ResolvedEffectRef): string[] | undefined {
  return targetElementIds(effect);
}

function effectTagIdsForTargeting(effect: ResolvedEffectRef): string[] | undefined {
  return targetCritterTagIds(effect);
}

function weightedSelectorTargetMatches(state: CombatState, effect: ResolvedEffectRef, context: RuntimeContext): boolean {
  const required = new Set(targetElementIds(effect));
  const requiredTags = new Set(targetCritterTagIds(effect));
  if (required.size === 0 && requiredTags.size === 0) return true;
  return (context.skillTargetKeys ?? []).some((key) => {
    const target = findUnit(state, key);
    return Boolean(target && matchesSelectedElements(target.critter, required)
      && (requiredTags.size === 0 || critterTagIds(target.critter).some((tagId) => requiredTags.has(tagId))));
  });
}

function revivalTargets(state: CombatState, target: string, context: RuntimeContext): CombatUnit[] {
  const source = context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined;
  if (!source) throw new Error(`Missing source Critter for revival effect from ${context.sourceOwnerId}.`);
  const friendlies = source.side === "opponent" ? state.opponentUnits : state.playerUnits;
  const knockedOut = (unit: CombatUnit) => unit.hp <= 0;
  const ordered = (units: CombatUnit[]) => [...units].sort((left, right) =>
    (left.battlefieldSlot ?? 99) - (right.battlefieldSlot ?? 99)
    || left.key.localeCompare(right.key),
  );
  const filterByElements = (units: CombatUnit[]) => {
    const selected = new Set(context.elementIds ?? []);
    return selected.size === 0 ? units : units.filter((unit) => matchesSelectedElements(unit.critter, selected));
  };
  const filterByTags = (units: CombatUnit[]) => {
    const selected = new Set(context.tagIds ?? []);
    return selected.size === 0 ? units : units.filter((unit) => critterTagIds(unit.critter).some((tagId) => selected.has(tagId)));
  };
  const finish = (units: CombatUnit[]) => filterByTags(filterByElements(units));
  if (target === "target_friendlies") {
    const selected = new Set(context.skillTargetKeys ?? []);
    return finish(ordered(friendlies.filter((unit) => knockedOut(unit) && selected.has(unit.key))));
  }
  if (target === "all_allies") {
    return finish(ordered(friendlies.filter((unit) => knockedOut(unit) && unit.key !== source.key)));
  }
  if (target === "all_friendlies") return finish(ordered(friendlies.filter(knockedOut)));
  throw new Error(`Unsupported revival target: ${target}`);
}

function numericEffectValue(effect: ResolvedEffectRef, target: CombatUnit, context: RuntimeContext): number {
  const p = effect.parameters;
  const value = Number(p.value ?? p.amount ?? p.shield_value ?? context.calculatedValue ?? 0);
  const type = String(p.value_type ?? p.value_mode ?? "flat");
  if (type === "percent_max_hp" || type === "percentage") return target.maxHp * value;
  if (type === "percent_current_hp") return target.hp * value;
  if (type === "percent_missing_hp") return (target.maxHp - target.hp) * value;
  if (type === "percent_damage_dealt") return Number(context.damageDone ?? context.damageAttempted ?? context.hpDamage ?? 0) * value;
  return value;
}

function healingSourceSide(state: CombatState, context: RuntimeContext): CombatUnit["side"] {
  const source = context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined;
  // Rollcaster Abilities in the player runtime always belong to the user's
  // active Rollcaster and intentionally have no source Critter key.
  return source?.side ?? context.sourceSide ?? (context.sourceOwnerType === "ability" ? "player" : "opponent");
}

function amplifiedHealingAmount(
  state: CombatState,
  target: CombatUnit,
  rawAmount: number,
  context: RuntimeContext,
  affectedByHealingModifiers = true,
): number {
  if (rawAmount <= 0) return 0;
  const roundHealingStage = (value: number): number => value > 0 && value < 1 ? 1 : roundHalfUp(value);
  // Resolve the authored base heal first. Values at least 1 use half-up
  // rounding; any positive result below 1 still grants one HP. Every later
  // amplifier receives the integer result of the prior stage.
  let amount = roundHealingStage(rawAmount);
  if (affectedByHealingModifiers) {
    for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "effect_amplification")) {
      const parameters = instance.state.parameters as Record<string, unknown> | undefined;
      if (parameters?.affected_effect_category !== "healing") continue;
      const requiredSkillTags = sourceSkillTagIds({ parameters: parameters ?? {} } as ResolvedEffectRef);
      if (requiredSkillTags.length) {
        const sourceSkill = context.sourceOwnerType === "skill"
          ? state.catalog.skills.find((skill) => skill.id === context.sourceOwnerId)
          : undefined;
        if (!effectMatchesSourceSkill({ parameters: parameters ?? {} } as ResolvedEffectRef, sourceSkill)) continue;
      }
      const direction = String(parameters.direction ?? "received");
      const applies = direction === "received"
        ? instance.targetCritterKey === target.key
        : instance.targetCritterKey === context.sourceCritterKey;
      if (!applies) continue;
      const modifier = Number(parameters.modifier_value ?? 0);
      const boosted = parameters.modifier_type === "percentage" ? amount + amount * modifier : amount + modifier;
      amount = roundHealingStage(boosted);
    }
  }
  // Positive healing effects must always restore at least one HP before the
  // missing-HP cap is applied. This keeps small percentage heals meaningful.
  return Math.max(1, amount);
}

function amplifiedShieldAmount(
  state: CombatState,
  targetKey: string,
  rawAmount: number,
  context: RuntimeContext,
): number {
  let amount = Math.max(0, roundHalfUp(rawAmount));
  for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "effect_amplification")) {
    const parameters = instance.state.parameters as Record<string, unknown> | undefined;
    if (parameters?.affected_effect_category !== "shields") continue;
    const requiredSkillTags = sourceSkillTagIds({ parameters: parameters ?? {} } as ResolvedEffectRef);
    if (requiredSkillTags.length) {
      const sourceSkill = context.sourceOwnerType === "skill"
        ? state.catalog.skills.find((skill) => skill.id === context.sourceOwnerId)
        : undefined;
      if (!effectMatchesSourceSkill({ parameters: parameters ?? {} } as ResolvedEffectRef, sourceSkill)) continue;
    }
    const direction = String(parameters.direction ?? "received");
    const applies = direction === "received"
      ? instance.targetCritterKey === targetKey
      : instance.targetCritterKey === context.sourceCritterKey;
    if (!applies) continue;
    const modifier = Number(parameters.modifier_value ?? 0);
    const boosted = parameters.modifier_type === "percentage" ? amount + amount * modifier : amount + modifier;
    amount = Math.max(0, roundHalfUp(boosted));
  }
  return amount;
}

function compareValues(value: number, operator: string, target: number): boolean {
  if (operator === "equal") return value === target;
  if (operator === "not_equal") return value !== target;
  if (operator === "above" || operator === "greater_than") return value > target;
  if (operator === "below" || operator === "less_than") return value < target;
  if (operator === "at_least" || operator === "greater_than_or_equal") return value >= target;
  if (operator === "at_most" || operator === "less_than_or_equal") return value <= target;
  return false;
}

function parseConditionBoolean(value: unknown, activeLabel = "active"): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return ["true", "1", "yes", "on", activeLabel.toLowerCase()].includes(normalized);
}

function conditionalEffectMatches(
  state: CombatState,
  effect: ResolvedEffectRef,
  conditionTargets: CombatUnit[],
  context: RuntimeContext,
): boolean {
  const parameters = effect.parameters;
  const condition = String(parameters.condition ?? "");
  const comparison = String(parameters.comparison ?? "equal");
  const rawValue = parameters.condition_value;
  const ids = condition === "has_status" ? conditionStatusIds(parameters) : conditionIds(parameters);
  const compareBoolean = (actual: boolean, expected: boolean) => comparison === "not_equal" ? actual !== expected : comparison === "equal" ? actual === expected : compareValues(actual ? 1 : 0, comparison, expected ? 1 : 0);
  const anyTargetMatches = (predicate: (target: CombatUnit) => boolean) => conditionTargets.some(predicate);
  if (condition === "action_order") {
    const expected = String(rawValue ?? "").toLowerCase();
    const actual = expected === "first_overall" || expected === "first" || expected === "1"
      ? Boolean(context.actionOrder?.first)
      : expected === "last_overall" || expected === "last" || expected === "0" || expected === "-1"
        ? Boolean(context.actionOrder?.last)
        : expected === "before_skill_target"
          ? Boolean(context.actionOrder?.beforeSkillTarget)
          : expected === "after_skill_target"
            ? Boolean(context.actionOrder?.afterSkillTarget)
            : false;
    return comparison === "not_equal" ? !actual : comparison === "equal" ? actual : compareValues(actual ? 1 : 0, comparison, 1);
  }
  if (condition === "has_stat_modifier") {
    return conditionTargets.some((target) => hasStatModifier(state, target, parameters, comparison));
  }
  if (["shield_present", "active_state", "has_status", "has_relic", "last_squad_member", "ally_defeated", "enemy_defeated", "element"].includes(condition)) {
    if (condition === "has_status") {
      const hasSelectedStatus = (target: CombatUnit) => hasRuntimeStatus(state, target.key, ids);
      return comparison === "not_equal"
        ? conditionTargets.length > 0 && conditionTargets.every((target) => !hasSelectedStatus(target))
        : conditionTargets.some(hasSelectedStatus);
    }
    const actual = (target: CombatUnit) => condition === "shield_present"
      ? target.shield > 0
      : condition === "active_state"
        ? target.active
        : condition === "has_relic"
            ? state.setupSources.some((source) => source.ownerType === "relic" && source.sourceKey === target.key && ids.includes(source.ownerId))
            : condition === "last_squad_member"
              ? (target.side === "player" ? state.playerUnits : state.opponentUnits).filter((unit) => unit.hp > 0).length === 1
              : condition === "ally_defeated"
                ? (target.side === "player" ? state.playerUnits : state.opponentUnits).some((unit) => unit.hp <= 0)
                : condition === "enemy_defeated"
                  ? (target.side === "player" ? state.opponentUnits : state.playerUnits).some((unit) => unit.hp <= 0)
                  : critterElementIds(target.critter).some((elementId) => ids.includes(elementId) || elementId === String(rawValue ?? ""));
    const expected = ["has_status", "has_relic", "element"].includes(condition)
      ? true
      : parseConditionBoolean(rawValue, condition === "active_state" ? "active" : "true");
    return anyTargetMatches((target) => compareBoolean(actual(target), expected));
  }
  if (condition === "tags") {
    const requiredTags = new Set(
      Array.isArray(parameters.condition_target_critter_tag_ids)
        ? parameters.condition_target_critter_tag_ids.filter((id): id is string => typeof id === "string")
        : [],
    );
    const matches = (target: CombatUnit) => critterTagIds(target.critter).some((tagId) => requiredTags.has(tagId));
    return comparison === "not_equal"
      ? conditionTargets.length > 0 && conditionTargets.every((target) => !matches(target))
      : conditionTargets.some(matches);
  }
  if (condition === "previous_action") {
    const previous = [...state.turnEvents].reverse().find((event) => ["skill_resolved", "block_completed", "swap_completed"].includes(event.event_type));
    const actual = previous?.event_type === "skill_resolved" ? "skill" : previous?.event_type === "block_completed" ? "block" : previous?.event_type === "swap_completed" ? "swap" : "none";
    return comparison === "not_equal" ? actual !== String(rawValue ?? "none") : comparison === "equal" ? actual === String(rawValue ?? "none") : false;
  }
  if (condition === "relic_count") {
    return anyTargetMatches((target) => {
      const actual = state.setupSources.filter((source) => source.ownerType === "relic" && source.sourceKey === target.key).length;
      return compareValues(actual, comparison, Number(rawValue ?? 0));
    });
  }
  if (condition === "mana") {
    return anyTargetMatches((target) => {
      const actual = target.side === "player" ? state.playerMana : state.opponentMana;
      return compareValues(actual, comparison, Number(rawValue ?? 0));
    });
  }
  if (condition === "shield_value") return anyTargetMatches((target) => compareValues(target.shield, comparison, Number(rawValue ?? 0)));
  if (condition === "hp_percent") {
    const authored = Number(rawValue ?? 0);
    const expected = authored > 1 ? authored / 100 : authored;
    return anyTargetMatches((target) => compareValues(target.hp / Math.max(1, target.maxHp), comparison, expected));
  }
  if (condition === "previous_mana_roll") return anyTargetMatches((target) => compareValues(target.manaRoll, comparison, Number(rawValue ?? 0)));
  if (condition === "turn_interval" || condition === "round_interval") {
    const interval = Math.max(1, Number(rawValue ?? 1));
    return compareValues(state.turn % interval, comparison, 0);
  }
  return false;
}

function applyShieldValue(
  state: CombatState,
  targetKey: string,
  operation: string,
  value: number,
  maximum?: number,
  canStack = false,
  replaceExistingShield = false,
): CombatState {
  const target = findUnit(state, targetKey);
  if (!target) return state;
  const before = target.shield;
  const nextShield = operation === "destroy"
    ? 0
    : operation === "set"
      ? value
      : operation === "grant"
        ? replaceExistingShield
          ? value
          : canStack
            ? before + value
            : Math.max(before, value)
      : operation === "subtract"
        ? before - value
        : before + value;
  const capped = Math.max(0, Math.min(maximum ?? Math.max(before, nextShield), nextShield));
  const message = capped > before ? `${combatantName(target)} gained ${capped - before} Shield.` : capped < before ? `${combatantName(target)} lost ${before - capped} Shield.` : `${combatantPossessive(target)} Shield remained unchanged.`;
  return updateUnit({ ...state, log: [message, ...state.log] }, targetKey, (unit) => ({ ...unit, shield: capped, maxShield: Math.max(unit.maxShield, maximum ?? capped) }), message);
}

function applyDirectHealthValue(state: CombatState, effect: ResolvedEffectRef, target: CombatUnit, context: RuntimeContext): { state: CombatState; applied: number; excess: number } {
  const p = effect.parameters;
  const rawAmount = Math.max(0, numericEffectValue(effect, target, context));
  const amount = String(p.operation) === "heal"
    ? amplifiedHealingAmount(state, target, rawAmount, context, p.affected_by_healing_modifiers !== false)
    : Math.max(0, roundHalfUp(rawAmount));
  const operation = String(p.operation);
  const selfInflictedSkillEffect = context.sourceOwnerType === "skill" && context.sourceCritterKey === target.key;
  const sourceName = selfInflictedSkillEffect
    ? effect.name
    : effectSourceName(state, context.sourceOwnerType, context.sourceOwnerId, effect.name);
  if (operation === "heal") {
    const applied = Math.min(amount, target.maxHp - target.hp);
    const excess = Math.max(0, amount - applied);
    const next = recomputeCombatStats(updateUnit(state, target.key, (unit) => ({ ...unit, hp: unit.hp + applied }), `${combatantName(target)} gained ${applied} HP from ${sourceName}.`));
    return { state: next, applied, excess };
  }
  if (operation === "set_hp") {
    const after = Math.max(Boolean(p.can_defeat_target) ? 0 : 1, Math.min(target.maxHp, amount));
    return { state: recomputeCombatStats(updateUnit(state, target.key, (unit) => ({ ...unit, hp: after }), `${combatantPossessive(target)} HP changed to ${after} from ${sourceName}.`)), applied: Math.abs(after - target.hp), excess: 0 };
  }
  const shieldAbsorb = p.affected_by_shield === true ? Math.min(target.shield, amount) : 0;
  const remaining = amount - shieldAbsorb;
  const maximumLoss = Boolean(p.can_defeat_target) ? target.hp : Math.max(0, target.hp - 1);
  const applied = Math.min(maximumLoss, remaining);
  let next = shieldAbsorb > 0 ? applyShieldValue(state, target.key, "subtract", shieldAbsorb) : state;
  const message = selfInflictedSkillEffect && (operation === "lose_hp" || operation === "drain")
    ? `${combatantName(target)} lost ${applied} health from ${sourceName}.`
    : `${combatantName(target)} took ${applied} damage from ${sourceName}.`;
  next = recomputeCombatStats(updateUnit(next, target.key, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - applied) }), message));
  return { state: next, applied, excess: 0 };
}

function appendHealingProgressEvent(
  state: CombatState,
  target: CombatUnit,
  restored: number,
  context: RuntimeContext,
): CombatState {
  if (restored <= 0 || healingSourceSide(state, context) !== "player") return state;
  const source = context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined;
  const sourceSkill = context.sourceOwnerType === "skill" ? state.catalog.skills.find((skill) => skill.id === context.sourceOwnerId) : undefined;
  return appendProgressEvent(state, {
    event_type: "hp_healed",
    source_critter_id: source?.critter.id ?? null,
    target_critter_id: target.critter.id,
    skill_id: context.sourceOwnerType === "skill" ? context.sourceOwnerId : null,
    amount: restored,
    payload: {
      source_side: "player",
      recipient_side: target.side === "player" ? "friendly" : "enemy",
      source_element_ids: source ? critterElementIds(source.critter) : [],
      source_critter_tag_ids: source ? critterTagIds(source.critter) : [],
      target_critter_tag_ids: critterTagIds(target.critter),
      skill_tag_ids: sourceSkill?.tag_ids ?? [],
      target_element_ids: critterElementIds(target.critter),
      source_owner_type: context.sourceOwnerType,
      source_owner_id: context.sourceOwnerId,
    },
  });
}

function resolveEffect(state: CombatState, effect: ResolvedEffectRef, context: RuntimeContext): CombatState {
  assertEffectContract(effect, context.sourceOwnerType);
  const sourceCritter = context.sourceCritterKey ? findUnit(state, context.sourceCritterKey)?.critter : undefined;
  if (!effectMatchesSourceCritter(effect, sourceCritter)) return state;
  const sourceSkillId = context.sourceOwnerType === "skill"
    ? context.sourceOwnerId
    : effect.ownerType === "skill" ? effect.ownerId : undefined;
  if (sourceSkillId && !effectMatchesSourceSkill(effect, state.catalog.skills.find((skill) => skill.id === sourceSkillId))) return state;
  const key = `${effect.runtimeKind}@${effect.runtimeVersion}`;
  const isConditional = effect.runtimeKind === "conditional_effect";
  const effectTargetValue = isConditional
    ? effect.parameters.effect_target ?? effect.parameters.target
    : effect.parameters.target;
  const conditionTargetValue = isConditional
    ? effect.parameters.condition_target ?? effectTargetValue
    : undefined;
  const hasTarget = effectTargetValue !== undefined;
  let targets = effect.runtimeKind === "critter_revival"
    ? revivalTargets(state, String(effectTargetValue), {
      ...context,
      elementIds: effectElementIdsForTargeting(effect),
      tagIds: targetCritterTagIds(effect),
    })
      : hasTarget
      ? effectTargets(state, String(effectTargetValue), {
        ...context,
        elementIds: effectElementIdsForTargeting(effect),
        tagIds: targetCritterTagIds(effect),
      })
      : [];
  if (hasTarget && !targets.length) return state;
  let next = state;
  const chanceParameter = effect.runtimeKind === "resource_gain_loss" || effect.runtimeKind === "delayed_effect" || effect.runtimeKind === "direct_health_modifier"
    ? "activation_chance"
    : "chance";
  const activationChance = effect.parameters[chanceParameter] === undefined ? 1 : Number(effect.parameters[chanceParameter]);
  const hasPerTargetChance = hasTarget && effect.parameters[chanceParameter] !== undefined;
  if (context.activationAlreadyRolled) {
    // A reactive parent owns this roll so the child runtime must not consume a
    // second random value or square the authored activation chance.
  } else if (effect.runtimeKind === "weighted_child_selector") {
    if (!weightedSelectorTargetMatches(next, effect, context)) return next;
    // This runtime owns its single random roll: the roll selects one
    // cumulative outcome row, so it must not also consume the generic Effect
    // activation roll used by ordinary chance-based Effects.
  } else if (hasPerTargetChance) {
    const activatedTargets: CombatUnit[] = [];
    for (const target of targets) {
      const chance = rollChance(next, activationChance);
      next = chance.state;
      if (chance.activated) activatedTargets.push(target);
    }
    targets = activatedTargets;
    if (!targets.length) return next;
  } else {
    const chance = rollChance(next, activationChance);
    next = chance.state;
    if (!chance.activated) return next;
  }
  if (effect.execution === "root" && context.parentInstanceId) return next;
  if ((context.resolutionDepth ?? 0) > 16) return next;
  const targetContext = (hasPerTargetChance || isConditional)
    ? { ...context, skillTargetKeys: targets.map((target) => target.key) }
    : context;
  const conditionTargets = isConditional && conditionTargetValue !== undefined
    ? effectTargets(next, String(conditionTargetValue), { ...context, elementIds: undefined, tagIds: undefined })
    : targets;
  const conditionalMatched = !isConditional || conditionalEffectMatches(next, effect, conditionTargets, context);
  if (conditionalMatched) {
    next = recordEffectActivation(next, effect, context.sourceCritterKey);
  }
  if (effect.runtimeKind === "critter_revival") {
    let current = next;
    for (const target of targets) {
      const before = findUnit(current, target.key);
      if (!before || before.hp > 0) continue;
      const authored = effect.parameters.value_mode === "percent_max_hp"
        ? roundHalfUp(before.maxHp * Number(effect.parameters.amount))
        : Number(effect.parameters.amount);
      const revivedHp = Math.max(1, Math.min(before.maxHp, authored));
      const sourceName = effectSourceName(current, context.sourceOwnerType, context.sourceOwnerId, effect.name);
      const message = `${combatantName(before)} was revived with ${revivedHp} HP by ${sourceName}.`;
      current = recomputeCombatStats(updateUnit(current, before.key, (unit) => ({ ...unit, hp: revivedHp }), message));
      current = appendHealingProgressEvent(current, before, revivedHp, context);
      current = appendPresentationEvent(
        current,
        {
          kind: "heal",
          effectPolarity: "positive",
          message,
          actorKey: context.sourceCritterKey,
          targetKeys: [before.key],
          skillId: context.sourceOwnerType === "skill" ? context.sourceOwnerId : undefined,
          hpChanges: [{ unitKey: before.key, before: 0, after: revivedHp }],
        },
      );
    }
    return current;
  }
  if (effect.runtimeKind === "shield_modifier") {
    const operation = String(effect.parameters.operation ?? "grant");
    const authoredValue = operation === "destroy" ? 0 : Math.max(0, roundHalfUp(Number(effect.parameters.shield_value ?? 0)));
    const rawMaximum = effect.parameters.maximum_shield;
    const maximum = rawMaximum === null || rawMaximum === undefined || rawMaximum === ""
      ? undefined
      : Number.isFinite(Number(rawMaximum)) ? Number(rawMaximum) : undefined;
    return targets.reduce((current, target) => {
      const value = ["grant", "add"].includes(operation)
        ? amplifiedShieldAmount(current, target.key, authoredValue, context)
        : authoredValue;
      return applyShieldValue(
        current,
        target.key,
        operation,
        value,
        maximum,
        effect.parameters.can_stack === true,
        effect.parameters.replace_existing_shield === true,
      );
    }, next);
  }
  if (effect.runtimeKind === "direct_health_modifier") {
    let current = next;
    const appliedChanges: Array<{ target: CombatUnit; before: number; after: number; message: string }> = [];
    for (const target of targets) {
      const before = findUnit(current, target.key)!;
      const result = applyDirectHealthValue(current, effect, before, context);
      const after = findUnit(result.state, target.key)!;
      const message = result.state.log[0];
      current = result.state;
      if (after.hp > before.hp) current = appendHealingProgressEvent(current, before, after.hp - before.hp, context);
      if (after.hp !== before.hp) appliedChanges.push({ target: before, before: before.hp, after: after.hp, message });
      if (result.excess > 0 && effect.parameters.overhealing_behavior === "convert") {
        current = resolveChildEffects(current, effect, { ...targetContext, calculatedValue: result.excess }, effect.parameters.overheal_effect_ids);
      }
    }
    if (
      context.eventType === "owner_defeats_enemy"
      && context.sourceOwnerType === "ability"
      && String(effect.parameters.operation) === "heal"
      && appliedChanges.length > 0
    ) {
      const sourceName = effectSourceName(current, context.sourceOwnerType, context.sourceOwnerId, effect.name);
      const healingText = appliedChanges
        .map((change, index) => `${combatantName(change.target, index === 0)} healed ${change.after - change.before} HP`)
        .join(" and ");
      const message = `${healingText} from ${sourceName}.`;
      return appendPresentationEvent(
        { ...current, log: [message, ...current.log] },
        {
          kind: "heal",
          message,
          actorKey: context.sourceCritterKey,
          targetKeys: appliedChanges.map((change) => change.target.key),
          hpChanges: appliedChanges.map((change) => ({ unitKey: change.target.key, before: change.before, after: change.after })),
        },
      );
    }
    for (const change of appliedChanges) {
      current = appendPresentationEvent(current, {
        kind: change.after > change.before ? "heal" : "damage",
        message: change.message,
        actorKey: context.sourceCritterKey,
        targetKeys: [change.target.key],
        hpChanges: [{ unitKey: change.target.key, before: change.before, after: change.after }],
      });
      if (change.before > 0 && change.after <= 0 && context.sourceCritterKey) {
        const source = findUnit(current, context.sourceCritterKey);
        if (source && source.side !== change.target.side) {
          current = resolveReactiveEffects(
            current,
            "owner_defeats_enemy",
            source,
            findUnit(current, change.target.key) ?? change.target,
            change.before,
            change.before,
            0,
          );
        }
      }
    }
    return current;
  }
  if (effect.runtimeKind === "effect_scaling") {
    const sourceTarget = targets[0];
    const scalingSource = String(effect.parameters.scaling_source);
    const sourceValue = scalingSource === "missing_hp" && sourceTarget ? sourceTarget.maxHp - sourceTarget.hp
      : scalingSource === "current_hp" && sourceTarget ? sourceTarget.hp
        : scalingSource === "maximum_hp" && sourceTarget ? sourceTarget.maxHp
          : Number(context.damageAttempted ?? context.hpDamage ?? context.calculatedValue ?? 0);
    const scaled = Math.max(Number(effect.parameters.minimum_value ?? -Infinity), Math.min(Number(effect.parameters.maximum_value ?? Infinity), Number(effect.parameters.base_value ?? 0) + sourceValue * Number(effect.parameters.scaling_ratio ?? 0)));
    return resolveChildEffects(next, effect, { ...targetContext, calculatedValue: roundHalfUp(scaled) }, effect.parameters.child_effect_ids);
  }
  if (effect.runtimeKind === "effect_duration") {
    const duration = Number(effect.parameters.duration_value ?? effect.parameters.turns ?? 1);
    return resolveChildEffects(addRuntimeEffect(next, effect, targetContext, {}, duration), effect, targetContext, effect.parameters.child_effect_ids);
  }
  if (effect.runtimeKind === "conditional_effect") {
    const target = targets[0];
    if (!target) return next;
    const conditionalContext = context.conditionalParentInstanceId
      ? { ...targetContext, conditionalParentInstanceId: context.conditionalParentInstanceId }
      : targetContext;
    return resolveChildEffects(next, effect, conditionalContext, conditionalMatched ? effect.parameters.true_effect_ids : effect.parameters.false_effect_ids);
  }
  if (effect.runtimeKind === "weighted_child_selector") {
    const roll = nextRandom(next.rngState);
    let selectedChildId: string | null = null;
    let cumulative = 0;
    const rows = Array.isArray(effect.parameters.outcome_rows) ? effect.parameters.outcome_rows : [];
    for (const candidate of rows) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const row = candidate as Record<string, unknown>;
      cumulative += Number(row.probability ?? 0);
      if (roll.value < cumulative) {
        selectedChildId = typeof row.effect_id === "string" ? row.effect_id : null;
        break;
      }
    }
    next = { ...next, rngState: roll.state };
    return selectedChildId ? resolveChildEffects(next, effect, context, [selectedChildId]) : next;
  }
  if (effect.runtimeKind === "swap_after_attack") {
    const source = context.sourceCritterKey ? findUnit(next, context.sourceCritterKey) : undefined;
    const target = targets[0];
    if (!source || source.hp <= 0 || !target) return next;
    return swapCombatUnitByKey(next, source.key, target.key);
  }
  if (effect.runtimeKind === "delayed_effect" || effect.runtimeKind === "repeating_effect") {
    if (effect.runtimeKind === "delayed_effect") return scheduleDelayedEffect(next, effect, targetContext, targets);
    const delay = Number(effect.parameters.delay_value ?? effect.parameters.initial_delay ?? effect.parameters.repeat_interval ?? 1);
    return addRuntimeEffect(next, effect, { ...targetContext, skillTargetKeys: targets.map((target) => target.key) }, { childEffectIds: effect.parameters.child_effect_ids, repeat: effect.parameters.repeat === true }, delay);
  }
  if (effect.runtimeKind === "resource_gain_loss") {
    const value = Math.max(0, roundHalfUp(Number(effect.parameters.value ?? 0)));
    const sourceSide = context.sourceCritterKey ? findUnit(next, context.sourceCritterKey)?.side : undefined;
    const ownerSide = sourceSide ?? "player";
    const targetSquad = String(effect.parameters.target_squad ?? "owner");
    const targetSide = targetSquad === "enemy" ? (ownerSide === "player" ? "opponent" : "player") : ownerSide;
    const readMana = (side: "player" | "opponent") => side === "player" ? next.playerMana : next.opponentMana;
    const targetBefore = readMana(targetSide);
    const minimumRemaining = Math.max(0, Number(effect.parameters.minimum_remaining_resource ?? 0));
    const transferable = Math.min(value, Math.max(0, targetBefore - minimumRemaining));
    const operation = String(effect.parameters.operation);
    const updateSideMana = (state: CombatState, side: "player" | "opponent", amount: number) => side === "player"
      ? { ...state, playerMana: Math.max(0, amount) }
      : { ...state, opponentMana: Math.max(0, amount) };
    let resourceState = next;
    let message = "";
    let applied = 0;
    if (operation === "drain") {
      const sourceBefore = readMana(ownerSide);
      resourceState = updateSideMana(resourceState, targetSide, targetBefore - transferable);
      resourceState = updateSideMana(resourceState, ownerSide, sourceBefore + transferable);
      applied = transferable;
      if (applied > 0) {
        const sourceLabel = ownerSide === "player" ? "You" : "The enemy squad";
        const targetLabel = targetSide === "player" ? "your squad" : "the enemy squad";
        message = `${sourceLabel} drained ${applied} mana from ${targetLabel}.`;
      }
    } else {
      const after = operation === "set"
        ? value
        : ["lose", "reserve"].includes(operation)
          ? targetBefore - transferable
          : targetBefore + value;
      resourceState = updateSideMana(resourceState, targetSide, after);
      applied = operation === "set" ? Math.abs(after - targetBefore) : operation === "gain" || operation === "refund" ? value : transferable;
      if (applied > 0) {
        const targetLabel = targetSide === "player" ? "You" : "The enemy squad";
        const verb = ["lose", "reserve"].includes(operation) ? "lost" : operation === "set" ? "set" : "gained";
        message = operation === "set" ? `${targetLabel}'s mana was set to ${value}.` : `${targetLabel} ${verb} ${applied} mana.`;
      }
    }
    if (!message) return resourceState;
    return appendPresentationEvent(
      { ...resourceState, log: [message, ...resourceState.log] },
      { kind: "status", message, actorKey: context.sourceCritterKey, targetKeys: context.sourceCritterKey ? [context.sourceCritterKey] : [], hpChanges: [] },
    );
  }
  if (effect.runtimeKind === "resource_conversion" || effect.runtimeKind === "effect_transfer") {
    const sourceValue = Number(context.calculatedValue ?? context.hpDamage ?? context.damageAttempted ?? 0);
    const calculatedValue = effect.runtimeKind === "resource_conversion"
      ? Math.min(Number(effect.parameters.maximum_conversion ?? Infinity), sourceValue * Number(effect.parameters.conversion_ratio ?? 1))
      : sourceValue * Number(effect.parameters.transfer_percentage ?? 1);
    return resolveChildEffects(next, effect, { ...context, calculatedValue: roundHalfUp(calculatedValue) }, effect.parameters.output_effect_ids ?? effect.parameters.child_effect_ids);
  }
  if (effect.runtimeKind === "effect_amplification") {
    const durationType = String(effect.parameters.duration_type ?? "");
    const durationValue = Number(effect.parameters.duration_value);
    const remaining = ["turns", "rounds"].includes(durationType)
      && Number.isInteger(durationValue)
      && durationValue > 0
      ? durationValue
      : undefined;
    return targets.reduce((current, target) => addRuntimeEffect(
      current,
      effect,
      { ...context, skillTargetKeys: [target.key] },
      { parameters: structuredClone(effect.parameters) },
      remaining,
    ), next);
  }
  if (["effect_immunity", "damage_modifier", "damage_prevention", "action_cost_modifier", "reactive_trigger", "retaliation"].includes(effect.runtimeKind)) {
    const durationType = String(effect.parameters.duration_type ?? "");
    const durationValue = Number(effect.parameters.duration_value ?? 1);
    const remaining = ["current_turn", "turns", "rounds", "activations"].includes(durationType)
      && Number.isInteger(durationValue)
      && durationValue > 0
      ? durationValue
      : undefined;
    return targets.reduce((current, target) => addRuntimeEffect(
      current,
      effect,
      { ...context, skillTargetKeys: [target.key] },
      { parameters: structuredClone(effect.parameters) },
      remaining,
    ), next);
  }
  if (effect.runtimeKind === "effect_removal") {
    const category = String(effect.parameters.removal_category ?? "all_removable");
    const specificEffectId = String(effect.parameters.specific_effect_id ?? "");
    const targetKeys = new Set(targets.map((target) => target.key));
    const matchesCategory = (candidate: { id: string; runtimeKind: string; classification?: string }) => {
      if (candidate.id === effect.id || (specificEffectId && candidate.id !== specificEffectId)) return false;
      if (category === "all_removable") return true;
      if (category === "stat_modifiers") return candidate.runtimeKind === "stat_modifier";
      if (category === "statuses") return candidate.runtimeKind === "apply_status";
      if (category === "shields") return candidate.runtimeKind === "shield_modifier";
      if (category === "delayed") return ["delayed_effect", "repeating_effect"].includes(candidate.runtimeKind);
      if (category === "reactive") return ["reactive_trigger", "retaliation"].includes(candidate.runtimeKind);
      return candidate.classification === category;
    };
    const candidates: Array<{
      kind: "modifier" | "runtime" | "status";
      id: string;
      sequence: number;
      strength: number;
    }> = [];
    for (const [index, modifier] of next.modifiers.entries()) {
      if (!targetKeys.has(modifier.holderKey) || !matchesCategory(modifier.effect)) continue;
      candidates.push({
        kind: "modifier",
        id: modifier.instanceId,
        sequence: index,
        strength: Math.abs(Number(modifier.effect.parameters.amount ?? modifier.effect.parameters.value ?? 0)),
      });
    }
    for (const instance of next.runtimeEffects) {
      if (!instance.targetCritterKey || !targetKeys.has(instance.targetCritterKey)) continue;
      const candidate = effectForReference(next, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
      if (!candidate || !matchesCategory(candidate)) continue;
      candidates.push({
        kind: "runtime",
        id: instance.instanceId,
        sequence: instance.appliedAtSequence,
        strength: Math.abs(Number(candidate.parameters.amount ?? candidate.parameters.value ?? candidate.parameters.shield_value ?? 0)),
      });
    }
    for (const [index, instance] of next.statuses.entries()) {
      if (!targetKeys.has(instance.holderKey)) continue;
      const classification = statusClassification(instance.effects);
      const matchesStatusCategory = category === "statuses"
        || category === "all_removable"
        || category === classification;
      if (!matchesStatusCategory) continue;
      candidates.push({
        kind: "status",
        id: instance.instanceId,
        sequence: index,
        strength: Math.max(0, ...instance.effects.map((candidate) => Math.abs(Number(candidate.parameters.amount ?? candidate.parameters.value ?? 0)))),
      });
    }
    const selection = String(effect.parameters.selection_method ?? "oldest");
    const ordered = [...candidates];
    if (selection === "newest") ordered.sort((a, b) => b.sequence - a.sequence);
    else if (selection === "strongest") ordered.sort((a, b) => b.strength - a.strength || a.sequence - b.sequence);
    else if (selection === "weakest") ordered.sort((a, b) => a.strength - b.strength || a.sequence - b.sequence);
    else if (selection === "random") {
      for (let index = ordered.length - 1; index > 0; index -= 1) {
        const roll = nextRandom(next.rngState);
        next = { ...next, rngState: roll.state };
        const swapIndex = Math.floor(roll.value * (index + 1));
        [ordered[index], ordered[swapIndex]] = [ordered[swapIndex], ordered[index]];
      }
    }
    const rawLimit = effect.parameters.maximum_effects_removed;
    const limit = rawLimit === null || rawLimit === undefined ? ordered.length : Math.max(0, Number(rawLimit));
    const remove = new Set(ordered.slice(0, limit).map((candidate) => `${candidate.kind}:${candidate.id}`));
    const removedStatusIds = new Set(
      next.statuses
        .filter((instance) => remove.has(`status:${instance.instanceId}`))
        .map((instance) => instance.instanceId),
    );
    let removedState: CombatState = {
      ...next,
      statuses: next.statuses.filter((instance) => !removedStatusIds.has(instance.instanceId)),
      modifiers: next.modifiers.filter((modifier) => !remove.has(`modifier:${modifier.instanceId}`) && (!modifier.statusInstanceId || !removedStatusIds.has(modifier.statusInstanceId))),
      runtimeEffects: next.runtimeEffects.filter((instance) => (
        !remove.has(`runtime:${instance.instanceId}`)
        && !(instance.sourceOwnerType === "status" && removedStatusIds.has(`${instance.sourceOwnerId}:${instance.sourceCritterKey}`))
      )),
    };
    removedState = recomputeCombatStats(removedState);
    for (const removed of next.statuses.filter((instance) => removedStatusIds.has(instance.instanceId))) {
      const holder = findUnit(removedState, removed.holderKey);
      const status = removedState.statusRegistry[removed.statusId];
      if (!holder || !status) continue;
      const message = `${combatantName(holder)} was cured of ${status.name}.`;
      removedState = appendPresentationEvent(
        { ...removedState, log: [message, ...removedState.log] },
        { kind: "status", effectPolarity: "positive", message, actorKey: context.sourceCritterKey, targetKeys: [holder.key], hpChanges: [] },
      );
    }
    return removedState;
  }
  if (effect.runtimeKind === "effect_copy") {
    const copies = next.runtimeEffects.filter((instance) => instance.targetCritterKey && targets.some((target) => target.key === instance.targetCritterKey)).slice(0, Number(effect.parameters.maximum_effects_copied ?? 1));
    const cloned = copies.map((instance, index) => ({ ...instance, instanceId: `runtime:${next.effectSequence + index + 1}:copy:${instance.sourceEffectId}`, targetCritterKey: targets[0]?.key, state: { ...instance.state, copiedFrom: instance.instanceId } }));
    return { ...next, runtimeEffects: [...next.runtimeEffects, ...cloned], effectSequence: next.effectSequence + cloned.length };
  }
  if (key === "restore_hp@1") {
    return targets.reduce((current, original) => {
      const target = findUnit(current, original.key)!;
      const raw = effect.parameters.value_mode === "percent_max_hp"
        ? target.maxHp * Number(effect.parameters.amount ?? 0)
        : effect.parameters.value_mode === "percent_damage_done"
          ? Number(context.damageDone ?? 0) * Number(effect.parameters.amount ?? 0)
          : Number(effect.parameters.amount ?? 0);
      const amount = amplifiedHealingAmount(current, target, raw, context);
      const restored = Math.min(amount, target.maxHp - target.hp);
      const source = context.sourceCritterKey ? findUnit(current, context.sourceCritterKey) : undefined;
      const sourceName = effectSourceName(current, context.sourceOwnerType, context.sourceOwnerId, effect.name);
      const message = `${combatantName(target)} gained ${restored} HP from ${sourceName}.`;
      let updated = updateUnit(
        current,
        target.key,
        (unit) => ({ ...unit, hp: unit.hp + restored }),
        message,
      );
      updated = appendHealingProgressEvent(updated, target, restored, context);
      return restored > 0
        ? appendPresentationEvent(updated, {
            kind: "heal",
            message,
            actorKey: source?.key,
            targetKeys: [target.key],
            hpChanges: [{ unitKey: target.key, before: target.hp, after: target.hp + restored }],
          })
        : updated;
    }, next);
  }
  if (key === "apply_status@1") {
    const duration = effect.parameters.indefinite ? null : Number(effect.parameters.turns);
    for (const target of targets) {
      next = applyStatus(next, String(effect.parameters.status_id), target.key, context, duration);
    }
    return next;
  }
  if (key === "stat_modifier@1" || key === "stat_modifier@2") {
    let current = next;
    for (const original of targets) {
      const before = findUnit(current, original.key)!;
      const modifier: CombatModifier = {
        instanceId: `${context.sourceOwnerType}:${context.sourceOwnerId}:${effect.id}:${original.key}:${state.turn}:${current.modifiers.length}`,
        holderKey: original.key,
        sourceOwnerType: context.sourceOwnerType,
        sourceOwnerId: context.sourceOwnerId,
        sourceCritterKey: context.sourceCritterKey,
        statusInstanceId: context.statusInstanceId,
        retainedAfterStatusRemoval: false,
        conditionalParentInstanceId: context.conditionalParentInstanceId,
        effect: cloneEffect(effect),
      };
      current = recomputeCombatStats({ ...current, modifiers: [...current.modifiers, modifier] });
      const after = findUnit(current, original.key)!;
      const rawStat = String(effect.parameters.stat);
      const stat = ({ block_cost: "blockCost", swap_cost: "swapCost", relic_slots: "relicSlots", mana_dice_min: "diceMin", mana_dice_max: "diceMax" } as Record<string, keyof StatBlock>)[rawStat]
        ?? (rawStat in before.stats ? rawStat as keyof StatBlock : undefined);
      const delta = stat ? after.stats[stat] - before.stats[stat] : Number(effect.parameters.amount ?? 0);
      const statName = String(effect.parameters.stat).replace(/_/g, " ").toUpperCase();
      const changeLabel = stat
        ? String(delta)
        : effect.parameters.value_mode === "percentage"
          ? `${Number(effect.parameters.amount ?? 0) * 100}%`
          : String(delta);
      const sourceName = effectSourceName(current, context.sourceOwnerType, context.sourceOwnerId, effect.name);
      const message = delta > 0
        ? `${combatantName(after)} gained +${changeLabel} ${statName} from ${sourceName}.`
        : delta < 0
          ? `${combatantName(after)} lost −${changeLabel.replace(/^-/, "")} ${statName} from ${sourceName}.`
          : `${combatantPossessive(after)} ${statName} was unchanged by ${sourceName}.`;
      current = appendPresentationEvent(
        { ...current, log: [message, ...current.log] },
        { kind: "status", message, actorKey: context.sourceCritterKey, targetKeys: [original.key], hpChanges: [] },
      );
    }
    return current;
  }
  throw new Error(`Unsupported effect runtime: ${key}`);
}

function resolveReactiveEffects(
  state: CombatState,
  eventType: string,
  attacker: CombatUnit,
  defender: CombatUnit,
  attempted: number,
  hpDamage: number,
  shieldDamage: number,
): CombatState {
  let next = state;
  for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "reactive_trigger" || candidate.runtimeKind === "retaliation" || candidate.runtimeKind === "direct_health_modifier")) {
    const parent = effectForReference(next, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
    if (!parent) continue;
    const p = parent.parameters;
    const isAttackRetaliation = instance.runtimeKind === "direct_health_modifier";
    if (isAttackRetaliation && !["attacker", "attacker_and_targets"].includes(String(p.target))) continue;
    if (isAttackRetaliation && instance.sourceCritterKey !== defender.key) continue;
    const trigger = instance.runtimeKind === "retaliation" ? String(p.trigger_condition ?? "hit") : String(p.trigger_event ?? "owner_hp_damaged");
    const isDefeatTrigger = trigger === "owner_defeats_enemy";
    if (isDefeatTrigger) {
      const source = instance.sourceCritterKey ? findUnit(next, instance.sourceCritterKey) : undefined;
      const ownerSide = source?.side ?? (instance.sourceOwnerType === "ability" ? "player" : attacker.side);
      if (eventType !== "owner_defeats_enemy" || attacker.side !== ownerSide || defender.side === ownerSide) continue;
    } else {
      const watched = effectTargets(next, String(p.target ?? ""), {
        sourceOwnerType: instance.sourceOwnerType,
        sourceOwnerId: instance.sourceOwnerId,
        sourceSide: instance.sourceSide,
        sourceCritterKey: instance.sourceCritterKey,
        skillTargetKeys: [defender.key],
        attackerKey: attacker.key,
        defenderKey: defender.key,
        elementIds: targetElementIds(parent),
        tagIds: targetCritterTagIds(parent),
      });
      const watchedKey = isAttackRetaliation ? attacker.key : defender.key;
      if (!watched.some((unit) => unit.key === watchedKey)) continue;
    }
    if (p.activation_limit !== undefined && p.activation_limit !== null && instance.activationCount >= Number(p.activation_limit)) continue;
    const currentDefender = findUnit(next, defender.key) ?? defender;
    const matches = isAttackRetaliation
      ? eventType === "owner_attacked"
      : instance.runtimeKind === "retaliation"
        ? ["attacked", "hit", "hp_damaged"].includes(trigger) && currentDefender.hp > 0
        : trigger === "owner_defeats_enemy"
          ? eventType === "owner_defeats_enemy"
          : trigger === "owner_attacked"
          ? eventType === "owner_attacked"
          : trigger === "owner_hp_damaged"
            ? hpDamage > 0
            : trigger === "owner_shield_hit"
              ? shieldDamage > 0
              : trigger === "owner_shield_breaks"
                ? currentDefender.shield <= 0 && shieldDamage > 0
                : trigger === eventType;
    if (!matches) continue;
    if (p.requires_hp_damage === true && hpDamage <= 0) continue;
    if (p.requires_shield_damage === true && shieldDamage <= 0) continue;
    if (Number(p.minimum_damage ?? 0) > Math.max(hpDamage, shieldDamage)) continue;
    const chance = rollChance(next, p.activation_chance === undefined || p.activation_chance === null ? 1 : Number(p.activation_chance));
    next = chance.state;
    if (!chance.activated) continue;
    next = {
      ...next,
      runtimeEffects: next.runtimeEffects.map((candidate) => candidate.instanceId === instance.instanceId
        ? { ...candidate, activationCount: candidate.activationCount + 1 }
        : candidate),
    };
    if (isAttackRetaliation) {
      next = resolveEffect(next, parent, {
        sourceOwnerType: instance.sourceOwnerType,
        sourceOwnerId: instance.sourceOwnerId,
        sourceSide: instance.sourceSide,
        sourceCritterKey: instance.sourceCritterKey,
        skillTargetKeys: p.target === "attacker_and_targets" ? [defender.key] : [attacker.key],
        attackerKey: attacker.key,
        defenderKey: defender.key,
        damageAttempted: attempted,
        hpDamage,
        shieldDamage,
        eventType,
        resolutionDepth: 1,
        activationAlreadyRolled: true,
      });
      continue;
    }
    const targetKeys = instance.runtimeKind === "retaliation" ? [attacker.key] : [defender.key];
    const childIds = p.child_effect_ids;
    next = resolveChildEffects(next, parent, {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceSide: instance.sourceSide,
      sourceCritterKey: instance.sourceCritterKey,
      skillTargetKeys: targetKeys,
      attackerKey: attacker.key,
      defenderKey: defender.key,
      damageAttempted: attempted,
      hpDamage,
      shieldDamage,
      eventType,
      resolutionDepth: 1,
    }, childIds);
  }
  return next;
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
  const holderStatusIndex = state.statuses.findIndex((item) => item.holderKey === holderKey);
  // Status exclusivity is evaluated at the instant the application resolves.
  // A cure earlier in the same action sequence therefore opens the slot for a
  // later application, while an existing different Status blocks it.
  if (holderStatusIndex >= 0 && state.statuses[holderStatusIndex].statusId !== statusId) return state;
  const existingIndex = holderStatusIndex;
  let statuses = [...state.statuses];
  const instanceId = existingIndex >= 0 ? statuses[existingIndex].instanceId : `${statusId}:${holderKey}`;
  if (existingIndex >= 0) {
    statuses[existingIndex] = {
      ...statuses[existingIndex],
      duration,
      turnsElapsed: 0,
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
      turnsElapsed: 0,
      sourceOwnerType: context.sourceOwnerType,
      sourceOwnerId: context.sourceOwnerId,
      sourceCritterKey: context.sourceCritterKey,
      effects: state.runEffects.status[statusId] ?? [],
    });
  }
  const holder = findUnit(state, holderKey);
  const source = context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined;
  const sourceSide = source?.side ?? context.sourceSide ?? (context.sourceOwnerType === "ability" ? "player" : "opponent");
  const sourceName = effectSourceName(state, context.sourceOwnerType, context.sourceOwnerId, status.name);
  const classification = statusClassification(state.runEffects.status[statusId] ?? []);
  const holderName = holder ? combatantName(holder) : holderKey;
  const message = classification === "negative"
    ? `${holderName} was afflicted with ${status.name} from ${sourceName}.`
    : classification === "positive"
      ? `${holderName} gained ${status.name} from ${sourceName}.`
      : `${holderName} received ${status.name} from ${sourceName}.`;
  let next = appendPresentationEvent(
    recomputeCombatStats({
      ...state,
      statuses,
      modifiers: state.modifiers.filter((modifier) => modifier.statusInstanceId !== instanceId),
      log: [message, ...state.log],
    }),
    {
      kind: "status",
      effectPolarity: classification === "negative" ? "negative" : "positive",
      message,
      actorKey: context.sourceCritterKey,
      targetKeys: [holderKey],
      hpChanges: [],
    },
  );
  if (existingIndex < 0 && sourceSide === "player" && holder) {
    next = appendProgressEvent(next, {
      event_type: "status_afflicted",
      source_critter_id: source?.critter.id ?? null,
      target_critter_id: holder.critter.id,
      skill_id: context.sourceOwnerType === "skill" ? context.sourceOwnerId : null,
      amount: 1,
      payload: {
        fresh: true,
        status_ids: [statusId],
        target_side: holder.side,
        source_side: sourceSide,
        source_critter_tag_ids: source ? critterTagIds(source.critter) : [],
        target_critter_tag_ids: critterTagIds(holder.critter),
        skill_tag_ids: context.sourceOwnerType === "skill" ? state.catalog.skills.find((skill) => skill.id === context.sourceOwnerId)?.tag_ids ?? [] : [],
      },
    });
  }
  for (const effect of state.runEffects.status[statusId] ?? []) {
    if (effect.execution === "child") continue;
    const statusContext: RuntimeContext = { sourceOwnerType: "status", sourceOwnerId: statusId, sourceCritterKey: holderKey, statusHolderKey: holderKey, statusInstanceId: instanceId, skillTargetKeys: [holderKey] };
    if (["damage_over_time", "skip_action_chance"].includes(effect.runtimeKind)) continue;
    if (effect.runtimeKind === "stat_modifier" && effect.parameters.application_mode === "incremental") continue;
    if (effect.runtimeKind === "delayed_effect") next = resolveEffect(next, effect, statusContext);
    else if (["reactive_trigger", "retaliation", "damage_modifier", "damage_prevention", "action_cost_modifier", "effect_immunity", "effect_amplification", "repeating_effect"].includes(effect.runtimeKind)) next = addRuntimeEffect(next, effect, statusContext);
    else next = resolveEffect(next, effect, statusContext);
  }
  return next;
}

function resolveTimedEffects(state: CombatState, timing: "start_of_turn" | "end_of_turn"): CombatState {
  let next = timing === "start_of_turn"
    ? advanceDelayedEffects(state, { delayType: "turns", timing: "start_of_turn" })
    : state;
  for (const instance of state.statuses) {
    if (timing === "start_of_turn" && instance.duration !== null) {
      const holder = findUnit(next, instance.holderKey);
      const status = next.statusRegistry[instance.statusId];
      if (holder?.active && holder.hp > 0 && status) {
        const remaining = Math.max(0, Number(instance.duration));
        const message = `${combatantName(holder)} is affected by ${status.name}; ${remaining} turn${remaining === 1 ? "" : "s"} remain.`;
        const classification = statusClassification(instance.effects);
        next = appendPresentationEvent(
          { ...next, log: [message, ...next.log] },
          {
            kind: "status",
            effectPolarity: classification === "negative" ? "negative" : "positive",
            message,
            actorKey: instance.sourceCritterKey,
            targetKeys: [instance.holderKey],
            hpChanges: [],
          },
        );
      }
    }
    for (const effect of instance.effects) {
      if (effect.runtimeKind !== "damage_over_time" || effect.parameters.timing !== timing) continue;
      const holder = findUnit(next, instance.holderKey);
      if (!holder || !holder.active || holder.hp <= 0) continue;
      const targets = effectTargets(next, String(effect.parameters.target), {
        sourceOwnerType: "status",
        sourceOwnerId: instance.statusId,
        statusHolderKey: instance.holderKey,
      });
      for (const original of targets) {
        const chance = rollChance(next, Number(effect.parameters.chance));
        next = chance.state;
        if (!chance.activated) continue;
        const target = findUnit(next, original.key);
        if (!target) continue;
        const raw = effect.parameters.value_mode === "percent_max_hp"
          ? target.maxHp * Number(effect.parameters.amount ?? 0)
          : Number(effect.parameters.amount ?? 0);
        const damage = Math.max(0, roundHalfUp(raw));
        const actualDamage = Math.min(target.hp, damage);
        const afterHp = Math.max(0, target.hp - damage);
        const message = `${combatantName(target)} took ${actualDamage} damage from ${effect.name}.`;
        next = appendPresentationEvent(
          recomputeCombatStats(updateUnit(next, target.key, (unit) => ({ ...unit, hp: afterHp }), message)),
          {
            kind: "damage",
            message,
            actorKey: instance.sourceCritterKey,
            targetKeys: [target.key],
            hpChanges: [{ unitKey: target.key, before: target.hp, after: afterHp }],
          },
        );
        const source = instance.sourceCritterKey ? findUnit(next, instance.sourceCritterKey) : undefined;
        if (source) next = appendDamageProgressEvents(next, source, target, actualDamage, target.hp - actualDamage <= 0);
      }
    }
    const turnsElapsed = Number(instance.turnsElapsed ?? 0);
    const tickNumber = turnsElapsed + 1;
    const holder = findUnit(next, instance.holderKey);
    if (holder?.active && holder.hp > 0) {
      for (const effect of instance.effects) {
        if (effect.runtimeKind !== "stat_modifier" || effect.parameters.application_mode !== "incremental" || effect.parameters.timing !== timing) continue;
        const spacing = Math.max(1, Number(effect.parameters.spacing ?? 1));
        if (tickNumber % spacing !== 0) continue;
        next = resolveEffect(next, effect, {
          sourceOwnerType: "status",
          sourceOwnerId: instance.statusId,
          sourceCritterKey: instance.holderKey,
          statusHolderKey: instance.holderKey,
          statusInstanceId: instance.instanceId,
          skillTargetKeys: [instance.holderKey],
        });
      }
    }
  }
  if (timing === "end_of_turn") {
    const statusesByHolder = new Map<string, { holder: CombatUnit; statusIds: string[] }>();
    for (const instance of next.statuses) {
      const holder = findUnit(next, instance.holderKey);
      if (!holder || !holder.active || holder.hp <= 0) continue;
      const current = statusesByHolder.get(holder.key) ?? { holder, statusIds: [] };
      if (!current.statusIds.includes(instance.statusId)) current.statusIds.push(instance.statusId);
      statusesByHolder.set(holder.key, current);
    }
    for (const { holder, statusIds } of statusesByHolder.values()) {
      next = appendProgressEvent(next, {
        event_type: "status_turn_completed",
        source_critter_id: null,
        target_critter_id: holder.critter.id,
        skill_id: null,
        amount: 1,
        payload: { status_ids: statusIds, target_side: holder.side },
      });
    }
  }
  if (timing === "end_of_turn") {
    next = advanceDelayedEffects(next, { delayType: "turns", timing: "end_of_turn" });
    next = advanceDelayedEffects(next, { delayType: "rounds", timing: "end_of_turn" });
  }
  const scheduled = [...next.runtimeEffects];
  for (const instance of scheduled) {
    if (instance.runtimeKind === "delayed_effect") continue;
    if (instance.remaining === undefined || instance.remaining > 0) continue;
    const parent = effectForReference(next, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
    if (!parent) continue;
    const context: RuntimeContext = {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceSide: instance.sourceSide,
      sourceCritterKey: instance.sourceCritterKey,
      skillTargetKeys: instance.targetCritterKey ? [instance.targetCritterKey] : undefined,
      parentInstanceId: instance.instanceId,
    };
    next = resolveChildEffects(next, parent, context, parent.parameters.child_effect_ids);
    if (parent.runtimeKind === "repeating_effect" || parent.parameters.repeat === true) {
      next = { ...next, runtimeEffects: next.runtimeEffects.map((candidate) => candidate.instanceId === instance.instanceId ? { ...candidate, remaining: Number(parent.parameters.repeat_interval ?? 1), activationCount: candidate.activationCount + 1 } : candidate) };
    } else {
      next = { ...next, runtimeEffects: next.runtimeEffects.filter((candidate) => candidate.instanceId !== instance.instanceId) };
    }
  }
  if (timing === "end_of_turn") {
    next = {
      ...next,
      runtimeEffects: next.runtimeEffects
        .map((instance) => {
          if (instance.remaining === undefined) return instance;
          if (instance.runtimeKind === "delayed_effect") return instance;
          const parameters = instance.state.parameters as Record<string, unknown> | undefined;
          if (String(parameters?.duration_clock ?? "global_round") === "target_turn") return instance;
          return { ...instance, remaining: instance.remaining - 1 };
        })
        .filter((instance) => instance.remaining === undefined || instance.remaining > 0),
    };
  }
  if (timing === "end_of_turn") {
    const expiredStatusIds = new Set(
      next.statuses
        .filter((item) => item.duration !== null && Number(item.duration) <= 1)
        .map((item) => item.instanceId),
    );
    next = {
      ...next,
      statuses: next.statuses
        .map((item) => item.duration === null
          ? { ...item, turnsElapsed: Number(item.turnsElapsed ?? 0) + 1 }
          : { ...item, duration: item.duration - 1, turnsElapsed: Number(item.turnsElapsed ?? 0) + 1 })
        .filter((item) => item.duration === null || item.duration > 0),
      modifiers: next.modifiers.flatMap((modifier) => {
        if (!modifier.statusInstanceId || !expiredStatusIds.has(modifier.statusInstanceId)) return [modifier];
        const persists = modifier.effect.runtimeKind === "stat_modifier"
          && modifier.effect.parameters.application_mode === "incremental"
          && modifier.effect.parameters.removal_behavior === "keep_after_removal";
        return persists
          ? [{ ...modifier, statusInstanceId: undefined, retainedAfterStatusRemoval: true }]
          : [];
      }),
    };
  }
  const conditionalTiming: ConditionalRefreshTiming = timing === "start_of_turn" ? "turn_start" : "turn_end";
  return recomputeCombatStats(refreshConditionalSetupEffects(next, {}, conditionalTiming));
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

function swapCombatUnitByKey(state: CombatState, actorKey: string, swapTargetKey: string): CombatState {
  const actor = findUnit(state, actorKey);
  if (!actor || actor.hp <= 0) return state;
  const sideUnits = actor.side === "player" ? state.playerUnits : state.opponentUnits;
  const activeIndex = sideUnits.findIndex((unit) => unit.key === actorKey && unit.active && unit.hp > 0);
  const benchIndex = sideUnits.findIndex((unit) => unit.key === swapTargetKey && !unit.active && unit.hp > 0);
  if (activeIndex < 0 || benchIndex < 0) return state;
  const battlefieldSlot = sideUnits[activeIndex].battlefieldSlot;
  if (battlefieldSlot === null) return state;

  const units = sideUnits.map((unit, index) => {
    if (index === activeIndex) return { ...unit, active: false, battlefieldSlot: null };
    if (index === benchIndex) return { ...unit, active: true, battlefieldSlot };
    return unit;
  });

  const message = actor.side === "player"
    ? `You sent in ${sideUnits[benchIndex].name}.`
    : `The enemy sent out ${sideUnits[benchIndex].name}.`;
  let next: CombatState = {
    ...state,
    playerUnits: actor.side === "player" ? units : state.playerUnits,
    opponentUnits: actor.side === "opponent" ? units : state.opponentUnits,
    log: [message, ...state.log],
  };
  next = recomputeCombatStats(next);
  // Formation changes immediately change which equipped Relic/Ability roots
  // are active, so refresh runtime instances before the next action stage.
  next = refreshSetupRuntimeEffects(next);
  return appendPresentationEvent(next, {
    kind: "swap",
    message,
    actorKey,
    targetKeys: [sideUnits[benchIndex].key],
    swap: {
      outgoingKey: sideUnits[activeIndex].key,
      incomingKey: sideUnits[benchIndex].key,
      battlefieldSlot,
    },
    hpChanges: [],
  });
}

function resolvePostTurn(state: CombatState): CombatState {
  const next = resolveTimedEffects(state, "end_of_turn");
  return { ...next, log: ["Post-turn effects resolved.", ...next.log] };
}

export function elementEffectiveness(
  catalog: Pick<Catalog, "elementEffectiveness">,
  attackingElementId: string,
  defender: Pick<Critter, "element_1_id" | "element_2_id">,
): number {
  const multiplierFor = (defendingElementId: string) => {
    const cell = catalog.elementEffectiveness.find(
      (row) => row.attacking_element_id === attackingElementId
        && row.defending_element_id === defendingElementId,
    );
    if (!cell) {
      throw new Error(`Element Chart is missing ${attackingElementId} → ${defendingElementId}.`);
    }
    return Number(cell.multiplier);
  };
  return multiplierFor(defender.element_1_id)
    * (defender.element_2_id ? multiplierFor(defender.element_2_id) : 1);
}

export function classifyEffectiveness(multiplier: number): {
  classification: EffectivenessClass;
  suffix: string;
} {
  if (Math.abs(multiplier - 1) <= 1e-6) return { classification: "neutral", suffix: "" };
  if (multiplier >= 2) {
    return {
      classification: "extra-effective",
      suffix: "It was an extra effective skill!",
    };
  }
  if (multiplier > 1) {
    return {
      classification: "effective",
      suffix: "It was an effective skill!",
    };
  }
  if (multiplier > 0.5) {
    return {
      classification: "resisted",
      suffix: "It was a resisted skill.",
    };
  }
  return {
    classification: "extra-resisted",
    suffix: "It was an extra resisted skill.",
  };
}

export function calculateSkillDamage(
  catalog: Pick<Catalog, "elementEffectiveness">,
  attacker: CombatUnit,
  defender: CombatUnit,
  skill: Skill,
  random: () => number = () => 1,
  targetCount = 1,
): SkillDamage {
  if (skill.skill_type !== "attack" || skill.power <= 0) {
    return {
      damage: 0,
      maxDamage: 0,
      damageRollPercent: DAMAGE_ROLL_MAX_PERCENT,
      targetCount: 1,
      spreadMultiplier: 1,
      effectiveness: 1,
      classification: "neutral",
      suffix: "",
      stab: false,
    };
  }
  const stab = critterHasElement(attacker.critter, skill.element_id);
  const effectivePower = skill.power * (stab ? 1.5 : 1);
  const effectiveness = elementEffectiveness(catalog, skill.element_id, defender.critter);
  const resolvedTargetCount = Math.max(1, Math.floor(Number(targetCount) || 1));
  const spreadMultiplier = resolvedTargetCount > 1 ? MULTI_TARGET_DAMAGE_MULTIPLIER : 1;
  const rawDamage = (((((2 * attacker.level) / 5 + 2) * effectivePower * attacker.stats.atk) / defender.stats.def) / 50 + 2)
    * effectiveness
    * spreadMultiplier;
  const minimum = effectiveness === 0 ? 0 : 1;
  const maxDamage = Math.max(minimum, Math.floor(rawDamage));
  const damageRollPercent = rollDamagePercent(random);
  const damage = maxDamage === 0
    ? 0
    : Math.max(minimum, Math.floor((maxDamage * damageRollPercent) / 100));
  return {
    damage,
    maxDamage,
    damageRollPercent,
    targetCount: resolvedTargetCount,
    spreadMultiplier,
    effectiveness,
    ...classifyEffectiveness(effectiveness),
    stab,
  };
}

export const DAMAGE_ROLL_MIN_PERCENT = 85;
export const DAMAGE_ROLL_MAX_PERCENT = 100;
export const MULTI_TARGET_DAMAGE_MULTIPLIER = 0.75;

/**
 * Roll the percentage of a Skill's calculated maximum damage to apply.
 * The upper bound is inclusive, so a 100% roll always means max damage.
 */
export function rollDamagePercent(random: () => number = Math.random): number {
  const value = Number(random());
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5;
  return DAMAGE_ROLL_MIN_PERCENT + Math.floor(normalized * (DAMAGE_ROLL_MAX_PERCENT - DAMAGE_ROLL_MIN_PERCENT + 1));
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

function clearBlockStreak(state: CombatState, key: string): CombatState {
  const clear = (unit: CombatUnit) => unit.key === key
    ? { ...unit, blocking: false, blockStreak: 0 }
    : unit;
  return {
    ...state,
    playerUnits: state.playerUnits.map(clear),
    opponentUnits: state.opponentUnits.map(clear),
  };
}

function appendPresentationEvent(
  state: CombatState,
  event: CombatPresentationEvent,
): CombatState {
  const units = [...state.playerUnits, ...state.opponentUnits];
  return {
    ...state,
    presentationEvents: [...state.presentationEvents, {
      ...event,
      state: {
        playerMana: state.playerMana,
        opponentMana: state.opponentMana,
        units: units.map((unit) => ({
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
        statuses: structuredClone(state.statuses),
        modifiers: structuredClone(state.modifiers),
        runtimeEffects: structuredClone(state.runtimeEffects),
      },
    }],
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
  skill?: Skill,
): CombatState {
  if (actualDamage <= 0 || source.side === target.side) return state;
  let next = state;
  if (source.side === "player" && target.side === "opponent") {
    next = appendProgressEvent(next, {
      event_type: "hp_damage_dealt",
      source_critter_id: source.critter.id,
      target_critter_id: target.critter.id,
      skill_id: skill?.id ?? null,
      amount: actualDamage,
      payload: { source_element_ids: critterElementIds(source.critter), target_element_ids: critterElementIds(target.critter), source_critter_tag_ids: critterTagIds(source.critter), target_critter_tag_ids: critterTagIds(target.critter), skill_tag_ids: skill?.tag_ids ?? [] },
    });
    if (knockedOut) {
      next = appendProgressEvent(next, {
        event_type: "critter_knocked_out",
        source_critter_id: source.critter.id,
        target_critter_id: target.critter.id,
        skill_id: skill?.id ?? null,
        amount: 1,
        payload: { source_element_ids: critterElementIds(source.critter), source_critter_tag_ids: critterTagIds(source.critter), target_element_ids: critterElementIds(target.critter), target_critter_tag_ids: critterTagIds(target.critter), skill_tag_ids: skill?.tag_ids ?? [] },
      });
    }
  } else if (source.side === "opponent" && target.side === "player") {
    next = appendProgressEvent(next, {
      event_type: "hp_damage_taken",
      source_critter_id: source.critter.id,
      target_critter_id: target.critter.id,
      skill_id: skill?.id ?? null,
      amount: actualDamage,
      payload: { source_element_ids: critterElementIds(source.critter), target_element_ids: critterElementIds(target.critter), source_critter_tag_ids: critterTagIds(source.critter), target_critter_tag_ids: critterTagIds(target.critter), skill_tag_ids: skill?.tag_ids ?? [] },
    });
  }
  return next;
}

function findUnit(state: CombatState, key: string): CombatUnit | undefined {
  return [...state.playerUnits, ...state.opponentUnits].find((unit) => unit.key === key);
}

function combatantName(unit: CombatUnit, sentenceStart = true): string {
  const owner = unit.side === "player"
    ? sentenceStart ? "Your" : "your"
    : sentenceStart ? "The enemy" : "the enemy";
  return `${owner} ${unit.name}`;
}

function combatantPossessive(unit: CombatUnit): string {
  return `${combatantName(unit)}'s`;
}

function effectSourceName(state: CombatState, ownerType: EffectOwnerType, ownerId: string, fallback: string): string {
  if (ownerType === "skill") return byId(state.catalog.skills, ownerId)?.name ?? fallback;
  if (ownerType === "ability") return byId(state.catalog.rollcasterAbilities, ownerId)?.name ?? fallback;
  if (ownerType === "relic") return byId(state.catalog.relics, ownerId)?.name ?? fallback;
  return state.statusRegistry[ownerId]?.name ?? fallback;
}

function speedFor(state: CombatState, key: string): number {
  return findUnit(state, key)?.stats.spd ?? 0;
}

export function rollManaDie(min: number, max: number, random: () => number = Math.random): number {
  const { diceMin: lower, diceMax: upper } = normalizeManaDiceBounds(min, max, Math.floor);
  return lower + Math.floor(random() * (upper - lower + 1));
}

function rollManaDieSeeded(min: number, max: number, rngState: number): { value: number; state: number } {
  const roll = nextRandom(rngState);
  return { value: rollManaDie(min, max, () => roll.value), state: roll.state };
}
