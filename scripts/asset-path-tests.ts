import { catalogAssetPath, findAssetPath, findAssetRecord, preferredAssetPath, versionedAssetPath } from "../src/lib/asset-paths.js";
import type { AppData, GameAsset } from "../src/lib/types.js";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const assets: GameAsset[] = [
  {
    id: "active-icon",
    path: "critters/ramber/icon.png",
    category: "critter",
    owner_table: "critters",
    owner_id: "ramber",
    variant: "icon",
    display_name: "Ramber",
    alt_text: "Ramber",
    content_type: "image/png",
    width: 64,
    height: 64,
    is_active: true,
    checksum: "checksum-1",
    sort_order: 1,
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "inactive-card",
    path: "critters/ramber/card.png",
    category: "critter",
    owner_table: "critters",
    owner_id: "ramber",
    variant: "card",
    display_name: "Ramber",
    alt_text: "Ramber",
    content_type: "image/png",
    width: 64,
    height: 64,
    is_active: false,
    checksum: "checksum-2",
    sort_order: 2,
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "updated-only",
    path: "ui/updated.png",
    category: "ui",
    owner_table: null,
    owner_id: "updated",
    variant: "default",
    display_name: null,
    alt_text: null,
    content_type: "image/png",
    width: 64,
    height: 64,
    is_active: true,
    checksum: null,
    sort_order: 1,
    updated_at: "2026-02-01T00:00:00Z",
  },
];
const data = { catalog: { gameAssets: assets } } as AppData;

check(findAssetRecord(data, "critter", "ramber", "icon")?.id === "active-icon", "active asset records should be found");
check(findAssetRecord(data, "critter", "ramber", "card") === undefined, "inactive asset records should be ignored");
check(findAssetPath(data, "critter", "ramber") === "critters/ramber/icon.png?v=checksum-1", "asset lookup should use the default icon variant and checksum version");
const currentManaReleaseData = {
  catalog: {
    gameAssets: [{
      ...assets[0],
      id: "current-mana-icon",
      path: "ui/mana.icon.checksum-mana.webp",
      category: "ui",
      owner_table: "global",
      owner_id: "mana",
      variant: "icon",
      checksum: "checksum-mana",
    }],
  },
} as AppData;
check(
  findAssetPath(currentManaReleaseData, "mana", "mana") === "ui/mana.icon.checksum-mana.webp?v=checksum-mana",
  "Mana lookup must resolve the current release record even when its global asset category is ui",
);
check(catalogAssetPath(data, "ui", "updated", undefined) === "ui/updated.png?v=2026-02-01T00%3A00%3A00Z", "catalog lookup should use updated_at when no checksum exists");
check(catalogAssetPath(data, "critter", "ramber", "https://cdn.example.test/ramber.png") === "https://cdn.example.test/ramber.png", "direct external paths should remain unchanged");
check(versionedAssetPath(data, "critters/ramber/icon.png?size=small") === "critters/ramber/icon.png?size=small&v=checksum-1", "existing query parameters should be preserved");
check(versionedAssetPath(data, "missing.png") === "missing.png", "unregistered paths should remain unchanged");

const reorderedRelicData = {
  catalog: {
    gameAssets: [
      {
        ...assets[0],
        id: "stale-relic-owner",
        path: "relics/016-weighted-die.png",
        category: "relic",
        owner_table: "relics",
        owner_id: "016",
        variant: "card",
        checksum: "stale-relic-checksum",
      },
      {
        ...assets[0],
        id: "current-relic-path",
        path: "relics/017-tiny-blade.png",
        category: "relic",
        owner_table: "relics",
        owner_id: "017",
        variant: "card",
        checksum: "current-relic-checksum",
      },
    ],
  },
} as AppData;
check(
  preferredAssetPath(reorderedRelicData, "relic", "016", "relics/017-tiny-blade.png", ["card", "thumb"]) ===
    "relics/017-tiny-blade.png?v=current-relic-checksum",
  "the catalog row asset path should win over a stale owner-id asset mapping",
);

console.log("Asset path tests passed.");
