import assert from "node:assert/strict";
import {
  buildLocalUpdateId,
  assertLoopbackConnection,
  assertReleaseIsSyncable,
  buildPreviewCompatibilityError,
} from "./local-player-release-sync.mjs";

assert.equal(buildLocalUpdateId("1.0.8", "2026.09.03.1"), "local:1.0.8:2026.09.03.1");
assert.throws(
  () => buildLocalUpdateId("1.0.8", "not-a-release"),
  /Release ID must use YYYY\.MM\.DD\.N format/,
);

assert.doesNotThrow(() => assertLoopbackConnection("postgresql://postgres:postgres@127.0.0.1:54322/postgres"));
assert.doesNotThrow(() => assertLoopbackConnection("http://127.0.0.1:54321"));
assert.throws(
  () => assertLoopbackConnection("postgresql://postgres:secret@db.example.supabase.co:5432/postgres"),
  /loopback/,
);

assert.doesNotThrow(() => assertReleaseIsSyncable({
  id: "2026.09.03.1",
  status: "published",
  schema_version: 2,
  minimum_game_version: "1.0.0",
  manifest_hash: "a".repeat(64),
}));
assert.throws(
  () => assertReleaseIsSyncable({
    id: "2026.09.03.1",
    status: "draft",
    schema_version: 2,
    minimum_game_version: "1.0.0",
    manifest_hash: "a".repeat(64),
  }),
  /published or validated/,
);

assert.match(
  buildPreviewCompatibilityError({
    version: "1.0.8",
    releaseId: "2026.09.03.1",
    activeVersion: "1.0.8",
    activeReleaseId: "2026.08.26.2",
  }),
  /local:player:sync.*2026\.09\.03\.1/s,
);

console.log("Local player release-sync contract passed.");
