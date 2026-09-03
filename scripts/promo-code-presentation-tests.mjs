import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/App.tsx", "utf8");
const types = fs.readFileSync("src/lib/types.ts", "utf8");
const artwork = source.slice(source.indexOf("function PromoRewardArt"), source.indexOf("function ShopEntryCard"));

assert.match(types, /PromoCodeRewardType = [^;]*"lootbox"/);
assert.match(artwork, /reward\.type === "shard"[\s\S]*CollectibleSprite/);
assert.match(artwork, /reward\.type === "lootbox"[\s\S]*LootboxSprite/);
assert.match(artwork, /variant="closed"/);

console.log("Promo Code Game presentation contract passed.");
