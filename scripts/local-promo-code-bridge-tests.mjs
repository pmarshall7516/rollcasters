import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const bridge = fs.readFileSync(path.join(root, "scripts/local-promo-code-bridge.sql"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "scripts/bootstrap-local-player-db.mjs"), "utf8");
const migrator = fs.readFileSync(path.join(root, "scripts/apply-local-player-migrations.mjs"), "utf8");

assert.match(bridge, /create or replace function public\.redeem_promo_code_from_definition\(p_definition jsonb\)/);
assert.match(bridge, /public\.redeem_promo_code\(v_code\)/, "Local claims must delegate to the existing local redemption function.");
assert.match(bridge, /on conflict \(id\) do update set[\s\S]*?redemption_limit/, "Definitions must refresh in place.");
assert.doesNotMatch(bridge, /on conflict \(id\) do update set[\s\S]*?redemption_count\s*=/, "The refresh must not overwrite the local redemption count.");
assert.match(bridge, /grant execute on function public\.redeem_promo_code_from_definition\(jsonb\) to authenticated/);
assert.match(bootstrap, /local-promo-code-bridge\.sql/);
assert.match(migrator, /local-promo-code-bridge\.sql/);
assert.doesNotMatch(bootstrap, /"promo_codes"|"promo_code_rewards"/, "Local bootstrap must not copy Production Promo Code tables as Catalog data.");

console.log("Local Promo Code bridge contract passed.");
