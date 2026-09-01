import crypto from "node:crypto";
import { createDbClient } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
try {
  await client.connect();
  await client.query("begin");
  const userId = crypto.randomUUID();
  await client.query(`
    insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'authenticated','authenticated',$2,'{}','{}',now(),now())
  `, [userId, `shop-release-${userId}@example.com`]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
  await client.query("select public.ensure_user_game_state()");

  const catalog = (await client.query("select public.get_collectible_shop_catalog() as catalog")).rows[0].catalog;
  check(catalog.currencies?.length > 0, "Release shop catalog must include currencies.");
  check(catalog.shop_entries?.length > 0, "Release shop catalog must include shop entries.");
  check(catalog.lootboxes?.length > 0, "Release shop catalog must include lootboxes.");
  check(catalog.shop_entries.every((entry) => typeof entry.price === "string"), "Release shop prices must preserve exact integer JSON values.");

  const entry = catalog.shop_entries.find((item) => item.target_category === "lootbox" && item.is_active && !item.is_archived);
  check(entry, "The published release needs an active Lootbox shop entry.");
  await client.query(`
    insert into public.user_currencies(user_id,currency_id,balance)
    values($1,$2,$3)
    on conflict(user_id,currency_id) do update set balance=excluded.balance
  `, [userId, entry.currency_id, entry.price]);
  const receipt = (await client.query(
    "select public.purchase_shop_entry($1,$2) as receipt",
    [entry.id, crypto.randomUUID()],
  )).rows[0].receipt;
  check(receipt?.entry_id === entry.id && receipt?.price === entry.price, "Shop purchase must resolve price from the immutable release catalog.");
  await client.query("rollback");
  console.log("Release-backed collectibles/shop DB regression passed; fixture changes were rolled back.");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
