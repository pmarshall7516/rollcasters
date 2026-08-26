import fs from "node:fs";
import path from "node:path";
import { createDbClient, parseArgs, readEnv } from "./db-utils.mjs";

const DEFAULT_ASSET_ROOT = path.resolve(process.env.ROLLCASTER_ASSETS_DIR ?? path.join(process.cwd(), "..", "assets"));
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** unitIndex)).toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function scanLocalMasters(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = fs.statSync(fullPath);
      entries.push({
        path: path.relative(root, fullPath).split(path.sep).join("/"),
        byteSize: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }
  if (fs.existsSync(root)) visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const args = parseArgs();
  if (args.apply) {
    throw new Error("--apply is no longer supported: local master files are the source of truth and have no remote cache metadata to rewrite.");
  }

  const env = readEnv();
  const assetRoot = path.resolve(env.ROLLCASTER_ASSETS_DIR ?? DEFAULT_ASSET_ROOT);
  const masters = scanLocalMasters(assetRoot);
  const db = createDbClient(env);
  await db.connect();
  try {
    const rows = (await db.query("select path from public.game_assets where is_active order by path")).rows;
    const masterPaths = new Set(masters.map((entry) => entry.path));
    const missing = rows.map((row) => String(row.path)).filter((assetPath) => !masterPaths.has(assetPath));
    const totalBytes = masters.reduce((total, entry) => total + entry.byteSize, 0);
    console.log(`Master-art root: ${assetRoot}`);
    console.log(`Local image masters: ${masters.length} (${formatBytes(totalBytes)}).`);
    console.log(`Active registry paths: ${rows.length}; missing local masters: ${missing.length}.`);
    for (const assetPath of missing) console.log(`- ${assetPath}`);
    if (missing.length) console.log("Add each missing master to the local assets/ directory and run the audit again.");
  } finally {
    await db.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
