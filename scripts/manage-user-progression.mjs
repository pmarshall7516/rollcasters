import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, readEnv } from "./db-utils.mjs";

const ACTIONS = new Set(["grant-xp", "set-level"]);
const COLLECTIBLE_TYPES = new Set(["critter", "rollcaster"]);
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export function commandOptions(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const [action = ""] = args._;
  const configValue = (key) => args[key] ?? env[`npm_config_${key.replaceAll("-", "_")}`];
  const rawXp = configValue("xp") ?? configValue("amount");
  const rawLevel = configValue("level");

  return {
    action: String(action).trim().toLowerCase(),
    collectibleType: String(configValue("type") ?? "").trim().toLowerCase(),
    email: String(configValue("user") ?? "").trim().toLowerCase(),
    collectibleId: String(configValue("id") ?? "").trim(),
    xp: rawXp === undefined ? null : parsePositiveInteger(rawXp, "--xp"),
    level: rawLevel === undefined ? null : parsePositiveInteger(rawLevel, "--level"),
    help: Boolean(args.help ?? env.npm_config_help),
  };
}

export function validateCommand(options) {
  if (!ACTIONS.has(options.action)) {
    throw new Error("Action must be grant-xp or set-level.");
  }
  if (!COLLECTIBLE_TYPES.has(options.collectibleType)) {
    throw new Error("Type must be critter or rollcaster.");
  }
  if (!/^\S+@\S+\.\S+$/.test(options.email)) {
    throw new Error("Pass a valid email with --user=user@example.com.");
  }
  if (!options.collectibleId) {
    throw new Error("Pass a catalog ID with --id=<collectible_id>.");
  }
  if (options.action === "grant-xp") {
    if (options.xp === null) throw new Error("Pass XP with --xp=<positive_integer>.");
    if (options.level !== null) throw new Error("--level is only supported by set-level.");
  } else {
    if (options.level === null) throw new Error("Pass a progression level with --level=<integer>.");
    if (options.xp !== null) throw new Error("--xp is only supported by grant-xp.");
  }
}

export async function runProgressionCommand({
  argv = process.argv.slice(2),
  env = readEnv(),
  fetchImpl = fetch,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let options;
  try {
    options = commandOptions(argv, env);
    if (options.help) {
      stdout.write(usage());
      return 0;
    }
    validateCommand(options);
    validateEnvironment(env);

    const result = await callProgressionRpc(options, env, fetchImpl);
    stdout.write(`${formatSuccess(result)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Progression command failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function callProgressionRpc(options, env, fetchImpl = fetch) {
  const url = new URL("/rest/v1/rpc/dev_manage_user_progression", env.VITE_SUPABASE_URL);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_action: options.action,
      p_collectible_type: options.collectibleType,
      p_user_email: options.email,
      p_collectible_id: options.collectibleId,
      p_xp: options.xp,
      p_level: options.level,
    }),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.message ?? data?.error_description ?? data?.error ?? text ?? response.statusText;
    if (response.status === 404 && /dev_manage_user_progression|schema cache/i.test(message)) {
      throw new Error(
        "The progression admin database function is unavailable. Apply the corresponding migration from rollcaster-docs/migrations, then retry.",
      );
    }
    throw new Error(`Supabase rejected the request (${response.status}): ${message}`);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Supabase returned an empty progression update result.");
  }

  return data;
}

export function formatSuccess(result) {
  const label = capitalize(result.collectible_type);
  const action = result.action === "set_level" ? `Set ${label}` : `Granted XP to ${label}`;
  const change = result.action === "set_level"
    ? `level ${result.previous_level} → ${result.new_level}; XP ${result.previous_xp} → ${result.new_xp}`
    : `${result.previous_xp} → ${result.new_xp} XP; level ${result.previous_level} → ${result.new_level}`;
  return `${action} ${result.collectible_id} “${result.collectible_name}” for ${result.user_email}: ${change}.`;
}

function validateEnvironment(env) {
  if (!env.VITE_SUPABASE_URL) {
    throw new Error("Set VITE_SUPABASE_URL in .env.");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in .env. Progression commands require server-side admin access.");
  }
}

function parsePositiveInteger(value, label) {
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_POSTGRES_INTEGER) {
    throw new Error(`${label} must be no greater than ${MAX_POSTGRES_INTEGER}.`);
  }
  return parsed;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

export function usage() {
  return `Usage:
  npm run game:grant:xp --user=user@example.com --type=rollcaster --id=001 --xp=500
  npm run game:grant:xp --user=user@example.com --type=critter --id=001 --amount=500
  npm run game:set:level --user=user@example.com --type=critter --id=001 --level=10

The ID is the catalog ID of a Critter or Rollcaster the user already owns.
grant-xp adds XP and recalculates the level. set-level requires an authored
progression level and sets XP to that level's threshold; lowering a level does
not remove previously awarded Skill or Ability points. These commands require
VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
`;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  process.exitCode = await runProgressionCommand();
}
