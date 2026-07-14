import { byId, critterStats, roundHalfUp, type StatBlock } from "./game.js";
import type { AppData, ResolvedEffectRef, UserCritter } from "./types.js";

export type LoadoutStatKey = keyof StatBlock;

export type StatDeltaSource = {
  amount: number;
  sourceName: string;
};

export type StatBreakdown = {
  base: number;
  sources: StatDeltaSource[];
};

export type CalculatedLoadoutStats = {
  stats: StatBlock;
  breakdowns: Partial<Record<LoadoutStatKey, StatBreakdown>>;
};

type PassiveSource = {
  ownerType: "relic" | "ability";
  sourceCritterId?: string;
  sourceName: string;
  effects: ResolvedEffectRef[];
};

function targetsCritter(
  source: PassiveSource,
  effect: ResolvedEffectRef,
  target: UserCritter,
  targetElementId: string,
): boolean {
  const effectTarget = String(effect.parameters.target ?? "");
  if (source.ownerType === "relic") {
    if (effectTarget === "equipped_critter") return source.sourceCritterId === target.id;
    if (effectTarget === "equipped_allies") return source.sourceCritterId !== target.id;
    if (effectTarget === "equipped_friendlies") return true;
    return false;
  }

  if (effectTarget === "all_friendlies") return true;
  if (effectTarget === "all_element_friendlies") {
    const elementIds = Array.isArray(effect.parameters.element_ids)
      ? effect.parameters.element_ids.filter((id): id is string => typeof id === "string")
      : [];
    return elementIds.includes(targetElementId);
  }
  return false;
}

function passiveSources(data: AppData): PassiveSource[] {
  const player = data.player!;
  const squad = player.squadSlots
    .slice()
    .sort((left, right) => left.slot_index - right.slot_index)
    .map((slot) => player.critters.find((owned) => owned.id === slot.user_critter_id))
    .filter((owned): owned is UserCritter => Boolean(owned));
  const sources: PassiveSource[] = [];

  for (const owned of squad) {
    for (const slot of player.relicSlots
      .filter((candidate) => candidate.user_critter_id === owned.id && candidate.relic_id)
      .sort((left, right) => left.slot_index - right.slot_index)) {
      const relic = byId(data.catalog.relics, slot.relic_id);
      if (!relic) continue;
      sources.push({
        ownerType: "relic",
        sourceCritterId: owned.id,
        sourceName: relic.name,
        effects: data.catalog.effectsByRelic[relic.id] ?? [],
      });
    }
  }

  const activeRollcaster = player.rollcasters.find((owned) => owned.id === player.profile.active_rollcaster_id);
  if (activeRollcaster) {
    for (const slot of player.abilitySlots
      .filter((candidate) => candidate.user_rollcaster_id === activeRollcaster.id && candidate.ability_id)
      .sort((left, right) => left.slot_index - right.slot_index)) {
      const ability = byId(data.catalog.rollcasterAbilities, slot.ability_id);
      if (!ability) continue;
      sources.push({
        ownerType: "ability",
        sourceName: ability.name,
        effects: data.catalog.effectsByAbility[ability.id] ?? [],
      });
    }
  }

  return sources;
}

function addDelta(
  breakdowns: Partial<Record<LoadoutStatKey, StatBreakdown>>,
  key: LoadoutStatKey,
  base: number,
  amount: number,
  sourceName: string,
): void {
  if (amount === 0) return;
  const breakdown = breakdowns[key] ?? { base, sources: [] };
  breakdown.sources.push({ amount, sourceName });
  breakdowns[key] = breakdown;
}

export function calculateLoadoutStats(data: AppData, owned: UserCritter): CalculatedLoadoutStats {
  const critter = byId(data.catalog.critters, owned.critter_id);
  if (!critter) throw new Error(`Missing catalog Critter ${owned.critter_id}.`);
  const base = critterStats(data.catalog, critter, owned.level);
  const stats = { ...base };
  const breakdowns: Partial<Record<LoadoutStatKey, StatBreakdown>> = {};

  for (const source of passiveSources(data)) {
    for (const effect of source.effects) {
      if (!targetsCritter(source, effect, owned, critter.element_id)) continue;
      if (effect.runtimeKind === "stat_modifier") {
        const key = String(effect.parameters.stat) as "hp" | "atk" | "def" | "spd";
        if (!["hp", "atk", "def", "spd"].includes(key)) continue;
        const configured = Number(effect.parameters.amount ?? 0);
        const delta = effect.parameters.value_mode === "percentage"
          ? roundHalfUp(stats[key] * configured)
          : configured;
        const previous = stats[key];
        stats[key] = Math.max(1, previous + delta);
        addDelta(breakdowns, key, base[key], stats[key] - previous, source.sourceName);
      } else if (effect.runtimeKind === "mana_dice_modifier") {
        const minimumDelta = Number(effect.parameters.minimum_delta ?? 0);
        const maximumDelta = Number(effect.parameters.maximum_delta ?? 0);
        stats.diceMin += minimumDelta;
        stats.diceMax += maximumDelta;
        addDelta(breakdowns, "diceMin", base.diceMin, minimumDelta, source.sourceName);
        addDelta(breakdowns, "diceMax", base.diceMax, maximumDelta, source.sourceName);
      }
    }
  }

  stats.diceMin = Math.max(1, roundHalfUp(stats.diceMin));
  stats.diceMax = Math.max(stats.diceMin, roundHalfUp(stats.diceMax));
  return { stats, breakdowns };
}
