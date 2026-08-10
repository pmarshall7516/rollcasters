import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
const projection = source.match(/dungeon_enemy_rollcaster_abilities:\s*"([^"]+)"/)?.[1] ?? "";

if (projection !== "enemy_rollcaster_id,rollcaster_ability_id,slot_index") {
  throw new Error(`Enemy Rollcaster Ability projection must use rollcaster_ability_id; received ${projection || "<missing>"}.`);
}
if (!/map\(\(item\) => String\(item\.rollcaster_ability_id\)\)/.test(source)) {
  throw new Error("Enemy Rollcaster runtime hydration must read rollcaster_ability_id.");
}

console.log("Dungeon Eclipse Order projection contract passed.");
