import {
  isLocalCatalogPreview,
  resolveLocalServerCompatibilityIdentity,
} from "../src/lib/local-release-preview.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const initial = {
  version: "1.0.0",
  catalogReleaseId: "2026.08.22.1",
  protocol: "1",
};
const active = {
  version: "1.0.2",
  catalogReleaseId: "2026.08.23.1",
  clientProtocolVersion: 1,
};

check(
  JSON.stringify(resolveLocalServerCompatibilityIdentity(initial, active)) ===
    JSON.stringify({ version: "1.0.2", catalogReleaseId: "2026.08.23.1", protocol: "1" }),
  "A local client must use the active server Game Update identity for RPC compatibility.",
);
check(
  JSON.stringify(resolveLocalServerCompatibilityIdentity(initial, null)) === JSON.stringify(initial),
  "A local client must retain its configured identity when no Game Update is active.",
);
check(isLocalCatalogPreview("local", true), "The local exact-Catalog launcher must enable preview mode.");
check(!isLocalCatalogPreview("stable", true), "Stable builds must never enable local Catalog preview mode.");

console.log("Local release preview compatibility contract passed.");
