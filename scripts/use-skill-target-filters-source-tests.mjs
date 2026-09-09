import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "../rollcaster-docs/migrations/collectibles/20260908100000_use_skill_target_filters.sql"), "utf8");
const catalogMigration = readFileSync(resolve(process.cwd(), "../rollcaster-docs/migrations/catalog/20260908100000_use_skill_target_filters.sql"), "utf8");
const releaseCore = readFileSync(resolve(process.cwd(), "../rollcaster-dev/scripts/catalog-release-core.mjs"), "utf8");

for (const marker of [
  '"target_side"',
  '"target_critter_ids"',
  '"target_element_ids"',
  '"target_critter_tag_ids"',
  "'enemies','friendlies','any'",
  "target_contexts",
  "release_critters(public.current_game_catalog_release_id())",
  "release_critter_tag_assignments(public.current_game_catalog_release_id())",
  "invalid Skill target context",
]) {
  if (!migration.includes(marker)) throw new Error(`Use Skill target-filter migration is missing ${marker}`);
}
if (!catalogMigration.includes("id='use_skill'") || !catalogMigration.includes("runtime_version=5")) {
  throw new Error("Catalog Use Skill template migration is incomplete.");
}
if (!releaseCore.includes("'use_skill:5'")) throw new Error("Catalog release validation must support Use Skill runtime version 5.");
console.log("Use Skill target-filter migration contract markers passed.");
