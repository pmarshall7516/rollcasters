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

  const userResult = await client.query("select id from auth.users order by created_at limit 1");
  check(userResult.rowCount === 1, "The development database needs one auth user for the quantity purchase test.");
  const userId = userResult.rows[0].id;
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  const targetResult = await client.query(`
    select c.id
    from public.critters c
    where c.is_active and not c.is_archived
      and not exists(select 1 from public.user_critters uc where uc.user_id=$1 and uc.critter_id=c.id)
      and not exists(select 1 from public.collectible_unlock_requirements r where r.collectible_type='critter' and r.collectible_id=c.id)
    order by c.sort_order,c.id
    limit 1
  `, [userId]);
  check(targetResult.rowCount === 1, "The development catalog needs an unowned Critter for the quantity purchase test.");
  const targetId = targetResult.rows[0].id;
  const challengeId = crypto.randomUUID();
  const entryId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  await client.query(`
    insert into public.collectible_unlock_requirements(collectible_type,collectible_id,required_challenges)
    values('critter',$1,1)
  `, [targetId]);
  await client.query(`
    insert into public.collectible_unlock_challenges(
      id,collectible_type,collectible_id,challenge_type,required_amount,sort_order
    ) values($1,'critter',$2,'shop_shards',20,0)
  `, [challengeId, targetId]);
  await client.query(`
    insert into public.shop_entries(
      id,shop_type,name,description,target_category,target_id,quantity,currency_id,price,sort_order,is_active,is_archived
    ) values($1,'shard','Quantity purchase probe','Rolled back after verification.','critter',$2,2,'coins',10,0,true,false)
  `, [entryId, targetId]);
  await client.query(`
    insert into public.user_currencies(user_id,currency_id,balance)
    values($1,'coins',100)
    on conflict(user_id,currency_id) do update set balance=excluded.balance
  `, [userId]);

  const first = (await client.query("select public.purchase_shop_entry($1,$2,3) as receipt", [entryId, requestId])).rows[0].receipt;
  const retry = (await client.query("select public.purchase_shop_entry($1,$2,3) as receipt", [entryId, requestId])).rows[0].receipt;
  check(JSON.stringify(first) === JSON.stringify(retry), "Retrying a quantity request must return the exact original receipt.");
  check(first.price === "30" && first.balance === "70" && first.granted === "6" && first.discarded === "0", "The quantity RPC must charge and grant the requested bundle exactly.");

  const state = await client.query(`
    select
      (select balance::text from public.user_currencies where user_id=$1 and currency_id='coins') as balance,
      (select quantity::text from public.user_collectible_shards where user_id=$1 and collectible_type='critter' and collectible_id=$2) as shards,
      (select count(*)::int from public.shop_purchase_receipts where user_id=$1 and request_id=$3) as receipts
  `, [userId, targetId, requestId]);
  check(state.rows[0].balance === "70" && state.rows[0].shards === "6" && state.rows[0].receipts === 1, "A quantity purchase must persist one atomic receipt and the matching balance/inventory changes.");

  const privileges = await client.query(`
    select has_function_privilege('authenticated','public.purchase_shop_entry(uuid,uuid,bigint)','execute') as quantity_rpc
  `);
  check(privileges.rows[0].quantity_rpc, "Authenticated clients must be allowed to call the quantity purchase RPC.");

  console.log(`Quantity shop purchase DB tests passed for Critter ${targetId}; all changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
