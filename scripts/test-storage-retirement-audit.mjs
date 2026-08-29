import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { shapeStorageAudit } from "./storage-retirement-audit.mjs";

const source = fs.readFileSync(path.resolve("scripts/storage-retirement-audit.mjs"), "utf8");
assert.doesNotMatch(source, /delete\s+bucket|removeBucket|deleteBucket/i, "The audit must never delete Storage buckets.");
assert.equal(shapeStorageAudit({ identity: null, release: null, buckets: [], references: [] }).safeToDelete, false);
assert.equal(shapeStorageAudit({
  identity: { database: "rollcasters", schemaIdentity: "rollcasters" },
  release: { channel: "production", current_release_id: "2026.08.26.2" },
  buckets: [{ name: "game-assets", available: true, objectCount: 1, byteCount: 10 }],
  references: [],
}).safeToDelete, false);
assert.equal(shapeStorageAudit({
  identity: { database: "rollcasters", schemaIdentity: "rollcasters" },
  release: { channel: "production", current_release_id: "2026.08.26.2" },
  buckets: [{ name: "game-assets", available: true, objectCount: 0, byteCount: 0 }, { name: "game-releases", available: false, objectCount: 0, byteCount: 0 }],
  references: [],
}).safeToDelete, true);
console.log("Storage retirement audit contract passed.");
