import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

const STARTER_ROLLCASTER_IDS = ["001", "002", "003"];
const STARTER_CRITTER_IDS = ["001", "004", "007"];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const userId = crypto.randomUUID();
  await client.query(`
    insert into auth.users(
      id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values($1,'authenticated','authenticated',$2,'{}','{}',now(),now())
  `, [userId, `starter-selection-${userId}@example.com`]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("select public.ensure_user_game_state()");

  const freshState = await client.query(`
    select
      profile.starter_rollcaster_selected_at,
      profile.starter_selected_at,
      profile.active_rollcaster_id,
      (select count(*)::int from public.user_rollcasters where user_id=$1) as owned_rollcasters
    from public.profiles profile
    where profile.user_id=$1
  `, [userId]);
  check(freshState.rows[0]?.starter_rollcaster_selected_at === null, "A new player must begin before Rollcaster selection.");
  check(freshState.rows[0]?.starter_selected_at === null, "A new player must begin before Critter selection.");
  check(freshState.rows[0]?.active_rollcaster_id === null, "A new player must not receive an active Rollcaster automatically.");
  check(freshState.rows[0]?.owned_rollcasters === 0, "ensure_user_game_state must not auto-grant Roland.");

  await client.query("savepoint critter_before_rollcaster");
  let rejectedCritterFirst = false;
  try {
    await client.query("select public.select_starter_critter($1)", [STARTER_CRITTER_IDS[0]]);
  } catch (error) {
    rejectedCritterFirst = String(error?.message ?? error).includes("before selecting a starter Critter");
    await client.query("rollback to savepoint critter_before_rollcaster");
  }
  check(rejectedCritterFirst, "The database must reject Critter selection before Rollcaster selection.");

  const authoredRollcasters = await client.query(`
    select
      starter.rollcaster_id,
      challenge.id as challenge_id,
      challenge.required_amount::text,
      ability.ability_id
    from public.starter_rollcaster_options starter
    join public.collectible_unlock_challenges challenge
      on challenge.collectible_type='rollcaster'
     and challenge.collectible_id=starter.rollcaster_id
     and challenge.challenge_type='shop_shards'
    join lateral (
      select authored.ability_id
      from public.rollcaster_ability_unlocks authored
      where authored.rollcaster_id=starter.rollcaster_id
        and authored.unlock_level=1
        and authored.unlock_cost=0
      order by authored.is_default desc,authored.sort_order,authored.ability_id
      limit 1
    ) ability on true
    where starter.rollcaster_id=any($1::text[]) and starter.is_active
    order by starter.sort_order,starter.rollcaster_id
  `, [STARTER_ROLLCASTER_IDS]);
  check(
    authoredRollcasters.rows.map((row) => row.rollcaster_id).join(",") === STARTER_ROLLCASTER_IDS.join(","),
    "Rollcasters 001, 002, and 003 must be the active starter options.",
  );
  check(
    authoredRollcasters.rows.every((row) => row.required_amount === "20"),
    "Every starter Rollcaster shard challenge must require exactly 20 shards.",
  );

  for (const starter of authoredRollcasters.rows) {
    await client.query("savepoint starter_rollcaster_case");
    await client.query("select public.select_starter_rollcaster($1)", [starter.rollcaster_id]);

    const result = await client.query(`
      select
        (select count(*)::int from public.user_rollcasters where user_id=$1 and rollcaster_id=$2) as owned,
        (select quantity::text from public.user_collectible_shards where user_id=$1 and collectible_type='rollcaster' and collectible_id=$2) as shards,
        (select starter_rollcaster_selected_at is not null from public.profiles where user_id=$1) as selected,
        (select owned.id=profile.active_rollcaster_id
         from public.user_rollcasters owned
         join public.profiles profile on profile.user_id=owned.user_id
         where owned.user_id=$1 and owned.rollcaster_id=$2) as active,
        (select count(*)::int
         from public.user_rollcaster_abilities unlocked
         join public.user_rollcasters owned on owned.id=unlocked.user_rollcaster_id
         where owned.user_id=$1 and owned.rollcaster_id=$2 and unlocked.ability_id=$3) as ability_unlocked,
        (select count(*)::int
         from public.user_rollcaster_ability_slots slot
         join public.user_rollcasters owned on owned.id=slot.user_rollcaster_id
         where owned.user_id=$1 and owned.rollcaster_id=$2 and slot.slot_index=1 and slot.ability_id=$3) as ability_slotted,
        public.collectible_challenge_current($1,$4)::text as current,
        public.collectible_challenge_goal($4)::text as goal
    `, [userId, starter.rollcaster_id, starter.ability_id, starter.challenge_id]);
    const state = result.rows[0];
    check(state.owned === 1, `Starter Rollcaster ${starter.rollcaster_id} must be granted to the player.`);
    check(state.shards === "20", `Starter Rollcaster ${starter.rollcaster_id} must grant exactly 20 shards.`);
    check(state.selected && state.active, `Starter Rollcaster ${starter.rollcaster_id} must finish selection and become active.`);
    check(
      state.ability_unlocked === 1 && state.ability_slotted === 1,
      `Starter Rollcaster ${starter.rollcaster_id} must unlock and slot its authored starter Ability.`,
    );
    check(
      state.current === "20" && state.goal === "20",
      `Starter Rollcaster ${starter.rollcaster_id} must complete its 20-shard challenge.`,
    );

    await client.query("select public.select_starter_rollcaster($1)", [starter.rollcaster_id]);
    const retry = await client.query(`
      select
        (select count(*)::int from public.user_rollcasters where user_id=$1) as owned,
        (select quantity::text
         from public.user_collectible_shards
         where user_id=$1 and collectible_type='rollcaster' and collectible_id=$2) as quantity
    `, [userId, starter.rollcaster_id]);
    check(retry.rows[0]?.owned === 1, `Retrying starter Rollcaster ${starter.rollcaster_id} must not grant another Rollcaster.`);
    check(retry.rows[0]?.quantity === "20", `Retrying starter Rollcaster ${starter.rollcaster_id} must remain at 20 shards.`);
    await client.query("rollback to savepoint starter_rollcaster_case");
  }

  const selectedRollcaster = authoredRollcasters.rows[0];
  await client.query("select public.select_starter_rollcaster($1)", [selectedRollcaster.rollcaster_id]);

  const authoredCritters = await client.query(`
    select starter.critter_id,challenge.id as challenge_id,challenge.required_amount::text
    from public.starter_options starter
    join public.collectible_unlock_challenges challenge
      on challenge.collectible_type='critter'
     and challenge.collectible_id=starter.critter_id
     and challenge.challenge_type='shop_shards'
    where starter.critter_id=any($1::text[]) and starter.is_active
    order by starter.sort_order,starter.critter_id
  `, [STARTER_CRITTER_IDS]);
  check(
    authoredCritters.rows.map((row) => row.critter_id).join(",") === STARTER_CRITTER_IDS.join(","),
    "Critters 001, 004, and 007 must remain active starter options.",
  );
  check(
    authoredCritters.rows.every((row) => row.required_amount === "50"),
    "Every starter Critter shard challenge must require exactly 50 shards.",
  );

  for (const starter of authoredCritters.rows) {
    await client.query("savepoint starter_critter_case");
    await client.query("select public.select_starter_critter($1)", [starter.critter_id]);

    const result = await client.query(`
      select
        (select count(*)::int from public.user_critters where user_id=$1 and critter_id=$2) as owned,
        (select quantity::text from public.user_collectible_shards where user_id=$1 and collectible_type='critter' and collectible_id=$2) as shards,
        (select starter_selected_at is not null from public.profiles where user_id=$1) as selected,
        (select user_critter_id is not null from public.user_squad_slots where user_id=$1 and slot_index=1) as in_squad,
        public.collectible_challenge_current($1,$3)::text as current,
        public.collectible_challenge_goal($3)::text as goal
    `, [userId, starter.critter_id, starter.challenge_id]);
    const state = result.rows[0];
    check(state.owned === 1, `Starter Critter ${starter.critter_id} must be granted to the player.`);
    check(state.shards === "50", `Starter Critter ${starter.critter_id} must grant exactly 50 shards.`);
    check(state.selected && state.in_squad, `Starter Critter ${starter.critter_id} must finish selection and occupy squad slot 1.`);
    check(
      state.current === "50" && state.goal === "50",
      `Starter Critter ${starter.critter_id} must complete its 50-shard challenge.`,
    );

    await client.query("select public.select_starter_critter($1)", [starter.critter_id]);
    const retry = await client.query(`
      select quantity::text
      from public.user_collectible_shards
      where user_id=$1 and collectible_type='critter' and collectible_id=$2
    `, [userId, starter.critter_id]);
    check(retry.rows[0]?.quantity === "50", `Retrying starter Critter ${starter.critter_id} selection must remain idempotent.`);
    await client.query("rollback to savepoint starter_critter_case");
  }

  console.log(
    "Starter onboarding enforces Rollcaster-before-Critter selection, grants 20/50 shards, and equips authored starter abilities/skills; all test data will be rolled back.",
  );
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
