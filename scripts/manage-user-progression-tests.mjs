import assert from "node:assert/strict";
import fs from "node:fs";

import {
  commandOptions,
  formatSuccess,
  runProgressionCommand,
  validateCommand,
} from "./manage-user-progression.mjs";

const baseEnv = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

{
  const options = commandOptions(
    ["grant-xp", "--user=PLAYER@EXAMPLE.COM", "--type=critter", "--id=001", "--xp=250"],
    baseEnv,
  );
  assert.deepEqual(options, {
    action: "grant-xp",
    collectibleType: "critter",
    email: "player@example.com",
    collectibleId: "001",
    xp: 250,
    level: null,
    help: false,
  });
  validateCommand(options);
}

{
  const options = commandOptions(
    ["grant-xp", "--user=player@example.com", "--type=rollcaster", "--id=002", "--amount=500"],
    baseEnv,
  );
  assert.equal(options.xp, 500);
  validateCommand(options);
}

{
  const options = commandOptions(
    ["set-level", "--user=player@example.com", "--type=rollcaster", "--id=002", "--level=10"],
    baseEnv,
  );
  assert.equal(options.level, 10);
  validateCommand(options);
}

assert.throws(
  () => validateCommand(commandOptions([
    "grant-xp",
    "--user=player@example.com",
    "--type=critter",
    "--id=001",
    "--xp=250",
    "--level=4",
  ], baseEnv)),
  /--level is only supported by set-level/,
);

{
  let request;
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runProgressionCommand({
    argv: ["grant-xp", "--user=player@example.com", "--type=rollcaster", "--id=002", "--xp=500"],
    env: baseEnv,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse(200, {
        action: "grant_xp",
        collectible_type: "rollcaster",
        collectible_id: "002",
        collectible_name: "Astra",
        user_email: "player@example.com",
        previous_xp: 100,
        new_xp: 600,
        previous_level: 2,
        new_level: 4,
      });
    },
    stdout,
    stderr,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value, "");
  assert.match(stdout.value, /Granted XP to Rollcaster 002 “Astra”/);
  assert.match(stdout.value, /100 → 600 XP; level 2 → 4/);
  assert.equal(request.url, "https://example.supabase.co/rest/v1/rpc/dev_manage_user_progression");
  assert.deepEqual(JSON.parse(request.options.body), {
    p_action: "grant-xp",
    p_collectible_type: "rollcaster",
    p_user_email: "player@example.com",
    p_collectible_id: "002",
    p_xp: 500,
    p_level: null,
  });
}

{
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runProgressionCommand({
    argv: ["set-level", "--user=player@example.com", "--type=critter", "--id=001", "--level=3"],
    env: baseEnv,
    fetchImpl: async () => jsonResponse(200, {
      action: "set_level",
      collectible_type: "critter",
      collectible_id: "001",
      collectible_name: "Toxichick",
      user_email: "player@example.com",
      previous_xp: 900,
      new_xp: 180,
      previous_level: 5,
      new_level: 3,
    }),
    stdout,
    stderr,
  });

  assert.equal(exitCode, 0);
  assert.match(stdout.value, /Set Critter 001 “Toxichick”/);
  assert.match(stdout.value, /level 5 → 3; XP 900 → 180/);
  assert.equal(stderr.value, "");
}

{
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["game:grant:xp"], "node scripts/manage-user-progression.mjs grant-xp");
  assert.equal(packageJson.scripts["game:set:level"], "node scripts/manage-user-progression.mjs set-level");
}

assert.equal(
  formatSuccess({
    action: "set_level",
    collectible_type: "critter",
    collectible_id: "001",
    collectible_name: "Toxichick",
    user_email: "player@example.com",
    previous_xp: 0,
    new_xp: 180,
    previous_level: 1,
    new_level: 3,
  }),
  "Set Critter 001 “Toxichick” for player@example.com: level 1 → 3; XP 0 → 180.",
);

process.stdout.write("Progression command tests passed (8 checks).\n");

function captureStream() {
  return {
    value: "",
    write(chunk) {
      this.value += String(chunk);
    },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Bad Request",
    async text() {
      return JSON.stringify(body);
    },
  };
}
