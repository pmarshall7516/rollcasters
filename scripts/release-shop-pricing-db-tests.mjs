import crypto from "node:crypto";
import { createDbClient, readEnv } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const gameAccountEmail = readEnv().GAME_ACCOUNT_EMAIL;
  const userResult = await client.query("select id from auth.users where email=$1", [gameAccountEmail]);
  check(userResult.rowCount === 1, "The development database needs the configured game account for the release-price regression.");
  const userId = userResult.rows[0].id;
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);

  const fixture = await client.query(`
    select entry.id, product->>'price' as release_price
    from public.content_release_channels channel
    join public.content_release_snapshots snapshot on snapshot.release_id=channel.current_release_id
    join public.shop_entries entry on entry.shop_type='lootbox' and entry.is_active and not entry.is_archived
    cross join lateral jsonb_array_elements(
      coalesce(snapshot.snapshot->'shopProducts',snapshot.snapshot->'shopEntries','[]'::jsonb)
    ) product
    where channel.channel='production'
      and product->>'id'=entry.id::text
      and product->>'shop_type'='lootbox'
    order by entry.sort_order,entry.id
    limit 1
  `);
  check(fixture.rowCount === 1, "The development database needs one lootbox in the active release snapshot.");

  const entry = fixture.rows[0];
  const releasePrice = BigInt(entry.release_price);
  const unpublishedPrice = releasePrice + 60n;
  await client.query("update public.shop_entries set price=$2 where id=$1", [entry.id, unpublishedPrice.toString()]);
  await client.query(`
    insert into public.user_currencies(user_id,currency_id,balance)
    values($1,'coins',$2)
    on conflict(user_id,currency_id) do update set balance=excluded.balance
  `, [userId, (releasePrice + 1n).toString()]);

  const receipt = (await client.query(
    "select public.purchase_shop_entry($1,$2) as receipt",
    [entry.id, crypto.randomUUID()],
  )).rows[0].receipt;
  check(
    receipt.price === releasePrice.toString()
      && receipt.balance === "1"
      && receipt.shop_type === "lootbox",
    `Lootbox purchases must charge the active release price ${releasePrice}, not unpublished live price ${unpublishedPrice}.`,
  );
  console.log(`Release shop pricing regression passed: release=${releasePrice}, unpublished=${unpublishedPrice}; all changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
