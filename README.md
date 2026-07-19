# Rollcasters: Roll, Fight, and Collect!
Created by Patrick Marshall \
Development Began: July 2026

## Local App Setup

Rollcasters is a Vite + React app backed by Supabase Auth and Postgres.

Required `.env` values for the browser app:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

`VITE_SUPABASE_ANON_KEY` is also supported as a backward-compatible fallback, but the app prefers Supabase's current `VITE_SUPABASE_PUBLISHABLE_KEY` name.

Optional values for database/admin tooling:

```text
SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_ID.supabase.co:5432/postgres
SUPABASE_DB_CA_CERT_PATH=certs/prod-ca-2021.crt
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
postgres_password=YOUR_DATABASE_PASSWORD
```

Apply the single source-of-truth migration in the Supabase SQL editor or with your preferred migration tool:

1. `supabase/migrations/20260719000000_rollcasters_baseline.sql`

The baseline was generated from the live database's current `public` schema. It creates the complete game schema, functions, triggers, RLS policies, grants, the public-read `game-assets` Storage bucket, and the current reusable game catalog/configuration.

It intentionally does not copy Auth users, player-owned state, audit history, dungeon runs or commands, purchase receipts, redemption history, or operational promo-code definitions. Storage object files are also not embedded in SQL and must be uploaded separately.

Recommended `game-assets` object layout:

```text
critters/001-toxichick.png
critters/002-spreagle.png
critters/003-congua.png
rollcasters/001-shanks.png
relics/001-copper-shield.png
logos/elements/basic.png
logos/elements/vile.png
logos/elements/bloom.png
logos/elements/aqua.png
ui/mana.png
ui/coins.png
```

Skills and abilities do not have image assets.

The app renders `asset_path` values from the catalog through the `game-assets` bucket and falls back to generated placeholder badges if an image has not been uploaded yet.

If you provide a verified database connection string and CA certificate path, the local migration runner can apply all migration files:

```bash
npm run db:migrate
```

To preview which migrations will run:

```bash
npm run db:migrate:dry
```

To run only the baseline migration, pass its basename or path:

```bash
npm run db:migrate -- --files 20260719000000_rollcasters_baseline.sql
```

The baseline is for a fresh Supabase database and must not be executed over the existing Rollcasters schema. The linked production database already has this shape. Before using `supabase db push` against that database, reconcile its migration ledger by marking legacy versions `001` and `002` reverted and version `20260719000000` applied; migration repair changes history only and does not execute the baseline SQL.

If the local runner reports `SELF_SIGNED_CERT_IN_CHAIN`, use the Supabase SQL editor for the migration files or download the Supabase database CA certificate and set `SUPABASE_DB_CA_CERT_PATH` to that file path. Do not disable TLS verification for migrations.

## Development Database Utilities

Grant or revoke collectibles for an existing Auth user by email:

```bash
npm run game:grant:relic --user=player@example.com --id=001 --count=2
npm run game:revoke:relic --user=player@example.com --id=001 --count=1
npm run game:grant:critter --user=player@example.com --id=001
npm run game:revoke:critter --user=player@example.com --id=001
npm run game:grant:rollcaster --user=player@example.com --id=001
npm run game:revoke:rollcaster --user=player@example.com --id=001
```

Relic `--count` values default to `1`. Granting cannot exceed the catalog Relic's `max_owned`, and revoking cannot reduce inventory below the number of equipped copies. Reducing a Relic to zero removes its inventory row and locks it again. Critters and Rollcasters are whole collectibles, so their commands reject `--count`; a grant initializes their level-one default Skill or Ability unlocks and equipment slots. Revoking an active Rollcaster selects the user's oldest remaining Rollcaster as active, or clears the active selection if none remain.

The commands require `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the database function in `supabase/migrations/20260719000000_rollcasters_baseline.sql`. They return a concise success message and exit nonzero with a specific failure message for missing users or catalog IDs, duplicate ownership, missing ownership, invalid counts, maximum-count violations, and equipped-copy conflicts. The service-role key stays server-side and must never use a `VITE_` prefix.

The no-separator form above is supported as requested. Current npm versions may print an npm-owned `Unknown cli config` warning for those flags; add the standard argument separator (`npm run game:grant:relic -- --user=... --id=...`) to avoid that warning and remain compatible with the next npm major version.

Delete a development user by email:

```bash
DEV_ENABLE_USER_DELETE=true npm run db:delete-user -- --email test@example.com --yes
```

This removes the matching row from `auth.users` through Supabase Auth Admin. Game save rows are configured to cascade from `auth.users(id)`, catalog authorship is cleared, and historical audit actor IDs are retained. Apply the baseline migration before using the command. The command refuses to run unless `DEV_ENABLE_USER_DELETE=true`, `SUPABASE_SERVICE_ROLE_KEY`, and `--yes` are present.

Direct database deletion is available only when explicitly requested and the DB certificate chain is configured:

```bash
DEV_ENABLE_USER_DELETE=true npm run db:delete-user -- --email test@example.com --yes --direct-db
```

Run locally:

```bash
npm install
npm run dev
```
