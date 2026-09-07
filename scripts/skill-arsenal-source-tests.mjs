import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "../rollcaster-docs/migrations/collectibles/20260906120000_skill_arsenal_challenge.sql"), "utf8");
const requiredMarkers = [
  "'skill_arsenal','Skill Arsenal'",
  "single_turn",
  "single_encounter",
  "single_dungeon",
  "minimum_uses_per_skill",
  "skill_use_counts",
  "release_skill_tag_assignments",
  "server_turn_number",
  "required_completions",
  "Skill Arsenal template postflight failed",
  "Skill Arsenal v4 postflight failed",
];
for (const marker of requiredMarkers) {
  if (!migration.includes(marker)) throw new Error(`Skill Arsenal migration is missing ${marker}`);
}
if (!migration.includes("scope_type in ('turn','battle','dungeon','shop_purchase')")) {
  throw new Error("Skill Arsenal migration must add turn scope persistence.");
}
console.log("Skill Arsenal migration contract markers passed.");
