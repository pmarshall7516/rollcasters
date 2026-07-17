import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createDbClient, root } from "./db-utils.mjs";

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const client = createDbClient();
const migrationSql = fs.readFileSync(
  path.join(root, "supabase", "migrations", "009_two_critter_elements.sql"),
  "utf8",
);
let began = false;

async function expectFailure(sql, params, expectedMessage) {
  await client.query("savepoint expected_two_element_failure");
  let failure;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error;
  }
  await client.query("rollback to savepoint expected_two_element_failure");
  check(failure, `Expected failure containing: ${expectedMessage}`);
  check(
    String(failure.message).includes(expectedMessage),
    `Expected failure containing "${expectedMessage}", received "${failure.message}".`,
  );
}

try {
  await client.connect();
  await client.query("begin");
  began = true;

  const before = (await client.query(`
    select id,element_1_id,element_2_id
    from public.critters
    order by id
  `)).rows;
  check(before.length > 0, "The catalog needs at least one Critter.");

  await client.query(migrationSql);
  await client.query(migrationSql);

  const columns = (await client.query(`
    select column_name,is_nullable,is_generated,generation_expression
    from information_schema.columns
    where table_schema='public'
      and table_name='critters'
      and column_name in ('element_1_id','element_2_id','element_id')
    order by column_name
  `)).rows;
  const byName = new Map(columns.map((column) => [column.column_name, column]));
  check(byName.get("element_1_id")?.is_nullable === "NO", "Element 1 must be required.");
  check(byName.get("element_2_id")?.is_nullable === "YES", "Element 2 must be optional.");
  check(
    byName.get("element_id")?.is_generated === "ALWAYS"
      && String(byName.get("element_id")?.generation_expression).includes("element_1_id"),
    "The deprecated element_id alias must be generated from Element 1.",
  );

  const constraints = (await client.query(`
    select conname,contype,confupdtype,pg_get_constraintdef(oid) definition
    from pg_constraint
    where conrelid='public.critters'::regclass
      and conname in (
        'critters_element_1_id_fkey',
        'critters_element_2_id_fkey',
        'critters_element_slots_distinct_check'
      )
  `)).rows;
  check(constraints.length === 3, "Both Element foreign keys and the distinct-slot check must exist.");
  check(
    constraints.filter((constraint) => constraint.contype === "f").every((constraint) => constraint.confupdtype === "c"),
    "Both Element foreign keys must cascade Element ID updates.",
  );
  check(
    constraints.some((constraint) =>
      constraint.conname === "critters_element_slots_distinct_check"
        && constraint.definition.includes("element_2_id <> element_1_id")
    ),
    "The database must reject duplicate Element slots.",
  );

  const after = (await client.query(`
    select id,element_1_id,element_2_id,element_id
    from public.critters
    order by id
  `)).rows;
  check(
    JSON.stringify(after.map(({ id, element_1_id, element_2_id }) => ({ id, element_1_id, element_2_id })))
      === JSON.stringify(before),
    "An idempotent migration rerun must preserve every authored Critter Element slot.",
  );
  check(after.every((critter) => critter.element_id === critter.element_1_id), "Every compatibility alias must equal Element 1.");

  const fixture = (await client.query(`
    select critter.id,critter.element_1_id,element.id as element_2_id
    from public.critters critter
    join lateral (
      select id
      from public.elements
      where id<>critter.element_1_id
      order by sort_order,id
      limit 1
    ) element on true
    order by critter.sort_order,critter.id
    limit 1
  `)).rows[0];
  check(fixture?.element_2_id, "The catalog needs two different Elements for the dual-type fixture.");

  await client.query(
    "update public.critters set element_2_id=$2 where id=$1",
    [fixture.id, fixture.element_2_id],
  );
  const dual = (await client.query(`
    select element_1_id,element_2_id,element_id
    from public.critters where id=$1
  `, [fixture.id])).rows[0];
  check(
    dual.element_1_id === fixture.element_1_id
      && dual.element_2_id === fixture.element_2_id
      && dual.element_id === fixture.element_1_id,
    "A Critter must persist ordered primary/secondary Elements while its alias remains primary-only.",
  );

  await expectFailure(
    "update public.critters set element_2_id=element_1_id where id=$1",
    [fixture.id],
    "critters_element_slots_distinct_check",
  );
  await expectFailure(
    "update public.critters set element_2_id='missing-two-element-fixture' where id=$1",
    [fixture.id],
    "critters_element_2_id_fkey",
  );

  const adminId = (await client.query(`
    select dev_user.user_id
    from public.dev_tool_users dev_user
    join auth.users auth_user on auth_user.id=dev_user.user_id
    where dev_user.is_active
      and coalesce((auth_user.raw_app_meta_data->>'content_admin')::boolean,false)
      and coalesce((auth_user.raw_app_meta_data->>'dev_tool_only')::boolean,false)
      and auth_user.raw_app_meta_data->>'account_type'='dev_tool'
    limit 1
  `)).rows[0]?.user_id;
  check(adminId, "The aggregate validation test needs an active Content Studio admin.");
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [adminId]);

  await expectFailure(
    "select public.admin_save_critter($1::jsonb,0)",
    [JSON.stringify({ id: "duplicate-element-fixture", element1Id: fixture.element_1_id, element2Id: fixture.element_1_id })],
    "Element 1 and Element 2 must be different",
  );
  await expectFailure(
    "select public.admin_save_critter($1::jsonb,0)",
    [JSON.stringify({ id: "missing-primary-fixture", element2Id: fixture.element_2_id })],
    "Element 1 is required",
  );

  const usage = (await client.query(
    "select public.admin_content_usage('element',$1) value",
    [fixture.element_2_id],
  )).rows[0].value;
  check(
    usage.some((entry) => entry.entity_type === "critter" && entry.entity_id === fixture.id),
    "Element usage must include Critters assigned through Element 2.",
  );

  const cascadeElementIds = [1, 2, 3].map((index) => `two-element-cascade-${index}-${crypto.randomUUID()}`);
  await client.query(`
    insert into public.elements(id,name,description,sort_order,is_active,is_archived,version)
    values($1,'Cascade Fixture','Rollback-only two-Element cascade fixture.',100000,false,false,1)
  `, [cascadeElementIds[0]]);
  await client.query(
    "update public.critters set element_2_id=$2 where id=$1",
    [fixture.id, cascadeElementIds[0]],
  );
  await client.query(
    "update public.elements set id=$2 where id=$1",
    [cascadeElementIds[0], cascadeElementIds[1]],
  );
  let cascaded = (await client.query(
    "select element_2_id from public.critters where id=$1",
    [fixture.id],
  )).rows[0];
  check(cascaded.element_2_id === cascadeElementIds[1], "Renaming Element 2 must cascade to its Critter slot.");

  await client.query(
    "update public.critters set element_2_id=null,element_1_id=$2 where id=$1",
    [fixture.id, cascadeElementIds[1]],
  );
  await client.query(
    "update public.elements set id=$2 where id=$1",
    [cascadeElementIds[1], cascadeElementIds[2]],
  );
  cascaded = (await client.query(
    "select element_1_id,element_id from public.critters where id=$1",
    [fixture.id],
  )).rows[0];
  check(
    cascaded.element_1_id === cascadeElementIds[2] && cascaded.element_id === cascadeElementIds[2],
    "Renaming Element 1 must cascade to its canonical slot and generated alias.",
  );

  console.log("Two-Critter-Element schema, validation, compatibility, and usage tests passed; all changes will be rolled back.");
} finally {
  if (began) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}
