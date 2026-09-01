import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");

if (!source.includes('const gameCatalogMode = "release"')) {
  throw new Error("Player catalog loading must use release mode for every Game build.");
}
if (source.includes("fetchLiveCatalog") || source.includes("VITE_ALLOW_LIVE_CATALOG_FALLBACK")) {
  throw new Error("Player release loading must not retain a live Catalog database path.");
}
if (!source.includes("loadPublishedCatalog(gameCatalogBaseUrl, gameVersion)")) {
  throw new Error("Release mode must load the verified published catalog.");
}

for (const table of [
  "content_tags", "critter_tag_assignments", "critters", "currencies", "dungeon_opponents",
  "dungeons", "game_assets", "relics", "rollcaster_abilities", "rollcasters", "skills",
]) {
  if (source.includes(`selectAll(\"${table}\"`) || source.includes(`selectAll<\"${table}\"`)) {
    throw new Error(`Game runtime must not query Catalog table ${table}.`);
  }
}

console.log("Release content lockdown source regression passed.");
