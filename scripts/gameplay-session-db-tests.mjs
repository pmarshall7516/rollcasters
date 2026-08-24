import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const user = (
    await client.query(
      "select id from auth.users where not public.is_dev_tool_identity(id) order by created_at limit 1",
    )
  ).rows[0];
  assert.ok(user, "A game account is required for the gameplay-session DB regression.");

  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user.id]);
  const firstSessionId = crypto.randomUUID();
  const secondSessionId = crypto.randomUUID();
  const acquire = (sessionId, takeover) => client.query(
    "select public.acquire_gameplay_session($1,$2,$3,$4,$5,$6) as result",
    [sessionId, "regression-test", "test", "test", 1, takeover],
  );

  const first = (await acquire(firstSessionId, false)).rows[0].result;
  assert.equal(first.outcome, "ACQUIRED");

  const online = (await acquire(secondSessionId, false)).rows[0].result;
  assert.equal(online.outcome, "ACCOUNT_ONLINE");

  const takeover = (await acquire(secondSessionId, true)).rows[0].result;
  assert.equal(takeover.outcome, "ACQUIRED");

  const sessions = await client.query(
    "select id,status,displaced_by_session_id from public.player_game_sessions where id = any($1::uuid[]) order by id",
    [[firstSessionId, secondSessionId]],
  );
  const oldSession = sessions.rows.find((row) => row.id === firstSessionId);
  const newSession = sessions.rows.find((row) => row.id === secondSessionId);
  assert.deepEqual(
    { status: oldSession?.status, displaced_by_session_id: oldSession?.displaced_by_session_id },
    { status: "displaced", displaced_by_session_id: secondSessionId },
  );
  assert.equal(newSession?.status, "active");

  await client.query("select public.release_gameplay_session($1)", [secondSessionId]);
  const released = await client.query("select status from public.player_game_sessions where id=$1", [secondSessionId]);
  assert.equal(released.rows[0]?.status, "logged_out");

  await client.query("rollback");
  began = false;
  console.log("Gameplay session DB regression passed; takeover and release fixtures were rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
