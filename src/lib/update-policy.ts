export type UpdateBoundary = "startup" | "idle" | "dungeon" | "lootbox";
export type UpdatePolicyState =
  | { kind: "clear" }
  | { kind: "notice"; version: string; activatesAt: string }
  | { kind: "deferred"; version: string; boundary: "dungeon" | "lootbox" }
  | { kind: "required"; version: string; reason: "startup" | "active" | "maintenance" };

export type UpdatePolicyInput = {
  availableVersion?: string;
  activation: "inactive" | "scheduled" | "active";
  activatesAt?: string;
  maintenance?: boolean;
  boundary: UpdateBoundary;
};

export function evaluateUpdatePolicy(input: UpdatePolicyInput): UpdatePolicyState {
  if (!input.availableVersion) return { kind: "clear" };
  if (input.activation === "scheduled" && input.activatesAt) {
    return { kind: "notice", version: input.availableVersion, activatesAt: input.activatesAt };
  }
  if (input.activation !== "active" && !input.maintenance) return { kind: "clear" };
  if (!input.maintenance && (input.boundary === "dungeon" || input.boundary === "lootbox")) {
    return { kind: "deferred", version: input.availableVersion, boundary: input.boundary };
  }
  return {
    kind: "required",
    version: input.availableVersion,
    reason: input.maintenance ? "maintenance" : input.boundary === "startup" ? "startup" : "active",
  };
}

export function operationAllowed(state: UpdatePolicyState, operation: "bootstrap" | "new-mutation" | "dungeon-boundary" | "lootbox-receipt"): boolean {
  if (state.kind === "clear" || state.kind === "notice") return true;
  if (state.kind === "required") return false;
  return state.boundary === "dungeon" ? operation === "dungeon-boundary" : operation === "lootbox-receipt";
}

