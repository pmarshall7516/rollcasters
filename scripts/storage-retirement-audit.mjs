import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDbClient, readEnv } from "./db-utils.mjs";

const workspaceRoot = path.resolve(process.cwd(), "..");
const scannedRoots = ["rollcasters/src", "rollcasters/src-tauri", "rollcaster-dev/src", "rollcaster-sim/src"]
  .map((relative) => path.join(workspaceRoot, relative));

function runtimeReferences() {
  const existing = scannedRoots.filter((root) => fs.existsSync(root));
  if (!existing.length) return [];
  try {
    return execFileSync("rg", ["-l", "supabase\\.co/storage/v1|storage/v1/object|storage\\.from\\(['\"]game-(assets|releases)", ...existing], { encoding: "utf8" })
      .split(/\r?\n/).filter(Boolean).map((file) => path.relative(workspaceRoot, file)).sort();
  } catch (error) {
    if (error?.status === 1) return [];
    throw error;
  }
}

async function listBucketObjects(baseUrl, serviceRoleKey, bucket) {
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!response.ok) {
      if (response.status === 404) return { available: false, objects: [] };
      throw new Error(`Storage audit could not list ${bucket}: HTTP ${response.status}`);
    }
    const page = await response.json();
    objects.push(...(Array.isArray(page) ? page : []));
    if (page.length < 1000) return { available: true, objects };
  }
}

export function shapeStorageAudit({ identity, release, buckets, references }) {
  const blockers = [];
  if (!identity) blockers.push("Production database identity could not be verified.");
  if (identity && !release) blockers.push("Production has no active Catalog Release identity.");
  if (references.length) blockers.push("Runtime source still contains Supabase Storage/bucket references.");
  for (const bucket of buckets) {
    if (!bucket.available) continue;
    if (bucket.objectCount > 0) blockers.push(`${bucket.name} still contains ${bucket.objectCount} object(s).`);
  }
  return {
    generatedAt: new Date().toISOString(),
    production: identity,
    activeCatalogRelease: release,
    buckets,
    runtimeReferences: references,
    safeToDelete: blockers.length === 0,
    blockers,
  };
}

export async function runStorageRetirementAudit({ env = readEnv() } = {}) {
  const db = createDbClient(env);
  await db.connect();
  try {
    const identityResult = await db.query(`
      select current_database() as database_name,
        to_regclass('public.dungeon_run_commands') as command_table,
        to_regclass('public.content_release_channels') as release_table
    `);
    const row = identityResult.rows[0];
    const identity = row?.command_table && row?.release_table
      ? { database: row.database_name, schemaIdentity: "rollcasters" }
      : null;
    if (!identity) return shapeStorageAudit({ identity: null, release: null, buckets: [], references: runtimeReferences() });
    const release = (await db.query(`select channel,current_release_id from public.content_release_channels where channel='production'`)).rows[0] ?? null;
    const baseUrl = String(env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
    const key = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "");
    if (!baseUrl || !key) throw new Error("VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the read-only Storage audit.");
    const buckets = [];
    for (const name of ["game-assets", "game-releases"]) {
      const result = await listBucketObjects(baseUrl, key, name);
      buckets.push({ name, available: result.available, objectCount: result.objects.length,
        byteCount: result.objects.reduce((sum, object) => sum + Number(object.metadata?.size ?? object.size ?? 0), 0) });
    }
    return shapeStorageAudit({ identity, release, buckets, references: runtimeReferences() });
  } finally {
    await db.end().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runStorageRetirementAudit(), null, 2));
}
