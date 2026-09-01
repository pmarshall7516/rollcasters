import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.resolve(root, relativePath), "utf8");
const migration = read("../rollcaster-docs/migrations/collectibles/20260831130000_multi_target_level_up_challenges.sql");
const gameCollectibles = read("src/lib/collectibles.ts");
const gameChallenges = read("src/lib/challenges.ts");
const studioCollectibles = read("../rollcaster-dev/src/lib/collectibles.ts");
const studioPage = read("../rollcaster-dev/src/pages/CatalogPage.tsx");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

for (const key of ["level_target_mode", "critter_ids", "rollcaster_ids", "required_level", "required_amount"]) {
  check(migration.includes(key), `Migration must define ${key}.`);
}
for (const text of ["level_up_critter", "level_up_rollcaster", "user_critters", "user_rollcasters", "collectible_challenge_goal", "collectible_challenge_current", "user_collectible_challenge_progress"]) {
  check(migration.includes(text), `Migration must cover ${text}.`);
}
check(gameCollectibles.includes('challenge?.challenge_type === "level_up_rollcaster"'), "Game must treat Rollcaster level-up challenges as derived.");
check(gameChallenges.includes('challenge.challenge_type === "level_up_rollcaster"'), "Challenge event-side derivation must recognize Rollcaster level-up challenges.");
check(studioCollectibles.includes("level_up_rollcaster"), "Studio must register Rollcaster level-up challenges.");
check(studioPage.includes("SearchableMultiSelect"), "Studio must expose searchable multi-selection for level-up targets.");
check(studioPage.includes("level_target_mode"), "Studio must expose level target mode.");
console.log("Level-up Challenge source contract passed.");
