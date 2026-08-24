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
  await client.query("select pg_advisory_xact_lock(hashtextextended('rollcaster:collectible-db-fixture',0))");

  const fixture = await client.query(`
    select player.id as user_id, challenge.collectible_id as target_critter_id,
      challenge.id as target_challenge_id, challenge.target_id as dependency_relic_id
    from auth.users player
    join lateral (
      select challenge.collectible_id, challenge.id, challenge.target_id
      from public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
      join public.release_collectible_requirements(public.current_game_catalog_release_id()) dependency_requirement
        on dependency_requirement.collectible_type='relic'
       and dependency_requirement.collectible_id=challenge.target_id
       and dependency_requirement.required_challenges>0
      join public.relics dependency on dependency.id=challenge.target_id
        and dependency.is_active and not dependency.is_archived
      join public.critters target on target.id=challenge.collectible_id
        and target.is_active and not target.is_archived
      where challenge.collectible_type='critter'
        and challenge.challenge_type='own_collectible'
        and challenge.target_category='relic'
        and challenge.target_id is not null
        and not exists (
          select 1 from public.user_critters owned
          where owned.user_id=player.id and owned.critter_id=challenge.collectible_id
        )
        and not exists (
          select 1 from public.user_collectible_unlock_events event
          where event.user_id=player.id and event.collectible_type='relic' and event.collectible_id=challenge.target_id
        )
      order by challenge.collectible_id,challenge.sort_order,challenge.id
      limit 1
    ) challenge on true
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The published release needs an authenticated user, a gated Critter dependency challenge, and a gated Relic.");

  const { user_id: userId, target_critter_id: targetCritterId, target_challenge_id: targetChallengeId, dependency_relic_id: dependencyRelicId } = fixture.rows[0];
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  // This is raw inventory ownership from a reward path, not a challenge grant.
  await client.query(`
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values($1,$2,1,now())
    on conflict(user_id,relic_id) do update set quantity=1,discovered_at=now()
  `, [userId, dependencyRelicId]);

  check(!(await client.query("select public.collectible_is_unlocked($1,'relic',$2) as unlocked", [userId, dependencyRelicId])).rows[0].unlocked, "The raw Relic inventory row must not make the gated Relic unlocked.");
  const beforeEvaluation = (await client.query("select * from public.collectible_challenge_states($1,'critter',$2) where challenge_id=$3", [userId, targetCritterId, targetChallengeId])).rows[0];
  check(beforeEvaluation.raw_progress === "0" && !beforeEvaluation.complete, "A dependent own-collectible challenge must not count a Relic that is still challenge-locked.");

  await client.query("select public.evaluate_all_collectible_unlocks_internal($1)", [userId]);
  check(!(await client.query("select public.collectible_is_unlocked($1,'critter',$2) as unlocked", [userId, targetCritterId])).rows[0].unlocked, "Evaluating unlocks must not grant a Critter through a locked Relic dependency.");
  check((await client.query("select count(*)::int as count from public.user_critters where user_id=$1 and critter_id=$2", [userId, targetCritterId])).rows[0].count === 0, "A locked Relic dependency must not grant the dependent Critter.");

  const taggedChallengeFixture = await client.query(`
    select challenge.id as challenge_id, challenge.parameters->'critter_tag_ids'->>0 as tag_id
    from public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
    where challenge.collectible_type='critter'
      and challenge.challenge_type='own_collectible'
      and jsonb_array_length(coalesce(challenge.parameters->'critter_tag_ids','[]'::jsonb))>0
    order by challenge.collectible_id,challenge.sort_order,challenge.id
    limit 1
  `);
  if (taggedChallengeFixture.rowCount === 1) {
    const taggedFixture = await client.query(`
      select owned.critter_id as tagged_critter_id, candidate.id as second_critter_id
      from public.user_critters owned
      join lateral (
        select id from public.critters candidate
        where candidate.is_active and not candidate.is_archived
          and candidate.id<>owned.critter_id
          and not exists (select 1 from public.user_critters existing where existing.user_id=owned.user_id and existing.critter_id=candidate.id)
        order by candidate.sort_order,candidate.id limit 1
      ) candidate on true
      where owned.user_id=$1
      order by owned.critter_id
      limit 1
    `, [userId]);
    check(taggedFixture.rowCount === 1, "The development database needs an owned Critter and another Critter for the published tagged ownership projection test.");
    const { tagged_critter_id: taggedCritterId, second_critter_id: secondCritterId } = taggedFixture.rows[0];
    const { challenge_id: taggedChallengeId, tag_id: tagId } = taggedChallengeFixture.rows[0];
    await client.query("insert into public.user_critters(user_id,critter_id) values($1,$2)", [userId, secondCritterId]);
    await client.query("delete from public.critter_tag_assignments where critter_id in (select critter_id from public.user_critters where user_id=$1)", [userId]);
    await client.query("insert into public.critter_tag_assignments(critter_id,tag_id) values($1,$2) on conflict do nothing", [taggedCritterId, tagId]);
    const taggedCurrent = (await client.query("select public.collectible_challenge_current($1,$2) as current", [userId, taggedChallengeId])).rows[0].current;
    check(taggedCurrent === "1", `Tagged ownership projection must count only the owned Critter matching the selected tag; got ${taggedCurrent}.`);
  } else {
    console.log("Published release has no Critter Tag ownership challenge; tagged projection subtest skipped.");
  }

  const specificFixture = await client.query(`
    select id as challenge_id, parameters->'collectible_ids' as relic_ids
    from public.release_collectible_challenges(public.current_game_catalog_release_id())
    where challenge_type='own_collectible'
      and parameters->>'specific_collectible_mode'='all'
    order by id
    limit 1
  `);
  check(specificFixture.rows[0]?.relic_ids?.length === 2, "The published release needs a two-item Require all Relic challenge for the specific ownership projection test.");
  const specificChallengeId = specificFixture.rows[0].challenge_id;
  const [specificRelicOne, specificRelicTwo] = specificFixture.rows[0].relic_ids;
  await client.query(`
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values($1,$2,1,now()),($1,$3,0,null)
    on conflict(user_id,relic_id) do update set quantity=excluded.quantity,discovered_at=excluded.discovered_at
  `, [userId, specificRelicOne, specificRelicTwo]);
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, specificChallengeId]);
  const specificRow = (await client.query("select parameters,required_amount from public.release_collectible_challenges(public.current_game_catalog_release_id()) where id=$1", [specificChallengeId])).rows[0];
  check(specificRow.required_amount === "2" && specificRow.parameters.require_unique_collectibles === true, "Require all must canonicalize its goal and distinct-ID ownership semantics.");
  check((await client.query("select public.collectible_challenge_goal($1) as goal, public.collectible_challenge_current($2,$1) as current", [specificChallengeId, userId])).rows[0].goal === "2", "Require all must expose a 2-item server goal.");
  const partialSpecificCurrent = (await client.query("select public.collectible_challenge_current($1,$2) as current", [userId, specificChallengeId])).rows[0].current;
  check(partialSpecificCurrent === "1", "Require all must report one of two selected Relics as 1/2.");
  await client.query("update public.user_relic_inventory set quantity=1,discovered_at=now() where user_id=$1 and relic_id=$2", [userId, specificRelicTwo]);
  check((await client.query("select public.collectible_challenge_current($1,$2) as current", [userId, specificChallengeId])).rows[0].current === "2", "Require all must complete only after both selected Relics are owned.");

  console.log(`Collectible ownership dependency and Critter-tag projection tests passed for user ${userId}; all fixture changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
