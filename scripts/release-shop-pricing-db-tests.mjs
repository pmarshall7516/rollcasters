import { createDbClient } from "./db-utils.mjs";

const client = createDbClient();
try {
  await client.connect();
  const entry = (await client.query(`
    select id,price::text as price
    from public.shop_entries
    where is_active and not is_archived
    order by sort_order,id
    limit 1
  `)).rows[0];
  if (!entry) throw new Error("An active release shop entry is required.");
  const price = (await client.query("select public.active_release_shop_price($1) as price", [entry.id])).rows[0]?.price;
  if (String(price) !== entry.price) throw new Error("Active shop price must come from the immutable release snapshot.");
  console.log("Release shop pricing DB regression passed.");
} finally {
  await client.end().catch(() => undefined);
}
