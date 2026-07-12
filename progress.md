Original prompt: Now, I want you to use all of these refined implementation documents to make the first version of my game. This should be functional for the most part with a decent bit of UI and feature polish. Seed initial data in the database, and use a database connection to pull all user and game catalog data. Do not seed any user data, as I will test the sign up and log in flows when the first version is built. In this repo, I have a .env file, and I can provide all needed database connection information to it, just let me know what else I need to add to this documentation or repo so you can go though implementation iterations of building and testing to refine a first version of this game.

## Progress

- Expanded `docs/04-enhanced-ui.md` into a full UI refresh specification covering logo placement, dark fantasy visual tokens, universal 5px-padded contain-fit sprite frames, element-first critter names, standardized home/combat skill tiles, larger relic slots, definitive Rollcaster ability slots, accessible tooltips, equip dialogs, server-side loadout validation, responsive/accessibility requirements, phased implementation, and acceptance criteria.
- Audited the current frontend/data model while planning the refresh: ability, skill, squad, and relic slot tables already exist, but the client currently reads only ability/skill/squad slots, renders just one Rollcaster ability, and has no equip mutation APIs. The plan explicitly calls out loading relic slots and adding server-validated equipment operations.
- The requested `ui/logo.png` and `ui/small-logo.png` were not visible in the repository checkout during the documentation pass; the UI plan includes an asset verification/registration gate before implementation.

- Standardized collectible presentation across home, collection/detail, and combat: Rollcasters, critters, and relics now use true square frames, combat sprites gained explicit square wrappers, and all artwork uses proportional `object-fit: contain` sizing with a safety inset so full sprites remain visible.

- Hardened Rollcaster portrait containment: images now preserve their intrinsic aspect ratio with `width/height: auto`, are limited by both frame dimensions, and receive explicit vertical inset inside a non-clipping sprite wrapper so the full source artwork is always displayed.

- Corrected the shared Rollcaster display after visual feedback: reduced the square to a pane-safe 236px, made it responsive to narrower containers, and changed portrait sizing to height-driven `object-fit: contain` so the complete sprite remains visible with 4% top and bottom breathing room.

- Standardized Rollcaster artwork on the home page, collection grid, and detail popup to the same 260px square frame with 20px padding, and increased the contained portrait from 70% to 88% of its available sprite area.

- Tightened Rollcaster portrait padding slightly by increasing the rendered image box from 64% to 70% while preserving full-portrait containment.

- Increased the Rollcaster portrait safety inset from 12% to 18% per side (64% rendered image box), ensuring artwork that touches the source PNG edges still has clearly visible space around the complete silhouette.

- Made Rollcaster portrait fitting cascade-proof by applying a dedicated class directly to the image and constraining its rendered box to 76% of the square frame, guaranteeing the entire tall PNG plus visible breathing room.

- Inspected the live Shanks source asset (568x954, intact full-body canvas) and added an explicit portrait-fit Sprite mode so Rollcaster images render at `height: 100%; width: auto` instead of filling and clipping against square frames on home, collection, and detail surfaces.

- Expanded collectible detail popups to 920px and gave critter, Rollcaster, and relic details the same ID/square-sprite/name hierarchy as grid cards; relic cards now open owned-item details.
- Added padded square `object-fit: contain` frames to the equipped home Rollcaster and critter slot artwork, and strengthened full-image sizing in collection/detail frames.

- Standardized collection ownership styling: every unowned critter (including seen critters), Rollcaster, and relic now receives the greyed-out locked card treatment.

- Ensured collection Rollcaster and relic artwork uses the full padded sprite-frame area with `object-fit: contain`; unowned relics now retain their visible artwork while the card itself remains styled as locked.

- Reworked starter and collection cards with top-left collectible IDs, centered padded square sprite frames, and centered name rows. Critter name rows now show only the element logo (without type text); Rollcaster and relic name rows remain text-only.

- Fixed signup when email confirmation is enabled: the app now waits for a real Supabase session before loading protected game data and displays a check-email confirmation state otherwise.
- Simplified authentication UI to a centered Rollcasters title above one fixed-size login/signup pane.
- Verified the production build and visually inspected both login and signup panes with the Playwright web-game client; layout is centered, consistent, and console output contains no app errors.

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
- Wired all game screens to resolve critter, Rollcaster, relic, and element art from either catalog `asset_path` values or the active `game_assets` registry fallback.
- Added element-logo labels to starter, home squad, collection, detail, and combat views; standardized icon sizing for element, coin, and mana artwork.
- Verified all 11 documented Supabase Storage asset URLs return HTTP 200 with `image/png` content, and verified the production build succeeds.
- Ran the web-game Playwright client and visually inspected the auth screen; gameplay screen inspection still requires an authenticated test session.

## TODO

- Apply `supabase/migrations/001_initial_schema.sql`, `supabase/migrations/002_seed_catalog.sql`, and `supabase/migrations/003_asset_storage_and_starter_seen.sql` to the Supabase project.
- After migrations are applied, test signup, login, starter selection, home, collection, dungeon start, combat, and reward claim against the live Supabase database.
- Review npm audit findings later; avoid broad forced upgrades until the first build is stable.

## Content Dev Tool requirements (2026-07-12)

- Added `docs/05-content-dev-tool.md`, a complete product and technical plan for a private CRUD content-admin app covering critters, Rollcasters, progression/unlocks, relics, skills, abilities, reusable effect templates/definitions, statuses, elements, assets, and regular/boss dungeons.
- Audited the existing Supabase schema and documented an additive expand/backfill/switch/contract migration path. Current JSON effect fields, dungeon arrays, and drop JSON remain in place until the player game is verified against normalized attachments and child tables.
- Specified admin-claim authorization, transactional aggregate RPCs, lifecycle/draft/publish behavior, optimistic locking, audit history, usage-aware archive/delete/ID rename flows, Storage-backed searchable sprite fields, dungeon weighted sampling, independent final-value stat overrides, and runtime compatibility gates.
- No database migration or app implementation was applied during this documentation task; schema work starts with the proposed admin-foundation migration after the plan is accepted.

## Enhanced UI refresh implementation (2026-07-12)

- Implemented the `docs/04-enhanced-ui.md` dark-fantasy presentation system with semantic CSS tokens, layered moonlit backgrounds, luminous indigo panels, consistent controls, focus states, reduced-motion support, and responsive layouts.
- Added reusable `BrandLogo`, `SpriteFrame`, `CritterName`, `SkillTile`, `RelicSlot`, `AbilitySlot`, tooltip, modal, and equip-dialog components. Sprite frames use square containment and exactly 5px of padding.
- Rebuilt authentication, starter selection, signed-in header, home/loadout, collection/detail, dungeon selection, combat actions, and post-victory rewards around the shared visual language.
- Added ordered four-slot skill grids, progression-driven Rollcaster ability slots, larger relic slots, exact selector empty-state copy, human-readable effect formatting, combat affordability feedback, and keyboard-focus handling.
- Added `user_critter_relic_slots` to frontend state and migration `004_enhanced_ui_loadout_rpcs.sql` with ownership-validating RPCs for squad, skill, relic, ability, and active-Rollcaster changes. The RPCs enforce slot unlocks, duplicates, inventory quantity, and minimum equipped skill/ability/squad rules.
- Registered `ui/logo.png`, `ui/small-logo.png`, and `ui/relic-slot.png` in the asset manifest. The full supplied logo was confirmed visually from the configured storage bucket.
- Verified `npm run build`, `npm run db:migrate:dry`, desktop auth rendering, the signup toggle, 360px no-overflow layout, and minimum 44px control sizing.

### Remaining environment step

- Apply `supabase/migrations/004_enhanced_ui_loadout_rpcs.sql` to the configured Supabase project before using the new equipment dialogs against live data.
- A full signed-in mutation/combat/reward browser pass still requires an authenticated test session after migration 004 is applied.

## Skill tooltip and targeting refinement (2026-07-12)

- Rebuilt ability tooltips as a bold name row followed by the ability description, with no Rollcaster-ability image or logo in slots, candidates, or tooltips.
- Rebuilt skill tooltips with an element-logo header, bold name/type/power metadata, a separate description row, and a clean targeting sentence.
- Added five catalog targeting modes via `005_skill_targeting.sql`: `single_enemy`, `all_enemies`, `all_others`, `single_any`, and `all_friendlies`.
- Added combat target selection for single-target moves when multiple legal targets exist. Group moves resolve automatically against active legal targets.
- Added multi-target combat resolution and basic targeted support healing. Deterministic checks confirmed that `all_others` hits the active ally and enemy but not its user, while `single_any` can heal a selected friendly target.
- Tightened skill tiles to 66px minimum height while enlarging and vertically centering the element logo/name row.
- Empty relic slots no longer expose an Unequip action.
- Empty squad-slot dialogs now show every owned critter; already-assigned critters remain visible, disabled, greyed, and marked `In squad`.

### Remaining environment step

- Apply both `004_enhanced_ui_loadout_rpcs.sql` and `005_skill_targeting.sql` before signed-in live testing of equipment and targeting.

## Header and skill-tile density refinement (2026-07-12)

- Removed the separate Home control from the signed-in header and made the centered Rollcasters logo the accessible home button.
- Enlarged equipped skill content: 32px element logo, 18px skill name, 13px power label, 17px mana count, and 22px mana icon.
- Vertically centered the element/name group across both tile rows while retaining power and mana alignment on the right.
- Added a dedicated empty-skill state so `-----` is centered both horizontally and vertically.

## Area preview and effect-copy templates (2026-07-12)

- Added an area-effect confirmation state. Choosing a group attack or support skill now previews every legal affected Critter before committing the action.
- Affected battlefield cards receive a pulsing danger glow for attacks or success glow for support effects; reduced-motion preferences continue to disable the animation.
- The turn submission control is disabled while target selection or area confirmation is unresolved.
- Added `src/lib/presentation.ts` as the centralized player-facing effect language source for damage-over-time, skip chance, healing, buffs, debuffs, status application, shields, damage reduction, and mana gain.
- Replaced raw/generic effect formatting across skill tooltips, ability slots/dialogs, and relic details/dialogs with the centralized templates.

## Skill-tile scale refinement (2026-07-12)

- Increased equipped skill names from 18px to 21px and element logos from 32px to 38px.
- Standardized the power label, mana number, and mana icon on one shared 17px metadata token.
- Increased the shared tile minimum height slightly to 84px to preserve clean alignment with the larger identity content.

## Mana Dice bounds (2026-07-12)

- Replaced the single Mana Die maximum with explicit `base_dice_min` and `base_dice_max` critter data, plus independent `dice_min_delta` and `dice_max_delta` level-progression values.
- Added migration `006_mana_dice_bounds.sql`; it preserves every existing maximum, initializes existing minimums to 1, adds bound constraints, and has been applied successfully to the configured Supabase database.
- Combat now rolls uniformly across every integer in the inclusive `[minimum, maximum]` range using `Math.floor(random * range)`, and both combat and stat cards display the full range.
- Verified production build, migration selection, exact bucket boundaries/uniform bucket counts, fixed-value ranges, live database values, and the unauthenticated app render/browser console with the required Playwright client.
- Seed values intentionally preserve the current balance (Toxichick 1–6, Spreagle 1–6, Congua 1–8); future catalog edits can raise either bound independently.
