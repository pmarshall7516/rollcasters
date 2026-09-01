import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  createDbClient,
  migrationFiles,
  parseArgs,
  readEnv,
  sharedMigrationsDir,
} from "./db-utils.mjs";

const args = parseArgs();
const replace = Boolean(args.replace);
const env = readEnv();
const root = process.cwd();
const localUrl = env.LOCAL_PLAYER_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const local = new pg.Client({ connectionString: localUrl, ssl: false });
const source = createDbClient(env);

const releaseInfrastructureTables = [
  "content_release_artifacts", "content_release_channels", "content_release_snapshots",
  "content_releases", "game_updates", "game_update_policy", "content_change_log", "dev_tool_users",
];

function resolveMigrationFile(row) {
  const files = migrationFiles();
  const exact = files.find((file) => file.slice(0, -4) === row.version);
  if (exact) return exact;
  const candidates = files.filter((file) => {
    const basename = path.basename(file, ".sql");
    const version = row.version.split("/").at(-1);
    return basename === version || (basename.startsWith(`${version}_`) && basename.endsWith(`_${row.name}`));
  });
  if (candidates.length !== 1) {
    throw new Error(`Could not resolve Production migration ${row.version} (${row.name}).`);
  }
  return candidates[0];
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function migrationSqlFor(file, sql) {
  if (file.endsWith("20260828231000_reconcile_effect_validator_patches.sql")) {
    // Production needed a one-time repair because its rebuilt function text
    // contained duplicate historical patches. The canonical Local rebuild
    // applies those patches once, so this migration is intentionally a no-op
    // here while retaining the exact history row.
    return "";
  }
  if (file.endsWith("20260828231200_restore_essence_canister_xp_policy.sql")) {
    // Production owns the compatibility Catalog row. The Local clone copies
    // it with the rest of the Catalog after migrations, avoiding a duplicate
    // primary key while retaining the exact migration history row.
    return "";
  }
  if (file.endsWith("20260821010000_status_classifications.sql")) {
    // The Local player clone receives catalog rows after migrations. Keep the
    // schema, constraint, and protected save function, but defer the authored
    // Status backfill/assertion until the Production catalog rows are copied.
    return sql.replace(
      /-- The live catalog currently contains exactly these authored Statuses\.[\s\S]*?(?=-- Preserve the existing protected Status save contract)/,
      "",
    );
  }
  if (file.endsWith("20260821020000_effect_removal_status_classification.sql")) {
    // Effect templates and authored effects are copied after migrations. The
    // validator/function patches are safe on the empty clone; defer only the
    // data-dependent postflight assertion.
    return sql.replace(
      /do \$assert_effect_removal\$[\s\S]*?\$assert_effect_removal\$;/,
      "",
    );
  }
  if (file.endsWith("20260828230900_restore_release_shop_runtime.sql")) {
    // The local clone receives the release rows after migrations, so defer this
    // data-dependent postflight until the copied snapshot is present.
    return sql.replace(
      /do \$verify_release_shop_runtime\$[\s\S]*?\$verify_release_shop_runtime\$;/,
      "",
    );
  }
  if (file.endsWith("20260828230700_restore_release_dungeon_helpers.sql")) {
    // The local clone receives release rows after all migrations have run, so
    // this migration's data-dependent postflight must be deferred. The helper
    // definitions themselves are safe and required during the clone.
    return sql.replace(
      /do \$verify_release_dungeon_helpers\$[\s\S]*?\$verify_release_dungeon_helpers\$;/,
      "",
    );
  }
  if (!file.endsWith("20260821231000_release_content_lockdown.sql")) return sql;
  // This historical migration contains defensive DO blocks that patch old
  // function text. The rebuilt Production database already has those later
  // release-backed functions; the durable release helper definitions are the
  // portion needed before the subsequent canonical migrations run.
  return sql.replace(
    /do \$patch_dungeon_start_functions\$[\s\S]*?\$patch_combat_receipt_catalog_sources\$;/,
    "",
  );
}

async function copyRows(table, columns) {
  const qualified = `public.${quoteIdentifier(table)}`;
  const rows = (await source.query(`select ${columns.map((column) => quoteIdentifier(column.column_name)).join(",")} from ${qualified}`)).rows;
  if (!rows.length) return 0;
  const columnSql = columns.map((column) => quoteIdentifier(column.column_name)).join(",");
  for (const row of rows) {
    const values = columns.map((column) => ["json", "jsonb"].includes(column.data_type)
      ? row[column.column_name] == null ? null : JSON.stringify(row[column.column_name])
      : row[column.column_name]);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
    await local.query(`insert into ${qualified} (${columnSql}) values (${placeholders})`, values);
  }
  return rows.length;
}

async function copyTableData(table) {
  const sourceColumns = (await source.query(`
    select column_name,data_type
    from information_schema.columns
    where table_schema='public' and table_name=$1 and is_generated='NEVER' and is_identity='NO'
    order by ordinal_position
  `, [table])).rows;
  const localColumns = new Set((await local.query(`
    select column_name
    from information_schema.columns
    where table_schema='public' and table_name=$1 and is_generated='NEVER' and is_identity='NO'
  `, [table])).rows.map((row) => row.column_name));
  const columns = sourceColumns.filter((column) => localColumns.has(column.column_name));
  return columns.length ? copyRows(table, columns) : 0;
}

async function copyAuthStubs() {
  const ids = (await source.query(`
    select distinct id
    from (
      select created_by as id from public.content_releases where created_by is not null
      union all select updated_by from public.content_release_channels where updated_by is not null
      union all select admin_user_id from public.content_change_log where admin_user_id is not null
      union all select created_by from public.game_updates where created_by is not null
      union all select updated_by from public.game_updates where updated_by is not null
      union all select updated_by from public.game_update_policy where updated_by is not null
    ) referenced
  `)).rows.map((row) => row.id);
  if (!ids.length) return 0;
  const users = (await source.query(`
    select id,email,raw_user_meta_data,is_anonymous
    from auth.users where id = any($1::uuid[])
  `, [ids])).rows;
  for (const user of users) {
    await local.query(`
      insert into auth.users(id,email,raw_user_meta_data,is_anonymous)
      values($1,$2,coalesce($3,'{}'::jsonb),coalesce($4,false))
      on conflict(id) do update set email=excluded.email
    `, [user.id, user.email, user.raw_user_meta_data, user.is_anonymous]);
  }
  return users.length;
}

async function installLocalDevelopmentUpdate() {
  const localUpdateId = "local:1.0.8";
  await local.query("update public.game_update_policy set active_update_id=null,scheduled_update_id=null,activates_at=null where singleton");
  await local.query("delete from public.game_updates where id=$1", [localUpdateId]);
  await local.query(`
    insert into public.game_updates(
      id,version,channel,environment,status,source_tag,source_commit,ai_lab_commit,
      catalog_release_id,catalog_manifest_sha256,asset_git_revision,client_protocol_version,
      content_schema_version,combat_runtime_version,release_notes,artifacts,evidence,manifest,
      manifest_sha256,retain_until,activated_at,created_at,updated_at
    )
    select
      $1,'1.0.8',channel,environment,'active','local-development',source_commit,ai_lab_commit,
      catalog_release_id,catalog_manifest_sha256,asset_git_revision,client_protocol_version,
      content_schema_version,combat_runtime_version,'Local current-code development build',artifacts,evidence,
      jsonb_set(jsonb_set(manifest,'{updateId}',to_jsonb($1::text)),'{version}',to_jsonb('1.0.8'::text)),
      manifest_sha256,now()+interval '30 days',now(),now(),now()
    from public.game_updates
    where id='stable:1.0.7'
  `, [localUpdateId]);
  const inserted = await local.query("select id,version,catalog_release_id from public.game_updates where id=$1", [localUpdateId]);
  assert.equal(inserted.rowCount, 1, "Local development Game Update was not installed.");
  await local.query("update public.game_update_policy set active_update_id=$1,updated_at=now() where singleton", [localUpdateId]);
  return inserted.rows[0];
}

await source.connect();
await local.connect();
try {
  const identity = await source.query(`
    select to_regclass('public.dungeon_run_commands') as command_table,
      to_regclass('public.content_release_channels') as release_table,
      current_database() as database_name
  `);
  assert.ok(identity.rows[0]?.command_table && identity.rows[0]?.release_table,
    "Configured Production database is not the Rollcasters database.");

  const existing = await local.query("select to_regclass('public.profiles') is not null as initialized");
  if (existing.rows[0]?.initialized && !replace) {
    throw new Error("Local player database is already initialized. Use --replace only for an intentional local reset.");
  }

  const release = (await source.query(`
    select channel,current_release_id from public.content_release_channels where channel='production'
  `)).rows[0];
  assert.ok(release?.current_release_id, "Production has no active Catalog Release.");
  const update = (await source.query(`
    select id,version,catalog_release_id from public.game_updates
    where id=(select active_update_id from public.game_update_policy where singleton)
  `)).rows[0];
  assert.equal(update?.version, "1.0.7", "Production active Game Update is not 1.0.7.");
  assert.equal(update.catalog_release_id, release.current_release_id,
    "Production active Game Update and Catalog Release do not match.");

  // The rebuilt Production schema already contains the release-lockdown
  // functions, but that migration was omitted from its historical ledger.
  // Repair the ledger before cloning it so future local rebuilds are exact.
  const lockdownMigration = "general/20260821231000_release_content_lockdown.sql";
  const lockdownSql = fs.readFileSync(path.join(sharedMigrationsDir, lockdownMigration), "utf8");
  const lockdownHistory = await source.query(
    "select 1 from supabase_migrations.schema_migrations where version=$1",
    [lockdownMigration.slice(0, -4)],
  );
  if (!lockdownHistory.rowCount) {
    const lockdownFunction = await source.query(
      "select to_regprocedure('public.current_game_catalog_snapshot()') is not null as present",
    );
    if (!lockdownFunction.rows[0]?.present) await source.query(lockdownSql);
    await source.query(
      "insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2::text[],$3)",
      [lockdownMigration.slice(0, -4), [lockdownSql], "release_content_lockdown"],
    );
  }

  const productionMigrations = (await source.query(
    "select version,name from supabase_migrations.schema_migrations order by version",
  )).rows;
  const migrationRowsByFile = new Map();
  for (const row of productionMigrations) {
    const file = resolveMigrationFile(row);
    const rows = migrationRowsByFile.get(file) ?? [];
    rows.push(row);
    migrationRowsByFile.set(file, rows);
  }
  const selected = migrationFiles().filter((file) => migrationRowsByFile.has(file));
  assert.equal(
    [...migrationRowsByFile.values()].reduce((total, rows) => total + rows.length, 0),
    productionMigrations.length,
    "Every Production migration must resolve to a local canonical file.",
  );

  await local.query("drop schema if exists public cascade");
  await local.query("create schema public");
  await local.query("grant usage,create on schema public to postgres,anon,authenticated,service_role");
  await local.query("drop schema if exists supabase_migrations cascade");
  await local.query("create schema supabase_migrations");
  await local.query("create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text)");

  let applied = 0;
  for (const file of selected) {
    const rows = migrationRowsByFile.get(file);
    const sql = migrationSqlFor(file, fs.readFileSync(path.join(sharedMigrationsDir, file), "utf8"));
    try {
      if (file.endsWith("20260823004744_stable_game_update_policy.sql")) {
        await local.query("drop table if exists private.player_registration_invites cascade");
      }
      const hasTransactionControl = /^\s*begin\s*;/i.test(sql);
      if (hasTransactionControl) {
        await local.query(sql);
      } else {
        await local.query("begin");
        await local.query(sql);
      }
      for (const row of rows) {
        await local.query(
          "insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2::text[],$3)",
          [row.version, [sql], row.name],
        );
      }
      await local.query("commit");
      applied += 1;
    } catch (error) {
      await local.query("rollback").catch(() => undefined);
      throw new Error(`Local migration ${file} failed: ${error.message}`, { cause: error });
    }
  }

  await local.query(fs.readFileSync(path.join(root, "scripts/local-promo-code-bridge.sql"), "utf8"));

  const authStubs = await copyAuthStubs();
  let copiedRows = 0;
  await local.query("begin");
  try {
    await local.query("set local session_replication_role = replica");
    for (const table of [...releaseInfrastructureTables].reverse()) {
      await local.query(`delete from public.${quoteIdentifier(table)}`);
    }
    for (const table of releaseInfrastructureTables) copiedRows += await copyTableData(table);
    await local.query("set local session_replication_role = origin");
    await local.query("commit");
  } catch (error) {
    await local.query("rollback").catch(() => undefined);
    throw error;
  }

  const localUpdate = await installLocalDevelopmentUpdate();

  const counts = (await local.query(`
    select
      (select count(*) from public.profiles) as player_profiles,
      (select count(*) from public.content_releases) as releases,
      (select count(*) from public.content_release_snapshots) as snapshots,
      (select count(*) from public.game_updates) as updates,
      (select count(*) from supabase_migrations.schema_migrations) as migrations
  `)).rows[0];
  assert.equal(Number(counts.player_profiles), 0, "Production player profiles must never be copied to local.");
  assert.equal(Number(counts.migrations), productionMigrations.length);
  assert.equal(Number(counts.releases), 1);
  assert.equal(Number(counts.snapshots), 1);
  assert.equal(Number(counts.updates), 2);

  console.log(JSON.stringify({
    database: "rollcasters-local-player",
    sourceDatabase: identity.rows[0].database_name,
    releaseId: release.current_release_id,
    gameVersion: localUpdate.version,
    migrations: applied,
    authAdminStubs: authStubs,
    releaseInfrastructureRowsCopied: copiedRows,
    playerProfilesCopied: 0,
    replaced: replace,
  }, null, 2));
} finally {
  await source.end().catch(() => undefined);
  await local.end().catch(() => undefined);
}
