import type { AppData, GameAsset } from "./types.js";

export function preferredAssetPath(
  data: AppData,
  category: string,
  ownerId: string | null | undefined,
  directPath: string | null | undefined,
  variants: readonly string[],
): string | null {
  // The catalog row's direct path is the authoritative association. The
  // owner-indexed asset registry is only a fallback for legacy rows without
  // a direct path, since numeric IDs can be reordered independently of the
  // source asset filename.
  if (directPath) return catalogAssetPath(data, category, ownerId, directPath);

  if (ownerId) {
    for (const variant of variants) {
      const path = findAssetPath(data, category, ownerId, variant);
      if (path) return path;
    }
  }
  return catalogAssetPath(data, category, ownerId, directPath);
}

export function findAssetRecord(data: AppData, category: string, ownerId: string, variant: string): GameAsset | undefined {
  return data.catalog.gameAssets.find(
    (asset) =>
      asset.category === category &&
      asset.owner_id === ownerId &&
      asset.variant === variant &&
      asset.is_active,
  );
}

export function versionedAssetPath(data: AppData, path: string | null | undefined): string | null {
  if (!path || /^https?:\/\//i.test(path)) return path ?? null;
  const [objectPath] = path.split("?", 1);
  const asset = data.catalog.gameAssets.find((candidate) => candidate.path === objectPath && candidate.is_active);
  const version = asset?.checksum || asset?.updated_at;
  if (!version) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(version)}`;
}

export function catalogAssetPath(
  data: AppData,
  category: string,
  ownerId: string | null | undefined,
  directPath: string | null | undefined,
  variant = "default",
): string | null {
  const path = directPath ?? (ownerId ? findAssetRecord(data, category, ownerId, variant)?.path : null);
  return versionedAssetPath(data, path);
}

export function findAssetPath(data: AppData, category: string, ownerId: string, variant = "icon"): string | null {
  const categories = category === "mana" ? ["mana", "ui"] : [category];
  for (const candidateCategory of categories) {
    const path = findAssetRecord(data, candidateCategory, ownerId, variant)?.path;
    if (path) return versionedAssetPath(data, path);
  }
  return null;
}
