import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

const STARTER_IDS = ["001", "004", "007"];

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

  const authored = await client.query(`
    select starter.critter_id,challenge.id as challenge_id,challenge.required_amount::text
    from public.starter_options starter
    join public.collectible_unlock_challenges challenge
      on challenge.collectible_type='critter'
     and challenge.collectible_id=starter.critter_id
     and challenge.challenge_type='shop_shards'
    where starter.critter_id=any($1::text[]) and starter.is_active
    order by starter.sort_order,starter.critter_id
  `, [STARTER_IDS]);
  check(authored.rows.map((row) => row.critter_id).join(",") === STARTER_IDS.join(","), "Starter IDs 001, 004, and 007 must remain active and have shard challenges.");
  check(authored.rows.every((row) => row.required_amount === "50"), "Every starter shard challenge must require exactly 50 shards.");

  for (const starter of authored.rows) {
    await client.query("savepoint starter_selection_case");
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
    check(state.owned === 1, `Starter ${starter.critter_id} must be granted to the player.`);
    check(state.shards === "50", `Starter ${starter.critter_id} must grant exactly 50 shards.`);
    check(state.selected && state.in_squad, `Starter ${starter.critter_id} must finish selection and occupy squad slot 1.`);
    check(state.current === "50" && state.goal === "50", `Starter ${starter.critter_id} must complete its 50-shard challenge.`);

    await client.query("select public.select_starter_critter($1)", [starter.critter_id]);
    const retry = await client.query(`
      select quantity::text
      from public.user_collectible_shards
      where user_id=$1 and collectible_type='critter' and collectible_id=$2
    `, [userId, starter.critter_id]);
    check(retry.rows[0]?.quantity === "50", `Retrying starter ${starter.critter_id} selection must remain idempotent.`);
    await client.query("rollback to savepoint starter_selection_case");
  }

  console.log("Starter selection grants and completes 50-shard progress for Critters 001, 004, and 007; all test data will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
