import fs from "node:fs";
import path from "node:path";
import { createDbClient, parseArgs, resolveMigrationSelection, root } from "./db-utils.mjs";

const args = parseArgs();
const selected = resolveMigrationSelection(args.files);

function migrationMetadata(migration) {
  const basename = path.basename(migration);
  const match = basename.match(/^(\d+)_([^.]+)\.sql$/);
  if (!match) {
    throw new Error(`Migration filename must match <version>_<name>.sql: ${basename}`);
  }
  return { version: match[1], name: match[2] };
}

if (args.help) {
  process.stdout.write(`Usage:
  npm run db:migrate
  npm run db:migrate -- --files 20260719000000_rollcasters_baseline.sql
  npm run db:migrate -- --dry-run

Options:
  --files     Comma-separated migration filenames or paths.
  --dry-run   Print selected migrations without applying them.
`);
  process.exit(0);
}

if (args["dry-run"]) {
  process.stdout.write(`Selected migrations:\n${selected.map((file) => `- ${file}`).join("\n")}\n`);
  process.exit(0);
}

const client = createDbClient();

try {
  await client.connect();
  await client.query("begin");

  await client.query("create schema if not exists supabase_migrations");
  await client.query(
    `create table if not exists supabase_migrations.schema_migrations(
       version text primary key,
       statements text[],
       name text
     )`,
  );

  const appliedResult = await client.query(
    "select version from supabase_migrations.schema_migrations",
  );
  const appliedVersions = new Set(appliedResult.rows.map((row) => row.version));

  for (const migration of selected) {
    const { version, name } = migrationMetadata(migration);
    if (appliedVersions.has(version)) {
      process.stdout.write(`Skipping ${migration} (already applied).\n`);
      continue;
    }

    const sql = fs.readFileSync(path.join(root, migration), "utf8");
    process.stdout.write(`Applying ${migration}...\n`);
    await client.query(sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations(version,statements,name)
       values($1,$2::text[],$3)`,
      [version, [sql], name],
    );
    appliedVersions.add(version);
  }
  await client.query("commit");
  process.stdout.write("Migration check completed successfully.\n");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  if (error?.code === "SELF_SIGNED_CERT_IN_CHAIN") {
    throw new Error(
      [
        "Database migration failed TLS verification: self-signed certificate in certificate chain.",
        "",
        "Fix options:",
        "1. Download the Supabase database CA certificate for this project, save it inside the repo, and set SUPABASE_DB_CA_CERT_PATH to that file path.",
        "2. Set SUPABASE_DB_URL to the exact verified Postgres connection string from Supabase and include sslmode=verify-full.",
        "3. Apply the SQL files manually in the Supabase SQL editor.",
        "",
        "Do not disable TLS verification for migrations.",
      ].join("\n"),
    );
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
