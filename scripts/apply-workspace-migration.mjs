import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { readEnv } from "./db-utils.mjs";

const migrationPath = process.argv[2];
if (!migrationPath || !migrationPath.startsWith("supabase/migrations/") || !migrationPath.endsWith(".sql")) {
  throw new Error("Pass one migration path under supabase/migrations/.");
}

const basename = path.basename(migrationPath, ".sql");
const match = basename.match(/^(\d+)_([^.]+)$/);
if (!match) throw new Error("Migration filename must match <version>_<name>.sql.");

const env = readEnv();
const poolerUrl = new URL(fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim());
poolerUrl.password = env.postgres_password;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { ca: fs.readFileSync(env.SUPABASE_DB_CA_CERT_PATH, "utf8") },
});
const sql = fs.readFileSync(migrationPath, "utf8");

try {
  await client.connect();
  await client.query("begin");
  const version = basename;
  const existing = await client.query(
    "select 1 from supabase_migrations.schema_migrations where version in ($1,$2) limit 1",
    [version, match[1]],
  );
  if (existing.rowCount === 0) {
    await client.query(sql);
    await client.query(
      "insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2::text[],$3)",
      [version, [sql], match[2]],
    );
  }
  await client.query("commit");
  console.log(existing.rowCount === 0 ? `Applied ${basename}.` : `${basename} was already applied.`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
