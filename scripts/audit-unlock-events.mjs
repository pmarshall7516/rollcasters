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
try {
  await client.connect();
  const result = await client.query(`
    with owned as (
      select user_id,'critter'::text collectible_type,critter_id collectible_id from public.user_critters
      union all
      select user_id,'rollcaster',rollcaster_id from public.user_rollcasters
      union all
      select user_id,'relic',relic_id from public.user_relic_inventory where discovered_at is not null and quantity>0
    ), gated_owned as (
      select owned.*
      from owned
      join public.collectible_unlock_requirements requirement using(collectible_type,collectible_id)
      where requirement.required_challenges>0
    )
    select count(*)::int gated_owned,
      count(*) filter(where event.id is null)::int missing_event
    from gated_owned owned
    left join public.user_collectible_unlock_events event
      on event.user_id=owned.user_id and event.collectible_type=owned.collectible_type and event.collectible_id=owned.collectible_id
  `);
  console.log(JSON.stringify(result.rows[0]));
  const missing = await client.query(`
    with owned as (
      select user_id,'critter'::text collectible_type,critter_id collectible_id from public.user_critters
      union all select user_id,'rollcaster',rollcaster_id from public.user_rollcasters
      union all select user_id,'relic',relic_id from public.user_relic_inventory where discovered_at is not null and quantity>0
    )
    select owned.user_id,owned.collectible_type,owned.collectible_id,requirement.required_challenges,
      count(progress.challenge_id) filter(where progress.completed_at is not null)::int historically_completed
    from owned
    join public.collectible_unlock_requirements requirement using(collectible_type,collectible_id)
    left join public.collectible_unlock_challenges challenge
      on challenge.collectible_type=owned.collectible_type and challenge.collectible_id=owned.collectible_id
    left join public.user_collectible_challenge_progress progress
      on progress.user_id=owned.user_id and progress.challenge_id=challenge.id
    left join public.user_collectible_unlock_events event
      on event.user_id=owned.user_id and event.collectible_type=owned.collectible_type and event.collectible_id=owned.collectible_id
    where requirement.required_challenges>0 and event.id is null
    group by owned.user_id,owned.collectible_type,owned.collectible_id,requirement.required_challenges
    order by owned.user_id,owned.collectible_type,owned.collectible_id
  `);
  console.log(JSON.stringify(missing.rows));
} finally {
  await client.end().catch(() => undefined);
}
