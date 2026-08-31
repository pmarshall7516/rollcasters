import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectError(client, savepoint, expectedText, action) {
  await client.query(`savepoint ${savepoint}`);
  let matched = false;
  try {
    await action();
  } catch (error) {
    matched = String(error.message).includes(expectedText);
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  check(matched, `Expected database error containing ${expectedText}.`);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const fixture = await client.query(`
    select player.id as user_id, target.collectible_type as target_type, target.id as target_id
    from auth.users player
    join lateral (
      select candidate.collectible_type,candidate.id
      from (
        select 'critter'::text as collectible_type,critter.id,critter.sort_order
        from public.critters critter
        where critter.is_active and not critter.is_archived
          and not exists(select 1 from public.user_critters owned where owned.user_id=player.id and owned.critter_id=critter.id)
        union all
        select 'rollcaster',rollcaster.id,rollcaster.sort_order
        from public.rollcasters rollcaster
        where rollcaster.is_active and not rollcaster.is_archived
          and not exists(select 1 from public.user_rollcasters owned where owned.user_id=player.id and owned.rollcaster_id=rollcaster.id)
        union all
        select 'relic',relic.id,relic.sort_order
        from public.relics relic
        where relic.is_active and not relic.is_archived
          and not exists(select 1 from public.user_relic_inventory owned where owned.user_id=player.id and owned.relic_id=relic.id and owned.discovered_at is not null and owned.quantity>0)
      ) candidate
      order by case candidate.collectible_type when 'critter' then 1 when 'rollcaster' then 2 else 3 end,candidate.sort_order,candidate.id
      limit 1
    ) target on true
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The development database needs a user with an unowned collectible.");

  const { user_id: userId, target_type: targetType, target_id: targetId } = fixture.rows[0];
  const challengeId = crypto.randomUUID();
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  // Isolate the temporary catalog owner. The surrounding transaction is rolled
  // back, so no production content or player data survives this fixture.
  await client.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await client.query("delete from public.collectible_unlock_requirements where collectible_type=$1 and collectible_id=$2", [targetType, targetId]);
  await client.query("delete from public.collectible_unlock_challenges where collectible_type=$1 and collectible_id=$2", [targetType, targetId]);
  await client.query(`
    insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
    values($1,$2,1)
  `, [targetType, targetId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,parameters,target_mode,any_target,target_ids,required_amount,sort_order
    ) values($1,$2,$3,'deal_damage',$4::jsonb,'species',true,'{}',5,0)
  `, [challengeId, targetType, targetId, JSON.stringify({ target_mode: "species", any_target: true, target_ids: [], required_amount: 5 })]);

  const completedAt = new Date().toISOString();
  await client.query(`
    insert into public.user_collectible_challenge_progress(user_id,challenge_id,progress,completed_at)
    values($1,$2,5,$3)
  `, [userId, challengeId, completedAt]);

  // Regression: editing a stable challenge ID must preserve its historical
  // progress, including when the goal is raised from 5 to 9.
  await client.query("select public.replace_collectible_unlocks($1,$2,$3::jsonb)", [
    targetType,
    targetId,
    JSON.stringify({
      requiredChallenges: 1,
      challenges: [{
        id: challengeId,
        type: "deal_damage",
        parameters: { target_mode: "species", any_target: true, target_ids: [], required_amount: 9 },
        sortOrder: 0,
      }],
    }),
  ]);
  const afterDefinitionChange = (await client.query(`
    select progress::text, completed_at is not null as completed
    from public.user_collectible_challenge_progress
    where user_id=$1 and challenge_id=$2
  `, [userId, challengeId])).rows[0];
  check(afterDefinitionChange?.progress === "5", "A stable challenge definition edit must preserve stored progress.");
  check(afterDefinitionChange.completed, "A stable challenge definition edit must preserve completion evidence.");

  // Regression: no later write, including a stale lower value or a completion
  // recalculation, may erase a player's high-water mark or completion marker.
  await client.query(`
    update public.user_collectible_challenge_progress
    set progress=2, completed_at=null
    where user_id=$1 and challenge_id=$2
  `, [userId, challengeId]);
  const afterStaleWrite = (await client.query(`
    select progress::text, completed_at is not null as completed
    from public.user_collectible_challenge_progress
    where user_id=$1 and challenge_id=$2
  `, [userId, challengeId])).rows[0];
  check(afterStaleWrite?.progress === "5", "A stale write must not lower stored challenge progress.");
  check(afterStaleWrite.completed, "A stale write must not clear challenge completion evidence.");

  const changedState = (await client.query(
    `select progress::text as raw_progress,
            challenge.required_amount::text as goal,
            progress.completed_at is not null as complete
     from public.user_collectible_challenge_progress progress
     join public.collectible_unlock_challenges challenge on challenge.id=progress.challenge_id
     where progress.user_id=$2 and progress.challenge_id=$1`,
    [challengeId, userId],
  )).rows[0];
  check(changedState?.raw_progress === "5" && changedState.goal === "9" && changedState.complete,
    "A raised goal must preserve progress and historical completion evidence.");

  await expectError(client, "challenge_fk_delete", "violates foreign key", () =>
    client.query("delete from public.collectible_unlock_challenges where id=$1", [challengeId]),
  );

  await expectError(client, "challenge_history_delete", "CHALLENGE_PROGRESS_EXISTS", () =>
    client.query("select public.replace_collectible_unlocks($1,$2,$3::jsonb)", [
      targetType,
      targetId,
      JSON.stringify({ requiredChallenges: 0, challenges: [] }),
    ]),
  );

  // This fixture is intentionally authoring-only. Production unlock
  // evaluation reads the active published release, so it must not grant a
  // collectible from a temporary mutable row that is absent from that
  // release. Durable unlock and notification replay are covered by the
  // release-backed gate/runtime tests.

  console.log(`Challenge persistence tests passed for user ${userId}; all fixture changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
