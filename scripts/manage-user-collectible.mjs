import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, readEnv } from "./db-utils.mjs";

const ACTIONS = new Set(["grant", "revoke"]);
const COLLECTIBLE_TYPES = new Set(["relic", "critter", "rollcaster"]);
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export function commandOptions(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const [action = "", collectibleType = ""] = args._;
  const configValue = (key) => args[key] ?? env[`npm_config_${key.replaceAll("-", "_")}`];
  const rawCount = configValue("count");

  return {
    action: String(action).trim().toLowerCase(),
    collectibleType: String(collectibleType).trim().toLowerCase(),
    email: String(configValue("user") ?? "").trim().toLowerCase(),
    collectibleId: String(configValue("id") ?? "").trim(),
    count: rawCount === undefined ? 1 : parsePositiveInteger(rawCount, "--count"),
    countWasProvided: rawCount !== undefined,
    help: Boolean(args.help ?? env.npm_config_help),
  };
}

export function validateCommand(options) {
  if (!ACTIONS.has(options.action)) {
    throw new Error("Action must be grant or revoke.");
  }
  if (!COLLECTIBLE_TYPES.has(options.collectibleType)) {
    throw new Error("Collectible type must be relic, critter, or rollcaster.");
  }
  if (!/^\S+@\S+\.\S+$/.test(options.email)) {
    throw new Error("Pass a valid email with --user=user@example.com.");
  }
  if (!options.collectibleId) {
    throw new Error("Pass a catalog ID with --id=<collectible_id>.");
  }
  if (options.collectibleType !== "relic" && options.countWasProvided) {
    throw new Error("--count is only supported for relic commands.");
  }
}

export async function runCollectibleCommand({
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

    const result = await callCollectibleRpc(options, env, fetchImpl);
    stdout.write(`${formatSuccess(result)}\n`);
    return 0;
  } catch (error) {
    const action = options?.action && ACTIONS.has(options.action)
      ? `${options.action[0].toUpperCase()}${options.action.slice(1)}`
      : "Command";
    stderr.write(`${action} failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function callCollectibleRpc(options, env, fetchImpl = fetch) {
  const url = new URL("/rest/v1/rpc/dev_manage_user_collectible", env.VITE_SUPABASE_URL);
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
      p_count: options.count,
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
    if (response.status === 404 && /dev_manage_user_collectible|schema cache/i.test(message)) {
      throw new Error(
        "The collectible admin database function is unavailable. Apply supabase/migrations/005_dev_collectible_commands.sql, then retry.",
      );
    }
    throw new Error(`Supabase rejected the request (${response.status}): ${message}`);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Supabase returned an empty collectible update result.");
  }

  return data;
}

export function formatSuccess(result) {
  const action = result.action === "revoke" ? "Revoked" : "Granted";
  const email = result.user_email;
  const idAndName = `${result.collectible_id} “${result.collectible_name}”`;

  if (result.collectible_type === "relic") {
    const copies = result.changed_count === 1 ? "copy" : "copies";
    const direction = result.action === "revoke" ? "from" : "to";
    const lockMessage = result.new_count === 0 ? " Relic is now locked." : "";
    return `${action} ${result.changed_count} relic ${copies} ${direction} ${email}: ${idAndName}. Quantity ${result.previous_count} → ${result.new_count} (max ${result.max_count}).${lockMessage}`;
  }

  const label = capitalize(result.collectible_type);
  const state = result.action === "revoke" ? "locked" : "unlocked";
  const direction = result.action === "revoke" ? "for" : "for";
  return `${action} ${label} ${idAndName} ${direction} ${email}. ${label} is now ${state}.`;
}

function validateEnvironment(env) {
  if (!env.VITE_SUPABASE_URL) {
    throw new Error("Set VITE_SUPABASE_URL in .env.");
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in .env. Collectible commands require server-side admin access.");
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
  npm run game:grant:relic --user=user@example.com --id=001 [--count=1]
  npm run game:revoke:relic --user=user@example.com --id=001 [--count=1]
  npm run game:grant:critter --user=user@example.com --id=001
  npm run game:revoke:critter --user=user@example.com --id=001
  npm run game:grant:rollcaster --user=user@example.com --id=001
  npm run game:revoke:rollcaster --user=user@example.com --id=001

The relic count defaults to 1. Critters and Rollcasters are granted or revoked as
whole collectibles and do not accept --count. These commands require
VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
`;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  process.exitCode = await runCollectibleCommand();
}
