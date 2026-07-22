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

export type RuntimeEffectInstance = {
  instanceId: string;
  sourceEffectId: string;
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
  targetCritterKey?: string;
  runtimeKind: string;
  runtimeVersion: number;
  classification?: "positive" | "negative" | "mixed";
  appliedAtSequence: number;
  remaining?: number;
  activationCount: number;
  state: Record<string, unknown>;
};

export type CombatModifier = {
  instanceId: string;
  holderKey: string;
  sourceOwnerType: EffectOwnerType;
  sourceOwnerId: string;
  sourceCritterKey?: string;
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
  kind: "skill" | "damage" | "heal" | "swap" | "block" | "wait" | "status" | "other";
  message: string;
  actorKey?: string;
  targetKeys: string[];
  skillId?: string;
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
  presentationEvents: CombatPresentationEvent[];
  runtimeEffects: RuntimeEffectInstance[];
  effectSequence: number;
};

export type EffectivenessClass =
  | "extra-effective"
  | "effective"
  | "neutral"
  | "resisted"
  | "extra-resisted";

export type SkillDamage = {
  damage: number;
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
  seedKey = runId,
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
    runtimeEffects: [],
    effectSequence: 0,
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
    sourceCritterKey: context.sourceCritterKey,
    targetCritterKey: context.skillTargetKeys?.[0],
    runtimeKind: effect.runtimeKind,
    runtimeVersion: effect.runtimeVersion,
    classification: effect.classification,
    appliedAtSequence: sequence,
    remaining,
    activationCount: 0,
    state: stateData,
  };
  return { ...state, effectSequence: sequence, runtimeEffects: [...state.runtimeEffects, instance] };
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

function installRootEffects(state: CombatState): CombatState {
  let next = state;
  for (const source of activeSetupSources(state)) {
    for (const effect of source.effects) {
      if (effect.execution === "child") continue;
      const context: RuntimeContext = {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceCritterKey: source.sourceKey,
      };
      if (effect.runtimeKind === "shield_modifier") next = resolveEffect(next, effect, context);
      else if (["reactive_trigger", "retaliation", "repeating_effect", "delayed_effect", "conditional_effect", "effect_duration", "effect_immunity", "damage_modifier", "damage_prevention", "action_cost_modifier"].includes(effect.runtimeKind)) {
        next = addRuntimeEffect(next, effect, context, { sourceOrder: source.sourceOrder });
      }
    }
  }
  return next;
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

export function recomputeCombatStats(state: CombatState): CombatState {
  const effectsByTarget = new Map<string, ResolvedEffectRef[]>();
  for (const source of activeSetupSources(state)) {
    for (const effect of source.effects) {
      assertEffectContract(effect, source.ownerType);
      if (effect.execution === "child") continue;
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
    const stats = applyStatEffects(persistentStats, modifierEffects, persistentStats);
    const hp = Math.min(stats.hp, Math.max(0, unit.hp + Math.max(0, stats.hp - unit.maxHp)));
    const maxShield = Math.max(0, unit.maxShield);
    return { ...unit, persistentStats, stats, maxHp: stats.hp, hp, maxShield, shield: Math.min(maxShield, unit.shield) };
  };
  return { ...state, playerUnits: state.playerUnits.map(apply), opponentUnits: state.opponentUnits.map(apply) };
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
      classification: effect.classification ?? (amountLabel?.startsWith("−") ? "negative" : amountLabel?.startsWith("+") ? "positive" : "mixed"),
      sourceOwnerType,
      sourceOwnerId,
      duration,
    });
  };

  let persistent = { ...unit.baseStats };
  for (const source of activeSetupSources(state)) {
    for (const effect of source.effects) {
      if (effect.execution === "child") continue;
      const targets = effectTargets(state, String(effect.parameters.target ?? ""), {
        sourceOwnerType: source.ownerType,
        sourceOwnerId: source.ownerId,
        sourceCritterKey: source.sourceKey,
        elementIds: Array.isArray(effect.parameters.element_ids)
          ? effect.parameters.element_ids.filter((id): id is string => typeof id === "string")
          : undefined,
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
      const targets = effectTargets(state, String(effect.parameters.target ?? ""), {
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
    const applies = instance.targetCritterKey === unitKey || (!instance.targetCritterKey && effectTargets(state, String(effect.parameters.target ?? ""), {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceCritterKey: instance.sourceCritterKey,
      skillTargetKeys: instance.targetCritterKey ? [instance.targetCritterKey] : undefined,
    }).some((target) => target.key === unitKey));
    if (applies) addEffect(effect, instance.sourceOwnerType, instance.sourceOwnerId, instance.instanceId, undefined, undefined, instance.remaining);
  }

  return rows;
}

function combatEffectAmountLabel(effect: ResolvedEffectRef, unit: CombatUnit, before?: StatBlock, after?: StatBlock): string | null {
  if (before && after && (effect.runtimeKind === "stat_modifier" || effect.runtimeKind === "stat_modifier_v2" || effect.runtimeKind === "mana_dice_modifier")) {
    const statLabels: Array<[keyof StatBlock, string]> = effect.runtimeKind === "mana_dice_modifier"
      ? [["diceMin", "MIN MANA"], ["diceMax", "MAX MANA"]]
      : [[({ block_cost: "blockCost", swap_cost: "swapCost", relic_slots: "relicSlots" } as Record<string, keyof StatBlock>)[String(effect.parameters.stat)] ?? String(effect.parameters.stat) as keyof StatBlock, String(effect.parameters.stat).replace(/_/g, " ").toUpperCase()]];
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
      const stat = ({ block_cost: "blockCost", swap_cost: "swapCost", relic_slots: "relicSlots" } as Record<string, keyof StatBlock>)[String(effect.parameters.stat)] ?? String(effect.parameters.stat) as keyof StatBlock;
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

  const rolledState: CombatState = {
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
  let withDice = rolledState;
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
  const normalizedActions = actions.map((action) => ({ ...action, cost: calculateActionCost(state, action) }));
  const cost = normalizedActions.reduce((sum, action) => sum + action.cost, 0);
  if (cost > state.playerMana) return state;

  let next: CombatState = {
    ...state,
    playerMana: state.playerMana - cost,
    log: [`Submitted actions for ${cost} mana.`, ...state.log],
    presentationEvents: [],
  };

  const enemyActions = chooseEnemyActions(next);
  const enemyCost = enemyActions.reduce((sum, action) => sum + action.cost, 0);
  next = {
    ...next,
    opponentMana: Math.max(0, next.opponentMana - enemyCost),
  };

  const allActions = [...normalizedActions, ...enemyActions].map((action) => prepareActionTarget(next, action));
  next = resolveActionStage(next, allActions, "swap");
  next = resolveActionStage(next, allActions, "block");
  next = resolveActionStage(next, allActions, "skip");
  next = resolveActionStage(next, allActions, "skill");
  next = resolvePostTurn(next);

  const playerAlive = next.playerUnits.some((unit) => unit.hp > 0);
  const opponentsAlive = next.opponentUnits.some((unit) => unit.hp > 0);
  if (!playerAlive || !opponentsAlive) {
    const outcome = playerAlive ? "won" : "lost";
    const completed = playerAlive ? appendProgressEvent(next, {
      event_type: "battle_completed",
      source_critter_id: null,
      target_critter_id: null,
      skill_id: null,
      amount: playerAlive ? 1 : 0,
      payload: {
        won: playerAlive,
        squad: next.playerUnits.map((unit) => ({ critter_id: unit.critter.id, element_ids: critterElementIds(unit.critter), survived: unit.hp > 0 })),
        survivors_complete: next.playerUnits.filter((unit) => unit.active).every((unit) => unit.hp > 0),
      },
    }) : next;
    return { ...completed, phase: outcome, log: [playerAlive ? "Dungeon cleared." : "Defeat.", ...completed.log] };
  }

  return { ...next, turn: next.turn + 1, phase: "ready" };
}

function calculateActionCost(state: CombatState, action: CombatAction): number {
  const actor = findUnit(state, action.actorKey);
  if (!actor) return Math.max(0, action.cost);
  let cost = action.type === "skill" && action.skillId
    ? actor.skills.find((skill) => skill.id === action.skillId)?.mana_cost ?? action.cost
    : action.type === "block" ? actor.stats.blockCost
      : action.type === "swap" ? actor.stats.swapCost
        : 0;
  const effects = state.runtimeEffects.filter((instance) => instance.runtimeKind === "action_cost_modifier");
  for (const instance of effects) {
    const p = instance.state.parameters as Record<string, unknown> | undefined;
    if (!p) continue;
    const applicable = String(p.applicable_action ?? "all_actions");
    const costType = String(p.cost_type ?? "other");
    if (costType === "skill_mana" && action.type !== "skill") continue;
    if (costType === "block" && action.type !== "block") continue;
    if (costType === "swap" && action.type !== "swap") continue;
    if (applicable === "specific_skills" && (!action.skillId || !Array.isArray(p.skill_ids) || !p.skill_ids.includes(action.skillId))) continue;
    const value = Number(p.modifier_value ?? 0);
    if (p.modifier_type === "percentage") cost += roundHalfUp(cost * value);
    else if (p.modifier_type === "set") cost = value;
    else if (p.modifier_type === "minimum") cost = Math.max(cost, value);
    else if (p.modifier_type === "maximum") cost = Math.min(cost, value);
    else cost += value;
  }
  return Math.max(0, roundHalfUp(cost));
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

  return ordered.reduce(
    (current, action) => recomputeCombatStats(resolveAction(current, action)),
    { ...state, rngState },
  );
}

function prepareActionTarget(state: CombatState, action: CombatAction): CombatAction {
  if (!action.targetKey || action.targetSlotIndex !== undefined) return action;
  const target = findUnit(state, action.targetKey);
  if (!target || target.battlefieldSlot === null) return action;
  return { ...action, targetSlotSide: target.side, targetSlotIndex: target.battlefieldSlot };
}

function resolveIncomingDamage(
  state: CombatState,
  attacker: CombatUnit,
  defender: CombatUnit,
  attempted: number,
): { state: CombatState; hpDamage: number; shieldDamage: number; finalDamage: number; blockPrevented: number } {
  let finalDamage = Math.max(0, attempted);
  const blockPrevented = defender.blocking && finalDamage > 0 ? Math.max(0, finalDamage - Math.max(1, Math.floor(finalDamage * 0.1))) : 0;
  if (defender.blocking && finalDamage > 0) finalDamage = Math.max(1, Math.floor(finalDamage * 0.1));
  for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "damage_modifier")) {
    const p = instance.state.parameters as Record<string, unknown>;
    if (p.direction === "dealt" && instance.sourceCritterKey !== attacker.key) continue;
    if (p.direction === "received" && instance.targetCritterKey !== defender.key) continue;
    if (p.applicable_source && !["attack", "skill", "any_damage"].includes(String(p.applicable_source))) continue;
    const value = Number(p.modifier_value ?? 0);
    finalDamage = p.modifier_type === "percentage" ? finalDamage + roundHalfUp(finalDamage * value) : finalDamage + value;
    if (p.minimum_final_damage !== undefined) finalDamage = Math.max(finalDamage, Number(p.minimum_final_damage));
    if (p.maximum_final_damage !== undefined) finalDamage = Math.min(finalDamage, Number(p.maximum_final_damage));
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
  next = resolveReactiveEffects(next, "owner_hp_damaged", attacker, defender, finalDamage, hpDamage, shieldDamage);
  return { state: next, hpDamage, shieldDamage, finalDamage, blockPrevented };
}

function resolveAction(state: CombatState, action: CombatAction): CombatState {
  const actor = findUnit(state, action.actorKey);
  if (!actor) return state;
  if (actor.hp <= 0) {
    const refund = Math.max(0, action.cost);
    const refundedState = refund === 0
      ? state
      : actor.side === "player"
        ? { ...state, playerMana: state.playerMana + refund }
        : { ...state, opponentMana: state.opponentMana + refund };
    const message = refund > 0
      ? `${combatantName(actor)} was knocked out before acting; ${refund} reserved mana was refunded.`
      : `${combatantName(actor)} was knocked out before acting; no mana was spent.`;
    return appendPresentationEvent(
      { ...refundedState, log: [message, ...refundedState.log] },
      { kind: "other", message, actorKey: actor.key, targetKeys: [], hpChanges: [] },
    );
  }
  if (!actor.active) return state;

  if (action.type !== "skip") {
    const skip = resolveSkipCheck(state, actor.key, action.type);
    state = skip.state;
    if (skip.skipped) {
    const message = `${combatantPossessive(actor)} ${action.type} was skipped by ${skip.effectName}; the reserved mana was spent.`;
      return appendPresentationEvent(
        { ...state, log: [message, ...state.log] },
        { kind: "status", message, actorKey: actor.key, targetKeys: [actor.key], hpChanges: [] },
      );
    }
  }

  if (action.type === "skip") {
    const message = `${combatantName(actor)} waits.`;
    return appendPresentationEvent(
      { ...state, log: [message, ...state.log] },
      { kind: "wait", message, actorKey: actor.key, targetKeys: [], hpChanges: [] },
    );
  }

  if (action.type === "block") {
    const message = `${combatantName(actor)} blocks.`;
    const blockedState = updateUnit(state, action.actorKey, (unit) => ({ ...unit, blocking: true }), message);
    const blocked = actor.side === "player" ? appendProgressEvent(blockedState, {
      event_type: "block_completed",
      source_critter_id: actor.critter.id,
      target_critter_id: null,
      skill_id: null,
      amount: 1,
      payload: { blocks_performed: 1 },
    }) : blockedState;
    return appendPresentationEvent(
      blocked,
      { kind: "block", message, actorKey: actor.key, targetKeys: [actor.key], hpChanges: [] },
    );
  }

  if (action.type === "swap" && action.swapToId) {
    const swapped = swapPlayerUnit(state, action.actorKey, action.swapToId);
    const incoming = swapped.playerUnits.find((unit) => unit.userCritter?.id === action.swapToId);
    return incoming ? appendProgressEvent(swapped, {
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
    const actionState = appendPresentationEvent(state, {
      kind: "skill",
      message: skillMessage,
      actorKey: actor.key,
      targetKeys: targets.map((target) => target.key),
      skillId: skill.id,
      hpChanges: [],
    });
    let damageDone = 0;
    let next = targets.reduce((current, originalTarget) => {
      const target = findUnit(current, originalTarget.key);
      if (!target || target.hp <= 0) return current;
      if (skill.skill_type === "attack") {
        const resolvedDamage = calculateSkillDamage(current.catalog, actor, target, skill);
        const damage = resolveIncomingDamage(current, actor, target, resolvedDamage.damage);
        const actualDamage = damage.hpDamage;
        damageDone += actualDamage;
        const afterHp = findUnit(damage.state, target.key)?.hp ?? target.hp;
        const updated = {
          ...damage.state,
          log: [`${combatantName(actor)} used ${skill.name} on ${combatantName(target, false)} for ${damage.finalDamage} damage.${resolvedDamage.suffix ? ` ${resolvedDamage.suffix}` : ""}`, ...damage.state.log],
        };
        const withPresentation = appendPresentationEvent(updated, {
          kind: "damage",
          message: `${combatantName(target)} took ${actualDamage} damage.${resolvedDamage.suffix ? ` ${resolvedDamage.suffix}` : ""}`,
          actorKey: actor.key,
          targetKeys: [target.key],
          skillId: skill.id,
          hpChanges: [{ unitKey: target.key, before: target.hp, after: afterHp }],
        });
        let progress = appendDamageProgressEvents(withPresentation, actor, target, actualDamage, afterHp <= 0);
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
        return progress;
      }
      return { ...current, log: [`${combatantName(actor)} used ${skill.name} on ${combatantName(target, false)}.`, ...current.log] };
    }, actionState);
    if (actor.side === "player") {
      next = appendProgressEvent(next, {
        event_type: "use_skill",
        source_critter_id: actor.critter.id,
        target_critter_id: null,
        skill_id: skill.id,
        amount: 1,
        payload: { resolved: true, target_keys: targets.map((target) => target.key) },
      });
      next = appendProgressEvent(next, {
        event_type: "skill_resolved",
        source_critter_id: actor.critter.id,
        target_critter_id: targets[0]?.critter.id ?? null,
        skill_id: skill.id,
        amount: 1,
        payload: { source_element_ids: critterElementIds(actor.critter), target_element_ids: targets.flatMap((target) => critterElementIds(target.critter)) },
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
};

function effectTargets(state: CombatState, target: string, context: RuntimeContext): CombatUnit[] {
  const holder = context.statusHolderKey ? findUnit(state, context.statusHolderKey) : undefined;
  const source = holder ?? (context.sourceCritterKey ? findUnit(state, context.sourceCritterKey) : undefined);
  const friendlies = source?.side === "opponent" ? state.opponentUnits : state.playerUnits;
  const enemies = source?.side === "opponent" ? state.playerUnits : state.opponentUnits;
  const active = (unit: CombatUnit) => unit.active && unit.hp > 0;
  const ordered = (units: CombatUnit[]) => [...units].sort((a, b) =>
    (a.side === b.side ? 0 : a.side === "player" ? -1 : 1)
    || (a.battlefieldSlot ?? 99) - (b.battlefieldSlot ?? 99)
    || a.key.localeCompare(b.key),
  );
  const contextTarget = (key?: string) => key ? findUnit(state, key) : undefined;
  switch (target) {
    case "self": {
      if (!source) throw new Error(`Missing source Critter for ${context.sourceOwnerType} effect from ${context.sourceOwnerId}.`);
      return active(source) ? [source] : [];
    }
    case "all_enemies": return ordered(enemies.filter(active));
    case "all_allies": return ordered(friendlies.filter((unit) => active(unit) && unit.key !== source?.key));
    case "all_friendlies": return ordered(friendlies.filter(active));
    case "all_squad_friendlies": return ordered(friendlies.filter((unit) => unit.hp > 0));
    case "target_enemies": {
      const selected = new Set(context.skillTargetKeys ?? []);
      return ordered(enemies.filter((unit) => active(unit) && selected.has(unit.key)));
    }
    case "all_element_friendlies":
    case "all_element_enemies": {
      const elements = new Set(context.elementIds ?? []);
      const candidates = target === "all_element_friendlies" ? friendlies : enemies;
      return ordered(candidates.filter((unit) => active(unit) && critterElementIds(unit.critter).some((id) => elements.has(id))));
    }
    case "equipped_critter": {
      if (!source) throw new Error(`Missing equipped Critter for relic effect from ${context.sourceOwnerId}.`);
      return active(source) ? [source] : [];
    }
    case "equipped_allies": return ordered(friendlies.filter((unit) => active(unit) && unit.key !== source?.key));
    case "equipped_friendlies": return ordered(friendlies.filter(active));
    case "selected_ally": {
      const selected = contextTarget(context.skillTargetKeys?.find((key) => findUnit(state, key)?.side === source?.side));
      return selected && active(selected) ? [selected] : [];
    }
    case "selected_enemy": {
      const selected = contextTarget(context.skillTargetKeys?.find((key) => findUnit(state, key)?.side !== source?.side));
      return selected && active(selected) ? [selected] : [];
    }
    case "active_ally": return ordered(friendlies.filter(active)).slice(0, 1);
    case "active_enemy": return ordered(enemies.filter(active)).slice(0, 1);
    case "attacker": return contextTarget(context.attackerKey) && active(contextTarget(context.attackerKey)!) ? [contextTarget(context.attackerKey)!] : [];
    case "defender": return contextTarget(context.defenderKey) && active(contextTarget(context.defenderKey)!) ? [contextTarget(context.defenderKey)!] : [];
    case "effect_owner": return source && active(source) ? [source] : [];
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

function numericEffectValue(effect: ResolvedEffectRef, target: CombatUnit, context: RuntimeContext): number {
  const p = effect.parameters;
  const value = Number(p.value ?? p.amount ?? p.shield_value ?? context.calculatedValue ?? 0);
  const type = String(p.value_type ?? p.value_mode ?? "flat");
  if (type === "percent_max_hp" || type === "percentage") return target.maxHp * value;
  if (type === "percent_current_hp") return target.hp * value;
  if (type === "percent_missing_hp") return (target.maxHp - target.hp) * value;
  if (type === "percent_damage_dealt") return Number(context.damageAttempted ?? context.hpDamage ?? 0) * value;
  return value;
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

function applyShieldValue(state: CombatState, targetKey: string, operation: string, value: number, maximum?: number): CombatState {
  const target = findUnit(state, targetKey);
  if (!target) return state;
  const before = target.shield;
  const nextShield = operation === "destroy"
    ? 0
    : operation === "set" || operation === "grant"
      ? value
      : operation === "subtract"
        ? before - value
        : before + value;
  const capped = Math.max(0, Math.min(maximum ?? Math.max(before, nextShield), nextShield));
  const message = capped > before ? `${combatantName(target)} gained ${capped - before} Shield.` : capped < before ? `${combatantName(target)} lost ${before - capped} Shield.` : `${combatantPossessive(target)} Shield remained unchanged.`;
  return updateUnit({ ...state, log: [message, ...state.log] }, targetKey, (unit) => ({ ...unit, shield: capped, maxShield: Math.max(unit.maxShield, maximum ?? capped) }), message);
}

function applyDirectHealthValue(state: CombatState, effect: ResolvedEffectRef, target: CombatUnit, context: RuntimeContext): { state: CombatState; applied: number; excess: number } {
  const p = effect.parameters;
  const amount = Math.max(0, roundHalfUp(numericEffectValue(effect, target, context)));
  const operation = String(p.operation);
  const sourceName = effectSourceName(state, context.sourceOwnerType, context.sourceOwnerId, effect.name);
  if (operation === "heal") {
    const applied = Math.min(amount, target.maxHp - target.hp);
    const excess = Math.max(0, amount - applied);
    const next = updateUnit(state, target.key, (unit) => ({ ...unit, hp: unit.hp + applied }), `${combatantName(target)} gained ${applied} HP from ${sourceName}.`);
    return { state: next, applied, excess };
  }
  if (operation === "set_hp") {
    const after = Math.max(Boolean(p.can_defeat_target) ? 0 : 1, Math.min(target.maxHp, amount));
    return { state: updateUnit(state, target.key, (unit) => ({ ...unit, hp: after }), `${combatantPossessive(target)} HP changed to ${after} from ${sourceName}.`), applied: Math.abs(after - target.hp), excess: 0 };
  }
  const shieldAbsorb = p.affected_by_shield === true ? Math.min(target.shield, amount) : 0;
  const remaining = amount - shieldAbsorb;
  const maximumLoss = Boolean(p.can_defeat_target) ? target.hp : Math.max(0, target.hp - 1);
  const applied = Math.min(maximumLoss, remaining);
  let next = shieldAbsorb > 0 ? applyShieldValue(state, target.key, "subtract", shieldAbsorb) : state;
  next = updateUnit(next, target.key, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - applied) }), `${combatantName(target)} lost ${applied} HP from ${sourceName}.`);
  return { state: next, applied, excess: 0 };
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
  const chance = rollChance(state, effect.parameters.chance === undefined ? 1 : Number(effect.parameters.chance));
  let next = chance.state;
  if (!chance.activated) return next;
  if (effect.execution === "root" && context.parentInstanceId) return next;
  if ((context.resolutionDepth ?? 0) > 16) return next;
  if (effect.runtimeKind === "shield_modifier") {
    const operation = String(effect.parameters.operation ?? "grant");
    const value = operation === "destroy" ? 0 : Math.max(0, roundHalfUp(Number(effect.parameters.shield_value ?? 0)));
    return targets.reduce((current, target) => applyShieldValue(
      current,
      target.key,
      operation,
      value,
      Number.isFinite(Number(effect.parameters.maximum_shield)) ? Number(effect.parameters.maximum_shield) : undefined,
    ), next);
  }
  if (effect.runtimeKind === "direct_health_modifier") {
    return targets.reduce((current, target) => {
      const before = findUnit(current, target.key)!;
      const result = applyDirectHealthValue(current, effect, before, context);
      const after = findUnit(result.state, target.key)!;
      const message = result.state.log[0];
      let presented = after.hp !== before.hp
        ? appendPresentationEvent(result.state, {
            kind: after.hp > before.hp ? "heal" : "damage",
            message,
            actorKey: context.sourceCritterKey,
            targetKeys: [target.key],
            hpChanges: [{ unitKey: target.key, before: before.hp, after: after.hp }],
          })
        : result.state;
      if (result.excess > 0 && effect.parameters.overhealing_behavior === "convert") {
        presented = resolveChildEffects(presented, effect, { ...context, calculatedValue: result.excess }, effect.parameters.overheal_effect_ids);
      }
      return presented;
    }, next);
  }
  if (effect.runtimeKind === "effect_scaling") {
    const sourceTarget = targets[0];
    const scalingSource = String(effect.parameters.scaling_source);
    const sourceValue = scalingSource === "missing_hp" && sourceTarget ? sourceTarget.maxHp - sourceTarget.hp
      : scalingSource === "current_hp" && sourceTarget ? sourceTarget.hp
        : scalingSource === "maximum_hp" && sourceTarget ? sourceTarget.maxHp
          : Number(context.damageAttempted ?? context.hpDamage ?? context.calculatedValue ?? 0);
    const scaled = Math.max(Number(effect.parameters.minimum_value ?? -Infinity), Math.min(Number(effect.parameters.maximum_value ?? Infinity), Number(effect.parameters.base_value ?? 0) + sourceValue * Number(effect.parameters.scaling_ratio ?? 0)));
    return resolveChildEffects(next, effect, { ...context, calculatedValue: roundHalfUp(scaled) }, effect.parameters.child_effect_ids);
  }
  if (effect.runtimeKind === "effect_duration") {
    const duration = Number(effect.parameters.duration_value ?? effect.parameters.turns ?? 1);
    return resolveChildEffects(addRuntimeEffect(next, effect, context, {}, duration), effect, context, effect.parameters.child_effect_ids);
  }
  if (effect.runtimeKind === "conditional_effect") {
    const target = targets[0];
    if (!target) return next;
    const condition = String(effect.parameters.condition);
    const actual = condition === "hp_percent" ? target.hp / Math.max(1, target.maxHp) * 100
      : condition === "shield_present" ? (target.shield > 0 ? 1 : 0)
        : condition === "shield_value" ? target.shield
          : condition === "active_state" ? (target.active ? 1 : 0)
            : condition === "element" ? (critterElementIds(target.critter).includes(String(effect.parameters.condition_value)) ? 1 : 0)
              : 0;
    const expected = Number(effect.parameters.condition_value ?? 1);
    return resolveChildEffects(next, effect, { ...context }, compareValues(actual, String(effect.parameters.comparison ?? "equal"), expected) ? effect.parameters.true_effect_ids : effect.parameters.false_effect_ids);
  }
  if (effect.runtimeKind === "delayed_effect" || effect.runtimeKind === "repeating_effect") {
    const delay = Number(effect.parameters.delay_value ?? effect.parameters.initial_delay ?? effect.parameters.repeat_interval ?? 1);
    return addRuntimeEffect(next, effect, { ...context, skillTargetKeys: targets.map((target) => target.key) }, { childEffectIds: effect.parameters.child_effect_ids, repeat: effect.parameters.repeat === true }, delay);
  }
  if (effect.runtimeKind === "resource_gain_loss") {
    const value = Math.max(0, roundHalfUp(Number(effect.parameters.value ?? 0)));
    const playerResource = context.sourceCritterKey?.startsWith("p") || effect.parameters.target_squad === "user";
    const updateMana = (current: number) => {
      const operation = String(effect.parameters.operation);
      if (["lose", "drain"].includes(operation)) return Math.max(0, current - value);
      if (operation === "set") return value;
      return current + value;
    };
    return { ...next, playerMana: playerResource ? updateMana(next.playerMana) : next.playerMana, opponentMana: playerResource ? next.opponentMana : updateMana(next.opponentMana) };
  }
  if (effect.runtimeKind === "resource_conversion" || effect.runtimeKind === "effect_transfer") {
    const sourceValue = Number(context.calculatedValue ?? context.hpDamage ?? context.damageAttempted ?? 0);
    const calculatedValue = effect.runtimeKind === "resource_conversion"
      ? Math.min(Number(effect.parameters.maximum_conversion ?? Infinity), sourceValue * Number(effect.parameters.conversion_ratio ?? 1))
      : sourceValue * Number(effect.parameters.transfer_percentage ?? 1);
    return resolveChildEffects(next, effect, { ...context, calculatedValue: roundHalfUp(calculatedValue) }, effect.parameters.output_effect_ids ?? effect.parameters.child_effect_ids);
  }
  if (["effect_immunity", "damage_modifier", "damage_prevention", "action_cost_modifier", "reactive_trigger", "retaliation", "effect_amplification"].includes(effect.runtimeKind)) {
    return addRuntimeEffect(next, effect, context, { parameters: structuredClone(effect.parameters) });
  }
  if (effect.runtimeKind === "effect_removal") {
    const category = String(effect.parameters.removal_category ?? "all_removable");
    const removable = next.runtimeEffects.filter((instance) => instance.sourceEffectId !== effect.id && (category === "all_removable" || category === instance.classification || instance.runtimeKind.includes(category.replace("_modifiers", "_modifier"))));
    const remove = new Set(removable.slice(0, Number(effect.parameters.maximum_effects_removed ?? 1)).map((instance) => instance.instanceId));
    return { ...next, runtimeEffects: next.runtimeEffects.filter((instance) => !remove.has(instance.instanceId)) };
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
      const amount = Math.max(0, roundHalfUp(raw));
      const restored = Math.min(amount, target.maxHp - target.hp);
      const source = context.sourceCritterKey ? findUnit(current, context.sourceCritterKey) : undefined;
      const sourceName = effectSourceName(current, context.sourceOwnerType, context.sourceOwnerId, effect.name);
      const message = `${combatantName(target)} gained ${restored} HP from ${sourceName}.`;
      const updated = updateUnit(
        current,
        target.key,
        (unit) => ({ ...unit, hp: unit.hp + restored }),
        message,
      );
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
        effect: cloneEffect(effect),
      };
      current = recomputeCombatStats({ ...current, modifiers: [...current.modifiers, modifier] });
      const after = findUnit(current, original.key)!;
      const stat = ({ block_cost: "blockCost", swap_cost: "swapCost", relic_slots: "relicSlots" } as Record<string, keyof StatBlock>)[String(effect.parameters.stat)] ?? String(effect.parameters.stat) as keyof StatBlock;
      const delta = after.stats[stat] - before.stats[stat];
      const statName = String(effect.parameters.stat).replace(/_/g, " ").toUpperCase();
      const sourceName = effectSourceName(current, context.sourceOwnerType, context.sourceOwnerId, effect.name);
      const message = delta > 0
        ? `${combatantName(after)} gained +${delta} ${statName} from ${sourceName}.`
        : delta < 0
          ? `${combatantName(after)} lost −${Math.abs(delta)} ${statName} from ${sourceName}.`
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
  for (const instance of state.runtimeEffects.filter((candidate) => candidate.runtimeKind === "reactive_trigger" || candidate.runtimeKind === "retaliation")) {
    const parent = effectForReference(next, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
    if (!parent) continue;
    const p = parent.parameters;
    const trigger = instance.runtimeKind === "retaliation" ? String(p.trigger_condition ?? "hit") : String(p.trigger_event ?? "owner_hp_damaged");
    const watched = effectTargets(next, String(p.target ?? ""), {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
      sourceCritterKey: instance.sourceCritterKey,
      skillTargetKeys: [defender.key],
      attackerKey: attacker.key,
      defenderKey: defender.key,
    });
    if (!watched.some((unit) => unit.key === defender.key)) continue;
    if (p.activation_limit !== undefined && instance.activationCount >= Number(p.activation_limit)) continue;
    const matches = instance.runtimeKind === "retaliation"
      ? ["attacked", "hit", "hp_damaged"].includes(trigger) && defender.hp > 0
      : trigger === eventType || (trigger === "owner_shield_breaks" && defender.shield <= 0 && shieldDamage > 0);
    if (!matches) continue;
    if (Number(p.minimum_damage ?? 0) > Math.max(hpDamage, shieldDamage)) continue;
    const chance = rollChance(next, p.activation_chance === undefined ? 1 : Number(p.activation_chance));
    next = chance.state;
    if (!chance.activated) continue;
    next = {
      ...next,
      runtimeEffects: next.runtimeEffects.map((candidate) => candidate.instanceId === instance.instanceId
        ? { ...candidate, activationCount: candidate.activationCount + 1 }
        : candidate),
    };
    const targetKeys = instance.runtimeKind === "retaliation" ? [attacker.key] : [defender.key];
    const childIds = p.child_effect_ids;
    next = resolveChildEffects(next, parent, {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
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
  const sourceName = effectSourceName(state, context.sourceOwnerType, context.sourceOwnerId, status.name);
  const classification = statusClassification(state.runEffects.status[statusId] ?? []);
  const holderName = holder ? combatantName(holder) : holderKey;
  const message = classification === "negative"
    ? `${holderName} was afflicted with ${status.name} from ${sourceName}.`
    : classification === "positive"
      ? `${holderName} gained ${status.name} from ${sourceName}.`
      : `${holderName} received ${status.name} from ${sourceName}.`;
  let next = appendPresentationEvent(
    recomputeCombatStats({ ...state, statuses, log: [message, ...state.log] }),
    {
      kind: "status",
      message,
      actorKey: context.sourceCritterKey,
      targetKeys: [holderKey],
      hpChanges: [],
    },
  );
  for (const effect of state.runEffects.status[statusId] ?? []) {
    if (effect.execution === "child") continue;
    const statusContext: RuntimeContext = { sourceOwnerType: "status", sourceOwnerId: statusId, sourceCritterKey: holderKey, statusHolderKey: holderKey, skillTargetKeys: [holderKey] };
    if (["damage_over_time", "skip_action_chance"].includes(effect.runtimeKind)) continue;
    if (["reactive_trigger", "retaliation", "damage_modifier", "damage_prevention", "action_cost_modifier", "effect_immunity", "effect_amplification", "delayed_effect", "repeating_effect"].includes(effect.runtimeKind)) next = addRuntimeEffect(next, effect, statusContext);
    else next = resolveEffect(next, effect, statusContext);
  }
  return next;
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
        const afterHp = Math.max(0, target.hp - damage);
        const message = `${combatantName(target)} took ${actualDamage} damage from ${effect.name}.`;
        next = appendPresentationEvent(
          updateUnit(next, target.key, (unit) => ({ ...unit, hp: afterHp }), message),
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
  }
  const scheduled = [...next.runtimeEffects];
  for (const instance of scheduled) {
    if (instance.remaining === undefined || instance.remaining > 0) continue;
    const parent = effectForReference(next, instance.sourceOwnerType, instance.sourceOwnerId, instance.sourceEffectId);
    if (!parent) continue;
    const context: RuntimeContext = {
      sourceOwnerType: instance.sourceOwnerType,
      sourceOwnerId: instance.sourceOwnerId,
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
    next = { ...next, runtimeEffects: next.runtimeEffects.map((instance) => instance.remaining === undefined ? instance : { ...instance, remaining: instance.remaining - 1 }).filter((instance) => instance.remaining === undefined || instance.remaining > 0) };
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
  if (battlefieldSlot === null) return state;

  const units = state.playerUnits.map((unit, index) => {
    if (index === activeIndex) return { ...unit, active: false, battlefieldSlot: null };
    if (index === benchIndex) return { ...unit, active: true, battlefieldSlot };
    return unit;
  });

  const message = `${combatantName(state.playerUnits[activeIndex])} swapped with ${combatantName(state.playerUnits[benchIndex], false)}.`;
  let next: CombatState = {
    ...state,
    playerUnits: units,
    log: [message, ...state.log],
  };
  next = recomputeCombatStats(next);
  return appendPresentationEvent(next, {
    kind: "swap",
    message,
    actorKey,
    targetKeys: [state.playerUnits[benchIndex].key],
    swap: {
      outgoingKey: state.playerUnits[activeIndex].key,
      incomingKey: state.playerUnits[benchIndex].key,
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
): SkillDamage {
  if (skill.skill_type !== "attack" || skill.power <= 0) {
    return {
      damage: 0,
      effectiveness: 1,
      classification: "neutral",
      suffix: "",
      stab: false,
    };
  }
  const stab = critterHasElement(attacker.critter, skill.element_id);
  const effectivePower = skill.power * (stab ? 1.5 : 1);
  const effectiveness = elementEffectiveness(catalog, skill.element_id, defender.critter);
  const rawDamage = (((((2 * attacker.level) / 5 + 2) * effectivePower * attacker.stats.atk) / defender.stats.def) / 50 + 2)
    * effectiveness;
  const minimum = effectiveness === 0 ? 0 : 1;
  const damage = Math.max(minimum, Math.floor(rawDamage));
  return {
    damage,
    effectiveness,
    ...classifyEffectiveness(effectiveness),
    stab,
  };
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
      payload: { source_element_ids: critterElementIds(source.critter), target_element_ids: critterElementIds(target.critter) },
    });
    next = appendProgressEvent(next, {
      event_type: "hp_damage_dealt",
      source_critter_id: source.critter.id,
      target_critter_id: target.critter.id,
      skill_id: null,
      amount: actualDamage,
      payload: { source_element_ids: critterElementIds(source.critter), target_element_ids: critterElementIds(target.critter) },
    });
    if (knockedOut) {
      next = appendProgressEvent(next, {
        event_type: "knock_out_critters",
        source_critter_id: source.critter.id,
        target_critter_id: target.critter.id,
        skill_id: null,
        amount: 1,
        payload: { target_element_ids: critterElementIds(target.critter) },
      });
      next = appendProgressEvent(next, {
        event_type: "critter_knocked_out",
        source_critter_id: source.critter.id,
        target_critter_id: target.critter.id,
        skill_id: null,
        amount: 1,
        payload: { target_element_ids: critterElementIds(target.critter) },
      });
    }
  } else if (source.side === "opponent" && target.side === "player") {
    next = appendProgressEvent(next, {
      event_type: "take_damage",
      source_critter_id: source.critter.id,
      target_critter_id: target.critter.id,
      skill_id: null,
      amount: actualDamage,
      payload: { source_element_ids: critterElementIds(source.critter), target_element_ids: critterElementIds(target.critter) },
    });
    next = appendProgressEvent(next, {
      event_type: "hp_damage_taken",
      source_critter_id: source.critter.id,
      target_critter_id: target.critter.id,
      skill_id: null,
      amount: actualDamage,
      payload: { source_element_ids: critterElementIds(source.critter), target_element_ids: critterElementIds(target.critter) },
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
  const lower = Math.max(1, Math.floor(min));
  const upper = Math.max(lower, Math.floor(max));
  return lower + Math.floor(random() * (upper - lower + 1));
}

function rollManaDieSeeded(min: number, max: number, rngState: number): { value: number; state: number } {
  const roll = nextRandom(rngState);
  return { value: rollManaDie(min, max, () => roll.value), state: roll.state };
}
