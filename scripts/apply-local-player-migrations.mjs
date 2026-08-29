import { spawnSync } from "node:child_process";
import pg from "pg";
import { parseEnv } from "./db-utils.mjs";

const root = process.cwd();
const envFile = parseEnv();
const localDbUrl = process.env.LOCAL_PLAYER_DB_URL ?? envFile.LOCAL_PLAYER_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const local = new pg.Client({ connectionString: localDbUrl, ssl: false });
await local.connect();
try {
const result = await local.query("select to_regclass('public.profiles') is not null as initialized");
if (!result.rows[0]?.initialized) {
    throw new Error("Local player database is not initialized. Run `npm run local:player:bootstrap` after configuring the verified Production Supabase database.");
}
} finally {
  await local.end().catch(() => undefined);
}
const result = spawnSync(process.execPath, ["scripts/apply-migrations.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_DB_URL: localDbUrl,
    SUPABASE_DB_SSL: "false",
    SUPABASE_DB_CA_CERT_PATH: "",
  },
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
