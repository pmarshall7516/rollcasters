import {
  calculateSkillDamage,
  classifyEffectiveness,
  elementEffectiveness,
  normalizeManaDiceBounds,
  rollDamagePercent,
  rollManaDie,
  roundHalfUp,
} from "../src/lib/combat-calculations.js";
import type { CombatUnit } from "../src/lib/game.js";
import type { Catalog, Critter, Skill } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

check(roundHalfUp(1.5) === 2 && roundHalfUp(-1.5) === -2 && roundHalfUp(Number.NaN) === 0, "half-up rounding should preserve signed and non-finite behavior");
check(JSON.stringify(normalizeManaDiceBounds(12.4, 3.6)) === JSON.stringify({ diceMin: 4, diceMax: 4 }), "mana bounds should clamp the rounded minimum to the rounded maximum");
check(classifyEffectiveness(1).classification === "neutral" && classifyEffectiveness(2).classification === "extra-effective" && classifyEffectiveness(0.5).classification === "extra-resisted", "effectiveness classifications should preserve thresholds");

const catalog = {
  elementEffectiveness: [
    { attacking_element_id: "fire", defending_element_id: "grass", multiplier: 2 },
    { attacking_element_id: "fire", defending_element_id: "water", multiplier: 0.5 },
  ],
} as Pick<Catalog, "elementEffectiveness">;
const defender = { element_1_id: "grass", element_2_id: "water" } as Pick<Critter, "element_1_id" | "element_2_id">;
check(elementEffectiveness(catalog, "fire", defender) === 1, "dual-type effectiveness should multiply both defending elements");

const attacker = { level: 10, stats: { atk: 20 }, critter: { element_1_id: "fire", element_2_id: null } } as unknown as CombatUnit;
const damageTarget = { stats: { def: 10 }, critter: { element_1_id: "grass", element_2_id: null } } as unknown as CombatUnit;
const skill = { skill_type: "attack", power: 10, element_id: "fire" } as Skill;
const single = calculateSkillDamage(catalog, attacker, damageTarget, skill, () => 0, 1);
const multi = calculateSkillDamage(catalog, attacker, damageTarget, skill, () => 0, 2);
check(single.damageRollPercent === 85 && single.stab && single.effectiveness === 2, "damage calculations should preserve STAB, effectiveness, and the inclusive roll floor");
check(multi.targetCount === 2 && multi.spreadMultiplier === 0.75 && multi.maxDamage < single.maxDamage, "multi-target damage should preserve its spread multiplier");
check(rollDamagePercent(() => 0) === 85 && rollDamagePercent(() => 1) === 100, "damage roll bounds should remain inclusive");
check(rollManaDie(2, 4, () => 0) === 2 && rollManaDie(2, 4, () => 0.999999) === 4, "mana rolls should preserve inclusive bounds");

console.log("Combat calculation tests passed.");
