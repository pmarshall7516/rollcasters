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

  const userResult = await client.query("select id from auth.users where not public.is_dev_tool_identity(id) order by created_at limit 1");
  check(userResult.rowCount === 1, "The development database needs one auth user for the quantity purchase test.");
  const userId = userResult.rows[0].id;
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  const targetResult = await client.query(`
    select c.id, shop_entry.id as entry_id, shop_entry.quantity as bundle_quantity, shop_entry.price as unit_price
    from public.critters c
    join public.collectible_unlock_challenges shop_challenge
      on shop_challenge.collectible_type='critter'
     and shop_challenge.collectible_id=c.id
     and shop_challenge.challenge_type='shop_shards'
    join public.shop_entries shop_entry
      on shop_entry.shop_type='shard'
     and shop_entry.target_category='critter'
     and shop_entry.target_id=c.id
     and shop_entry.is_active
     and not shop_entry.is_archived
    join lateral (
      select product
      from jsonb_array_elements(public.current_game_catalog_snapshot()->'shopProducts') product
      where product->>'id'=shop_entry.id::text
        and coalesce((product->>'is_active')::boolean,false)
        and not coalesce((product->>'is_archived')::boolean,true)
    ) published_product on true
    where c.is_active and not c.is_archived
      and not exists(select 1 from public.user_critters uc where uc.user_id=$1 and uc.critter_id=c.id)
      and not exists(select 1 from public.user_collectible_unlock_events event where event.user_id=$1 and event.collectible_type='critter' and event.collectible_id=c.id)
    order by c.sort_order,c.id
    limit 1
  `, [userId]);
  check(targetResult.rowCount === 1, "The development catalog needs an unowned Critter for the quantity purchase test.");
  const { id: targetId, entry_id: entryId, bundle_quantity: bundleQuantity, unit_price: unitPrice } = targetResult.rows[0];
  await client.query(
    "delete from public.user_collectible_shards where user_id=$1 and collectible_type='critter' and collectible_id=$2",
    [userId, targetId],
  );
  const requestId = crypto.randomUUID();
  const initialBalance = 1000;
  const firstQuantity = 3;
  const expectedPrice = BigInt(unitPrice) * BigInt(firstQuantity);
  const expectedGranted = BigInt(bundleQuantity) * BigInt(firstQuantity);
  await client.query(`
    insert into public.user_currencies(user_id,currency_id,balance)
    values($1,'coins',$2)
    on conflict(user_id,currency_id) do update set balance=excluded.balance
  `, [userId, initialBalance]);

  const first = (await client.query("select public.purchase_shop_entry($1,$2,$3) as receipt", [entryId, requestId, firstQuantity])).rows[0].receipt;
  const retry = (await client.query("select public.purchase_shop_entry($1,$2,$3) as receipt", [entryId, requestId, firstQuantity])).rows[0].receipt;
  check(JSON.stringify(first) === JSON.stringify(retry), "Retrying a quantity request must return the exact original receipt.");
  check(first.price === expectedPrice.toString() && first.balance === (BigInt(initialBalance) - expectedPrice).toString() && first.granted === expectedGranted.toString() && first.discarded === "0", "The quantity RPC must charge and grant the requested bundle exactly.");

  const state = await client.query(`
    select
      (select balance::text from public.user_currencies where user_id=$1 and currency_id='coins') as balance,
      (select quantity::text from public.user_collectible_shards where user_id=$1 and collectible_type='critter' and collectible_id=$2) as shards,
      (select count(*)::int from public.shop_purchase_receipts where user_id=$1 and request_id=$3) as receipts
  `, [userId, targetId, requestId]);
  check(state.rows[0].balance === (BigInt(initialBalance) - expectedPrice).toString() && state.rows[0].shards === expectedGranted.toString() && state.rows[0].receipts === 1, "A quantity purchase must persist one atomic receipt and the matching balance/inventory changes.");

  const rolledBackRequestId = crypto.randomUUID();
  let rejectedAtomicBatch = false;
  await client.query("savepoint rejected_shop_batch");
  try {
    await client.query("select public.purchase_shop_entries($1::jsonb)", [JSON.stringify([
      { entry_id: entryId, request_id: rolledBackRequestId, quantity: 1 },
      { entry_id: crypto.randomUUID(), request_id: crypto.randomUUID(), quantity: 1 },
    ])]);
  } catch (error) {
    rejectedAtomicBatch = String(error?.message ?? error).includes("SHOP_ENTRY_UNAVAILABLE");
  }
  await client.query("rollback to savepoint rejected_shop_batch");
  await client.query("release savepoint rejected_shop_batch");
  check(rejectedAtomicBatch, "An invalid line must reject the complete Shop session batch.");
  const rolledBackState = await client.query(`
    select
      (select balance::text from public.user_currencies where user_id=$1 and currency_id='coins') as balance,
      (select quantity::text from public.user_collectible_shards where user_id=$1 and collectible_type='critter' and collectible_id=$2) as shards,
      (select count(*)::int from public.shop_purchase_receipts where user_id=$1 and request_id=$3) as receipts
  `, [userId, targetId, rolledBackRequestId]);
  check(
    rolledBackState.rows[0].balance === (BigInt(initialBalance) - expectedPrice).toString() && rolledBackState.rows[0].shards === expectedGranted.toString() && rolledBackState.rows[0].receipts === 0,
    "A rejected Shop session must roll back every currency, item, and receipt mutation.",
  );

  const batchRequestIds = [crypto.randomUUID(), crypto.randomUUID()];
  const batch = (await client.query("select public.purchase_shop_entries($1::jsonb) as result", [JSON.stringify([
    { entry_id: entryId, request_id: batchRequestIds[0], quantity: 2 },
    { entry_id: entryId, request_id: batchRequestIds[1], quantity: 1 },
  ])])).rows[0].result;
  check(batch.receipts.length === 2, "A Shop session batch must return one receipt for each local purchase intent.");
  const batchState = await client.query(`
    select
      (select balance::text from public.user_currencies where user_id=$1 and currency_id='coins') as balance,
      (select quantity::text from public.user_collectible_shards where user_id=$1 and collectible_type='critter' and collectible_id=$2) as shards,
      (select count(*)::int from public.shop_purchase_receipts where user_id=$1 and request_id=any($3::uuid[])) as receipts
  `, [userId, targetId, batchRequestIds]);
  check(
    batchState.rows[0].balance === (BigInt(initialBalance) - expectedPrice * 2n).toString() && batchState.rows[0].shards === (expectedGranted * 2n).toString() && batchState.rows[0].receipts === 2,
    "The atomic Shop session must persist every currency debit and item grant together.",
  );

  const privileges = await client.query(`
    select
      has_function_privilege('authenticated','public.purchase_shop_entry(uuid,uuid,bigint)','execute') as quantity_rpc,
      has_function_privilege('authenticated','public.purchase_shop_entries(jsonb)','execute') as batch_rpc
  `);
  check(privileges.rows[0].quantity_rpc && privileges.rows[0].batch_rpc, "Authenticated clients must be allowed to call both Shop purchase RPCs.");

  console.log(`Quantity shop purchase DB tests passed for Critter ${targetId}; all changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
