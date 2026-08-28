import { skillElementIds } from "./effects.js";
import { roundHalfUp } from "./combat-calculations.js";
import type { ActionCostAction, ActionCostBreakdown, ActionCostModifier } from "./game.js";

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

export function applyActionCostModifiers(base: number, modifiers: ActionCostModifier[]): ActionCostBreakdown {
  let cost = Math.max(0, base);
  const sources: Array<{ amount: number; sourceName: string }> = [];
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
