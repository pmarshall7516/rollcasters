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

Apply the SQL files in this order in the Supabase SQL editor or with your preferred migration tool:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_seed_catalog.sql`
3. `supabase/migrations/003_asset_storage_and_starter_seen.sql`

The seed migration only creates catalog content: Shanks, Toxichick, Spreagle, Congua, Slam, Copper Shield, starter options, elements, statuses, and dungeons. It does not create user accounts or user-owned save data.

`003_asset_storage_and_starter_seen.sql` creates a public-read Supabase Storage bucket named `game-assets`, a `public.game_assets` registry table, asset paths on starter catalog rows, and performance indexes for common game-state reads. The player client no longer uses the legacy `user_seen_critters` state: every catalog Critter displays its artwork and name, while ownership alone determines whether its card is unlocked.

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

To run only selected migration files, pass a comma-separated list by basename or path:

```bash
npm run db:migrate -- --files 001_initial_schema.sql
npm run db:migrate -- --files 001_initial_schema.sql,002_seed_catalog.sql
npm run db:migrate -- --files 003_asset_storage_and_starter_seen.sql
```

If the local runner reports `SELF_SIGNED_CERT_IN_CHAIN`, use the Supabase SQL editor for the migration files or download the Supabase database CA certificate and set `SUPABASE_DB_CA_CERT_PATH` to that file path. Do not disable TLS verification for migrations.

## Development Database Utilities

Delete a development user by email:

```bash
DEV_ENABLE_USER_DELETE=true npm run db:delete-user -- --email test@example.com --yes
```

This removes the matching row from `auth.users` through Supabase Auth Admin. Game save rows are configured to cascade from `auth.users(id)`. The command refuses to run unless `DEV_ENABLE_USER_DELETE=true`, `SUPABASE_SERVICE_ROLE_KEY`, and `--yes` are present.

Direct database deletion is available only when explicitly requested and the DB certificate chain is configured:

```bash
DEV_ENABLE_USER_DELETE=true npm run db:delete-user -- --email test@example.com --yes --direct-db
```

Run locally:

```bash
npm install
npm run dev
```
