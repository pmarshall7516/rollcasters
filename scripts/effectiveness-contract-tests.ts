import { assertEffectContract } from "../src/lib/effects.js";
import type { EffectOwnerType, ResolvedEffectRef } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function effect(ownerType: EffectOwnerType, runtimeKind: string, parameters: Record<string, unknown>, execution: "root" | "child" = "root"): ResolvedEffectRef {
  return { id: `${ownerType}-${runtimeKind}`, name: "test", description: "test", ownerType, ownerId: "owner", templateId: "test", runtimeKind, runtimeVersion: 1, parameters, execution, classification: "positive", sortOrder: 0 };
}
assertEffectContract(effect("skill", "effectiveness_modifier", { tier_modifiers: [{ tier: "extra-effective", percent_delta: 0.5 }] }), "skill");
assertEffectContract(effect("relic", "skill_effectiveness", { target: "equipped_critter", direction: "received", affected_skill_element_ids: ["tera"], percent_delta: -1 }), "relic");
let failed = false;
try { assertEffectContract(effect("status", "skill_effectiveness", { target: "status_holder", direction: "received", percent_delta: 1 }), "status"); } catch { failed = true; }
check(failed, "Status ownership must be rejected for effectiveness runtimes.");
failed = false;
try { assertEffectContract(effect("skill", "skill_effectiveness", { defender_element_rows: [{ element_id: "aqua", percent_delta: -1.1 }] }), "skill"); } catch { failed = true; }
check(failed, "Skill Effectiveness deltas below -1.00 must be rejected.");
console.log("Effectiveness contract tests passed.");
