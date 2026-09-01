import { createDbClient } from "./db-utils.mjs";

const migrations = [
  "20260831130000_multi_target_level_up_challenges",
  "20260831131500_level_up_unique_target_validation",
];
const db = createDbClient();

function check(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await db.connect();
  const history = await db.query(
    "select version from supabase_migrations.schema_migrations where version = any($1::text[])",
    [migrations],
  );
  check(history.rowCount === migrations.length, "Every level-up Challenge migration must be recorded.");

  const templates = await db.query(
    `select id,runtime_version,challenge_category,progress_mode,parameter_schema
     from public.unlock_challenge_templates
     where id in ('level_up_critter','level_up_rollcaster')
     order by id`,
  );
  check(templates.rowCount === 2, "Both level-up Challenge templates must exist in the authoring schema.");
  const critterTemplate = templates.rows.find((row) => row.id === "level_up_critter");
  const rollcasterTemplate = templates.rows.find((row) => row.id === "level_up_rollcaster");
  check(critterTemplate.runtime_version === 2, "Level Up Critter must use runtime version 2.");
  check(rollcasterTemplate.runtime_version === 1, "Level Up Rollcaster must use runtime version 1.");
  check(critterTemplate.parameter_schema.required.includes("critter_ids"), "Level Up Critter must require critter_ids.");
  check(rollcasterTemplate.parameter_schema.required.includes("rollcaster_ids"), "Level Up Rollcaster must require rollcaster_ids.");

  const invalid = await db.query(
    `select count(*)::int as count
     from public.collectible_unlock_challenges
     where challenge_type='level_up_critter'
       and (parameters->>'level_target_mode' is null or jsonb_typeof(parameters->'critter_ids')<>'array')`,
  );
  check(invalid.rows[0].count === 0, "Existing Critter level-up rows must be normalized.");

  const functions = await db.query(
    `select
       pg_get_functiondef('public.collectible_challenge_current(uuid,uuid)'::regprocedure) as current_definition,
       pg_get_functiondef('public.collectible_challenge_goal(uuid)'::regprocedure) as goal_definition,
       pg_get_functiondef('public.collectible_level_up_challenge_current(uuid,public.collectible_unlock_challenges)'::regprocedure) as helper_definition,
       pg_get_functiondef('public.validate_collectible_unlock_challenge()'::regprocedure) as validator_definition`,
  );
  check(functions.rows[0].current_definition.includes("level_up_rollcaster"), "Current projection must support Rollcaster level challenges.");
  check(functions.rows[0].goal_definition.includes("level_up_rollcaster"), "Goal projection must support Rollcaster level challenges.");
  check(functions.rows[0].helper_definition.includes("level_target_mode"), "Level-up current helper must support target modes.");
  check(functions.rows[0].validator_definition.includes("Level Up selected targets must be unique"), "Level-up validator must reject duplicate targets.");
  console.log(`Level-up Challenge database contract passed (${templates.rowCount} templates).`);
} finally {
  await db.end().catch(() => undefined);
}
