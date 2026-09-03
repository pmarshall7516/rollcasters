import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve(process.cwd(), "../rollcaster-docs/migrations/general/20260903150000_add_promo_lootbox_rewards.sql");
assert.equal(fs.existsSync(migrationPath), true, "The shared Promo Lootbox migration must exist.");
const migration = fs.readFileSync(migrationPath, "utf8");
const bridge = fs.readFileSync("scripts/local-promo-code-bridge.sql", "utf8");

assert.match(migration, /promo_code_rewards_reward_type_check[\s\S]*lootbox/);
assert.match(migration, /promo_code_redemption_rewards_reward_type_check[\s\S]*lootbox/);
assert.match(migration, /validate_promo_code_reward[\s\S]*reward_type='lootbox'[\s\S]*lootboxes/);
assert.match(migration, /redeem_promo_code[\s\S]*reward_type='lootbox'[\s\S]*grant_lootbox_inventory_internal/);
assert.match(migration, /reward_type='lootbox'[\s\S]*closed_asset_path/);
assert.match(bridge, /v_reward_type not in \('currency', 'shard', 'critter', 'rollcaster', 'relic', 'lootbox'\)/);

console.log("Promo Code Lootbox database contract passed.");
