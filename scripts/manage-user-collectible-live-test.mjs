import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { readEnv, root } from "./db-utils.mjs";

if (process.env.RUN_LIVE_COLLECTIBLE_COMMAND_TEST !== "true") {
  throw new Error("Set RUN_LIVE_COLLECTIBLE_COMMAND_TEST=true to create and clean up a temporary Auth test user.");
}

const env = readEnv();
const email = `collectible-command-${Date.now()}@example.com`;
const password = `Rollcasters-Test-${Date.now()}!`;
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId;

try {
  const [relicResult, critterResult, rollcasterResult] = await Promise.all([
    admin.from("relics").select("id,name,max_owned").gte("max_owned", 2).order("sort_order").limit(1).single(),
    admin.from("critters").select("id,name").order("sort_order").limit(1).single(),
    admin.from("rollcasters").select("id,name").order("sort_order").limit(1).single(),
  ]);
  if (relicResult.error) throw relicResult.error;
  if (critterResult.error) throw critterResult.error;
  if (rollcasterResult.error) throw rollcasterResult.error;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "Collectible Command Test" },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  const relic = relicResult.data;
  const critter = critterResult.data;
  const rollcaster = rollcasterResult.data;

  assert.match(run("game:grant:relic", relic.id), /Quantity 0 → 1/);
  assert.match(run("game:grant:relic", relic.id, "--count=1"), /Quantity 1 → 2/);
  assert.match(run("game:grant:critter", critter.id), /Critter is now unlocked/);
  assert.match(run("game:grant:rollcaster", rollcaster.id), /Rollcaster is now unlocked/);

  assert.match(run("game:grant:critter", critter.id, null, 1), /already has Critter/);
  assert.match(run("game:grant:rollcaster", rollcaster.id, null, 1), /already has Rollcaster/);
  assert.match(run("game:grant:relic", relic.id, `--count=${relic.max_owned}`, 1), /maximum is/);

  const [inventory, ownedCritter, ownedRollcaster] = await Promise.all([
    admin.from("user_relic_inventory").select("quantity").eq("user_id", userId).eq("relic_id", relic.id).single(),
    admin.from("user_critters").select("id").eq("user_id", userId).eq("critter_id", critter.id).single(),
    admin.from("user_rollcasters").select("id").eq("user_id", userId).eq("rollcaster_id", rollcaster.id).single(),
  ]);
  if (inventory.error) throw inventory.error;
  if (ownedCritter.error) throw ownedCritter.error;
  if (ownedRollcaster.error) throw ownedRollcaster.error;
  assert.equal(inventory.data.quantity, 2);

  const [skillSlots, abilitySlots] = await Promise.all([
    admin.from("user_critter_skill_slots").select("slot_index,skill_id").eq("user_critter_id", ownedCritter.data.id),
    admin.from("user_rollcaster_ability_slots").select("slot_index,ability_id").eq("user_rollcaster_id", ownedRollcaster.data.id),
  ]);
  if (skillSlots.error) throw skillSlots.error;
  if (abilitySlots.error) throw abilitySlots.error;
  assert.equal(skillSlots.data.length, 4);
  assert.ok(skillSlots.data.some((slot) => slot.slot_index === 1 && slot.skill_id));
  assert.ok(abilitySlots.data.some((slot) => slot.slot_index === 1 && slot.ability_id));

  const equipped = await admin.from("user_critter_relic_slots").insert({
    user_critter_id: ownedCritter.data.id,
    slot_index: 1,
    relic_id: relic.id,
  });
  if (equipped.error) throw equipped.error;
  assert.match(run("game:revoke:relic", relic.id, "--count=2", 1), /copies are equipped/);
  const unequipped = await admin
    .from("user_critter_relic_slots")
    .delete()
    .eq("user_critter_id", ownedCritter.data.id)
    .eq("slot_index", 1);
  if (unequipped.error) throw unequipped.error;

  assert.match(run("game:revoke:relic", relic.id), /Quantity 2 → 1/);
  assert.match(run("game:revoke:relic", relic.id), /Relic is now locked/);
  assert.match(run("game:revoke:critter", critter.id), /Critter is now locked/);
  assert.match(run("game:revoke:rollcaster", rollcaster.id), /Rollcaster is now locked/);
  assert.match(run("game:revoke:rollcaster", rollcaster.id, null, 1), /does not have Rollcaster/);

  const [finalRelic, finalCritter, finalRollcaster] = await Promise.all([
    admin.from("user_relic_inventory").select("relic_id").eq("user_id", userId).eq("relic_id", relic.id),
    admin.from("user_critters").select("id").eq("user_id", userId).eq("critter_id", critter.id),
    admin.from("user_rollcasters").select("id").eq("user_id", userId).eq("rollcaster_id", rollcaster.id),
  ]);
  if (finalRelic.error) throw finalRelic.error;
  if (finalCritter.error) throw finalCritter.error;
  if (finalRollcaster.error) throw finalRollcaster.error;
  assert.equal(finalRelic.data.length, 0);
  assert.equal(finalCritter.data.length, 0);
  assert.equal(finalRollcaster.data.length, 0);

  process.stdout.write("Live collectible command round trip passed.\n");
} finally {
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) throw removed.error;
  }
}

function run(script, id, countArgument = null, expectedStatus = 0) {
  const args = ["run", script, "--", `--user=${email}`, `--id=${id}`];
  if (countArgument) args.push(countArgument);
  const result = spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, expectedStatus, `Unexpected exit code for npm ${args.join(" ")}:\n${output}`);
  return output;
}
