import assert from "node:assert/strict";
import fs from "node:fs";

import {
  commandOptions,
  formatSuccess,
  runCollectibleCommand,
  validateCommand,
} from "./manage-user-collectible.mjs";

const baseEnv = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
};

{
  const options = commandOptions(
    ["grant", "relic", "--user=PLAYER@EXAMPLE.COM", "--id=001"],
    baseEnv,
  );
  assert.deepEqual(options, {
    action: "grant",
    collectibleType: "relic",
    email: "player@example.com",
    collectibleId: "001",
    count: 1,
    countWasProvided: false,
    help: false,
  });
  validateCommand(options);
}

{
  const options = commandOptions(["revoke", "relic"], {
    ...baseEnv,
    npm_config_user: "player@example.com",
    npm_config_id: "001",
    npm_config_count: "2",
  });
  assert.equal(options.count, 2);
  assert.equal(options.email, "player@example.com");
  assert.equal(options.collectibleId, "001");
  validateCommand(options);
}

{
  const options = commandOptions(
    ["grant", "critter", "--user=player@example.com", "--id=001", "--count=2"],
    baseEnv,
  );
  assert.throws(() => validateCommand(options), /only supported for relic commands/);
}

{
  let request;
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runCollectibleCommand({
    argv: ["grant", "relic", "--user=player@example.com", "--id=001", "--count=2"],
    env: baseEnv,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse(200, {
        action: "grant",
        collectible_type: "relic",
        collectible_id: "001",
        collectible_name: "Copper Shield",
        user_email: "player@example.com",
        changed_count: 2,
        previous_count: 1,
        new_count: 3,
        max_count: 5,
      });
    },
    stdout,
    stderr,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value, "");
  assert.match(stdout.value, /Granted 2 relic copies to player@example\.com/);
  assert.match(stdout.value, /Quantity 1 → 3 \(max 5\)/);
  assert.equal(request.url, "https://example.supabase.co/rest/v1/rpc/dev_manage_user_collectible");
  assert.deepEqual(JSON.parse(request.options.body), {
    p_action: "grant",
    p_collectible_type: "relic",
    p_user_email: "player@example.com",
    p_collectible_id: "001",
    p_count: 2,
  });
}

{
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runCollectibleCommand({
    argv: ["revoke", "relic"],
    env: {
      ...baseEnv,
      npm_config_user: "player@example.com",
      npm_config_id: "001",
    },
    fetchImpl: async () => jsonResponse(200, {
      action: "revoke",
      collectible_type: "relic",
      collectible_id: "001",
      collectible_name: "Copper Shield",
      user_email: "player@example.com",
      changed_count: 1,
      previous_count: 1,
      new_count: 0,
      max_count: 5,
    }),
    stdout,
    stderr,
  });

  assert.equal(exitCode, 0);
  assert.equal(stderr.value, "");
  assert.match(stdout.value, /Revoked 1 relic copy from player@example\.com/);
  assert.match(stdout.value, /Relic is now locked/);
}

{
  assert.equal(
    formatSuccess({
      action: "grant",
      collectible_type: "rollcaster",
      collectible_id: "002",
      collectible_name: "Astra",
      user_email: "player@example.com",
    }),
    "Granted Rollcaster 002 “Astra” for player@example.com. Rollcaster is now unlocked.",
  );
}

{
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runCollectibleCommand({
    argv: ["grant", "critter", "--user=player@example.com", "--id=001"],
    env: baseEnv,
    fetchImpl: async () => jsonResponse(400, {
      message: "User player@example.com already has Critter 001 (Toxichick) unlocked",
    }),
    stdout,
    stderr,
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.value, "");
  assert.match(stderr.value, /^Grant failed: Supabase rejected the request \(400\): User .* already has Critter 001/);
}

{
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const action of ["grant", "revoke"]) {
    for (const type of ["relic", "critter", "rollcaster"]) {
      assert.equal(
        packageJson.scripts[`game:${action}:${type}`],
        `node scripts/manage-user-collectible.mjs ${action} ${type}`,
      );
    }
  }
}

process.stdout.write("Collectible command tests passed (8 checks).\n");

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
