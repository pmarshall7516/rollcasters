import crypto from "node:crypto";
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
    select player.id as user_id, target.id as target_critter_id, dependency.id as dependency_relic_id
    from auth.users player
    join lateral (
      select critter.id
      from public.critters critter
      where critter.is_active and not critter.is_archived
        and not exists (
          select 1
          from public.user_critters owned
          where owned.user_id=player.id and owned.critter_id=critter.id
        )
      order by critter.sort_order,critter.id
      limit 1
    ) target on true
    join lateral (
      select relic.id
      from public.relics relic
      where relic.is_active and not relic.is_archived
        and not exists (
          select 1
          from public.user_relic_inventory owned
          where owned.user_id=player.id and owned.relic_id=relic.id and owned.quantity>0
        )
      order by relic.sort_order,relic.id
      limit 1
    ) dependency on true
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The development database needs an authenticated user, Critter target, and Relic dependency.");

  const { user_id: userId, target_critter_id: targetCritterId, dependency_relic_id: dependencyRelicId } = fixture.rows[0];
  const dependencyChallengeId = crypto.randomUUID();
  const targetChallengeId = crypto.randomUUID();
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  for (const [type, id] of [["critter", targetCritterId], ["relic", dependencyRelicId]]) {
    await client.query("delete from public.user_tracked_collectible_challenges tracked using public.collectible_unlock_challenges challenge where tracked.challenge_id=challenge.id and challenge.collectible_type=$1 and challenge.collectible_id=$2", [type, id]);
    await client.query("delete from public.user_collectible_challenge_progress progress using public.collectible_unlock_challenges challenge where progress.challenge_id=challenge.id and challenge.collectible_type=$1 and challenge.collectible_id=$2", [type, id]);
    await client.query("delete from public.collectible_unlock_requirements where collectible_type=$1 and collectible_id=$2", [type, id]);
    await client.query("delete from public.collectible_unlock_challenges where collectible_type=$1 and collectible_id=$2", [type, id]);
  }

  await client.query(`
    insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
    values ('relic',$1,1),('critter',$2,1)
  `, [dependencyRelicId, targetCritterId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,parameters,target_mode,any_target,target_ids,required_amount,sort_order
    ) values($1,'relic',$2,'deal_damage',$3::jsonb,'species',true,'{}',5,0)
  `, [dependencyChallengeId, dependencyRelicId, JSON.stringify({ target_mode: "species", any_target: true, target_ids: [], required_amount: 5 })]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,parameters,target_category,target_id,required_amount,sort_order
    ) values($1,'critter',$2,'own_collectible',$3::jsonb,'relic',$4,1,0)
  `, [targetChallengeId, targetCritterId, JSON.stringify({ collectible_category: "relic", collectible_ids: [dependencyRelicId], required_amount: 1, require_unique_collectibles: true, retroactive: true }), dependencyRelicId]);

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

  const taggedFixture = await client.query(`
    select owned.critter_id as tagged_critter_id, tag.id as tag_id, candidate.id as second_critter_id
    from public.user_critters owned
    join lateral (
      select id from public.content_tags where tag_type='critter' and is_active and not is_archived order by sort_order,id limit 1
    ) tag on true
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
  check(taggedFixture.rowCount === 1, "The development database needs an owned Critter, a Critter Tag, and another Critter for the tagged ownership projection test.");
  const { tagged_critter_id: taggedCritterId, tag_id: tagId, second_critter_id: secondCritterId } = taggedFixture.rows[0];
  const taggedChallengeId = crypto.randomUUID();
  await client.query("insert into public.user_critters(user_id,critter_id) values($1,$2)", [userId, secondCritterId]);
  await client.query("delete from public.critter_tag_assignments where critter_id in (select critter_id from public.user_critters where user_id=$1)", [userId]);
  await client.query("insert into public.critter_tag_assignments(critter_id,tag_id) values($1,$2) on conflict do nothing", [taggedCritterId, tagId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,parameters,required_amount,sort_order
    ) values($1,'critter',$2,'own_collectible',$3::jsonb,1,1)
  `, [taggedChallengeId, targetCritterId, JSON.stringify({ collectible_category: "critter", collectible_ids: [], critter_tag_ids: [tagId], required_amount: 1, require_unique_collectibles: true, retroactive: true })]);
  const taggedCurrent = (await client.query("select public.collectible_challenge_current($1,$2) as current", [userId, taggedChallengeId])).rows[0].current;
  check(taggedCurrent === "1", `Tagged ownership projection must count only the owned Critter matching the selected tag; got ${taggedCurrent}.`);
  await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [taggedChallengeId, JSON.stringify({ collectible_category: "critter", collectible_ids: [], critter_tag_ids: [], required_amount: 1, require_unique_collectibles: true, retroactive: true })]);
  const allOwnedCount = (await client.query("select count(*)::text as count from public.user_critters where user_id=$1 and public.collectible_is_unlocked($1,'critter',critter_id)", [userId])).rows[0].count;
  const unfilteredCurrent = (await client.query("select public.collectible_challenge_current($1,$2) as current", [userId, taggedChallengeId])).rows[0].current;
  check(unfilteredCurrent === allOwnedCount, `Removing the ownership tag filter must restore all owned Critters to the projection; got ${unfilteredCurrent}, expected ${allOwnedCount}.`);

  console.log(`Collectible ownership dependency and Critter-tag projection tests passed for user ${userId}; all fixture changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
