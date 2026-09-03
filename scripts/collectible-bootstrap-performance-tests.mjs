import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "../rollcaster-docs/migrations/collectibles/20260903120000_fast_path_empty_challenge_tracking.sql",
  "utf8",
);
assert.match(migration, /create or replace function public\.reconcile_user_gated_tracking_internal/i);
assert.match(
  migration,
  /if not exists\s*\(\s*select 1\s*from public\.user_tracked_collectible_challenges/i,
  "Empty tracked-challenge sets must return before release-wide reconciliation.",
);
assert.match(migration, /return 0;/i);
console.log("Collectible bootstrap performance contract passed.");
