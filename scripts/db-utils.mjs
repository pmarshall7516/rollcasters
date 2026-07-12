import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export const root = process.cwd();

export function parseEnv(filePath = path.join(root, ".env")) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index < 0) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

export function readEnv() {
  return { ...parseEnv(), ...process.env };
}

export function connectionStringFromEnv(env) {
  if (env.SUPABASE_DB_URL) return env.SUPABASE_DB_URL;

  const password = env.postgres_password ?? env.POSTGRES_PASSWORD;
  const supabaseUrl = env.VITE_SUPABASE_URL;
  if (!password || !supabaseUrl) {
    throw new Error("Set SUPABASE_DB_URL, or set both postgres_password and VITE_SUPABASE_URL.");
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
}

export function createDbClient(env = readEnv()) {
  const caCertPath = env.SUPABASE_DB_CA_CERT_PATH;
  return new pg.Client({
    connectionString: connectionStringFromEnv(env),
    ssl: caCertPath ? { ca: fs.readFileSync(path.resolve(root, caCertPath), "utf8") } : true,
  });
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) continue;

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function migrationFiles() {
  const dir = path.join(root, "supabase", "migrations");
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join("supabase", "migrations", file));
}

export function resolveMigrationSelection(filesArg) {
  const allFiles = migrationFiles();
  if (!filesArg) return allFiles;

  const requested = String(filesArg)
    .split(",")
    .map((file) => file.trim())
    .filter(Boolean);

  const selected = requested.map((requestedFile) => {
    const exact = allFiles.find((file) => file === requestedFile);
    if (exact) return exact;

    const byBasename = allFiles.find((file) => path.basename(file) === requestedFile);
    if (byBasename) return byBasename;

    throw new Error(`Migration not found: ${requestedFile}`);
  });

  return selected;
}
