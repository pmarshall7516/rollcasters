export type LocalServerCompatibilityIdentity = {
  version: string;
  catalogReleaseId: string;
  protocol: string;
};

export type ActiveGameUpdateIdentity = {
  version: string;
  catalogReleaseId: string;
  clientProtocolVersion: number;
};

/**
 * Local browser clients may render a candidate Catalog while the Production
 * server still accepts the currently active Game Update. Keep that server
 * identity separate from the candidate's own version and Catalog metadata.
 */
export function resolveLocalServerCompatibilityIdentity(
  current: LocalServerCompatibilityIdentity,
  active: ActiveGameUpdateIdentity | null | undefined,
): LocalServerCompatibilityIdentity {
  if (!active) return current;
  return {
    version: active.version,
    catalogReleaseId: active.catalogReleaseId,
    protocol: String(active.clientProtocolVersion),
  };
}

export function isLocalCatalogPreview(profile: "local" | "stable", enabled: boolean): boolean {
  return profile === "local" && enabled;
}

/**
 * Local packaged previews use the candidate Catalog but must still present
 * the active server Game Update identity to compatibility-gated RPCs.
 */
export function shouldSyncLocalServerCompatibility(profile: "local" | "stable"): boolean {
  return profile === "local";
}
