import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const fixture = await client.query(`
    select
      player.id as user_id,
      challenge.id as challenge_id,
      challenge.collectible_type,
      challenge.collectible_id,
      challenge.parameters,
      progress.clear_count
    from auth.users player
    join public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
      on challenge.collectible_type='relic'
     and challenge.collectible_id='010'
     and challenge.challenge_type='dungeon_clear'
     and challenge.parameters->>'tracking_required'='false'
     and challenge.parameters->>'has_relic_requirements'='false'
    join public.user_dungeon_progress progress
      on progress.user_id=player.id
     and progress.dungeon_id=any(
       select jsonb_array_elements_text(coalesce(challenge.parameters->'dungeon_ids','[]'::jsonb))
     )
     and progress.clear_count>0
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The database needs a user with a cleared automatic Dungeon Clear challenge target.");

  const row = fixture.rows[0];
  await client.query(
    "delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [row.user_id, row.challenge_id],
  );
  await client.query(
    "select set_config('request.jwt.claim.sub',$1,true)",
    [row.user_id],
  );

  const state = (await client.query(`
    select raw_progress,goal,eligible,complete,trackable
    from public.collectible_challenge_states($1,$2,$3)
    where challenge_id=$4
  `, [row.user_id, row.collectible_type, row.collectible_id, row.challenge_id])).rows[0];

  check(state?.raw_progress === String(row.clear_count),
    `Automatic Dungeon Clear must derive existing clears from user_dungeon_progress; got ${JSON.stringify(state)}`);
  check(state?.goal === "1" && state.eligible === true && state.complete === true && state.trackable === false,
    `Boost Box's completed automatic challenge state is incorrect: ${JSON.stringify(state)}`);

  console.log(`Automatic Dungeon Clear backfill regression passed for ${row.challenge_id}; fixture rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
