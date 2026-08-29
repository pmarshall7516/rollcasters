import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("scripts/create-local-player-user.mjs", "utf8");
assert.match(source, /supabase/);
assert.match(source, /status/);
assert.match(source, /SERVICE_ROLE_KEY/);
assert.match(source, /createUser/);
assert.match(source, /email_confirm/);
assert.match(source, /local/);
assert.doesNotMatch(source, /VITE_SUPABASE_URL/);
assert.doesNotMatch(source, /SUPABASE_DB_URL/);
console.log("Local player fixture contract passed.");
