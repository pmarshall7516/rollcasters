import {
  assembleCatalog,
  assertServerCatalogCompatibility,
  isMinimumVersionSatisfied,
  parseCatalogReleaseManifest,
  parseCatalogReleasePointer,
  sha256Hex,
  type CatalogPackKey,
} from "../src/lib/catalog-release.js";
import type { Catalog } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectError(work: () => unknown | Promise<unknown>, phrase: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof Error && error.message.includes(phrase), `Expected error containing "${phrase}".`);
    return;
  }
  throw new Error(`Expected error containing "${phrase}".`);
}

const pointer = parseCatalogReleasePointer({
  schemaVersion: 1,
  catalogVersion: "2026.07.20.1",
  releaseManifestUrl: "releases/2026.07.20.1/release.json",
  releaseManifestSha256: "a".repeat(64),
  publishedAt: "2026-07-20T00:00:00.000Z",
  minimumGameVersion: "0.1.0",
});
check(pointer.catalogVersion === "2026.07.20.1", "The release pointer must retain its version.");
await expectError(() => parseCatalogReleasePointer({ schemaVersion: 1 }), "catalogVersion");

const descriptor = (key: CatalogPackKey) => ({ key, url: `${key}.json`, sha256: "b".repeat(64), byteSize: 2 });
const manifest = parseCatalogReleaseManifest({
  schemaVersion: 1,
  catalogVersion: pointer.catalogVersion,
  publishedAt: pointer.publishedAt,
  minimumGameVersion: "0.1.0",
  runtimeContractVersion: 1,
  serverCatalogVersion: pointer.catalogVersion,
  assetBaseUrl: "../../../game-assets",
  assetManifestUrl: "../../../game-assets/assets.json",
  assetManifestSha256: "c".repeat(64),
  previousCatalogVersion: null,
  packs: [descriptor("core"), descriptor("combat"), descriptor("collectibles"), descriptor("dungeons")],
});
check(manifest.packs.length === 4, "The manifest must retain all loading tiers.");
await expectError(() => parseCatalogReleaseManifest({ ...manifest, packs: [descriptor("core"), descriptor("core")] }), "Duplicate");
check(isMinimumVersionSatisfied("1.2.3", "1.2.3"), "An exact client version must be compatible.");
check(isMinimumVersionSatisfied("1.3.0", "1.2.9"), "A newer client version must be compatible.");
check(!isMinimumVersionSatisfied("1.2.9", "1.3.0"), "An older client version must be rejected.");
check(await sha256Hex(new TextEncoder().encode("abc").buffer) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256 verification must be deterministic.");
const releaseInfo = { schemaVersion: 1, catalogVersion: pointer.catalogVersion, publishedAt: pointer.publishedAt, manifestUrl: "https://example.test/release.json", assetBaseUrl: null, source: "network" as const };
assertServerCatalogCompatibility(releaseInfo, undefined, false);
assertServerCatalogCompatibility(releaseInfo, pointer.catalogVersion, true);
await expectError(() => assertServerCatalogCompatibility(releaseInfo, undefined, true), "server accepts none");

const emptyCatalog: Catalog = {
  currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [],
  elements: [], elementEffectiveness: [], skills: [], critters: [], critterProgression: [], critterSkillUnlocks: [],
  rollcasters: [], rollcasterProgression: [], rollcasterAbilities: [], rollcasterAbilityUnlocks: [], relics: [],
  dungeons: [], dungeonOpponents: [], dungeonCompletionDrops: [], starterRollcasterOptions: [], starterOptions: [],
  gameAssets: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {},
  dungeonOpponentStatOverrides: [],
};
const assembled = assembleCatalog([
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "core", currencies: [], elements: [], elementEffectiveness: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [] },
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "combat", skills: [], rollcasterAbilities: [], relics: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {} },
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "collectibles", collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], critters: [], critterProgression: [], critterSkillUnlocks: [], rollcasters: [], rollcasterProgression: [], rollcasterAbilityUnlocks: [] },
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "dungeons", dungeons: [], dungeonOpponents: [], dungeonCompletionDrops: [], dungeonOpponentStatOverrides: [] },
]);
check(Object.keys(assembled).sort().join(",") === Object.keys(emptyCatalog).sort().join(","), "Tier assembly must produce exactly one complete Catalog contract.");
await expectError(() => assembleCatalog([{ schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "core", currencies: [] }]), "Catalog release is missing");

console.log("Catalog release contract tests passed.");
