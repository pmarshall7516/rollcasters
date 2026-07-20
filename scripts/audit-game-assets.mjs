import { createClient } from "@supabase/supabase-js";
import { createDbClient, parseArgs, readEnv } from "./db-utils.mjs";

const DEFAULT_BUCKET = "game-assets";
const DEFAULT_CACHE_SECONDS = 31_536_000;
const OVERSIZED_ASSET_BYTES = 300_000;

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function publicObjectUrl(baseUrl, bucket, objectName, cacheNonce) {
  const encodedPath = objectName.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}?cacheNonce=${cacheNonce}`;
}

async function loadAuditRows(db, bucket) {
  const { rows } = await db.query(
    `
      with referenced_paths as (
        select asset_path as path from public.critters where is_active and not is_archived
        union select asset_path from public.rollcasters where is_active and not is_archived
        union select asset_path from public.relics where is_active and not is_archived
        union select asset_path from public.elements where is_active and not is_archived
        union select asset_path from public.currencies where is_active and not is_archived
        union select asset_path from public.statuses where is_active and not is_archived
        union select regular_logo_path from public.dungeons where is_active and not is_archived
        union select boss_logo_path from public.dungeons where is_active and not is_archived
        union select path from public.game_assets where is_active and category = 'mana'
      )
      select
        objects.name,
        coalesce((objects.metadata->>$2)::bigint, 0) as size_bytes,
        coalesce(objects.metadata->>$3, $4) as mime_type,
        coalesce(objects.metadata->>$5, $6) as cache_control,
        objects.updated_at,
        objects.name in (select path from referenced_paths where path is not null) as is_referenced,
        exists (
          select 1
          from public.game_assets registry
          where registry.is_active and registry.path = objects.name
        ) as has_active_registry
      from storage.objects objects
      where objects.bucket_id = $1
      order by coalesce((objects.metadata->>$2)::bigint, 0) desc, objects.name
    `,
    [bucket, "size", "mimetype", "application/octet-stream", "cacheControl", "unset"],
  );
  return rows;
}

function printAudit(rows, desiredCacheSeconds) {
  const totalBytes = rows.reduce((total, row) => total + Number(row.size_bytes), 0);
  const referenced = rows.filter((row) => row.is_referenced);
  const referencedBytes = referenced.reduce((total, row) => total + Number(row.size_bytes), 0);
  const desiredPolicy = `max-age=${desiredCacheSeconds}`;
  const shortCached = rows.filter((row) => row.cache_control !== desiredPolicy);
  const oversized = rows.filter((row) => Number(row.size_bytes) >= OVERSIZED_ASSET_BYTES);
  const unreferenced = rows.filter((row) => !row.is_referenced && Number(row.size_bytes) > 0);
  const unversionedReferences = referenced.filter((row) => !row.has_active_registry);

  console.log(`Objects: ${rows.length} (${formatBytes(totalBytes)})`);
  console.log(`Referenced by active catalog: ${referenced.length} (${formatBytes(referencedBytes)})`);
  console.log(`Cache policy differs from ${desiredPolicy}: ${shortCached.length}`);
  console.log(`Assets at least ${formatBytes(OVERSIZED_ASSET_BYTES)}: ${oversized.length}`);
  console.log(`Unreferenced non-empty objects: ${unreferenced.length} (${formatBytes(
    unreferenced.reduce((total, row) => total + Number(row.size_bytes), 0),
  )})`);
  console.log(`Referenced objects without an active version registry row: ${unversionedReferences.length}`);

  if (oversized.length) {
    console.log("\nLargest optimization candidates:");
    for (const row of oversized.slice(0, 12)) {
      console.log(`- ${row.name}: ${formatBytes(row.size_bytes)} (${row.cache_control})`);
    }
  }
}

async function applyCachePolicy(rows, { baseUrl, bucket, cacheSeconds, serviceRoleKey }) {
  const desiredPolicy = `max-age=${cacheSeconds}`;
  const pending = rows.filter((row) => row.cache_control !== desiredPolicy);
  if (!pending.length) {
    console.log(`All objects already use ${desiredPolicy}.`);
    return;
  }

  const admin = createClient(baseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const nonce = Date.now();

  for (const [index, row] of pending.entries()) {
    const response = await fetch(publicObjectUrl(baseUrl, bucket, row.name, `${nonce}-${index}`), {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Unable to download ${row.name}: ${response.status} ${response.statusText}`);
    }

    const body = await response.arrayBuffer();
    const { error } = await admin.storage.from(bucket).update(row.name, body, {
      cacheControl: String(cacheSeconds),
      contentType: row.mime_type,
      upsert: true,
    });
    if (error) throw new Error(`Unable to update ${row.name}: ${error.message}`);
    console.log(`[${index + 1}/${pending.length}] ${row.name}`);
  }

  console.log(`Applied ${desiredPolicy} to ${pending.length} objects.`);
}

async function main() {
  const args = parseArgs();
  const env = readEnv();
  const bucket = String(args.bucket ?? DEFAULT_BUCKET);
  const cacheSeconds = Number(args["cache-seconds"] ?? DEFAULT_CACHE_SECONDS);
  if (!Number.isInteger(cacheSeconds) || cacheSeconds < 3600) {
    throw new Error("--cache-seconds must be an integer of at least 3600.");
  }

  const db = createDbClient(env);
  await db.connect();
  try {
    const rows = await loadAuditRows(db, bucket);
    printAudit(rows, cacheSeconds);

    if (!args.apply) {
      console.log("\nDry run only. Pass --apply to rewrite object cache metadata without changing file contents.");
      return;
    }
    if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Applying the cache policy requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
    await applyCachePolicy(rows, {
      baseUrl: env.VITE_SUPABASE_URL,
      bucket,
      cacheSeconds,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
