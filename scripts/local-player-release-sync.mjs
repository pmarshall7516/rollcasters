import crypto from "node:crypto";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "./db-utils.mjs";

export const RELEASE_ID_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function buildLocalUpdateId(version, releaseId) {
  if (!SEMVER_PATTERN.test(String(version))) throw new Error(`Invalid Game version: ${version}`);
  if (!RELEASE_ID_PATTERN.test(String(releaseId))) throw new Error("Release ID must use YYYY.MM.DD.N format.");
  return `local:${version}:${releaseId}`;
}

export function assertLoopbackConnection(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error("Local player connections must use a valid loopback URL.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Local player connections must target loopback PostgreSQL or HTTP services.");
  }
  return parsed;
}

export function assertReleaseIsSyncable(release) {
  if (!release || !RELEASE_ID_PATTERN.test(String(release.id))) {
    throw new Error("Catalog Release ID must use YYYY.MM.DD.N format.");
  }
  if (!["published", "validated"].includes(String(release.status))) {
    throw new Error(`Catalog Release ${release.id} must be published or validated before local sync.`);
  }
  if (!Number.isInteger(release.schema_version) || release.schema_version < 1) {
    throw new Error(`Catalog Release ${release.id} has an invalid schema version.`);
  }
  if (!SEMVER_PATTERN.test(String(release.minimum_game_version))) {
    throw new Error(`Catalog Release ${release.id} has an invalid minimum Game version.`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(release.manifest_hash ?? ""))) {
    throw new Error(`Catalog Release ${release.id} has an invalid manifest hash.`);
  }
}

export function buildPreviewCompatibilityError({ version, releaseId, activeVersion, activeReleaseId }) {
  return [
    `Local player database is active on Game ${activeVersion ?? "unknown"} / Catalog ${activeReleaseId ?? "unknown"},`,
    `but this preview requires Game ${version} / Catalog ${releaseId}.`,
    `Run: npm run local:player:sync -- --release ${releaseId} --version ${version}`,
    "This sync preserves Auth users and player state; it only updates local release metadata and the local compatibility pointer.",
  ].join(" ");
}

function versionTuple(value) {
  return String(value).match(/^(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
}

function compareVersions(left, right) {
  const a = versionTuple(left);
  const b = versionTuple(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function tableColumns(client, table) {
  return (await client.query(`
    select column_name,data_type
    from information_schema.columns
    where table_schema='public' and table_name=$1 and is_generated='NEVER' and is_identity='NO'
    order by ordinal_position
  `, [table])).rows;
}

function dbValue(column, value) {
  if (value == null) return null;
  return ["json", "jsonb"].includes(column.data_type) ? JSON.stringify(value) : value;
}

async function insertRows(target, table, rows, options = {}) {
  if (!rows.length) return 0;
  const columns = await tableColumns(target, table);
  const excluded = new Set(options.exclude ?? []);
  const selected = columns.filter((column) => !excluded.has(column.column_name));
  const columnSql = selected.map((column) => quoteIdentifier(column.column_name)).join(",");
  for (const row of rows) {
    const values = selected.map((column) => dbValue(column, row[column.column_name]));
    const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
    await target.query(`insert into public.${quoteIdentifier(table)} (${columnSql}) values (${placeholders})`, values);
  }
  return rows.length;
}

function updateManifest(template, updateId, version, releaseId, releaseHash) {
  const manifest = {
    ...(template && typeof template === "object" ? template : {}),
    updateId,
    version,
    localPreview: true,
    catalogReleaseId: releaseId,
    catalogManifestSha256: releaseHash,
  };
  return manifest;
}

function jsonHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function installLocalUpdate(local, { version, releaseId, release }) {
  const updateId = buildLocalUpdateId(version, releaseId);
  const existingVersion = (await local.query(
    "select id from public.game_updates where version=$1",
    [version],
  )).rows[0];
  if (existingVersion && !String(existingVersion.id).startsWith("local:")) {
    throw new Error(`Game version ${version} already belongs to non-local update ${existingVersion.id}; refusing to overwrite it.`);
  }

  const template = (await local.query(`
    select * from public.game_updates
    where id like 'local:%' or status='active'
    order by (status='active') desc, created_at desc
    limit 1
  `)).rows[0];
  if (!template) throw new Error("Local player database has no Game Update template; run local:player:bootstrap first.");

  await local.query("update public.game_update_policy set active_update_id=null,scheduled_update_id=null,activates_at=null where singleton");
  await local.query("delete from public.game_updates where id like 'local:%' and version=$1", [version]);
  await local.query("delete from public.game_updates where id=$1", [updateId]);

  const manifest = updateManifest(template.manifest, updateId, version, releaseId, release.manifest_hash);
  const update = {
    id: updateId,
    version,
    channel: "stable",
    environment: "production",
    status: "active",
    source_tag: "local-development",
    source_commit: template.source_commit,
    ai_lab_commit: template.ai_lab_commit,
    catalog_release_id: releaseId,
    catalog_manifest_sha256: release.manifest_hash,
    asset_git_revision: template.asset_git_revision,
    client_protocol_version: template.client_protocol_version,
    content_schema_version: release.schema_version,
    combat_runtime_version: template.combat_runtime_version,
    release_notes: `Local development preview for Catalog ${releaseId}`,
    artifacts: [],
    evidence: { localPreview: true, catalogReleaseId: releaseId },
    manifest,
    manifest_sha256: jsonHash(manifest),
    retain_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    scheduled_for: null,
    activated_at: new Date(),
    retired_at: null,
    created_at: new Date(),
    created_by: null,
    updated_at: new Date(),
    updated_by: null,
  };
  await insertRows(local, "game_updates", [update]);
  await local.query("update public.game_update_policy set active_update_id=$1,updated_at=now() where singleton", [updateId]);
  return { id: updateId, version, catalogReleaseId: releaseId };
}

async function syncRelease({ local, catalog, releaseId, version }) {
  const sourceRelease = (await catalog.query("select * from public.content_releases where id=$1", [releaseId])).rows[0];
  assertReleaseIsSyncable(sourceRelease);
  if (compareVersions(version, sourceRelease.minimum_game_version) < 0) {
    throw new Error(`Game ${version} cannot run Catalog ${releaseId}; it requires Game ${sourceRelease.minimum_game_version} or newer.`);
  }
  const snapshot = (await catalog.query("select * from public.content_release_snapshots where release_id=$1", [releaseId])).rows[0];
  if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.snapshot_hash)) {
    throw new Error(`Catalog Release ${releaseId} has no valid immutable source snapshot.`);
  }
  const artifacts = (await catalog.query(
    "select * from public.content_release_artifacts where release_id=$1 order by artifact_key",
    [releaseId],
  )).rows;
  const localRelease = (await local.query("select * from public.content_releases where id=$1", [releaseId])).rows[0];
  if (localRelease && localRelease.manifest_hash !== sourceRelease.manifest_hash) {
    throw new Error(`Local Catalog Release ${releaseId} exists with a different manifest; refusing to mutate immutable release data.`);
  }
  const localSnapshot = (await local.query("select snapshot_hash from public.content_release_snapshots where release_id=$1", [releaseId])).rows[0];
  if (localSnapshot && localSnapshot.snapshot_hash !== snapshot.snapshot_hash) {
    throw new Error(`Local Catalog snapshot ${releaseId} exists with a different hash; refusing to mutate immutable content.`);
  }

  await local.query("begin");
  try {
    if (!localRelease) await insertRows(local, "content_releases", [{ ...sourceRelease, created_by: null }]);
    if (!localSnapshot) await insertRows(local, "content_release_snapshots", [snapshot]);
    if (artifacts.length) {
      const localArtifacts = await local.query("select artifact_key,content_hash from public.content_release_artifacts where release_id=$1", [releaseId]);
      const localArtifactHashes = new Map(localArtifacts.rows.map((row) => [row.artifact_key, row.content_hash]));
      for (const artifact of artifacts) {
        const existingHash = localArtifactHashes.get(artifact.artifact_key);
        if (existingHash && existingHash !== artifact.content_hash) {
          throw new Error(`Local Catalog artifact ${releaseId}/${artifact.artifact_key} exists with a different hash.`);
        }
      }
      await insertRows(local, "content_release_artifacts", artifacts.filter((artifact) => !localArtifactHashes.has(artifact.artifact_key)));
    }
    await local.query(`
      update public.content_release_channels
      set current_release_id=$1,updated_at=now(),updated_by=null
      where channel='production'
    `, [releaseId]);
    const update = await installLocalUpdate(local, { version, releaseId, release: sourceRelease });
    await local.query("commit");
    return { releaseId, snapshotHash: snapshot.snapshot_hash, artifactCount: artifacts.length, update };
  } catch (error) {
    await local.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log("Usage: npm run local:player:sync -- --release YYYY.MM.DD.N --version X.Y.Z [--catalog-db-url URL]");
    return;
  }
  const releaseId = String(args.release ?? "");
  const version = String(args.version ?? "");
  if (!releaseId || !version) throw new Error("Pass --release YYYY.MM.DD.N and --version X.Y.Z.");
  buildLocalUpdateId(version, releaseId);

  const env = { ...parseEnv(), ...process.env };
  const studioEnv = parseEnv(path.resolve(process.cwd(), "..", "rollcaster-dev", ".env"));
  const localUrl = env.LOCAL_PLAYER_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const catalogUrl = args["catalog-db-url"] ?? env.CATALOG_DB_URL ?? studioEnv.CATALOG_DB_URL;
  assertLoopbackConnection(localUrl);
  assertLoopbackConnection(catalogUrl);

  const local = new pg.Client({ connectionString: localUrl, ssl: false });
  const catalog = new pg.Client({ connectionString: catalogUrl, ssl: false });
  await local.connect();
  await catalog.connect();
  try {
    const result = await syncRelease({ local, catalog, releaseId, version });
    console.log(`Synchronized local player database to Game ${version} / Catalog ${releaseId}.`);
    console.log(`Preserved Auth and player state; installed ${result.artifactCount} immutable release artifact records and snapshot ${result.snapshotHash}.`);
  } finally {
    await local.end().catch(() => undefined);
    await catalog.end().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Local player release sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}
