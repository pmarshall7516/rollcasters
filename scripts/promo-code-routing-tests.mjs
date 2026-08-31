import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("src/lib/supabase.ts", "utf8");
const envExample = fs.readFileSync(".env.example", "utf8");
const preview = fs.readFileSync("scripts/build-desktop-preview.mjs", "utf8");
const devLocal = fs.readFileSync("scripts/dev-local.mjs", "utf8");

assert.match(source, /VITE_PROMO_DEFINITION_SUPABASE_URL/);
assert.match(source, /VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY/);
assert.match(source, /get_promo_code_definition/);
assert.match(source, /redeem_promo_code_from_definition/);
assert.match(source, /desktopProfile\.profile === ["']local["']/);
assert.match(source, /getPromoCodeRedemptionHistory[\s\S]*?promo_code_redemption_history/);
assert.match(envExample, /VITE_PROMO_DEFINITION_SUPABASE_URL/);
assert.match(envExample, /VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY/);
assert.match(preview, /VITE_PROMO_DEFINITION_SUPABASE_URL:/);
assert.match(preview, /VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY:/);
assert.match(devLocal, /VITE_PROMO_DEFINITION_SUPABASE_URL:/);
assert.match(devLocal, /VITE_PROMO_DEFINITION_SUPABASE_PUBLISHABLE_KEY:/);

console.log("Promo Code Game routing contract passed.");
