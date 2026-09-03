import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { migrationFiles, parseEnv } from "./db-utils.mjs";

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
const applied = await (async () => {
  const client = new pg.Client({ connectionString: localDbUrl, ssl: false });
  await client.connect();
  try {
    const rows = (await client.query("select version from supabase_migrations.schema_migrations")).rows;
    return rows.map(({ version }) => Number(String(version).match(/^\d+/)?.[0] ?? 0));
  } finally {
    await client.end().catch(() => undefined);
  }
})();
const latestAppliedVersion = Math.max(0, ...applied);
const pendingFiles = migrationFiles().filter((file) => {
  const version = Number(path.basename(file).match(/^(\d+)_/)?.[1] ?? 0);
  return version > latestAppliedVersion;
});
if (pendingFiles.length) {
  const result = spawnSync(process.execPath, ["scripts/apply-migrations.mjs", "--files", pendingFiles.join(",")], {
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
}

const bridge = new pg.Client({ connectionString: localDbUrl, ssl: false });
await bridge.connect();
try {
  await bridge.query(fs.readFileSync(path.join(root, "scripts/local-promo-code-bridge.sql"), "utf8"));
} finally {
  await bridge.end().catch(() => undefined);
}
