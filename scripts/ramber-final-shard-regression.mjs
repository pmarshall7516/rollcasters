import fs from "node:fs";
import pg from "pg";
import { readEnv } from "./db-utils.mjs";

const env = readEnv();
const poolerUrl = new URL(fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim());
poolerUrl.password = env.postgres_password;
const client = new pg.Client({
  connectionString: poolerUrl.toString(),
  ssl: { ca: fs.readFileSync(env.SUPABASE_DB_CA_CERT_PATH, "utf8") },
});

function check(condition, message) {
  if (!condition) throw new Error(message);
}

let began = false;
try {
  await client.connect();
  await client.query("begin");
  began = true;
  const fixture = await client.query(`
    select player.id user_id,entry.id entry_id,challenge.required_amount goal,
      coalesce(shards.quantity,0) current
    from auth.users player
    join public.shop_entries entry
      on entry.shop_type='shard' and entry.target_category='critter' and entry.target_id='001'
    join public.collectible_unlock_challenges challenge
      on challenge.collectible_type='critter' and challenge.collectible_id='001' and challenge.challenge_type='shop_shards'
    left join public.user_collectible_shards shards
      on shards.user_id=player.id and shards.collectible_type='critter' and shards.collectible_id='001'
    where lower(player.email)=lower($1) and entry.is_active
    order by entry.sort_order,entry.id limit 1
  `, [env.GAME_ACCOUNT_EMAIL]);
  check(fixture.rowCount === 1, "Expected the configured account and active Ramber shard offer.");
  const row = fixture.rows[0];
  check(BigInt(row.current) + 1n === BigInt(row.goal), `Expected the account to be one Ramber shard short, got ${row.current}/${row.goal}.`);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [row.user_id]);
  await client.query("select public.purchase_shop_entry($1,$2,1)", [row.entry_id, row.user_id]);
  const after = await client.query(`
    select shards.quantity,
      public.collectible_is_unlocked($1,'critter','001') unlocked,
      exists(select 1 from public.user_collectible_unlock_events where user_id=$1 and collectible_type='critter' and collectible_id='001') event_exists
    from public.user_collectible_shards shards
    where shards.user_id=$1 and shards.collectible_type='critter' and shards.collectible_id='001'
  `, [row.user_id]);
  check(BigInt(after.rows[0].quantity) === BigInt(row.goal), "Final Ramber shard was not recorded in the transaction.");
  check(after.rows[0].unlocked && after.rows[0].event_exists, "Final Ramber shard did not materialize the unlock.");
  console.log(`Ramber final-shard purchase passed at ${row.current}/${row.goal}; transaction will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
