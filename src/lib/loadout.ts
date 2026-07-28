import { actionCostModifierApplies, applyActionCostModifiers, byId, critterElementIds, critterStats, roundHalfUp, type ActionCostBreakdown, type ActionCostModifier, type StatBlock } from "./game.js";
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
  skillCosts: Record<string, ActionCostBreakdown>;
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
  targetElementIds: string[],
): boolean {
  const effectTarget = String(effect.parameters.target ?? "");
  if (source.ownerType === "relic") {
    if (effectTarget === "equipped_critter") return source.sourceCritterId === target.id;
    if (effectTarget === "equipped_allies") return source.sourceCritterId !== target.id;
    if (effectTarget === "equipped_friendlies" || effectTarget === "all_squad_friendlies") return true;
    return false;
  }

  if (effectTarget === "all_friendlies" || effectTarget === "all_squad_friendlies") return true;
  if (effectTarget === "all_element_friendlies") {
    const elementIds = Array.isArray(effect.parameters.element_ids)
      ? effect.parameters.element_ids.filter((id): id is string => typeof id === "string")
      : [];
    return elementIds.some((elementId) => targetElementIds.includes(elementId));
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

function actionCostSources(
  sources: PassiveSource[],
  target: UserCritter,
  elementIds: string[],
): ActionCostModifier[] {
  return sources.flatMap((source) => source.effects
    .filter((effect) => effect.execution !== "child" && effect.runtimeKind === "action_cost_modifier")
    .filter((effect) => targetsCritter(source, effect, target, elementIds))
    .map((effect) => ({
      parameters: effect.parameters,
      sourceName: source.sourceName,
    })));
}

function addCostDelta(
  breakdowns: Partial<Record<LoadoutStatKey, StatBreakdown>>,
  key: "blockCost" | "swapCost",
  base: number,
  amount: number,
  sourceName: string,
): void {
  addDelta(breakdowns, key, base, amount, sourceName);
}

export function calculateLoadoutStats(data: AppData, owned: UserCritter): CalculatedLoadoutStats {
  const critter = byId(data.catalog.critters, owned.critter_id);
  if (!critter) throw new Error(`Missing catalog Critter ${owned.critter_id}.`);
  const base = critterStats(data.catalog, critter, owned.level);
  const stats = { ...base };
  const breakdowns: Partial<Record<LoadoutStatKey, StatBreakdown>> = {};
  const sources = passiveSources(data);
  const elementIds = critterElementIds(critter);

  for (const source of sources) {
    for (const effect of source.effects) {
      if (!targetsCritter(source, effect, owned, elementIds)) continue;
      if (effect.runtimeKind === "stat_modifier") {
        const key = String(effect.parameters.stat) as LoadoutStatKey;
        if (!(key in stats)) continue;
        const configured = Number(effect.parameters.amount ?? 0);
        const delta = effect.parameters.value_mode === "percentage"
          ? (roundHalfUp(base[key] * configured) || (configured === 0 ? 0 : Math.sign(configured)))
          : configured;
        const previous = stats[key];
        const minimum = key === "blockCost" || key === "swapCost" ? 0 : key === "relicSlots" ? 0 : 1;
        stats[key] = Math.max(minimum, previous + delta);
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
  const blockCostModifiers = actionCostSources(sources, owned, elementIds)
    .filter((modifier) => actionCostModifierApplies(modifier.parameters, { type: "block" }));
  const swapCostModifiers = actionCostSources(sources, owned, elementIds)
    .filter((modifier) => actionCostModifierApplies(modifier.parameters, { type: "swap" }));
  const blockCost = applyActionCostModifiers(stats.blockCost, blockCostModifiers);
  const swapCost = applyActionCostModifiers(stats.swapCost, swapCostModifiers);
  for (const source of blockCost.sources) addCostDelta(breakdowns, "blockCost", base.blockCost, source.amount, source.sourceName);
  for (const source of swapCost.sources) addCostDelta(breakdowns, "swapCost", base.swapCost, source.amount, source.sourceName);
  stats.blockCost = blockCost.final;
  stats.swapCost = swapCost.final;

  const skillCosts = Object.fromEntries(data.catalog.skills.map((skill) => [
    skill.id,
    applyActionCostModifiers(
      skill.mana_cost,
      actionCostSources(sources, owned, elementIds)
        .filter((modifier) => actionCostModifierApplies(modifier.parameters, { type: "skill", skillId: skill.id, skillType: skill.skill_type })),
    ),
  ]));
  return { stats, breakdowns, skillCosts };
}
