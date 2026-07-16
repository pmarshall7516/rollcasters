import { createDbClient, parseArgs, readEnv } from "./db-utils.mjs";

const args = parseArgs();
const env = readEnv();
const email = String(args.email ?? "").trim().toLowerCase();

if (args.help) {
  process.stdout.write(`Usage:
  npm run db:delete-user -- --email test@example.com --yes

Required safety checks:
  DEV_ENABLE_USER_DELETE=true must be set in .env or the environment.
  --yes must be passed.
  SUPABASE_SERVICE_ROLE_KEY must be set unless --direct-db is passed.

This deletes the matching row from auth.users. Public game data rows cascade through
foreign keys that reference auth.users(id). Catalog authorship is cleared while
append-only audit entries retain the historical actor UUID.

Preferred auth deletion uses SUPABASE_SERVICE_ROLE_KEY. Direct Postgres deletion is
available with --direct-db for environments with a verified DB CA certificate.
`);
  process.exit(0);
}

if (env.DEV_ENABLE_USER_DELETE !== "true") {
  throw new Error("Refusing to delete users unless DEV_ENABLE_USER_DELETE=true is set.");
}

if (!args.yes) {
  throw new Error("Refusing to delete users without --yes.");
}

if (!email || !email.includes("@")) {
  throw new Error("Pass a valid email with --email user@example.com.");
}

if (args["direct-db"]) {
  await deleteViaDirectDb();
} else if (env.SUPABASE_SERVICE_ROLE_KEY) {
  await deleteViaAuthAdmin();
} else {
  throw new Error(
    "Set SUPABASE_SERVICE_ROLE_KEY to delete via Supabase Auth Admin, or pass --direct-db with SUPABASE_DB_CA_CERT_PATH for verified direct database deletion.",
  );
}

async function deleteViaAuthAdmin() {
  if (!env.VITE_SUPABASE_URL) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY deletion also requires VITE_SUPABASE_URL.");
  }

  let page = 1;
  const perPage = 1000;
  let match = null;

  while (true) {
    const data = await authAdminRequest(`/admin/users?page=${page}&per_page=${perPage}`);

    const matches = data.users.filter((user) => user.email?.toLowerCase() === email);
    if (matches.length > 1 || (match && matches.length > 0)) {
      throw new Error(`Refusing to delete multiple auth users for ${email}.`);
    }
    if (matches.length === 1) match = matches[0];

    if (data.users.length < perPage) break;
    page += 1;
  }

  if (!match) {
    process.stdout.write(`No auth user found for ${email}.\n`);
    return;
  }

  await authAdminRequest(`/admin/users/${match.id}`, { method: "DELETE" });

  process.stdout.write(`Deleted auth user ${match.email} (${match.id}) via Supabase Auth Admin.\n`);
}

async function authAdminRequest(path, options = {}) {
  const url = new URL(`/auth/v1${path}`, env.VITE_SUPABASE_URL);
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message ?? data?.error_description ?? data?.error ?? response.statusText;
    if (options.method === "DELETE" && response.status === 500 && /foreign key constraint/i.test(message)) {
      throw new Error(
        [
          `Supabase refused to delete the Auth user because a public table still has a restrictive foreign key: ${message}`,
          "Apply supabase/migrations/015_auth_user_delete_audit_fks.sql, then rerun this command.",
        ].join("\n"),
      );
    }
    throw new Error(`Supabase Auth Admin request failed (${response.status}): ${message}`);
  }

  return data;
}

async function deleteViaDirectDb() {
  const client = createDbClient(env);

  try {
    await client.connect();
    await client.query("begin");

    const lookup = await client.query(
      "select id, email, created_at from auth.users where lower(email) = lower($1)",
      [email],
    );

    if (lookup.rowCount === 0) {
      await client.query("rollback");
      process.stdout.write(`No auth user found for ${email}.\n`);
      return;
    }

    if (lookup.rowCount > 1) {
      await client.query("rollback");
      throw new Error(`Refusing to delete ${lookup.rowCount} users for ${email}.`);
    }

    const deleted = await client.query(
      "delete from auth.users where id = $1 returning id, email",
      [lookup.rows[0].id],
    );

    await client.query("commit");
    process.stdout.write(`Deleted auth user ${deleted.rows[0].email} (${deleted.rows[0].id}) via direct DB.\n`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    if (error?.code === "SELF_SIGNED_CERT_IN_CHAIN") {
      throw new Error(
        "Direct database deletion failed TLS verification. Add SUPABASE_SERVICE_ROLE_KEY to .env to use Supabase Auth Admin, or provide SUPABASE_DB_CA_CERT_PATH for a verified direct DB connection.",
      );
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
