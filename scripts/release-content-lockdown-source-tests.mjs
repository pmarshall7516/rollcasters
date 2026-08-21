import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");

if (!source.includes('=== "live" ? "live" : "release"')) {
  throw new Error("Player catalog loading must default to release mode.");
}
if (source.includes("allowLiveCatalogFallback") || source.includes("VITE_ALLOW_LIVE_CATALOG_FALLBACK")) {
  throw new Error("Player release loading must not retain a live-catalog fallback.");
}
if (!source.includes("loadPublishedCatalog(gameCatalogBaseUrl, gameVersion)")) {
  throw new Error("Release mode must load the verified published catalog.");
}

console.log("Release content lockdown source regression passed.");
