import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDbClient, root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function numeric(value) {
  return Number(value ?? 0);
}

const migrationPath = path.join(root, "supabase", "migrations", "013_level_progression_point_rewards.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");
const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const pendingCritters = (await client.query(`
    select owned.id,owned.skill_points,owned.level,owned.highest_processed_level,
      coalesce(sum(progression.grant_skill_points),0)::int as pending_points
    from public.user_critters owned
    left join public.critter_level_progression progression
      on progression.critter_id=owned.critter_id
     and progression.level>greatest(owned.highest_processed_level,1)
     and progression.level<=owned.level
    where owned.level>greatest(owned.highest_processed_level,1)
    group by owned.id
  `)).rows;
  const pendingRollcasters = (await client.query(`
    select owned.id,owned.ability_points,owned.level,owned.highest_processed_level,
      coalesce(sum(progression.grant_ability_points),0)::int as pending_points
    from public.user_rollcasters owned
    left join public.rollcaster_level_progression progression
      on progression.rollcaster_id=owned.rollcaster_id
     and progression.level>greatest(owned.highest_processed_level,1)
     and progression.level<=owned.level
    where owned.level>greatest(owned.highest_processed_level,1)
    group by owned.id
  `)).rows;

  await client.query(migrationSql);

  for (const before of pendingCritters) {
    const after = (await client.query(`
      select skill_points,highest_processed_level
      from public.user_critters where id=$1
    `, [before.id])).rows[0];
    check(
      after.skill_points === before.skill_points + before.pending_points,
      "Historic Critter progression must add every unprocessed Skill point grant.",
    );
    check(after.highest_processed_level === before.level, "Historic Critter progression must advance its processed-level cursor.");
  }

  for (const before of pendingRollcasters) {
    const after = (await client.query(`
      select ability_points,highest_processed_level
      from public.user_rollcasters where id=$1
    `, [before.id])).rows[0];
    check(
      after.ability_points === before.ability_points + before.pending_points,
      "Historic Rollcaster progression must add every unprocessed Ability point grant.",
    );
    check(after.highest_processed_level === before.level, "Historic Rollcaster progression must advance its processed-level cursor.");
  }

  const authored = (await client.query(`
    select
      (select critter_id from public.critter_level_progression group by critter_id having max(level)>=4 order by critter_id limit 1) as critter_id,
      (select rollcaster_id from public.rollcaster_level_progression group by rollcaster_id having max(level)>=4 order by rollcaster_id limit 1) as rollcaster_id
  `)).rows[0];
  check(authored.critter_id && authored.rollcaster_id, "The catalog needs Critter and Rollcaster progression through level 4.");

  const userId = crypto.randomUUID();
  await client.query(`
    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'authenticated','authenticated',$2,'{}','{}',now(),now())
  `, [userId, `progression-points-${userId}@example.com`]);

  const expectedCritterThroughThree = numeric((await client.query(`
    select coalesce(sum(grant_skill_points),0)::int as points
    from public.critter_level_progression
    where critter_id=$1 and level>1 and level<=3
  `, [authored.critter_id])).rows[0].points);
  const critterLevelFourGrant = numeric((await client.query(`
    select grant_skill_points as points
    from public.critter_level_progression where critter_id=$1 and level=4
  `, [authored.critter_id])).rows[0].points);
  check(expectedCritterThroughThree > 0 && critterLevelFourGrant > 0, "The Critter fixture needs positive point grants through levels 2–4.");

  const critterId = (await client.query(`
    insert into public.user_critters(user_id,critter_id)
    values($1,$2) returning id
  `, [userId, authored.critter_id])).rows[0].id;
  await client.query("update public.user_critters set level=3 where id=$1", [critterId]);
  let critter = (await client.query(`
    select level,skill_points,highest_processed_level from public.user_critters where id=$1
  `, [critterId])).rows[0];
  check(critter.skill_points === expectedCritterThroughThree, "A Critter jumping from level 1 to 3 must receive both milestone grants.");
  check(critter.highest_processed_level === 3, "A Critter multi-level jump must process through level 3.");

  await client.query("update public.user_critters set level=3 where id=$1", [critterId]);
  critter = (await client.query("select skill_points from public.user_critters where id=$1", [critterId])).rows[0];
  check(critter.skill_points === expectedCritterThroughThree, "Retrying the same Critter level must not award points twice.");

  await client.query("update public.user_critters set skill_points=skill_points-1 where id=$1", [critterId]);
  await client.query("update public.user_critters set level=4 where id=$1", [critterId]);
  critter = (await client.query(`
    select level,skill_points,highest_processed_level from public.user_critters where id=$1
  `, [critterId])).rows[0];
  check(
    critter.skill_points === expectedCritterThroughThree - 1 + critterLevelFourGrant,
    "Later Critter levels must preserve spent points and add only newly crossed milestones.",
  );
  check(critter.highest_processed_level === 4, "The Critter processed-level cursor must advance to level 4.");

  await client.query("update public.user_critters set level=4,highest_processed_level=1 where id=$1", [critterId]);
  const critterCursorRetry = (await client.query(`
    select skill_points,highest_processed_level from public.user_critters where id=$1
  `, [critterId])).rows[0];
  check(critterCursorRetry.skill_points === critter.skill_points, "Rewinding the Critter cursor in a repeated level write must not duplicate rewards.");
  check(critterCursorRetry.highest_processed_level === 4, "A Critter update must not rewind the durable reward cursor.");

  await client.query("update public.user_critters set level=2 where id=$1", [critterId]);
  await client.query("update public.user_critters set level=4 where id=$1", [critterId]);
  const critterRetry = (await client.query(`
    select skill_points,highest_processed_level from public.user_critters where id=$1
  `, [critterId])).rows[0];
  check(critterRetry.skill_points === critter.skill_points, "Down-leveling and returning must not duplicate Critter rewards.");
  check(critterRetry.highest_processed_level === 4, "Down-leveling must not rewind the Critter reward cursor.");

  const expectedRollcasterThroughThree = numeric((await client.query(`
    select coalesce(sum(grant_ability_points),0)::int as points
    from public.rollcaster_level_progression
    where rollcaster_id=$1 and level>1 and level<=3
  `, [authored.rollcaster_id])).rows[0].points);
  const rollcasterLevelFourGrant = numeric((await client.query(`
    select grant_ability_points as points
    from public.rollcaster_level_progression where rollcaster_id=$1 and level=4
  `, [authored.rollcaster_id])).rows[0].points);
  check(expectedRollcasterThroughThree > 0 && rollcasterLevelFourGrant > 0, "The Rollcaster fixture needs positive point grants through levels 2–4.");

  const rollcasterId = (await client.query(`
    insert into public.user_rollcasters(user_id,rollcaster_id)
    values($1,$2) returning id
  `, [userId, authored.rollcaster_id])).rows[0].id;
  await client.query("update public.user_rollcasters set level=3 where id=$1", [rollcasterId]);
  let rollcaster = (await client.query(`
    select level,ability_points,highest_processed_level from public.user_rollcasters where id=$1
  `, [rollcasterId])).rows[0];
  check(rollcaster.ability_points === expectedRollcasterThroughThree, "A Rollcaster jumping from level 1 to 3 must receive both milestone grants.");
  check(rollcaster.highest_processed_level === 3, "A Rollcaster multi-level jump must process through level 3.");

  await client.query("update public.user_rollcasters set level=3 where id=$1", [rollcasterId]);
  rollcaster = (await client.query("select ability_points from public.user_rollcasters where id=$1", [rollcasterId])).rows[0];
  check(rollcaster.ability_points === expectedRollcasterThroughThree, "Retrying the same Rollcaster level must not award points twice.");

  await client.query("update public.user_rollcasters set ability_points=ability_points-1 where id=$1", [rollcasterId]);
  await client.query("update public.user_rollcasters set level=4 where id=$1", [rollcasterId]);
  rollcaster = (await client.query(`
    select level,ability_points,highest_processed_level from public.user_rollcasters where id=$1
  `, [rollcasterId])).rows[0];
  check(
    rollcaster.ability_points === expectedRollcasterThroughThree - 1 + rollcasterLevelFourGrant,
    "Later Rollcaster levels must preserve spent points and add only newly crossed milestones.",
  );
  check(rollcaster.highest_processed_level === 4, "The Rollcaster processed-level cursor must advance to level 4.");

  await client.query("update public.user_rollcasters set level=4,highest_processed_level=1 where id=$1", [rollcasterId]);
  const rollcasterCursorRetry = (await client.query(`
    select ability_points,highest_processed_level from public.user_rollcasters where id=$1
  `, [rollcasterId])).rows[0];
  check(rollcasterCursorRetry.ability_points === rollcaster.ability_points, "Rewinding the Rollcaster cursor in a repeated level write must not duplicate rewards.");
  check(rollcasterCursorRetry.highest_processed_level === 4, "A Rollcaster update must not rewind the durable reward cursor.");

  await client.query("update public.user_rollcasters set level=2 where id=$1", [rollcasterId]);
  await client.query("update public.user_rollcasters set level=4 where id=$1", [rollcasterId]);
  const rollcasterRetry = (await client.query(`
    select ability_points,highest_processed_level from public.user_rollcasters where id=$1
  `, [rollcasterId])).rows[0];
  check(rollcasterRetry.ability_points === rollcaster.ability_points, "Down-leveling and returning must not duplicate Rollcaster rewards.");
  check(rollcasterRetry.highest_processed_level === 4, "Down-leveling must not rewind the Rollcaster reward cursor.");

  console.log("Critter Skill point and Rollcaster Ability point progression tests passed; all test schema/data changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
