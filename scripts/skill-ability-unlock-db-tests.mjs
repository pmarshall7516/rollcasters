import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDbClient, root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
const migrationSql = fs.readFileSync(
  path.join(root, "supabase", "migrations", "014_skill_ability_unlocks.sql"),
  "utf8",
);
let began = false;

async function expectFailure(sql, params, expectedMessage) {
  await client.query("savepoint expected_unlock_failure");
  let failure;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error;
  }
  await client.query("rollback to savepoint expected_unlock_failure");
  check(failure, `Expected unlock failure containing: ${expectedMessage}`);
  check(
    String(failure.message).includes(expectedMessage),
    `Expected unlock failure containing "${expectedMessage}", received "${failure.message}".`,
  );
}

try {
  await client.connect();
  await client.query("begin");
  began = true;
  await client.query(migrationSql);

  const authored = (await client.query(`
    select json_build_object(
      'critter_id', unlock.critter_id,
      'skill_id', unlock.skill_id,
      'unlock_level', unlock.unlock_level,
      'unlock_cost', unlock.unlock_cost
    ) as skill
    from public.critter_skill_unlocks unlock
    where unlock.unlock_level > 1 and unlock.unlock_cost > 0
    order by unlock.unlock_level, unlock.sort_order, unlock.critter_id
    limit 1
  `)).rows[0] ?? {};
  check(authored.skill, "The catalog needs a level-gated Critter Skill with a positive point cost.");

  const paidAbility = (await client.query(`
    select unlock.rollcaster_id,unlock.ability_id,unlock.unlock_level,unlock.unlock_cost
    from public.rollcaster_ability_unlocks unlock
    where unlock.unlock_level > 1 and unlock.unlock_cost > 0
    order by unlock.unlock_level,unlock.sort_order,unlock.rollcaster_id
    limit 1
  `)).rows[0];
  if (paidAbility) {
    authored.ability = paidAbility;
  } else {
    const fixtureAbility = (await client.query(`
      select rollcaster.id as rollcaster_id,ability.id as ability_id
      from public.rollcasters rollcaster
      cross join public.rollcaster_abilities ability
      where not exists(
        select 1 from public.rollcaster_ability_unlocks authored
        where authored.rollcaster_id=rollcaster.id and authored.ability_id=ability.id
      )
      order by rollcaster.sort_order,ability.sort_order
      limit 1
    `)).rows[0];
    check(fixtureAbility, "The catalog needs one Rollcaster/Ability pair for the disposable paid-unlock fixture.");
    authored.ability = { ...fixtureAbility, unlock_level: 2, unlock_cost: 2 };
    await client.query(`
      insert into public.rollcaster_ability_unlocks(
        rollcaster_id,ability_id,unlock_level,unlock_cost,is_default,sort_order
      ) values($1,$2,$3,$4,false,10000)
    `, [
      authored.ability.rollcaster_id,
      authored.ability.ability_id,
      authored.ability.unlock_level,
      authored.ability.unlock_cost,
    ]);
  }

  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();
  await client.query(`
    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values
      ($1,'authenticated','authenticated',$3,'{}','{}',now(),now()),
      ($2,'authenticated','authenticated',$4,'{}','{}',now(),now())
  `, [
    userId,
    otherUserId,
    `unlock-owner-${userId}@example.com`,
    `unlock-other-${otherUserId}@example.com`,
  ]);

  const ownerCritterId = (await client.query(`
    insert into public.user_critters(user_id,critter_id)
    values($1,$2) returning id
  `, [userId, authored.skill.critter_id])).rows[0].id;
  const otherCritterId = (await client.query(`
    insert into public.user_critters(user_id,critter_id)
    values($1,$2) returning id
  `, [otherUserId, authored.skill.critter_id])).rows[0].id;
  const ownerRollcasterId = (await client.query(`
    insert into public.user_rollcasters(user_id,rollcaster_id)
    values($1,$2) returning id
  `, [userId, authored.ability.rollcaster_id])).rows[0].id;
  const otherRollcasterId = (await client.query(`
    insert into public.user_rollcasters(user_id,rollcaster_id)
    values($1,$2) returning id
  `, [otherUserId, authored.ability.rollcaster_id])).rows[0].id;

  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  const privileges = (await client.query(`
    select
      has_function_privilege('authenticated','public.unlock_critter_skill(uuid,text)','execute') as authenticated_skill,
      has_function_privilege('authenticated','public.unlock_rollcaster_ability(uuid,text)','execute') as authenticated_ability,
      has_function_privilege('anon','public.unlock_critter_skill(uuid,text)','execute') as anonymous_skill,
      has_function_privilege('anon','public.unlock_rollcaster_ability(uuid,text)','execute') as anonymous_ability
  `)).rows[0];
  check(privileges.authenticated_skill && privileges.authenticated_ability, "Authenticated players must be able to call both unlock RPCs.");
  check(!privileges.anonymous_skill && !privileges.anonymous_ability, "Anonymous users must not be able to execute unlock RPCs.");

  await expectFailure(
    "select public.unlock_critter_skill($1,$2)",
    [otherCritterId, authored.skill.skill_id],
    "Critter is not owned",
  );
  await expectFailure(
    "select public.unlock_rollcaster_ability($1,$2)",
    [otherRollcasterId, authored.ability.ability_id],
    "Rollcaster is not owned",
  );

  await client.query("update public.user_critters set level=$2,skill_points=$3 where id=$1", [
    ownerCritterId,
    authored.skill.unlock_level - 1,
    authored.skill.unlock_cost,
  ]);
  await client.query("update public.user_critters set skill_points=$2 where id=$1", [ownerCritterId, authored.skill.unlock_cost]);
  await expectFailure(
    "select public.unlock_critter_skill($1,$2)",
    [ownerCritterId, authored.skill.skill_id],
    "Skill requires Critter level",
  );
  await client.query("update public.user_critters set level=$2 where id=$1", [ownerCritterId, authored.skill.unlock_level]);
  await client.query("update public.user_critters set skill_points=$2 where id=$1", [ownerCritterId, authored.skill.unlock_cost - 1]);
  await expectFailure(
    "select public.unlock_critter_skill($1,$2)",
    [ownerCritterId, authored.skill.skill_id],
    "Not enough Skill points",
  );
  await expectFailure(
    "select public.unlock_critter_skill($1,$2)",
    [ownerCritterId, "missing-skill"],
    "Skill is not available for this Critter",
  );
  await client.query("update public.user_critters set skill_points=$2 where id=$1", [ownerCritterId, authored.skill.unlock_cost]);
  await client.query("select public.unlock_critter_skill($1,$2)", [ownerCritterId, authored.skill.skill_id]);
  let skillState = (await client.query(`
    select owned.skill_points,
      exists(
        select 1 from public.user_critter_skills unlocked
        where unlocked.user_critter_id=owned.id and unlocked.skill_id=$2
      ) as unlocked
    from public.user_critters owned where owned.id=$1
  `, [ownerCritterId, authored.skill.skill_id])).rows[0];
  check(skillState.skill_points === 0 && skillState.unlocked, "A successful Skill unlock must spend its exact cost and persist ownership.");
  await expectFailure(
    "select public.unlock_critter_skill($1,$2)",
    [ownerCritterId, authored.skill.skill_id],
    "Skill is already unlocked",
  );
  skillState = (await client.query("select skill_points from public.user_critters where id=$1", [ownerCritterId])).rows[0];
  check(skillState.skill_points === 0, "Retrying an unlocked Skill must not spend points again.");

  await client.query("update public.user_rollcasters set level=$2,ability_points=$3 where id=$1", [
    ownerRollcasterId,
    authored.ability.unlock_level - 1,
    authored.ability.unlock_cost,
  ]);
  await client.query("update public.user_rollcasters set ability_points=$2 where id=$1", [ownerRollcasterId, authored.ability.unlock_cost]);
  await expectFailure(
    "select public.unlock_rollcaster_ability($1,$2)",
    [ownerRollcasterId, authored.ability.ability_id],
    "Ability requires Rollcaster level",
  );
  await client.query("update public.user_rollcasters set level=$2 where id=$1", [ownerRollcasterId, authored.ability.unlock_level]);
  await client.query("update public.user_rollcasters set ability_points=$2 where id=$1", [ownerRollcasterId, authored.ability.unlock_cost - 1]);
  await expectFailure(
    "select public.unlock_rollcaster_ability($1,$2)",
    [ownerRollcasterId, authored.ability.ability_id],
    "Not enough Ability points",
  );
  await expectFailure(
    "select public.unlock_rollcaster_ability($1,$2)",
    [ownerRollcasterId, "missing-ability"],
    "Ability is not available for this Rollcaster",
  );
  await client.query("update public.user_rollcasters set ability_points=$2 where id=$1", [ownerRollcasterId, authored.ability.unlock_cost]);
  await client.query("select public.unlock_rollcaster_ability($1,$2)", [ownerRollcasterId, authored.ability.ability_id]);
  let abilityState = (await client.query(`
    select owned.ability_points,
      exists(
        select 1 from public.user_rollcaster_abilities unlocked
        where unlocked.user_rollcaster_id=owned.id and unlocked.ability_id=$2
      ) as unlocked
    from public.user_rollcasters owned where owned.id=$1
  `, [ownerRollcasterId, authored.ability.ability_id])).rows[0];
  check(abilityState.ability_points === 0 && abilityState.unlocked, "A successful Ability unlock must spend its exact cost and persist ownership.");
  await expectFailure(
    "select public.unlock_rollcaster_ability($1,$2)",
    [ownerRollcasterId, authored.ability.ability_id],
    "Ability is already unlocked",
  );
  abilityState = (await client.query("select ability_points from public.user_rollcasters where id=$1", [ownerRollcasterId])).rows[0];
  check(abilityState.ability_points === 0, "Retrying an unlocked Ability must not spend points again.");

  console.log("Critter Skill and Rollcaster Ability unlock RPC tests passed; all schema and fixture changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
