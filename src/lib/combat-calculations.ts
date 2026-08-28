import type { Catalog, Critter, Skill } from "./types.js";
import type { CombatUnit, EffectivenessClass, SkillDamage } from "./game.js";

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
  const stab = attacker.critter.element_1_id === skill.element_id || attacker.critter.element_2_id === skill.element_id;
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

export function rollManaDie(min: number, max: number, random: () => number = Math.random): number {
  const { diceMin: lower, diceMax: upper } = normalizeManaDiceBounds(min, max, Math.floor);
  return lower + Math.floor(random() * (upper - lower + 1));
}
