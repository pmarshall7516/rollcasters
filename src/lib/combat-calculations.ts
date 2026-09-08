import type { Catalog, Critter, Skill } from "./types.js";
import type { BaseEffectivenessClass, CombatUnit, EffectivenessClass, SkillDamage } from "./game.js";

export type EffectivenessResolution = {
  baseMultiplier: number;
  baseClassification: BaseEffectivenessClass;
  totalMultiplier: number;
  classification: EffectivenessClass;
  suffix: string;
};

export type EffectivenessInputs = {
  /** Replacement cells keyed by the defending Element ID. */
  cellMultipliers?: Readonly<Record<string, number>>;
  /** Matchup multipliers from external Skill Effectiveness Effects. */
  matchupMultipliers?: readonly number[];
  /** Percent-delta factors selected from the legacy base tier. */
  tierPercentDeltas?: readonly number[];
};

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

export function elementEffectiveness(
  catalog: Pick<Catalog, "elementEffectiveness">,
  attackingElementId: string,
  defender: Pick<Critter, "element_1_id" | "element_2_id">,
  cellMultipliers: Readonly<Record<string, number>> = {},
): number {
  const multiplierFor = (defendingElementId: string) => {
    const replacement = cellMultipliers[defendingElementId];
    if (replacement !== undefined) return replacement;
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

export function classifyBaseEffectiveness(multiplier: number): BaseEffectivenessClass {
  if (Math.abs(multiplier - 1) <= 1e-6) return "neutral";
  if (multiplier >= 2) return "extra-effective";
  if (multiplier > 1) return "effective";
  if (multiplier > 0.5) return "resisted";
  return "extra-resisted";
}

function effectivenessSuffix(classification: EffectivenessClass): string {
  switch (classification) {
    case "immune": return "It was immune!";
    case "mega-resisted": return "It was a mega resisted skill.";
    case "extra-resisted": return "It was an extra resisted skill.";
    case "resisted": return "It was a resisted skill.";
    case "neutral": return "";
    case "effective": return "It was an effective skill!";
    case "extra-effective": return "It was an extra effective skill!";
    case "mega-effective": return "It was a mega effective skill!";
  }
}

export function classifyTotalEffectiveness(multiplier: number): { classification: EffectivenessClass; suffix: string } {
  const safe = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 0;
  let classification: EffectivenessClass;
  if (safe === 0) classification = "immune";
  else if (safe < 0.1) classification = "mega-resisted";
  else if (safe <= 0.5) classification = "extra-resisted";
  else if (safe < 1) classification = "resisted";
  else if (Math.abs(safe - 1) <= 1e-6) classification = "neutral";
  else if (safe < 1.5) classification = "effective";
  else if (safe <= 2.5) classification = "extra-effective";
  else classification = "mega-effective";
  return { classification, suffix: effectivenessSuffix(classification) };
}

export function classifyEffectiveness(multiplier: number): { classification: EffectivenessClass; suffix: string } {
  return classifyTotalEffectiveness(multiplier);
}

export function applyPercentDeltaFactors(baseMultiplier: number, deltas: readonly number[] = []): number {
  return Math.max(0, deltas.reduce((value, delta) => {
    const numeric = Number(delta);
    return Number.isFinite(numeric) ? value * Math.max(0, 1 + numeric) : value;
  }, baseMultiplier));
}

export function resolveEffectiveness(
  catalog: Pick<Catalog, "elementEffectiveness">,
  attackingElementId: string,
  defender: Pick<Critter, "element_1_id" | "element_2_id">,
  inputs: EffectivenessInputs = {},
): EffectivenessResolution {
  const baseMultiplier = applyPercentDeltaFactors(
    elementEffectiveness(catalog, attackingElementId, defender, inputs.cellMultipliers),
    inputs.matchupMultipliers?.map((multiplier) => Number(multiplier) - 1),
  );
  const baseClassification = classifyBaseEffectiveness(baseMultiplier);
  const totalMultiplier = applyPercentDeltaFactors(baseMultiplier, inputs.tierPercentDeltas);
  const final = classifyTotalEffectiveness(totalMultiplier);
  return { baseMultiplier, baseClassification, totalMultiplier, ...final };
}

export function calculateSkillDamage(
  catalog: Pick<Catalog, "elementEffectiveness">,
  attacker: CombatUnit,
  defender: CombatUnit,
  skill: Skill,
  random: () => number = () => 1,
  targetCount = 1,
  effectivenessInputs: EffectivenessInputs = {},
): SkillDamage {
  if (skill.skill_type !== "attack" || skill.power <= 0) {
    return {
      damage: 0,
      maxDamage: 0,
      damageRollPercent: DAMAGE_ROLL_MAX_PERCENT,
      targetCount: 1,
      spreadMultiplier: 1,
      effectiveness: 1,
      baseEffectiveness: 1,
      baseClassification: "neutral",
      classification: "neutral",
      suffix: "",
      stab: false,
    };
  }
  const stab = attacker.critter.element_1_id === skill.element_id || attacker.critter.element_2_id === skill.element_id;
  const effectivePower = skill.power * (stab ? 1.5 : 1);
  const effectivenessResolution = resolveEffectiveness(catalog, skill.element_id, defender.critter, effectivenessInputs);
  const effectiveness = effectivenessResolution.totalMultiplier;
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
      baseEffectiveness: effectivenessResolution.baseMultiplier,
      baseClassification: effectivenessResolution.baseClassification,
      classification: effectivenessResolution.classification,
      suffix: effectivenessResolution.suffix,
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

export function rollManaDie(min: number, max: number, random: () => number = Math.random): number {
  const { diceMin: lower, diceMax: upper } = normalizeManaDiceBounds(min, max, Math.floor);
  return lower + Math.floor(random() * (upper - lower + 1));
}
