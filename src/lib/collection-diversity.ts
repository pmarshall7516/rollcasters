import { maximumDistinctElementMatches } from "./element-matching.js";

type DiversityParameters = Record<string, unknown>;

export type CollectionDiversityCandidate = {
  id: string;
  elementIds: readonly string[];
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : [];
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = typeof value === "number" || typeof value === "string" ? Number(value) : fallback;
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

export function collectionDiversityGoal(parameters: DiversityParameters): bigint {
  const mode = String(parameters.diversity_mode ?? "different_types");
  if (mode === "amount_of_type") return BigInt(positiveInteger(parameters.required_per_type, 1));
  if (mode === "different_types") return BigInt(positiveInteger(parameters.required_distinct_types, 1));
  return BigInt(stringArray(parameters.required_element_ids).length * positiveInteger(parameters.required_per_type, 1));
}

export function collectionDiversityProgress(
  candidates: readonly CollectionDiversityCandidate[],
  parameters: DiversityParameters,
): bigint {
  const requiredPerType = positiveInteger(parameters.required_per_type, 1);
  const buckets = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const elementId of stringArray(candidate.elementIds)) {
      const bucket = buckets.get(elementId) ?? new Set<string>();
      bucket.add(candidate.id);
      buckets.set(elementId, bucket);
    }
  }

  const mode = String(parameters.diversity_mode ?? "different_types");
  if (mode === "amount_of_type") {
    const elementId = stringArray(parameters.element_ids)[0];
    return BigInt(elementId ? buckets.get(elementId)?.size ?? 0 : 0);
  }

  const selected = mode === "specific_types"
    ? stringArray(parameters.required_element_ids)
    : [...buckets.keys()];
  if (mode === "specific_types" && parameters.require_unique_critters === true) {
    const requiredSlots = selected.flatMap((elementId) => Array.from({ length: requiredPerType }, () => elementId));
    return BigInt(maximumDistinctElementMatches(candidates, requiredSlots));
  }
  if (mode === "specific_types") {
    return BigInt(selected.reduce((total, elementId) => total + Math.min(buckets.get(elementId)?.size ?? 0, requiredPerType), 0));
  }
  return BigInt(selected.filter((elementId) => (buckets.get(elementId)?.size ?? 0) >= requiredPerType).length);
}
