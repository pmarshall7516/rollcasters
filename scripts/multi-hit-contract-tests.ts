import { assertEffectContract } from "../src/lib/effects.js";
import type { EffectOwnerType, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function throws(fn: () => void, message: string): void {
  let didThrow = false;
  try { fn(); } catch { didThrow = true; }
  check(didThrow, message);
}

function effect(ownerType: EffectOwnerType, ownerId: string, id: string, runtimeKind: string, parameters: Record<string, unknown>, execution: "root" | "child" = "root"): ResolvedEffectRef {
  return {
    id,
    name: id,
    description: id,
    ownerType,
    ownerId,
    templateId: `${ownerType}-${runtimeKind}`,
    runtimeKind,
    runtimeVersion: 1,
    parameters,
    sortOrder: 0,
    execution,
  };
}

check((() => { try { assertEffectContract(effect("skill", "skill-a", "multi", "multi_hit", { minimum_hits: 0, maximum_hits: Number.MAX_SAFE_INTEGER }), "skill"); return true; } catch { return false; } })(), "A valid unbounded Multi-Hit contract must be accepted.");
for (const parameters of [
  { minimum_hits: -1, maximum_hits: 2 },
  { minimum_hits: 1.5, maximum_hits: 2 },
  { minimum_hits: 1, maximum_hits: Number.MAX_SAFE_INTEGER + 1 },
  { minimum_hits: 3, maximum_hits: 2 },
  { minimum_hits: 1, maximum_hits: 2, unexpected: true },
]) {
  throws(() => assertEffectContract(effect("skill", "skill-a", "invalid", "multi_hit", parameters), "skill"), "Invalid Multi-Hit parameters must be rejected.");
}
throws(() => assertEffectContract(effect("ability", "ability-a", "bad-owner", "multi_hit", { minimum_hits: 1, maximum_hits: 2 }), "ability"), "Multi-Hit must be Skill-only.");
throws(() => assertEffectContract(effect("skill", "skill-a", "bad-execution", "multi_hit", { minimum_hits: 1, maximum_hits: 2 }, "child"), "skill"), "Multi-Hit must be Root-only.");

const modifierParameters = {
  target: "equipped_critter",
  modifier_mode: "higher",
  additional_rolls: 1,
  affected_skill_category: "attack",
  affected_skill_element_ids: [],
  affected_skill_tag_ids: [],
  target_element_ids: [],
  target_critter_tag_ids: [],
  source_element_ids: [],
  source_critter_tag_ids: [],
  duration_type: "while_relic_equipped",
  duration_clock: "owner_turn",
};
check((() => { try { assertEffectContract(effect("relic", "relic-a", "modifier", "multi_hit_modifier", modifierParameters), "relic"); return true; } catch { return false; } })(), "A valid Relic Multi-Hit modifier must be accepted.");
for (const parameters of [
  { ...modifierParameters, modifier_mode: "sideways" },
  { ...modifierParameters, additional_rolls: 0 },
  { ...modifierParameters, additional_rolls: 1.5 },
  { ...modifierParameters, additional_rolls: Number.MAX_SAFE_INTEGER + 1 },
  { ...modifierParameters, target: "all_friendlies" },
]) {
  throws(() => assertEffectContract(effect("relic", "relic-a", "invalid-modifier", "multi_hit_modifier", parameters), "relic"), "Invalid Multi-Hit modifier parameters must be rejected.");
}
throws(() => assertEffectContract(effect("status", "status-a", "bad-owner", "multi_hit_modifier", modifierParameters), "status"), "Multi-Hit modifiers must be Ability or Relic-only.");

console.log("Multi-Hit Effect contract tests passed.");
