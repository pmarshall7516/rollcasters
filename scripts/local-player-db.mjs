import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const projectId = "rollcasters-local-player";
const command = process.argv[2] ?? "status";

const run = (args) => {
  const result = spawnSync("supabase", args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

switch (command) {
  case "start":
    run([
      "start",
      "--workdir",
      root,
      "--exclude",
      "imgproxy,studio,vector,realtime,edge-runtime,mailpit,postgres-meta",
    ]);
    break;
  case "stop":
    run(["stop", "--project-id", projectId]);
    break;
  case "reset":
    run(["db", "reset", "--local", "--workdir", root, "--no-seed"]);
    break;
  case "status":
    run(["status", "--workdir", root]);
    break;
  default:
    process.stderr.write("Usage: node scripts/local-player-db.mjs <start|stop|reset|status>\n");
    process.exit(2);
}
