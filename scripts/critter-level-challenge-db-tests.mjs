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
      owned.id as user_critter_id,
      challenge.id as challenge_id,
      challenge.target_id,
      challenge.required_level
    from auth.users player
    join public.user_critters owned
      on owned.user_id=player.id and owned.critter_id='010'
    join public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
      on challenge.collectible_type='critter'
     and challenge.collectible_id='011'
     and challenge.challenge_type='level_up_critter'
     and challenge.target_id='010'
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The live game account fixture needs an owned Nutter and the published Walbrute level challenge.");

  const { user_id: userId, user_critter_id: userCritterId, challenge_id: challengeId, target_id: targetId, required_level: requiredLevel } = fixture.rows[0];
  check(targetId === "010" && Number(requiredLevel) === 12, "The published Walbrute challenge must track Nutter to level 12.");
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, challengeId]);

  await client.query("update public.user_critters set level=10 where id=$1", [userCritterId]);
  let state = (await client.query(
    "select raw_progress,goal,goal_reached,complete from public.collectible_challenge_states($1,'critter','011') where challenge_id=$2",
    [userId, challengeId],
  )).rows[0];
  check(state?.raw_progress === "10" && state.goal === "12" && state.goal_reached === false && state.complete === false,
    `Walbrute's level challenge must project Nutter level 10 as 10/12, received ${JSON.stringify(state)}.`);

  await client.query("update public.user_critters set level=12 where id=$1", [userCritterId]);
  state = (await client.query(
    "select raw_progress,goal,goal_reached,complete from public.collectible_challenge_states($1,'critter','011') where challenge_id=$2",
    [userId, challengeId],
  )).rows[0];
  check(state?.raw_progress === "12" && state.goal === "12" && state.goal_reached === true && state.complete === true,
    `Walbrute's level challenge must complete when Nutter reaches level 12, received ${JSON.stringify(state)}.`);

  console.log("Published Critter level unlock challenge projection passed for Nutter → Walbrute; fixture changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
