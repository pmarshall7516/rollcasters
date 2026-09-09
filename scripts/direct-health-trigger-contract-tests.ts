import { assertEffectContract, effectMatchesTriggerSkill } from "../src/lib/effects.js";
import type { EffectOwnerType, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(run: () => void, message: string, pattern: RegExp): void {
  try {
    run();
  } catch (error) {
    check(pattern.test(String(error)), message);
    return;
  }
  throw new Error(message);
}

function effect(parameters: Record<string, unknown>): ResolvedEffectRef {
  return {
    id: "thorns",
    name: "Thorns",
    description: "Thorns.",
    ownerType: "relic" as EffectOwnerType,
    ownerId: "spiky",
    templateId: "relic-direct-health-modifier",
    runtimeKind: "direct_health_modifier",
    runtimeVersion: 1,
    parameters,
    sortOrder: 0,
  };
}

const base = effect({
  target: "attacker",
  operation: "lose_hp",
  value_type: "flat",
  value: 5,
  activation_chance: 1,
  can_defeat_target: true,
  affected_by_shield: false,
  trigger_skill_scope: "all",
  trigger_skill_tag_ids: ["contact"],
  trigger_skill_element_ids: ["basic"],
});

assertEffectContract(base, "relic");
check(effectMatchesTriggerSkill(base, { skill_type: "attack", element_id: "basic", tag_ids: ["contact"] }), "Matching attack Skill metadata must satisfy all configured trigger filters.");
check(!effectMatchesTriggerSkill(base, { skill_type: "attack", element_id: "basic", tag_ids: ["pulse"] }), "A missing trigger Skill Tag must reject the reaction.");
const attackScope = effect({ ...base.parameters, trigger_skill_scope: "attack" });
check(!effectMatchesTriggerSkill(attackScope, { skill_type: "support", element_id: "basic", tag_ids: ["contact"] }), "A mismatched trigger Skill scope must reject the reaction.");
const supportScope = effect({ ...base.parameters, trigger_skill_scope: "support", trigger_skill_tag_ids: [], trigger_skill_element_ids: [] });
check(effectMatchesTriggerSkill(supportScope, { skill_type: "support", element_id: "basic", tag_ids: [] }), "Support scope must accept support Skills.");
check(!effectMatchesTriggerSkill(supportScope, { skill_type: "attack", element_id: "basic", tag_ids: [] }), "Support scope must reject attack Skills.");
expectThrows(
  () => assertEffectContract(effect({ ...base.parameters, trigger_skill_scope: "invalid" }), "relic"),
  "Invalid Direct Health Modifier trigger scope must be rejected.",
  /trigger_skill_scope/,
);
expectThrows(
  () => assertEffectContract(effect({ ...base.parameters, trigger_skill_tag_ids: [1] }), "relic"),
  "Non-string Direct Health Modifier trigger tags must be rejected.",
  /trigger_skill_tag_ids/,
);
expectThrows(
  () => assertEffectContract(effect({ ...base.parameters, target: "equipped_critter" }), "relic"),
  "Attacker trigger filters must not be allowed on equipped_critter targets.",
  /trigger skill filters require/,
);

console.log("Direct Health Modifier trigger contract tests passed.");
