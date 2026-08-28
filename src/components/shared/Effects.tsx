import type { ReactNode } from "react";
import { effectMatchesSourceCritter, sourceElementIds } from "../../lib/effects.js";
import type { Critter, ResolvedEffectRef } from "../../lib/types.js";

function effectRequirementState(effect: ResolvedEffectRef, sourceCritter?: Critter): "none" | "unknown" | "active" | "inactive" {
  if (!sourceElementIds(effect).length) return "none";
  if (!sourceCritter) return "unknown";
  return effectMatchesSourceCritter(effect, sourceCritter) ? "active" : "inactive";
}

export function attachmentText(effects: ResolvedEffectRef[]): string {
  return effects.filter((effect) => effect.execution !== "child").map((effect) => `${effect.name}: ${effect.description}`).join(" ");
}

export function attachmentRows(effects: ResolvedEffectRef[], sourceCritter?: Critter): ReactNode {
  return effects.filter((effect) => effect.execution !== "child").map((effect) => {
    const state = effectRequirementState(effect, sourceCritter);
    return <span className={`tooltip-description effect-conditional-row ${state === "inactive" ? "effect-condition-inactive" : ""} effect-classification-${effect.classification ?? "mixed"}`} key={effect.id}><span><strong>{effect.name}:</strong> {effect.description}</span></span>;
  });
}

export function EffectList({ effects, className = "", sourceCritter }: { effects: ResolvedEffectRef[]; className?: string; sourceCritter?: Critter }) {
  const visibleEffects = effects.filter((effect) => effect.execution !== "child");
  return (
    <span className={`effect-list ${className}`.trim()}>
      {visibleEffects.length
        ? visibleEffects.map((effect) => {
          const state = effectRequirementState(effect, sourceCritter);
          return <span className={`effect-list-row effect-conditional-row ${state === "inactive" ? "effect-condition-inactive" : ""} effect-classification-${effect.classification ?? "mixed"}`} key={effect.id}><span><strong>{effect.name}:</strong> {effect.description}</span></span>;
        })
        : <span className="effect-list-row">No additional effect.</span>}
    </span>
  );
}
