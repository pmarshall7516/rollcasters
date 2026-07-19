import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDbClient, root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectError(client, label, query, values, token) {
  const savepoint = `promo_${label.replace(/[^a-z0-9]/gi, "_")}`;
  await client.query(`savepoint ${savepoint}`);
  let message = "";
  try {
    await client.query(query, values);
  } catch (error) {
    message = String(error.message);
    await client.query(`rollback to savepoint ${savepoint}`);
  }
  await client.query(`release savepoint ${savepoint}`);
  check(message.includes(token), `${label} must fail with ${token}; received ${message || "no error"}.`);
}

const client = createDbClient();
let began = false;

try {
  await client.connect();
  await client.query("begin");
  began = true;
  const migrationSql = fs.readFileSync(
    path.join(root, "supabase", "migrations", "018_promo_code_player_uses.sql"),
    "utf8",
  );
  await client.query(migrationSql);
  await client.query(migrationSql);

  const contract = (await client.query(`
    select
      to_regclass('public.promo_codes') is not null as has_codes,
      to_regclass('public.promo_code_redemptions') is not null as has_redemptions,
      to_regprocedure('public.redeem_promo_code(text)') is not null as has_redeem,
      to_regprocedure('public.promo_code_redemption_history()') is not null as has_history,
      has_function_privilege('authenticated','public.redeem_promo_code(text)','execute') as can_redeem,
      has_function_privilege('authenticated','public.promo_code_redemption_history()','execute') as can_read_history,
      exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='promo_codes'
          and column_name='infinite_uses_per_player'
      ) as has_infinite_player_uses,
      exists(
        select 1 from information_schema.columns
        where table_schema='public' and table_name='promo_codes'
          and column_name='uses_per_player'
      ) as has_player_limit,
      not exists(
        select 1 from pg_indexes
        where schemaname='public' and tablename='promo_code_redemptions'
          and indexname='promo_code_redemptions_user_id_promo_code_id_key'
      ) as allows_repeated_redemptions,
      exists(
        select 1 from pg_constraint
        where conrelid='public.promo_codes'::regclass
          and conname='promo_codes_player_use_limit_check'
      ) as has_canonical_player_limit,
      not exists(
        select 1 from pg_constraint
        where conrelid='public.promo_codes'::regclass
          and conname='promo_codes_player_uses_check'
      ) as removed_transitional_player_limit,
      pg_get_functiondef('public.redeem_promo_code(text)'::regprocedure)
        like '%PROMO_CODE_PLAYER_LIMIT_REACHED%' as has_player_limit_token,
      pg_get_functiondef('public.redeem_promo_code(text)'::regprocedure)
        like '%playerUsesRemaining%' as returns_player_use_counts
  `)).rows[0];
  check(
    contract.has_codes
      && contract.has_redemptions
      && contract.has_redeem
      && contract.has_history
      && contract.can_redeem
      && contract.can_read_history
      && contract.has_infinite_player_uses
      && contract.has_player_limit
      && contract.allows_repeated_redemptions
      && contract.has_canonical_player_limit
      && contract.removed_transitional_player_limit
      && contract.has_player_limit_token
      && contract.returns_player_use_counts,
    "The shared database must expose finite/infinite per-player Promo Code uses.",
  );

  const user = (await client.query(`
    select profile.user_id
    from public.profiles profile
    where not exists(
      select 1 from public.dev_tool_users dev
      where dev.user_id=profile.user_id and dev.is_active
    )
    order by profile.created_at
    limit 1
  `)).rows[0];
  check(user?.user_id, "The development database needs one normal player profile for the rollback-only Promo test.");

  const target = (await client.query(`
    select critter.id,critter.name
    from public.critters critter
    where critter.is_active and not critter.is_archived
      and not exists(
        select 1 from public.user_critters owned
        where owned.user_id=$1 and owned.critter_id=critter.id
      )
    order by critter.sort_order,critter.id
    limit 1
  `, [user.user_id])).rows[0];
  check(target?.id, "The Promo database test needs one active unowned Critter.");

  const promoId = crypto.randomUUID();
  const currencyRewardId = crypto.randomUUID();
  const critterRewardId = crypto.randomUUID();
  const unlimitedPromoId = crypto.randomUUID();
  const unlimitedRewardId = crypto.randomUUID();
  const secondUserId = crypto.randomUUID();
  const code = `GAME${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const editedCode = `${code}X`;
  const unlimitedCode = `DEV${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;

  await client.query(`
    insert into public.promo_codes(
      id,code,internal_notes,redemption_limit,infinite_use,
      infinite_uses_per_player,uses_per_player,is_active,is_archived
    ) values($1,$2,'Rollback-only game client contract.',3,false,false,2,true,false)
  `, [promoId, code]);
  await client.query(`
    insert into public.promo_code_rewards(
      id,promo_code_id,reward_type,target_id,quantity,sort_order
    ) values($1,$2,'currency','coins',25,0)
  `, [currencyRewardId, promoId]);
  await client.query(`
    insert into public.promo_code_rewards(
      id,promo_code_id,reward_type,target_category,target_id,quantity,sort_order
    ) values($1,$2,'critter','critter',$3,1,1)
  `, [critterRewardId, promoId, target.id]);

  const balanceBefore = BigInt((await client.query(`
    select coalesce((
      select balance from public.user_currencies
      where user_id=$1 and currency_id='coins'
    ),0)::text as balance
  `, [user.user_id])).rows[0].balance);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [user.user_id]);

  const redemption = (await client.query(
    "select public.redeem_promo_code($1) as value",
    [`  ${code.toLowerCase()}  `],
  )).rows[0].value;
  check(redemption.code === code, "Redemption must trim and canonicalize lowercase player input.");
  check(redemption.rewards.length === 2, "Redemption must return every reward in server order.");
  check(
    redemption.rewards[0].type === "currency"
      && Number(redemption.rewards[0].quantity) === 25
      && redemption.rewards[1].type === "critter"
      && redemption.rewards[1].didUnlock === true,
    "The claim response must expose actual Currency and Critter grant outcomes.",
  );

  const secondRedemption = (await client.query(
    "select public.redeem_promo_code($1) as value",
    [code],
  )).rows[0].value;
  check(
    secondRedemption.redemptionId !== redemption.redemptionId
      && secondRedemption.rewards[0].type === "currency"
      && Number(secondRedemption.rewards[0].quantity) === 25
      && secondRedemption.rewards[1].didUnlock === false
      && Number(secondRedemption.playerUses) === 2
      && Number(secondRedemption.playerUsesRemaining) === 0
      && Number(secondRedemption.globalUsesRemaining) === 1,
    "A permitted repeat claim must create a distinct snapshot and grant the full repeatable rewards.",
  );

  const state = (await client.query(`
    select
      (select balance::text from public.user_currencies where user_id=$1 and currency_id='coins') as balance,
      exists(select 1 from public.user_critters where user_id=$1 and critter_id=$2) as owns_critter,
      (select redemption_count::text from public.promo_codes where id=$3) as redemption_count,
      (select count(*)::int from public.promo_code_redemptions
        where user_id=$1 and promo_code_id=$3) as user_redemptions
  `, [user.user_id, target.id, promoId])).rows[0];
  check(BigInt(state.balance) === balanceBefore + 50n, "Currency must be granted for every permitted claim.");
  check(state.owns_critter, "Direct Critter ownership must be granted in the redemption transaction.");
  check(
    state.redemption_count === "2" && state.user_redemptions === 2,
    "The locked global counter and per-account history must include both successful claims.",
  );

  await expectError(
    client,
    "per_account_limit",
    "select public.redeem_promo_code($1)",
    [code],
    "PROMO_CODE_PLAYER_LIMIT_REACHED",
  );

  await client.query("update public.promo_codes set code=$2 where id=$1", [promoId, editedCode]);
  await client.query("update public.promo_code_rewards set quantity=99 where id=$1", [currencyRewardId]);
  const history = (await client.query("select public.promo_code_redemption_history() as value")).rows[0].value;
  check(history.length === 2, "Player history must return one row for every completed claim.");
  check(history.every((row) => row.code === code), "Every history row must retain its code snapshot after authoring edits.");
  check(
    history.every((row) => (
      Number(row.rewards[0].configuredQuantity) === 25
      && row.rewards[1].name === target.name
    )),
    "Repeated history must retain immutable reward quantity and name snapshots.",
  );

  await client.query(`
    insert into auth.users(
      id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
    ) values($1,'authenticated','authenticated',$2,'{}'::jsonb,'{}'::jsonb,now(),now())
  `, [secondUserId, `rollback-promo-game-${secondUserId}@example.invalid`]);
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [secondUserId]);
  const finalGlobalRedemption = (await client.query(
    "select public.redeem_promo_code($1) as value",
    [editedCode],
  )).rows[0].value;
  check(
    finalGlobalRedemption.code === editedCode
      && Number(finalGlobalRedemption.playerUses) === 1
      && Number(finalGlobalRedemption.playerUsesRemaining) === 1
      && Number(finalGlobalRedemption.globalUsesRemaining) === 0,
    "A second account must be able to consume the final global claim.",
  );
  await expectError(
    client,
    "global_limit",
    "select public.redeem_promo_code($1)",
    [editedCode],
    "PROMO_CODE_LIMIT_REACHED",
  );

  await client.query(`
    insert into public.promo_codes(
      id,code,internal_notes,redemption_limit,infinite_use,
      infinite_uses_per_player,uses_per_player,is_active,is_archived
    ) values($1,$2,'Rollback-only unlimited per-player contract.',null,true,true,null,true,false)
  `, [unlimitedPromoId, unlimitedCode]);
  await client.query(`
    insert into public.promo_code_rewards(
      id,promo_code_id,reward_type,target_id,quantity,sort_order
    ) values($1,$2,'currency','coins',7,0)
  `, [unlimitedRewardId, unlimitedPromoId]);

  const unlimitedRedemptionIds = [];
  let lastUnlimitedRedemption;
  for (let claim = 0; claim < 4; claim += 1) {
    const unlimited = (await client.query(
      "select public.redeem_promo_code($1) as value",
      [unlimitedCode],
    )).rows[0].value;
    unlimitedRedemptionIds.push(unlimited.redemptionId);
    lastUnlimitedRedemption = unlimited;
  }
  check(
    new Set(unlimitedRedemptionIds).size === 4
      && Number(lastUnlimitedRedemption.playerUses) === 4
      && lastUnlimitedRedemption.playerUsesRemaining === null
      && lastUnlimitedRedemption.globalUsesRemaining === null,
    "Infinite Uses per Player must permit repeated claims with distinct redemption snapshots.",
  );
  const unlimitedState = (await client.query(`
    select
      redemption_count::int,
      infinite_use,
      infinite_uses_per_player,
      uses_per_player,
      (select count(*)::int from public.promo_code_redemptions
        where user_id=$2 and promo_code_id=$1) as user_redemptions
    from public.promo_codes
    where id=$1
  `, [unlimitedPromoId, secondUserId])).rows[0];
  check(
    unlimitedState.redemption_count === 4
      && unlimitedState.infinite_use
      && unlimitedState.infinite_uses_per_player
      && unlimitedState.uses_per_player === null
      && unlimitedState.user_redemptions === 4,
    "Unlimited global and per-player settings must allow every successful repeat claim.",
  );

  await expectError(
    client,
    "invalid_code",
    "select public.redeem_promo_code($1)",
    ["NOT_A_REAL_PROMO"],
    "PROMO_CODE_INVALID_OR_INACTIVE",
  );

  const policies = await client.query(`
    select
      exists(
        select 1 from pg_policies
        where schemaname='public' and tablename='promo_codes'
          and policyname='promo_codes_admin_read'
      ) as definitions_admin_only,
      exists(
        select 1 from pg_policies
        where schemaname='public' and tablename='promo_code_redemptions'
          and policyname='promo_code_redemptions_read_own'
      ) as history_owner_only
  `);
  check(
    policies.rows[0].definitions_admin_only && policies.rows[0].history_owner_only,
    "Promo definitions must remain admin-only while redemption rows remain owner-only.",
  );

  console.log(`Promo Code finite and infinite per-account contract passed for ${code}; all changes will be rolled back.`);
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
