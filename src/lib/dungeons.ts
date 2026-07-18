import type {
  BattleFormat,
  Dungeon,
  DungeonCompletionDrop,
  DungeonOpponent,
  DungeonRunSnapshot,
  PlayerState,
  UserDungeonProgress,
} from "./types.js";

const dungeonIdCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export type EffectiveDungeon = {
  dungeon: Dungeon;
  mode: "regular" | "boss";
  logoPath: string | null;
  difficulty: number;
  battleCount: number;
  playerActiveCount: number;
  opponentActiveCount: number;
  pool: DungeonOpponent[];
  progress?: UserDungeonProgress;
  unlocked: boolean;
  enterable: boolean;
  lockedReason: string | null;
};

export function parseBattleFormat(format: BattleFormat): {
  playerActiveCount: number;
  opponentActiveCount: number;
} {
  const match = /^([1-3])v([1-3])$/.exec(format);
  if (!match) throw new Error(`Unsupported Battle Format: ${format}.`);
  return {
    playerActiveCount: Number(match[1]),
    opponentActiveCount: Number(match[2]),
  };
}

export function sortDungeonsNaturally(dungeons: Dungeon[]): Dungeon[] {
  return [...dungeons].sort((left, right) => dungeonIdCollator.compare(left.id, right.id));
}

export function effectiveDungeon(
  dungeon: Dungeon,
  opponents: DungeonOpponent[],
  progress: UserDungeonProgress | undefined,
  player?: PlayerState,
): EffectiveDungeon {
  const format = parseBattleFormat(dungeon.battle_format);
  const firstClearBoss = dungeon.dungeon_type === "boss" && (progress?.clear_count ?? 0) === 0;
  const mode = firstClearBoss ? "boss" : "regular";
  const poolType = mode === "boss" ? "boss_order" : "regular_pool";
  const pool = opponents
    .filter((opponent) => opponent.dungeon_id === dungeon.id && opponent.pool_type === poolType)
    .sort((left, right) => (left.sequence_index ?? Number.MAX_SAFE_INTEGER) - (right.sequence_index ?? Number.MAX_SAFE_INTEGER));
  const battleCount = mode === "boss"
    ? pool.length / format.opponentActiveCount
    : dungeon.battle_count;
  const difficulty = pool.length
    ? Math.round(pool.reduce((total, opponent) => total + opponent.critter_level, 0) / pool.length)
    : 0;
  const unlocked = Boolean(progress?.is_unlocked);
  const hasSquad = Boolean(player?.squadSlots.some((slot) => slot.user_critter_id));
  const hasRollcaster = Boolean(player?.profile.active_rollcaster_id);
  const authored = dungeon.is_active !== false && dungeon.is_archived !== true;
  const lockedReason = !authored
    ? "This Dungeon is not currently available."
    : !unlocked
      ? "Clear the previous Dungeon to unlock this one."
      : !hasSquad
        ? "Equip at least one Critter before entering."
        : !hasRollcaster
          ? "Choose an active Rollcaster before entering."
          : pool.length === 0 || !Number.isInteger(battleCount) || battleCount < 1
            ? "This Dungeon has an incomplete encounter setup."
            : null;

  return {
    dungeon,
    mode,
    logoPath: mode === "boss" ? dungeon.boss_logo_path : dungeon.regular_logo_path,
    difficulty,
    battleCount,
    playerActiveCount: format.playerActiveCount,
    opponentActiveCount: format.opponentActiveCount,
    pool,
    progress,
    unlocked,
    enterable: lockedReason === null,
    lockedReason,
  };
}

export function effectiveDungeons(player: PlayerState, dungeons: Dungeon[], opponents: DungeonOpponent[]): EffectiveDungeon[] {
  const progress = new Map(player.dungeonProgress.map((row) => [row.dungeon_id, row]));
  return sortDungeonsNaturally(dungeons)
    .filter((dungeon) => dungeon.is_archived !== true)
    .map((dungeon) => effectiveDungeon(dungeon, opponents, progress.get(dungeon.id), player));
}

export function dungeonCompletionDrops(
  drops: DungeonCompletionDrop[],
  dungeonId: string,
  phase: "first_time" | "regular",
): DungeonCompletionDrop[] {
  return drops.filter((drop) => drop.phase === phase && drop.id.startsWith(`${dungeonId}:`));
}

export function opponentsForBattle(run: DungeonRunSnapshot, battleIndex = run.battleIndex): DungeonRunSnapshot["selectedOpponents"] {
  return run.selectedOpponents
    .filter((opponent) => opponent.battleIndex === battleIndex)
    .sort((left, right) => left.battlefieldSlot - right.battlefieldSlot);
}

export function formatProbability(probability: number): string {
  const percent = probability * 100;
  const digits = Number.isInteger(percent) ? 0 : 2;
  return `${probability.toFixed(Math.min(6, Math.max(1, digits + 1)))} · ${percent.toFixed(digits)}%`;
}

export function dropAmountLabel(minAmount: number, maxAmount: number): string {
  return minAmount === maxAmount ? `${minAmount}` : `${minAmount}–${maxAmount}`;
}

