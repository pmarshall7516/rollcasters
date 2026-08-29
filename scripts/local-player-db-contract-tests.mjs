import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = path.join(root, "supabase", "config.toml");
const lifecyclePath = path.join(root, "scripts", "local-player-db.mjs");
const migrationPath = path.join(root, "scripts", "apply-local-player-migrations.mjs");
const envExamplePath = path.join(root, ".env.example");

assert.ok(fs.existsSync(configPath), "Local player Supabase config must exist.");
assert.ok(fs.existsSync(lifecyclePath), "Local player lifecycle script must exist.");
assert.ok(fs.existsSync(migrationPath), "Local player migration wrapper must exist.");

const config = fs.readFileSync(configPath, "utf8");
const lifecycle = fs.readFileSync(lifecyclePath, "utf8");
const migration = fs.readFileSync(migrationPath, "utf8");
const envExample = fs.readFileSync(envExamplePath, "utf8");

assert.match(config, /project_id\s*=\s*["']rollcasters-local-player["']/);
assert.match(config, /port\s*=\s*54321/);
assert.match(config, /port\s*=\s*54322/);
assert.match(config, /major_version\s*=\s*17/);
assert.match(lifecycle, /supabase/);
assert.match(lifecycle, /start/);
assert.match(lifecycle, /status/);
assert.match(lifecycle, /reset/);
assert.match(config, /127\.0\.0\.1|localhost/);
assert.match(envExample, /VITE_LOCAL_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321/);
assert.match(envExample, /VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY=/);
assert.doesNotMatch(lifecycle, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(migration, /public\.profiles/);
assert.match(migration, /not initialized/);

console.log("Local player database contract passed.");
