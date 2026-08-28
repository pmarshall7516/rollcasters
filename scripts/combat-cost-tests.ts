import { actionCostModifierApplies, applyActionCostModifiers } from "../src/lib/combat-costs.js";
import type { ActionCostAction, ActionCostModifier } from "../src/lib/game.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const attack: ActionCostAction = { type: "skill", skillType: "attack", skillElementId: "fire", skillTagIds: ["starter"] };
check(actionCostModifierApplies({ applicable_action: "skills_attack", skill_element_ids: ["fire"] }, attack), "matching attack elements should apply");
check(!actionCostModifierApplies({ applicable_action: "skills_support" }, attack), "support-only modifiers should not apply to attacks");
check(actionCostModifierApplies({ applicable_action: "matching_skills", skill_tag_ids: ["starter"] }, attack), "matching skill tags should apply");
check(!actionCostModifierApplies({ applicable_action: "skill_mana", cost_type: "block" }, attack), "legacy incompatible cost types should remain excluded");
check(actionCostModifierApplies({ applicable_action: "all_actions" }, { type: "skip" }), "all-action modifiers should apply to skips as before");

const modifiers: ActionCostModifier[] = [
  { parameters: { modifier_type: "flat", modifier_value: -2, minimum_cost: 1 }, sourceName: "Discount" },
  { parameters: { modifier_type: "percentage", modifier_value: 0.5, maximum_cost: 4 }, sourceName: "Surcharge" },
];
const result = applyActionCostModifiers(5, modifiers);
check(result.base === 5 && result.final === 4, "cost modifiers should preserve sequential arithmetic and bounds");
check(JSON.stringify(result.sources) === JSON.stringify([{ amount: -2, sourceName: "Discount" }, { amount: 1, sourceName: "Surcharge" }]), "cost sources should preserve modifier deltas and order");
check(applyActionCostModifiers(-3, []).final === 0, "negative base costs should remain clamped");

console.log("Combat cost tests passed.");
