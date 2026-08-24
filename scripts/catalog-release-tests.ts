import {
  assembleCatalog,
  assertServerCatalogCompatibility,
  isMinimumVersionSatisfied,
  loadPublishedCatalog,
  parseCatalogReleaseManifest,
  parseCatalogReleasePointer,
  resolveCatalogBaseUrl,
  sha256Hex,
  sha256HexFallback,
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
check(
  resolveCatalogBaseUrl("/desktop-catalog/game-data", "https://tauri.localhost/") === "https://tauri.localhost/desktop-catalog/game-data/",
  "The desktop catalog path must resolve against the app origin.",
);
check(
  resolveCatalogBaseUrl("/desktop-catalog/game-data", "tauri://localhost/") === "http://tauri.localhost/desktop-catalog/game-data/",
  "macOS Tauri catalog paths must resolve through an HTTP localhost alias.",
);
check(await sha256Hex(new TextEncoder().encode("abc").buffer) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256 verification must be deterministic.");
check(sha256HexFallback(new ArrayBuffer(0)) === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "Fallback SHA-256 must hash empty bytes correctly.");
check(sha256HexFallback(new TextEncoder().encode("abc").buffer) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "Fallback SHA-256 must match the standard abc vector.");

const testReleaseId = "2026.07.20.1";
const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const testPacks = [
  { schemaVersion: 1, catalogVersion: testReleaseId, pack: "core", currencies: [], elements: [], elementEffectiveness: [], tags: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [] },
  { schemaVersion: 1, catalogVersion: testReleaseId, pack: "combat", skills: [], rollcasterAbilities: [], relics: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {} },
  { schemaVersion: 1, catalogVersion: testReleaseId, pack: "collectibles", collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [], critters: [], critterProgression: [], critterSkillUnlocks: [], rollcasters: [], rollcasterProgression: [], rollcasterAbilityUnlocks: [] },
  { schemaVersion: 1, catalogVersion: testReleaseId, pack: "dungeons", dungeons: [], dungeonOpponents: [], dungeonEnemyRollcasters: [], dungeonRegularEncounters: [], dungeonBossEncounters: [], dungeonCompletionDrops: [], dungeonOpponentStatOverrides: [] },
] as const;
const testManifestPath = `releases/${testReleaseId}/release.json`;
const testManifestUrl = `https://tauri.localhost/desktop-catalog/game-data/${testManifestPath}`;
const testPackEntries = testPacks.map((pack) => {
  const bytes = encodeJson(pack);
  return { pack, bytes, descriptor: { key: pack.pack, url: `${pack.pack}.json`, sha256: "", byteSize: bytes.byteLength } };
});
for (const entry of testPackEntries) entry.descriptor.sha256 = await sha256Hex(entry.bytes.buffer);
const testAssetManifest = { schemaVersion: 1, catalogVersion: testReleaseId, assets: [] };
const testAssetBytes = encodeJson(testAssetManifest);
const testManifest = {
  schemaVersion: 1,
  catalogVersion: testReleaseId,
  publishedAt: "2026-07-20T00:00:00.000Z",
  minimumGameVersion: "0.1.0",
  runtimeContractVersion: 1,
  serverCatalogVersion: testReleaseId,
  assetBaseUrl: "../../../game-assets",
  assetManifestUrl: "../../../game-assets/assets.json",
  assetManifestSha256: await sha256Hex(testAssetBytes.buffer),
  previousCatalogVersion: null,
  packs: testPackEntries.map(({ descriptor }) => descriptor),
};
const testManifestBytes = encodeJson(testManifest);
const testLatestUrl = "https://tauri.localhost/desktop-catalog/game-data/latest.json";
const testResponses = new Map<string, Uint8Array>([
  [testLatestUrl, encodeJson({ schemaVersion: 1, catalogVersion: testReleaseId, releaseManifestUrl: testManifestPath, releaseManifestSha256: await sha256Hex(testManifestBytes.buffer), publishedAt: testManifest.publishedAt, minimumGameVersion: testManifest.minimumGameVersion })],
  [testManifestUrl, testManifestBytes],
  ["https://tauri.localhost/desktop-catalog/game-assets/assets.json", testAssetBytes],
  ...testPackEntries.map(({ pack, bytes }) => [`https://tauri.localhost/desktop-catalog/game-data/releases/${testReleaseId}/${pack.pack}.json`, bytes] as const),
]);
const originalFetch = globalThis.fetch;
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
try {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://tauri.localhost/" } });
  globalThis.fetch = async (input) => {
    const bytes = testResponses.get(String(input));
    return bytes ? new Response(bytes as unknown as BodyInit, { status: 200 }) : new Response("Not found", { status: 404 });
  };
  const loaded = await loadPublishedCatalog("/desktop-catalog/game-data", "0.1.0");
  check(loaded.release.catalogVersion === testReleaseId, "The desktop loader must load the selected release through its relative catalog root.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation);
  else delete (globalThis as { location?: Location }).location;
}
const releaseInfo = { schemaVersion: 1, catalogVersion: pointer.catalogVersion, publishedAt: pointer.publishedAt, manifestUrl: "https://example.test/release.json", assetBaseUrl: null, source: "network" as const };
assertServerCatalogCompatibility(releaseInfo, undefined, false);
assertServerCatalogCompatibility(releaseInfo, pointer.catalogVersion, true);
await expectError(() => assertServerCatalogCompatibility(releaseInfo, undefined, true), "server accepts none");

const emptyCatalog: Catalog = {
  currencies: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [],
  elements: [], elementEffectiveness: [], skills: [], critters: [], critterProgression: [], critterSkillUnlocks: [],
  tags: [],
  rollcasters: [], rollcasterProgression: [], rollcasterAbilities: [], rollcasterAbilityUnlocks: [], relics: [],
  dungeons: [], dungeonOpponents: [], dungeonEnemyRollcasters: [], dungeonRegularEncounters: [], dungeonBossEncounters: [], dungeonCompletionDrops: [], starterRollcasterOptions: [], starterOptions: [],
  gameAssets: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {},
  dungeonOpponentStatOverrides: [],
};
const assembled = assembleCatalog([
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "core", currencies: [], elements: [], elementEffectiveness: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [] },
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "combat", skills: [], rollcasterAbilities: [], relics: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {} },
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "collectibles", collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [], critters: [], critterProgression: [], critterSkillUnlocks: [], rollcasters: [], rollcasterProgression: [], rollcasterAbilityUnlocks: [] },
  { schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "dungeons", dungeons: [], dungeonOpponents: [], dungeonCompletionDrops: [], dungeonOpponentStatOverrides: [] },
]);
check(Object.keys(assembled).sort().join(",") === Object.keys(emptyCatalog).sort().join(","), "Tier assembly must produce exactly one complete Catalog contract.");
await expectError(() => assembleCatalog([{ schemaVersion: 1, catalogVersion: pointer.catalogVersion, pack: "core", currencies: [] }]), "Catalog release is missing");
await expectError(() => assembleCatalog([
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "core", currencies: [], elements: [], elementEffectiveness: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [] },
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "combat", skills: [], rollcasterAbilities: [], relics: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {} },
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "collectibles", collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [], critters: [], critterProgression: [], critterSkillUnlocks: [], rollcasters: [], rollcasterProgression: [], rollcasterAbilityUnlocks: [] },
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "dungeons", dungeons: [], dungeonOpponents: [], dungeonCompletionDrops: [], dungeonOpponentStatOverrides: [] },
]), "unlockChallengeTemplates");
const schemaTwo = assembleCatalog([
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "core", currencies: [], elements: [], elementEffectiveness: [], starterRollcasterOptions: [], starterOptions: [], gameAssets: [] },
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "combat", skills: [], rollcasterAbilities: [], relics: [], statuses: [], effectsBySkill: {}, effectsByAbility: {}, effectsByRelic: {}, effectsByStatus: {} },
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "collectibles", unlockChallengeTemplates: [], collectibleUnlockRequirements: [], collectibleUnlockChallenges: [], shopEntries: [], lootboxes: [], lootboxPoolEntries: [], critters: [], critterProgression: [], critterSkillUnlocks: [], rollcasters: [], rollcasterProgression: [], rollcasterAbilityUnlocks: [] },
  { schemaVersion: 2, catalogVersion: pointer.catalogVersion, pack: "dungeons", dungeons: [], dungeonOpponents: [], dungeonCompletionDrops: [], dungeonOpponentStatOverrides: [] },
]);
check(Array.isArray(schemaTwo.unlockChallengeTemplates), "Schema 2 must preserve Challenge Template metadata.");

console.log("Catalog release contract tests passed.");
