import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDbClient, root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
const migrationSql = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260720030000_fix_indirect_player_revision_trigger.sql"),
  "utf8",
);
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;
  await client.query(migrationSql);

  const starter = (await client.query(`
    select
      (select rollcaster_id from public.starter_rollcaster_options where is_active order by sort_order,rollcaster_id limit 1) as rollcaster_id,
      (select critter_id from public.starter_options where is_active order by sort_order,critter_id limit 1) as critter_id,
      (select id from public.relics where is_active and not is_archived order by sort_order,id limit 1) as relic_id
  `)).rows[0];
  check(starter?.rollcaster_id && starter?.critter_id && starter?.relic_id, "The loadout fixture requires active starter and Relic catalog entries.");

  const userId = crypto.randomUUID();
  await client.query(`
    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'authenticated','authenticated',$2,'{}','{}',now(),now())
  `, [userId, `loadout-unequip-${userId}@example.com`]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("select public.ensure_user_game_state()");
  await client.query("select public.select_starter_rollcaster($1)", [starter.rollcaster_id]);
  await client.query("select public.select_starter_critter($1)", [starter.critter_id]);

  const owned = (await client.query(`
    select
      (select id from public.user_rollcasters where user_id=$1 and rollcaster_id=$2) as rollcaster_id,
      (select id from public.user_critters where user_id=$1 and critter_id=$3) as critter_id,
      (select player_state_revision from public.profiles where user_id=$1) as revision
  `, [userId, starter.rollcaster_id, starter.critter_id])).rows[0];
  check(owned?.rollcaster_id && owned?.critter_id, "Starter selection must create both owned loadout records.");

  const secondSkill = (await client.query(`
    select unlock.skill_id
    from public.critter_skill_unlocks unlock
    where unlock.critter_id=$1
      and unlock.skill_id <> (
        select skill_id from public.user_critter_skill_slots
        where user_critter_id=$2 and skill_id is not null
        order by slot_index limit 1
      )
    order by unlock.sort_order,unlock.skill_id
    limit 1
  `, [starter.critter_id, owned.critter_id])).rows[0]?.skill_id;
  check(secondSkill, "The starter Critter needs a second authored Skill for the unequip fixture.");

  await client.query(`
    insert into public.user_critter_skills(user_critter_id,skill_id)
    values($1,$2) on conflict do nothing
  `, [owned.critter_id, secondSkill]);
  await client.query("select public.set_critter_skill_slot($1,2,$2)", [owned.critter_id, secondSkill]);

  await client.query(`
    insert into public.user_relic_inventory(user_id,relic_id,quantity,discovered_at)
    values($1,$2,1,now())
    on conflict(user_id,relic_id) do update set quantity=greatest(public.user_relic_inventory.quantity,1),discovered_at=coalesce(public.user_relic_inventory.discovered_at,now())
  `, [userId, starter.relic_id]);
  await client.query("select public.set_critter_relic_slot($1,1,$2)", [owned.critter_id, starter.relic_id]);

  await client.query("select public.set_critter_skill_slot($1,2,null)", [owned.critter_id]);
  await client.query("select public.set_critter_relic_slot($1,1,null)", [owned.critter_id]);
  await client.query("select public.set_rollcaster_ability_slot($1,1,null)", [owned.rollcaster_id]);

  const result = (await client.query(`
    select
      (select skill_id is null from public.user_critter_skill_slots where user_critter_id=$1 and slot_index=2) as skill_cleared,
      (select relic_id is null from public.user_critter_relic_slots where user_critter_id=$1 and slot_index=1) as relic_cleared,
      (select ability_id is null from public.user_rollcaster_ability_slots where user_rollcaster_id=$2 and slot_index=1) as ability_cleared,
      (select player_state_revision from public.profiles where user_id=$3) as revision
  `, [owned.critter_id, owned.rollcaster_id, userId])).rows[0];
  check(result.skill_cleared, "Critter Skill unequip must persist a null slot without a transition-record error.");
  check(result.relic_cleared, "Critter Relic unequip must persist a null slot without a transition-record error.");
  check(result.ability_cleared, "Rollcaster Ability unequip must persist a null slot without a transition-record error.");
  check(result.revision > owned.revision, "Every indirect loadout mutation must advance the player-state revision.");

  console.log("Critter Skill/Relic and Rollcaster Ability unequip tests passed; fixture changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
