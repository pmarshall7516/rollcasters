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
    select
      player.id as user_id,
      shop.id as shop_entry_id,
      shop.target_category,
      shop.target_id,
      shop.currency_id,
      shop.price,
      dungeon.dungeon_id,
      global_shop.id as global_shop_challenge_id,
      global_dungeon.id as global_dungeon_challenge_id
    from auth.users player
    cross join lateral (
      select s.id,s.target_category,s.target_id,s.currency_id,s.price
      from public.shop_entries s
      where s.is_active and not s.is_archived and s.shop_type='lootbox'
      order by s.id
      limit 1
    ) shop
    cross join lateral (
      select dungeon_id
      from public.user_dungeon_progress
      where user_id=player.id and is_unlocked
      order by dungeon_id
      limit 1
    ) dungeon
    cross join lateral (
      select challenge.id
      from public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
      where challenge.challenge_type='resource_spending'
        and challenge.parameters->>'tracking_required'='false'
      order by challenge.id
      limit 1
    ) global_shop
    cross join lateral (
      select challenge.id
      from public.release_collectible_challenges(public.current_game_catalog_release_id()) challenge
      where challenge.challenge_type='dungeon_clear'
        and challenge.parameters->>'tracking_required'='false'
      order by challenge.id
      limit 1
    ) global_dungeon
    where not public.is_dev_tool_identity(player.id)
    order by player.created_at
    limit 1
  `);
  check(fixture.rowCount === 1, "The development database needs a user and an active Shop entry.");

  const row = fixture.rows[0];
  const userId = row.user_id;
  const globalResourceId = row.global_shop_challenge_id;
  const globalDungeonId = row.global_dungeon_challenge_id;
  await client.query("delete from public.user_tracked_collectible_challenges where user_id=$1", [userId]);
  await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [globalResourceId, JSON.stringify({ spending_context: "shop", resource_type: "coin", tracking_scope: "lifetime", required_amount: 500, tracking_required: false, shop_ids: [], purchased_collectible_categories: [] })]);
  await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [globalDungeonId, JSON.stringify({ dungeon_selection: "specific_dungeon", dungeon_ids: ["010"], required_clears: 1, tracking_required: false, relic_selection: "any_relics", required_relic_ids: [], minimum_dungeon_ids: [], maximum_dungeon_ids: [], required_relic_amount: 1, require_unique_relics: true, has_relic_requirements: false, require_relic_activation: false })]);
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=any($2::uuid[])", [userId, [globalResourceId, globalDungeonId]]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  const shopAmount = 7;
  await client.query(
    "select public.apply_collectible_challenge_event_v3($1,'resource_spent',null,null,null,$2,$3::jsonb,'{}','{}',true)",
    [userId, shopAmount, JSON.stringify({ spending_context: "shop", resource_type: "coin", currency_id: "coins", custom_currency_id: "coins", shop_id: row.shop_entry_id, purchased_collectible_category: row.target_category })],
  );
  const globalResourceProgress = (await client.query(
    "select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, globalResourceId],
  )).rows[0]?.progress;
  check(globalResourceProgress === String(shopAmount), "A global Shop Resource Spending challenge must advance without being selected.");

  await client.query(`
    insert into public.user_currencies(user_id,currency_id,balance)
    values($1,$2,$3)
    on conflict(user_id,currency_id) do update set balance=excluded.balance
  `, [userId, row.currency_id, Number(row.price) + 100]);
  await client.query("select public.purchase_shop_entry($1,$2)", [row.shop_entry_id, crypto.randomUUID()]);
  const globalResourceAfterPurchase = (await client.query(
    "select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, globalResourceId],
  )).rows[0]?.progress;
  check(globalResourceAfterPurchase === String(shopAmount + Number(row.price)), "A real Shop purchase must emit its spend event to global Resource Spending challenges.");

  await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [globalResourceId, JSON.stringify({ spending_context: "combat", resource_type: "mana", tracking_scope: "lifetime", required_amount: 500, tracking_required: false, critter_ids: [], dungeon_ids: [], ability_ids: [], rollcaster_ids: [] })]);
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, globalResourceId]);
  const runId = (await client.query("select public.start_dungeon_run($1) as id", [row.dungeon_id])).rows[0].id;
  await client.query("select public.submit_collectible_combat_events($1,1,$2::jsonb)", [runId, JSON.stringify([{
    event_key: "global-resource-combat-regression",
    event_type: "resource_spent",
    source_critter_id: null,
    target_critter_id: null,
    skill_id: null,
    amount: 13,
    payload: { spending_context: "combat", resource_type: "mana" },
  }])]);
  const globalCombatProgress = (await client.query(
    "select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, globalResourceId],
  )).rows[0]?.progress;
  check(globalCombatProgress === "13", "Global combat Resource Spending challenges must advance for each submitted combat event.");

  await client.query("update public.collectible_unlock_challenges set parameters=$2::jsonb where id=$1", [globalResourceId, JSON.stringify({ spending_context: "combat", resource_type: "mana", tracking_scope: "lifetime", required_amount: 500, tracking_required: true, critter_ids: ["025"], dungeon_ids: [], ability_ids: [], rollcaster_ids: [] })]);
  await client.query("delete from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2", [userId, globalResourceId]);
  await client.query("insert into public.user_tracked_collectible_challenges(user_id,challenge_id,slot_order) values($1,$2,1)", [userId, globalResourceId]);

  const filteredAmount = 11;
  await client.query(
    "select public.apply_collectible_challenge_event_v3($1,'resource_spent', 'not-the-authored-critter', null, null, $2, $3::jsonb, '{}', '{}', false)",
    [userId, filteredAmount, JSON.stringify({ spending_context: "combat", resource_type: "mana", dungeon_id: "001" })],
  );
  const trackedResourceProgress = (await client.query(
    "select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, globalResourceId],
  )).rows[0]?.progress;
  check(trackedResourceProgress === undefined, "A selected Resource Spending challenge must reject an event that misses its authored filters.");

  await client.query(
    "select public.apply_collectible_challenge_event_v3($1,'resource_spent', '025', null, null, $2, $3::jsonb, '{}', '{}', false)",
    [userId, filteredAmount, JSON.stringify({ spending_context: "combat", resource_type: "mana", dungeon_id: "001" })],
  );
  const matchingTrackedProgress = (await client.query(
    "select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, globalResourceId],
  )).rows[0]?.progress;
  check(matchingTrackedProgress === String(filteredAmount), "A selected Resource Spending challenge must advance after its authored filters match.");

  await client.query(
    "select public.apply_collectible_challenge_event_v3($1,'dungeon_completed',null,null,null,1,$2::jsonb,'{}','{}',true)",
    [userId, JSON.stringify({ won: true, dungeon_id: "010", dungeon_order: 10 })],
  );
  const globalDungeonProgress = (await client.query(
    "select progress::text from public.user_collectible_challenge_progress where user_id=$1 and challenge_id=$2",
    [userId, globalDungeonId],
  )).rows[0]?.progress;
  check(globalDungeonProgress === "1", "A global Dungeon Clear challenge must advance without being selected.");

  check((await client.query(
    "select count(*)::int as count from public.user_tracked_collectible_challenges where user_id=$1 and challenge_id=$2",
    [userId, globalDungeonId],
  )).rows[0].count === 0, "Global event challenges must not be inserted into the tracker.");

  console.log(`Challenge runtime audit passed for user ${userId}; all fixture changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
