export type ElementMatchCandidate = {
  id: string;
  elementIds: readonly string[];
};

/** Returns how many required Elements can be assigned to different Critters. */
export function maximumDistinctElementMatches(
  candidates: readonly ElementMatchCandidate[],
  requiredElementIds: readonly string[],
): number {
  const candidateElements = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!candidate.id) continue;
    const elements = candidateElements.get(candidate.id) ?? new Set<string>();
    for (const elementId of candidate.elementIds) if (elementId) elements.add(elementId);
    candidateElements.set(candidate.id, elements);
  }

  const assignedElementByCritter = new Map<string, string>();
  const assign = (elementId: string, visited: Set<string>): boolean => {
    for (const [critterId, elements] of candidateElements) {
      if (!elements.has(elementId) || visited.has(critterId)) continue;
      visited.add(critterId);
      const previousElement = assignedElementByCritter.get(critterId);
      if (!previousElement || assign(previousElement, visited)) {
        assignedElementByCritter.set(critterId, elementId);
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (const elementId of requiredElementIds) {
    if (assign(elementId, new Set<string>())) matched += 1;
  }
  return matched;
}
