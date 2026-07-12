import type {
  Catalog,
  CombatAction,
  Critter,
  CritterProgression,
  Dungeon,
  DungeonOpponent,
  ElementDef,
  PlayerState,
  Skill,
  UserCritter,
} from "./types";

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
  stats: StatBlock;
  hp: number;
  maxHp: number;
  skills: Skill[];
  active: boolean;
  blocking: boolean;
  manaRoll: number;
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
): CombatState {
  const squad = squadCritters(player);
  const playerUnits = squad.map((owned, index) => {
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
      stats,
      hp: stats.hp,
      maxHp: stats.hp,
      skills,
      active: index < dungeon.player_active_count,
      blocking: false,
      manaRoll: 0,
    };
  });

  const opponentRows = pickOpponents(catalog, dungeon);
  const opponentUnits = opponentRows.map((opponent, index) => {
    const critter = byId(catalog.critters, opponent.critter_id)!;
    const stats = critterStats(catalog, critter, opponent.critter_level);
    const skills = opponent.skill_ids
      .map((skillId) => byId(catalog.skills, skillId))
      .filter((skill): skill is Skill => Boolean(skill));

    return {
      key: `o${index + 1}`,
      side: "opponent" as const,
      name: critter.name,
      critter,
      level: opponent.critter_level,
      stats,
      hp: stats.hp,
      maxHp: stats.hp,
      skills,
      active: index < dungeon.opponent_active_count,
      blocking: false,
      manaRoll: 0,
    };
  });

  return {
    dungeon,
    playerUnits,
    opponentUnits,
    playerMana: 0,
    opponentMana: 0,
    turn: 1,
    log: [`Entered ${dungeon.id} - ${dungeon.name}.`],
    phase: "ready",
    runId,
  };
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

export function startTurn(state: CombatState): CombatState {
  const playerUnits = state.playerUnits.map((unit) =>
    unit.active && unit.hp > 0
      ? { ...unit, blocking: false, manaRoll: rollManaDie(unit.stats.diceMin, unit.stats.diceMax) }
      : unit,
  );
  const opponentUnits = state.opponentUnits.map((unit) =>
    unit.active && unit.hp > 0
      ? { ...unit, blocking: false, manaRoll: rollManaDie(unit.stats.diceMin, unit.stats.diceMax) }
      : unit,
  );
  const playerRoll = playerUnits.reduce((sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0), 0);
  const opponentRoll = opponentUnits.reduce(
    (sum, unit) => sum + (unit.active && unit.hp > 0 ? unit.manaRoll : 0),
    0,
  );

  return {
    ...state,
    playerUnits,
    opponentUnits,
    playerMana: state.playerMana + playerRoll,
    opponentMana: state.opponentMana + opponentRoll,
    phase: "selecting",
    log: [
      `Turn ${state.turn}: player rolled ${playerRoll} mana, opponents rolled ${opponentRoll} mana.`,
      ...state.log,
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

  return ordered.reduce((current, action) => resolveAction(current, action), state);
}

function resolveAction(state: CombatState, action: CombatAction): CombatState {
  const actor = findUnit(state, action.actorKey);
  if (!actor || actor.hp <= 0) return state;

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
    return targets.reduce((current, originalTarget) => {
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
  if (targeting === "all_others") return [...friendlies, ...enemies].filter((unit) => onField(unit) && unit.key !== actor.key);
  const candidates = targeting === "single_any" ? [...friendlies, ...enemies].filter(onField) : enemies.filter(onField);
  if (!selectedKey) return candidates;
  return candidates.filter((unit) => unit.key === selectedKey);
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

  return {
    ...state,
    playerUnits: units,
    log: [`${state.playerUnits[activeIndex].name} swapped with ${state.playerUnits[benchIndex].name}.`, ...state.log],
  };
}

function resolvePostTurn(state: CombatState): CombatState {
  return { ...state, log: ["Post-turn effects resolved.", ...state.log] };
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
