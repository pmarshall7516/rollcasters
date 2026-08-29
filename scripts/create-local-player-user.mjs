import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "./db-utils.mjs";

const args = parseArgs();
const email = String(args.email ?? "").trim().toLowerCase();
const password = String(args.password ?? "");
const username = String(args.username ?? email.split("@")[0] ?? "player").trim() || "player";
assert.match(email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Pass --email with a valid local test email.");
assert.ok(password.length >= 6, "Pass --password with at least 6 characters.");

const status = spawnSync("supabase", ["status", "--workdir", process.cwd(), "-o", "env"], { encoding: "utf8" });
if (status.error) throw status.error;
if (status.status !== 0) throw new Error("Start the local player stack before creating a local game user.");
const values = {};
for (const line of status.stdout.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) values[match[1]] = match[2].replace(/^"|"$/g, "");
}
assert.ok(values.API_URL && values.SERVICE_ROLE_KEY, "Local Supabase status did not return the required Auth values.");

const admin = createClient(values.API_URL, values.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (users.error) throw users.error;
const existing = users.data.users.find((user) => user.email?.toLowerCase() === email);
const result = existing
  ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { username } })
  : await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username } });
if (result.error) throw result.error;
console.log(JSON.stringify({ environment: "local", email, userId: result.data.user?.id ?? existing?.id, created: !existing }, null, 2));
