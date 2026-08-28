import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));

function selectOfflineTests(scripts) {
  return Object.keys(scripts)
    .filter((name) => name.startsWith("test:"))
    .filter((name) => name !== "test:offline")
    .filter((name) => !/(db|browser|live|published-catalog)/.test(name));
}

function runSelfTest() {
  const selected = selectOfflineTests({
    "test:effect-runtime": "node scripts/effect-runtime-tests.mjs",
    "test:dungeons:db": "node scripts/dungeons-db-tests.mjs",
    "test:effect-browser": "node scripts/effect-browser-tests.mjs",
    "test:collectible-commands:live": "node scripts/collectible-live-tests.mjs",
    "test:offline": "node scripts/offline-tests.mjs --self-test",
  });

  assert.deepEqual(selected, ["test:effect-runtime"]);
  console.log("PASS offline runner self-check");
}

function lastLines(output, lineCount = 12) {
  return output.trim().split("\n").slice(-lineCount).join("\n");
}

function runOfflineTests() {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const testNames = selectOfflineTests(packageJson.scripts ?? {});
  const failures = [];

  console.log(`Running ${testNames.length} offline test scripts sequentially.`);

  for (const name of testNames) {
    const result = spawnSync("npm", ["run", name], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    });

    if (result.status === 0) {
      console.log(`PASS ${name}`);
      continue;
    }

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    failures.push({ name, status: result.status, signal: result.signal });
    console.log(`FAIL ${name}`);
    if (output) {
      console.log(lastLines(output));
    }
  }

  console.log(`Offline test summary: ${testNames.length - failures.length} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log(`Failed scripts: ${failures.map(({ name }) => name).join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  runOfflineTests();
}
