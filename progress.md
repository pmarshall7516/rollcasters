Original prompt: Now, I want you to use all of these refined implementation documents to make the first version of my game. This should be functional for the most part with a decent bit of UI and feature polish. Seed initial data in the database, and use a database connection to pull all user and game catalog data. Do not seed any user data, as I will test the sign up and log in flows when the first version is built. In this repo, I have a .env file, and I can provide all needed database connection information to it, just let me know what else I need to add to this documentation or repo so you can go though implementation iterations of building and testing to refine a first version of this game.

## Progress

- Started first playable implementation from the refined implementation docs.
- Decided to build a Vite + React + TypeScript frontend backed by Supabase Auth, Postgres tables, RLS, and RPC functions.
- Existing `.env` originally only contained `postgres_password`; user later added `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Added Vite/React scaffold, Supabase client layer, UI screens, local combat loop, SQL schema migration, and catalog seed migration.
- Ran `npm install`; dependencies installed and npm reported 1 moderate and 1 high audit finding.
- `npm run build` passes.
- Started local dev server at `http://127.0.0.1:5173/`.
- Ran the develop-web-game Playwright client after installing Playwright and Chromium; with no Supabase env values present, verified the setup screen screenshot at `output/web-game/shot-0.png`.
- Updated app to prefer `VITE_SUPABASE_PUBLISHABLE_KEY`, with `VITE_SUPABASE_ANON_KEY` fallback.
- Restarted Vite with current `.env`; browser validation now reaches the login screen.
- Attempted local database migration using derived direct Postgres URL, but secure TLS verification failed with a certificate-chain error. The unsafe SSL bypass was rejected, so migrations still need Supabase SQL editor or a verified `SUPABASE_DB_URL` plus `SUPABASE_DB_CA_CERT_PATH`.
- Added database utility commands:
  - `npm run db:migrate` for all migrations.
  - `npm run db:migrate:dry` to preview selected migrations.
  - `npm run db:migrate -- --files file1.sql,file2.sql` for subsets.
  - `DEV_ENABLE_USER_DELETE=true npm run db:delete-user -- --email test@example.com --yes` for dev-only user deletion.
- Updated `db:delete-user` to prefer Supabase Auth Admin via `SUPABASE_SERVICE_ROLE_KEY` and require explicit `--direct-db` for direct Postgres deletion, avoiding the self-signed certificate failure path by default.
- Fixed `db:delete-user` for Node 20 by replacing `@supabase/supabase-js` usage with direct Supabase Auth Admin REST calls, avoiding Realtime/WebSocket initialization. Deleted `patrick.wayne.marshall@gmail.com` successfully via the command.
- Added `supabase/migrations/003_asset_storage_and_starter_seen.sql` to create the public-read `game-assets` Supabase Storage bucket, `public.game_assets` registry table, catalog asset paths, and read/performance indexes for common game-state queries.
- Updated the starter selection RPC so choosing one starter records all active starter critters in `user_seen_critters`, while only the selected starter is inserted into `user_critters`.
- Updated the React app to render catalog `asset_path` values from the `game-assets` bucket with placeholder badge fallback when an upload is missing.
- Documented the recommended Supabase Storage object layout in `README.md`.
- Continued repo check for the storage/starter-seen optimization work.
- Verified `npm run build` passes after the asset storage and starter-seen changes.
- Verified `npm run db:migrate:dry` selects all three migrations in order.
- Ran `npm audit --audit-level=moderate`; npm reports the existing Vite/esbuild dev-server advisory and recommends a breaking `vite@8.1.4` force upgrade, so this was left unchanged for now.
- Added `supabase/.temp/` to `.gitignore` so Supabase CLI local state does not get committed.
- Updated asset storage migrations and docs so skills and abilities do not have image assets, and Basic plus the three starter element logos are registered.
- Updated the migration utility to derive direct Postgres URLs with `sslmode=verify-full` and emit a clearer `SELF_SIGNED_CERT_IN_CHAIN` remediation message.
- Updated game asset storage paths and bucket MIME restrictions so all image assets use PNG files.

## TODO

- Apply `supabase/migrations/001_initial_schema.sql`, `supabase/migrations/002_seed_catalog.sql`, and `supabase/migrations/003_asset_storage_and_starter_seen.sql` to the Supabase project.
- Upload game art to the `game-assets` bucket paths documented in `README.md` as sprites/logos become available.
- After migrations are applied, test signup, login, starter selection, home, collection, dungeon start, combat, and reward claim against the live Supabase database.
- Review npm audit findings later; avoid broad forced upgrades until the first build is stable.
