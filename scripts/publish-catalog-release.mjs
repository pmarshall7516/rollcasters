import fs from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createDbClient, parseArgs, readEnv, root } from "./db-utils.mjs";
import { sha256 } from "./catalog-release-utils.mjs";

const args = parseArgs();
const env = readEnv();
const inputRoot = path.resolve(root, String(args.input ?? "output/catalog-release"));
const provider = String(env.RELEASE_STORAGE_PROVIDER ?? "supabase").toLowerCase();
const useR2 = provider === "r2";
if (!useR2 && provider !== "supabase") throw new Error("RELEASE_STORAGE_PROVIDER must be supabase or r2.");
const bucket = String(useR2 ? env.R2_BUCKET : env.SUPABASE_RELEASE_BUCKET ?? "");
const accountId = String(env.R2_ACCOUNT_ID ?? "");
const endpoint = String(useR2 ? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "") : env.SUPABASE_STORAGE_S3_ENDPOINT ?? "");
const accessKeyId = String(useR2 ? env.R2_ACCESS_KEY_ID : env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID ?? "");
const secretAccessKey = String(useR2 ? env.R2_SECRET_ACCESS_KEY : env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY ?? "");
if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error(`Set the server-only ${useR2 ? "R2" : "Supabase Storage S3"} release credentials.`);
}

const client = new S3Client({
  region: useR2 ? "auto" : String(env.SUPABASE_STORAGE_S3_REGION ?? "local"),
  endpoint,
  forcePathStyle: !useR2,
  credentials: { accessKeyId, secretAccessKey },
});

async function walk(directory, prefix = "") {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

function contentType(key) {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

async function uploadVerified(key, bytes, cacheControl) {
  const hash = sha256(bytes);
  let remote;
  try {
    remote = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
  }
  if (remote?.Metadata?.sha256 === hash && Number(remote.ContentLength) === bytes.length) return "unchanged";
  if (remote && key !== "game-data/latest.json") {
    throw new Error(`Refusing to overwrite immutable object ${key}.`);
  }
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: bytes,
    ContentType: contentType(key),
    CacheControl: cacheControl,
    Metadata: { sha256: hash },
  }));
  const verified = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (verified.Metadata?.sha256 !== hash || Number(verified.ContentLength) !== bytes.length) {
    throw new Error(`Remote verification failed for ${key}.`);
  }
  return "uploaded";
}

const files = await walk(inputRoot);
if (!files.includes("game-data/latest.json")) throw new Error(`${inputRoot} does not contain game-data/latest.json.`);
const immutableFiles = files.filter((file) => file !== "game-data/latest.json" && !file.endsWith("release-report.json"));
let uploaded = 0;
let unchanged = 0;
for (const file of immutableFiles) {
  const result = await uploadVerified(file, await fs.readFile(path.join(inputRoot, file)), "public, max-age=31536000, immutable");
  if (result === "uploaded") uploaded += 1; else unchanged += 1;
}

const pointerBytes = await fs.readFile(path.join(inputRoot, "game-data", "latest.json"));
const pointer = JSON.parse(pointerBytes.toString("utf8"));
let db;
try {
  if (args.publish) {
    db = createDbClient(env);
    await db.connect();
    await db.query("begin");
    const candidate = await db.query("select status,manifest_hash from public.content_releases where id=$1 for update", [pointer.catalogVersion]);
    if (candidate.rowCount !== 1 || !["validated", "published"].includes(candidate.rows[0].status)) {
      throw new Error(`Release ${pointer.catalogVersion} must be recorded and validated before publishing.`);
    }
    if (candidate.rows[0].manifest_hash !== pointer.releaseManifestSha256) {
      throw new Error("Recorded release hash does not match latest.json.");
    }
    await db.query("update public.content_releases set status='published',published_at=coalesce(published_at,now()) where id=$1", [pointer.catalogVersion]);
    await db.query(`insert into public.content_release_channels(channel,current_release_id,updated_at) values('production',$1,now()) on conflict(channel) do update set current_release_id=excluded.current_release_id,updated_at=excluded.updated_at`, [pointer.catalogVersion]);
  }

  // The only mutable public object is switched last, while the DB status change
  // remains uncommitted, keeping the cross-service cutover window minimal.
  await uploadVerified("game-data/latest.json", pointerBytes, "no-cache, max-age=0, must-revalidate");
  if (db) await db.query("commit");
} catch (error) {
  if (db) await db.query("rollback").catch(() => undefined);
  throw error;
} finally {
  if (db) await db.end().catch(() => undefined);
}

process.stdout.write(`Published ${pointer.catalogVersion}: ${uploaded} immutable objects uploaded, ${unchanged} already verified; latest.json switched last.\n`);
