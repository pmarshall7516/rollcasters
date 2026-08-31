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
      challenge.collectible_id,
      challenge.target_id,
      challenge.required_level
    from auth.users player
    join public.user_critters owned
      on owned.user_id=player.id
    join public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
      on challenge.collectible_type='critter'
     and challenge.challenge_type='level_up_critter'
     and challenge.target_id=owned.critter_id
     and challenge.required_level>=3
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The live game account fixture needs an owned Critter and a published level challenge.");

  const { user_id: userId, user_critter_id: userCritterId, challenge_id: challengeId, target_id: targetId, required_level: requiredLevel } = fixture.rows[0];
  check(targetId && Number(requiredLevel) >= 3, "The published level challenge must reference its owned parent Critter.");
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, challengeId]);

  const belowGoal = Math.max(Number(requiredLevel) - 2, 1);
  await client.query("update public.user_critters set level=$1 where id=$2", [belowGoal, userCritterId]);
  let state = (await client.query(
    "select raw_progress,goal,goal_reached,complete from public.collectible_challenge_states($1,'critter',$3) where challenge_id=$2",
    [userId, challengeId, fixture.rows[0].collectible_id],
  )).rows[0];
  check(state?.raw_progress === String(belowGoal) && state.goal === String(requiredLevel) && state.goal_reached === false && state.complete === false,
    `The level challenge must project its parent Critter below goal, received ${JSON.stringify(state)}.`);

  await client.query("update public.user_critters set level=$1 where id=$2", [requiredLevel, userCritterId]);
  state = (await client.query(
    "select raw_progress,goal,goal_reached,complete from public.collectible_challenge_states($1,'critter',$3) where challenge_id=$2",
    [userId, challengeId, fixture.rows[0].collectible_id],
  )).rows[0];
  check(state?.raw_progress === String(requiredLevel) && state.goal === String(requiredLevel) && state.goal_reached === true && state.complete === true,
    `The level challenge must complete when its parent Critter reaches the goal, received ${JSON.stringify(state)}.`);

  console.log("Published Critter level unlock challenge projection passed; fixture changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
