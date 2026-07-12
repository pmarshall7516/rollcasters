import fs from "node:fs";
import path from "node:path";
import { createDbClient, parseArgs, resolveMigrationSelection, root } from "./db-utils.mjs";

const args = parseArgs();
const selected = resolveMigrationSelection(args.files);

if (args.help) {
  process.stdout.write(`Usage:
  npm run db:migrate
  npm run db:migrate -- --files 001_initial_schema.sql,002_seed_catalog.sql
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
  for (const migration of selected) {
    const sql = fs.readFileSync(path.join(root, migration), "utf8");
    process.stdout.write(`Applying ${migration}...\n`);
    await client.query(sql);
  }
  await client.query("commit");
  process.stdout.write("Migrations applied successfully.\n");
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
