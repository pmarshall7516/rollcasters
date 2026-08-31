import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createDbClient, readMigration } from "./db-utils.mjs";

const client = createDbClient();
await client.connect();

try {
  await client.query("begin");
  await client.query(readMigration("20260830210000_promo_code_definition_source.sql"));
  const present = (await client.query(
    "select to_regprocedure('public.get_promo_code_definition(text)') is not null as present",
  )).rows[0]?.present;
  assert.equal(present, true, "Production must expose the Promo Code definition lookup RPC.");

  const promoId = crypto.randomUUID();
  const firstRewardId = crypto.randomUUID();
  const secondRewardId = crypto.randomUUID();
  const activeCode = `DEFINITION${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const inactiveCode = `INACTIVE${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  await client.query(
    `insert into public.promo_codes(
      id,code,internal_notes,infinite_use,redemption_limit,
      infinite_uses_per_player,uses_per_player,is_active,is_archived
    ) values
      ($1,$2,'definition RPC test',false,7,false,2,true,false),
      ($3,$4,'inactive definition RPC test',false,7,false,2,false,false)`,
    [promoId, activeCode, crypto.randomUUID(), inactiveCode],
  );
  await client.query(
    `insert into public.promo_code_rewards(
      id,promo_code_id,reward_type,target_category,target_id,quantity,sort_order
    ) values
      ($1,$3,'currency',null,'coins',25,1),
      ($2,$3,'currency',null,'coins',10,0)`,
    [firstRewardId, secondRewardId, promoId],
  );

  const definition = (await client.query(
    "select public.get_promo_code_definition($1) as value",
    [`  ${activeCode.toLowerCase()}  `],
  )).rows[0]?.value;
  assert.equal(definition.code, activeCode, "Definition lookup must normalize the requested code.");
  assert.equal(definition.redemptionLimit, 7, "Definition lookup must return the authored global limit.");
  assert.equal(definition.usesPerPlayer, 2, "Definition lookup must return the authored player limit.");
  assert.equal("redemptionCount" in definition, false, "Definition lookup must not expose Production claim counts.");
  assert.deepEqual(
    definition.rewards.map((reward) => reward.sortOrder),
    [0, 1],
    "Definition lookup must return rewards in authored order.",
  );
  assert.equal(
    (await client.query("select public.get_promo_code_definition($1) as value", [inactiveCode])).rows[0]?.value,
    null,
    "Inactive definitions must not be returned.",
  );
  await client.query("rollback");
  console.log("Production Promo Code definition RPC contract passed.");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
