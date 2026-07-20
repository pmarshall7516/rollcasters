import type { Catalog, CatalogReleaseInfo } from "./types.js";

export const SUPPORTED_CATALOG_SCHEMA_VERSION = 1;
export const CATALOG_CACHE_NAME = "rollcasters-catalog-v1";

const LAST_VERIFIED_CACHE_KEY = "/__rollcasters_catalog_last_verified_v1__.json";
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

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
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

function parsePack(value: unknown, descriptor: CatalogPackDescriptor, version: string): CatalogPack {
  if (!isRecord(value)) throw new Error(`Catalog pack ${descriptor.key} must be an object.`);
  if (value.schemaVersion !== SUPPORTED_CATALOG_SCHEMA_VERSION || value.catalogVersion !== version || value.pack !== descriptor.key) {
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
  return assembled as Catalog;
}

export async function loadPublishedCatalog(
  catalogBaseUrl: string,
  gameVersion: string,
): Promise<{ catalog: Catalog; release: CatalogReleaseInfo }> {
  const latestUrl = new URL("latest.json", `${catalogBaseUrl.replace(/\/+$/, "")}/`).toString();
  const { pointer, source: pointerSource } = await fetchPointer(latestUrl);
  if (pointer.schemaVersion !== SUPPORTED_CATALOG_SCHEMA_VERSION) {
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
    return { pack: parsePack(await result.response.json(), descriptor, manifest.catalogVersion), source: result.source };
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
