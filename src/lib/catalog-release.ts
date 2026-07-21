import type { Catalog, CatalogReleaseInfo } from "./types.js";

export const SUPPORTED_CATALOG_SCHEMA_VERSION = 2;
export const CATALOG_CACHE_NAME = "rollcasters-catalog-v2";

const LAST_VERIFIED_CACHE_KEY = "/__rollcasters_catalog_last_verified_v2__.json";
const isSupportedCatalogSchema = (version: number) => version === 1 || version === SUPPORTED_CATALOG_SCHEMA_VERSION;
const CATALOG_KEYS = [
  "currencies",
  "collectibleUnlockRequirements",
  "collectibleUnlockChallenges",
  "shopEntries",
  "elements",
  "elementEffectiveness",
  "skills",
  "critters",
  "critterProgression",
  "critterSkillUnlocks",
  "rollcasters",
  "rollcasterProgression",
  "rollcasterAbilities",
  "rollcasterAbilityUnlocks",
  "relics",
  "dungeons",
  "dungeonOpponents",
  "dungeonCompletionDrops",
  "starterRollcasterOptions",
  "starterOptions",
  "gameAssets",
  "statuses",
  "effectsBySkill",
  "effectsByAbility",
  "effectsByRelic",
  "effectsByStatus",
  "dungeonOpponentStatOverrides",
] as const satisfies readonly (keyof Catalog)[];

export type CatalogPackKey = "core" | "combat" | "collectibles" | "dungeons";

export type CatalogReleasePointer = {
  schemaVersion: number;
  catalogVersion: string;
  releaseManifestUrl: string;
  releaseManifestSha256: string;
  publishedAt: string;
  minimumGameVersion: string;
};

export type CatalogPackDescriptor = {
  key: CatalogPackKey;
  url: string;
  sha256: string;
  byteSize: number;
};

export type CatalogReleaseManifest = {
  schemaVersion: number;
  catalogVersion: string;
  publishedAt: string;
  minimumGameVersion: string;
  runtimeContractVersion: number;
  serverCatalogVersion: string;
  assetBaseUrl: string | null;
  assetManifestUrl: string | null;
  assetManifestSha256: string | null;
  previousCatalogVersion: string | null;
  packs: CatalogPackDescriptor[];
};

type CatalogPack = Partial<Catalog> & {
  schemaVersion: number;
  catalogVersion: string;
  pack: CatalogPackKey;
};

type FetchSource = "network" | "cache";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Catalog release is missing ${key}.`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Catalog release is missing ${key}.`);
  return value;
}

export function parseCatalogReleasePointer(value: unknown): CatalogReleasePointer {
  if (!isRecord(value)) throw new Error("Catalog release pointer must be an object.");
  return {
    schemaVersion: requiredNumber(value, "schemaVersion"),
    catalogVersion: requiredString(value, "catalogVersion"),
    releaseManifestUrl: requiredString(value, "releaseManifestUrl"),
    releaseManifestSha256: requiredString(value, "releaseManifestSha256"),
    publishedAt: requiredString(value, "publishedAt"),
    minimumGameVersion: requiredString(value, "minimumGameVersion"),
  };
}

export function parseCatalogReleaseManifest(value: unknown): CatalogReleaseManifest {
  if (!isRecord(value)) throw new Error("Catalog release manifest must be an object.");
  if (!Array.isArray(value.packs) || value.packs.length === 0) {
    throw new Error("Catalog release manifest has no packs.");
  }
  const packKeys = new Set<string>();
  const packs = value.packs.map((pack): CatalogPackDescriptor => {
    if (!isRecord(pack)) throw new Error("Catalog pack descriptor must be an object.");
    const key = requiredString(pack, "key") as CatalogPackKey;
    if (!["core", "combat", "collectibles", "dungeons"].includes(key)) {
      throw new Error(`Unsupported catalog pack: ${key}.`);
    }
    if (packKeys.has(key)) throw new Error(`Duplicate catalog pack: ${key}.`);
    packKeys.add(key);
    return {
      key,
      url: requiredString(pack, "url"),
      sha256: requiredString(pack, "sha256"),
      byteSize: requiredNumber(pack, "byteSize"),
    };
  });
  return {
    schemaVersion: requiredNumber(value, "schemaVersion"),
    catalogVersion: requiredString(value, "catalogVersion"),
    publishedAt: requiredString(value, "publishedAt"),
    minimumGameVersion: requiredString(value, "minimumGameVersion"),
    runtimeContractVersion: requiredNumber(value, "runtimeContractVersion"),
    serverCatalogVersion: requiredString(value, "serverCatalogVersion"),
    assetBaseUrl: typeof value.assetBaseUrl === "string" ? value.assetBaseUrl : null,
    assetManifestUrl: typeof value.assetManifestUrl === "string" ? value.assetManifestUrl : null,
    assetManifestSha256: typeof value.assetManifestSha256 === "string" ? value.assetManifestSha256 : null,
    previousCatalogVersion: typeof value.previousCatalogVersion === "string" ? value.previousCatalogVersion : null,
    packs,
  };
}

function semverParts(version: string): [number, number, number] {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Invalid semantic version: ${version}.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isMinimumVersionSatisfied(current: string, minimum: string): boolean {
  const currentParts = semverParts(current);
  const minimumParts = semverParts(minimum);
  for (let index = 0; index < currentParts.length; index += 1) {
    if (currentParts[index] !== minimumParts[index]) return currentParts[index] > minimumParts[index];
  }
  return true;
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotateRight = (value: number, count: number) => (value >>> count) | (value << (32 - count));

export function sha256HexFallback(bytes: ArrayBuffer): string {
  const source = new Uint8Array(bytes);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(source);
  padded[source.length] = 0x80;
  const bitLength = source.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return sha256HexFallback(bytes);
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function assertServerCatalogCompatibility(
  release: CatalogReleaseInfo | undefined,
  serverCatalogVersion: string | null | undefined,
  required: boolean,
): void {
  if (!required || !release || release.source === "live-development") return;
  if (serverCatalogVersion !== release.catalogVersion) {
    throw new Error(
      `Catalog release mismatch: game loaded ${release.catalogVersion}, server accepts ${serverCatalogVersion ?? "none"}.`,
    );
  }
}

async function openCatalogCache(): Promise<Cache | null> {
  return "caches" in globalThis ? caches.open(CATALOG_CACHE_NAME) : null;
}

async function verifiedResponse(
  url: string,
  expectedSha256: string,
  expectedBytes?: number,
): Promise<{ response: Response; source: FetchSource }> {
  const cache = await openCatalogCache();
  let response: Response | undefined;
  let source: FetchSource = "network";
  try {
    const network = await fetch(url, { cache: "no-cache", credentials: "omit" });
    if (!network.ok) throw new Error(`HTTP ${network.status}`);
    response = network;
  } catch (networkError) {
    response = (await cache?.match(url)) ?? undefined;
    source = "cache";
    if (!response) throw new Error(`Unable to load ${url}: ${String(networkError)}`);
  }

  const bytes = await response.clone().arrayBuffer();
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
    throw new Error(`Catalog artifact byte-size mismatch for ${url}.`);
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256.toLowerCase()) {
    throw new Error(`Catalog artifact integrity mismatch for ${url}.`);
  }
  if (source === "network") await cache?.put(url, response.clone());
  return { response, source };
}

async function fetchPointer(url: string): Promise<{ pointer: CatalogReleasePointer; source: FetchSource }> {
  try {
    const response = await fetch(url, { cache: "no-cache", credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { pointer: parseCatalogReleasePointer(await response.json()), source: "network" };
  } catch (networkError) {
    const cache = await openCatalogCache();
    const fallbackUrl = typeof location === "undefined"
      ? new URL(LAST_VERIFIED_CACHE_KEY, url).toString()
      : new URL(LAST_VERIFIED_CACHE_KEY, location.origin).toString();
    const response = await cache?.match(fallbackUrl);
    if (!response) throw new Error(`Unable to load catalog release pointer: ${String(networkError)}`);
    return { pointer: parseCatalogReleasePointer(await response.json()), source: "cache" };
  }
}

function parsePack(value: unknown, descriptor: CatalogPackDescriptor, version: string, schemaVersion: number): CatalogPack {
  if (!isRecord(value)) throw new Error(`Catalog pack ${descriptor.key} must be an object.`);
  if (value.schemaVersion !== schemaVersion || value.catalogVersion !== version || value.pack !== descriptor.key) {
    throw new Error(`Catalog pack ${descriptor.key} does not belong to release ${version}.`);
  }
  return value as CatalogPack;
}

export function assembleCatalog(packs: readonly CatalogPack[]): Catalog {
  const assembled: Record<string, unknown> = {};
  for (const pack of packs) {
    for (const [key, value] of Object.entries(pack)) {
      if (key === "schemaVersion" || key === "catalogVersion" || key === "pack") continue;
      if (key in assembled) throw new Error(`Catalog field ${key} is present in more than one pack.`);
      assembled[key] = value;
    }
  }
  for (const key of CATALOG_KEYS) {
    if (!(key in assembled)) throw new Error(`Catalog release is missing ${key}.`);
  }
  if (packs.some((pack) => pack.schemaVersion >= 2) && !("unlockChallengeTemplates" in assembled)) {
    throw new Error("Catalog schema 2 is missing unlockChallengeTemplates.");
  }
  return assembled as Catalog;
}

export async function loadPublishedCatalog(
  catalogBaseUrl: string,
  gameVersion: string,
): Promise<{ catalog: Catalog; release: CatalogReleaseInfo }> {
  const latestUrl = new URL("latest.json", `${catalogBaseUrl.replace(/\/+$/, "")}/`).toString();
  const { pointer, source: pointerSource } = await fetchPointer(latestUrl);
  if (!isSupportedCatalogSchema(pointer.schemaVersion)) {
    throw new Error(`Catalog schema ${pointer.schemaVersion} is not supported by this game.`);
  }
  if (!isMinimumVersionSatisfied(gameVersion, pointer.minimumGameVersion)) {
    throw new Error(`Catalog ${pointer.catalogVersion} requires game ${pointer.minimumGameVersion} or newer.`);
  }

  const manifestUrl = new URL(pointer.releaseManifestUrl, latestUrl).toString();
  const manifestResult = await verifiedResponse(manifestUrl, pointer.releaseManifestSha256);
  const manifest = parseCatalogReleaseManifest(await manifestResult.response.json());
  if (manifest.schemaVersion !== pointer.schemaVersion || manifest.catalogVersion !== pointer.catalogVersion) {
    throw new Error("Catalog pointer and release manifest do not match.");
  }
  if (!isMinimumVersionSatisfied(gameVersion, manifest.minimumGameVersion)) {
    throw new Error(`Catalog ${manifest.catalogVersion} requires game ${manifest.minimumGameVersion} or newer.`);
  }

  const packResults = await Promise.all(manifest.packs.map(async (descriptor) => {
    const url = new URL(descriptor.url, manifestUrl).toString();
    const result = await verifiedResponse(url, descriptor.sha256, descriptor.byteSize);
    return { pack: parsePack(await result.response.json(), descriptor, manifest.catalogVersion, manifest.schemaVersion), source: result.source };
  }));
  const catalog = assembleCatalog(packResults.map((result) => result.pack));
  if (!manifest.assetManifestUrl || !manifest.assetManifestSha256) {
    throw new Error("Catalog release is missing its asset manifest contract.");
  }
  const assetManifestUrl = new URL(manifest.assetManifestUrl, manifestUrl).toString();
  const assetManifestResult = await verifiedResponse(assetManifestUrl, manifest.assetManifestSha256);
  const assetManifest = await assetManifestResult.response.json() as unknown;
  if (!isRecord(assetManifest) || assetManifest.schemaVersion !== manifest.schemaVersion || assetManifest.catalogVersion !== manifest.catalogVersion || !Array.isArray(assetManifest.assets)) {
    throw new Error("Asset manifest does not belong to the selected catalog release.");
  }
  const publishedAssets = new Map<string, string>();
  for (const asset of assetManifest.assets) {
    if (!isRecord(asset) || typeof asset.path !== "string" || typeof asset.sha256 !== "string") {
      throw new Error("Asset manifest contains an invalid entry.");
    }
    publishedAssets.set(asset.path, asset.sha256);
  }
  for (const asset of catalog.gameAssets) {
    if (publishedAssets.get(asset.path) !== asset.checksum) {
      throw new Error(`Catalog asset ${asset.path} is missing or has the wrong checksum in the asset manifest.`);
    }
  }
  const source: FetchSource = pointerSource === "cache" || manifestResult.source === "cache" || assetManifestResult.source === "cache" || packResults.some((result) => result.source === "cache")
    ? "cache"
    : "network";

  const cache = await openCatalogCache();
  if (cache) {
    const fallbackUrl = typeof location === "undefined"
      ? new URL(LAST_VERIFIED_CACHE_KEY, latestUrl).toString()
      : new URL(LAST_VERIFIED_CACHE_KEY, location.origin).toString();
    await cache.put(fallbackUrl, new Response(JSON.stringify(pointer), { headers: { "content-type": "application/json" } }));
  }
  return {
    catalog,
    release: {
      schemaVersion: manifest.schemaVersion,
      catalogVersion: manifest.catalogVersion,
      publishedAt: manifest.publishedAt,
      manifestUrl,
      assetBaseUrl: manifest.assetBaseUrl ? new URL(manifest.assetBaseUrl, manifestUrl).toString().replace(/\/+$/, "") : null,
      source,
    },
  };
}
