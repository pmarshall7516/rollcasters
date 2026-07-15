Original prompt: Now, I want you to use all of these refined implementation documents to make the first version of my game. This should be functional for the most part with a decent bit of UI and feature polish. Seed initial data in the database, and use a database connection to pull all user and game catalog data. Do not seed any user data, as I will test the sign up and log in flows when the first version is built. In this repo, I have a .env file, and I can provide all needed database connection information to it, just let me know what else I need to add to this documentation or repo so you can go though implementation iterations of building and testing to refine a first version of this game.

## Main-page empty squad slot consistency (2026-07-15)

- Made the squad grid use equal-height rows so every empty squad slot always matches occupied squad slot dimensions across responsive layouts.
- Replaced the empty squad slot's circled text glyph with the same Lucide Plus icon and sizing class used by empty relic slots.
- Expanded the home loadout layout regression fixture to cover an occupied and empty squad slot together and assert equal dimensions plus shared icon treatment.
- Verified exact width/height equality across seven responsive viewports from 1920px desktop through 320px mobile, visually inspected desktop/mobile screenshots, passed `npm run build` and `git diff --check`, and completed the required real-app Playwright smoke render without captured app errors.

## Player-facing Mana terminology (2026-07-14)

- Replaced the player-facing “Mana Dice”/“mana die” terminology with “Mana” across stat cards, generated effect copy, validation copy, and UI regression fixtures.
- Removed the collection-only compressed typography that was needed for the longer label while retaining close label/value spacing.
- Confirmed no old terminology remains in `src` or UI test fixtures and visually inspected collection, home loadout, stat detail, effect tooltip, and real-app smoke screenshots.
- Passed `npm run build`, `npm run test:collection-ui`, `npm run test:effect-runtime`, `npm run test:collection-layout`, `npm run test:home-loadout-layout`, `npm run test:collection-interaction-ui`, `npm run test:effect-ui`, and `git diff --check`.

## Collection Mana Dice spacing refinement (2026-07-14)

- Tightened the collection Critter card's Mana Dice label/value spacing, removed excess horizontal padding, and restored its responsive type scale closer to the other stat cells.
- Expanded the collection layout regression to require centered, tightly spaced, single-line Mana Dice content at a readable responsive size.
- Visually inspected the generated desktop and mobile collection screenshots. `npm run test:collection-layout`, `npm run build`, `git diff --check`, and the required real-app Playwright smoke render pass.

## Inline owner effect combat integration (2026-07-14)

- Replaced the player bootstrap dependency on reusable effect definitions and attachment tables with the `combat_effects_v1` inline owner view from `004_inline_owner_effects.sql`.
- Reworked the runtime contract to use the new `value_mode`, owner-specific targets, application-owned finite/indefinite Status durations, element filters, and owner-scoped effect IDs.
- Implemented one chance roll per attached effect, signed half-up delta rounding, actual-damage healing, active-slot-only targeting, slot-following selections across swaps, holder-relative Status damage/skip targets, Mana refunds for skipped actions, and active-source recomputation for Abilities and Relics.
- Added ordered Status icons/tooltips above active combat sprites and updated Skill, Ability, and Relic tooltips so normal owner copy precedes every inline effect description.
- Replaced the old runtime regression with inline-contract coverage for all runtime kinds, owner target families, duration behavior, chance failures, source lifetimes, snapshot freezing, and invalid owner/version/target rejection. `npm run test:effect-runtime` passes.

- Verified the five live `combat_effects_v1` rows conform to the client contract without mutating the database.
- Passed `npm run test:effect-runtime`, `npm run test:effect-ui`, `npm run typecheck`, `npm run build`, `npm run test:collection-layout`, `npm run test:sprite-containment`, `npm run db:migrate:dry`, and `git diff --check`.
- Ran the required web-game browser client and visually inspected its clean unauthenticated render. Also visually inspected the local combat effect UI, Status tooltip, desktop/mobile collection, and desktop/mobile sprite-containment screenshots.
- The service-role authenticated combat script was intentionally not run because it creates/deletes a real Auth user; no live data was mutated during this implementation.

## Game-data bootstrap relationship fix (2026-07-13)

- Fixed authenticated game loading after PostgREST reported two relationships between `effect_definitions` and `effect_templates`; the published-effect embed now explicitly uses `effect_definitions_template_id_fkey`.
- Improved bootstrap error handling so structured Supabase errors display their real message and are logged for diagnosis instead of always becoming `Unable to load game data.`
- Verified the signed-in home and collection screens against live Supabase data, then passed the production build, collection layout, sprite containment, and effect runtime test suites.

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

## Player effect runtime integration (2026-07-12)

- Integrated the player game with normalized effect definitions and Skill, Ability, Relic, and Status attachment tables from migrations 008/011/012.
- Catalog bootstrap now loads published definitions with their template runtime contracts, orders attachments by `sort_order` then effect ID, and rejects missing, inactive, archived, unsupported, or owner-mismatched definitions.
- Added the versioned runtime dispatcher contract for `stat_modifier@1`, `mana_dice_modifier@1`, `apply_status@1`, `restore_hp@1`, `damage_over_time@1`, and `skip_action_chance@1`; handlers use replayable injected RNG state rather than `Math.random()`.
- Implemented final-value dungeon overrides, player and opponent Relic registration, active Rollcaster Ability registration, flat/percentage stat stacking, Mana Dice/stat clamps, Skill attachment resolution, status application and refresh/extend/stack/ignore policies, timed damage, skip procs, and status expiry.
- Added canonical `self_only` and `all_allies` player targeting without aliasing either to `all_friendlies`.
- Dungeon combat now snapshots effect definition/runtime versions, canonical parameters, owner sources, attachment order, player/opponent loadouts, opponent overrides, and RNG seed. Migration `015_game_effect_runtime_integration.sql` adds status lifecycle fields and the authenticated write-once snapshot RPC.
- Updated Skill, Ability, and Relic tooltips to show normalized attachments in stored order as `<effect name>: <effect description>` without exposing JSON.
- Added `npm run test:effect-runtime`, covering Harden, Boosted Roll, Poison Touch proc/no-proc, deterministic snapshots, attachment ordering, owner rejection, status refresh, Toxic timing, and Mana Dice clamps.
- Verified `npm run test:effect-runtime`, `npm run build`, `npm run db:migrate:dry`, and `git diff --check`.
- Ran the required Playwright client against the local app, inspected `output/effect-runtime-browser/shot-0.png`, and confirmed the live unauthenticated state and auth layout render without captured app errors. Signed-in browser combat remains unavailable without using or creating user credentials.

### Remaining environment step

- Apply migrations 007 through 015 (including `015_game_effect_runtime_integration.sql`) to the configured Supabase project before starting a dungeon with normalized effects.
- After migration 015 is live, run an authenticated browser pass through battle setup, Skill target confirmation, poison/status turns, victory, and reward claim.

## Shared sprite containment contract (2026-07-13)

- Reworked the shared `Sprite` renderer so every Critter, Rollcaster, Relic, inventory, loadout, combat, reward, detail, and candidate image is an absolutely positioned paint layer inside a relatively positioned, clipped sprite box.
- Reworked `AssetIcon` into the same fixed-box contract for element, mana, currency, relic-slot, tooltip, and name-row artwork. Image loading or fallback changes no longer participate in surrounding layout sizing.
- Standardized all sprite images on centered `object-fit: contain`, border-box sizing, explicit width/height, and inherited safe-area padding (5px for framed artwork and 1px for compact icons).
- Removed the old category-specific portrait width, height, max-size, and `overflow: visible` rules that could let intrinsic image dimensions or Rollcaster overrides escape the frame.
- Added `npm run test:sprite-containment`, a Playwright geometry regression covering tall, near-square, square, oval, wide, and compact-icon sources at desktop and 360px mobile viewports. All 12 checks pass and both screenshots were visually inspected.
- Verified `npm run build`, `git diff --check`, the required web-game Playwright client, auth-screen text state, and browser screenshots. The app loaded without captured console errors.

### Remaining authenticated verification

- When an authenticated test session is available, visually recheck the home loadout, collection/detail, equip dialogs, dungeon combat/target picker, and reward screen with live catalog assets. The shared renderer and shape regression are verified independently of authentication.

## Authentication layout correction (2026-07-13)

- Replaced the authentication card's fixed 440px height with a 440px minimum height so the taller sign-up form expands instead of overflowing above and below its border.
- Added a contained error-message treatment and clear stale authentication errors when switching between log-in and sign-up modes.
- Verified the production build and ran the required web-game Playwright client against the sign-up state. Visually inspected 700x919 and 360x800 screenshots; all form children stay inside the card, mobile has no horizontal overflow, and no browser console errors were captured.

## Development user deletion foreign keys (2026-07-13)

- Diagnosed Auth Admin deletion failure caused by restrictive Content Studio authorship foreign keys such as `elements_created_by_fkey`.
- Added `002_auth_user_delete_audit_fks.sql`: live `created_by`/`updated_by` references now use `ON DELETE SET NULL`, while `content_change_log.admin_user_id` retains its immutable historical UUID without a live Auth foreign key.
- Improved `db:delete-user` to report the required migration explicitly if Supabase returns a foreign-key deletion failure.
- Applied migration 002 successfully to the configured Supabase database and deleted `patrick.wayne.marshall@gmail.com` through Supabase Auth Admin.

## Collection sorting, filtering, and fixed cards (2026-07-13)

- Fixed the active home Rollcaster portrait's collapsed 2px frame by using the same explicit `CardSprite` frame contract as collection Rollcaster cards and sizing its button to the 236px frame.
- Collection Critters, Rollcasters, and Relics now sort by collectible ID with numeric-aware comparison, independent of catalog `sort_order`.
- Added a shared name/ID search field beneath the collection tabs and a Critter-only searchable element dropdown with element logo/name rows and logo/name selected state.
- Standardized all collection grid cards at 440px tall across tabs; responsive breakpoints retain identical card dimensions while changing only the number of columns.
- Centered Critter `SEEN` and `UNDISCOVERED` status text, made it uppercase and bold, and widened the first compact stat column so `Mana Dice 10–12` remains fully contained on one line.
- Added `npm run test:collection-layout`, covering identical card dimensions, 10–12 Mana Dice containment, and status alignment/casing at desktop and 360px mobile widths.
- Verified the authenticated home and all three collection tabs in Chrome: active Rollcaster art rendered at 236x236, collection IDs appeared in 001/002/003 order, search reduced results by name/ID, element selection showed its logo/name and filtered the grid, all live cards measured 440px tall, and the 390px viewport had no horizontal overflow.
- Verified `npm run test:collection-layout`, `npm run test:sprite-containment`, the required web-game Playwright smoke client, production build, `git diff --check`, and an empty browser error log. Visually inspected desktop/mobile collection regression images and authenticated home/collection screenshots.

## Unified locked collection and grid-only scrolling (2026-07-13)

- Removed the player client's Critter seen-state query/type/rendering dependency. All catalog Critters now expose their normal artwork, element, and name; ownership alone determines whether the card is unlocked.
- Standardized every unowned Critter, Rollcaster, and Relic as a disabled greyed card with one centered, uppercase, bold `LOCKED` status. Removed `SEEN`, `UNDISCOVERED`, placeholder names, and question-mark art from collection cards.
- Locked Relics no longer show ownership/description content or open their detail modal; owned Relics retain their existing details.
- Added a fixed collection shell and dedicated grid viewport. The document is viewport-locked, only the card viewport scrolls, and the grid remains exactly three columns with 440px cards.
- Reserved fixed tab, search, and element-filter geometry so the title, controls, and grid origin do not move when switching collection tabs. Narrow screens keep the literal three-column grid inside the horizontally/vertically scrollable collection viewport.
- Expanded `npm run test:collection-layout` to verify three columns, fixed document overflow, grid-only vertical scrolling, stable anchors with/without the Critter filter, identical card sizes, locked status styling, and double-digit Mana Dice containment at desktop and mobile sizes.
- Authenticated Chrome verification confirmed stable coordinates across Critter/Rollcaster/Relic tabs, real artwork for all unowned Critters, disabled locked cards, centered `LOCKED` statuses, no browser errors, and a real scroll moving the collection grid while page `scrollY` remained zero.

## Locked collection details and page scrolling (2026-07-13)

- Restored level-1 stat grids on locked Critter cards so players can compare catalog Critters before owning them.
- Added normalized effect summaries to every Relic card, including locked Relics, while preserving the locked ownership treatment.
- Removed the fixed-height collection shell and nested grid viewport; collection grids now use responsive columns and the document itself scrolls on desktop and mobile.
- Updated the collection layout regression to verify document scrolling, the absence of nested grid scrolling, responsive 3/1-column layouts, locked Critter stat containment, and visible locked Relic effect copy.
- Verified `npm run test:collection-layout`, `npm run build`, and `git diff --check`; also ran the required web-game Playwright smoke client and visually inspected its clean auth render plus the desktop/mobile collection regression screenshots.

## Effect runtime contract hardening (2026-07-13)

- Audited the live effect catalog and category invariants against the supplied game integration contract. The live category/template/definition relationships are consistent, but the database did not yet expose the write-once dungeon effect snapshot RPC or explicit Status lifecycle columns expected by the client.
- Added strict game-side validation for supported runtime versions, canonical parameters, category-specific targets, template category/activity, and referenced active Statuses.
- Snapshotted effect/template versions, source order, Status lifecycle, loadouts, overrides, parameters, and RNG inputs into a run-owned runtime registry so combat no longer resolves against mutable catalog effect maps.
- Reworked combat stat recomputation so flat modifiers apply before one summed percentage bucket, Status and Skill modifiers do not compound accidentally, and active Relic/Ability modifiers are removed/reapplied when wearers are defeated or swapped.
- Added `003_game_effect_runtime_support.sql` for Status stacking/duration/max-stack fields plus the authenticated, idempotent, write-once `snapshot_dungeon_run_effects` RPC.
- Combat initialization now uses the exact `selected_opponents` stored by `start_dungeon_run` instead of independently selecting again from the mutable catalog, preventing boss/regular encounter divergence and ensuring the snapshot matches the server-owned run.
- Added a self-contained authenticated Playwright regression that creates and removes a temporary Auth user, enters a live dungeon, verifies the stored Effect/Status snapshot, plays through victory/rewards, captures both screens, and fails on browser errors.
- Applied `003_game_effect_runtime_support.sql` to the connected Supabase project. Post-apply checks report zero template, definition, and attachment category violations; the snapshot column/function exist; and no temporary browser-test users remain.
- Final verification passed `npm run typecheck`, `npm run build`, `npm run test:effect-runtime`, `npm run test:effect-browser`, `npm run test:collection-layout`, `npm run test:sprite-containment`, `npm run db:migrate:dry`, and `git diff --check`. The authenticated browser run reached rewards with three snapshotted effects and no console/page errors; combat and reward screenshots were visually inspected.

## Developer collectible grant/revoke commands (2026-07-14)

- Added six service-role-only commands: `game:grant:{relic,critter,rollcaster}` and `game:revoke:{relic,critter,rollcaster}`. Their argument reader supports the requested npm form without a separate `--` by reading npm config environment values, while also supporting direct forwarded CLI arguments.
- Added atomic database function migration `005_dev_collectible_commands.sql`. Relics default to one copy, respect `max_owned`, cannot be revoked below equipped quantity, and delete the inventory row at zero. Critter and Rollcaster grants initialize level-one zero-cost unlocks and slots; revokes clean dependent ownership state and safely replace an active Rollcaster when possible.
- Added focused command validation/transport/message tests and documented setup, success/failure behavior, and all examples in the README.
- Applied migration 005 to the configured Supabase project. Focused unit tests and a live temporary-user round trip passed across all six commands, including duplicate ownership, maximum quantity, equipped-copy protection, zero-quantity relocking, and default Skill/Ability slot initialization; the temporary user was removed automatically.
- Ran the required web-game Playwright smoke client and visually inspected `output/collectible-command-browser/shot-0.png`; the auth screen rendered cleanly and `render_game_to_text` reported the expected unauthenticated state.

## Inline effect parameter normalization (2026-07-14)

- Diagnosed live Relic effect `a597cea0-309a-4a70-9f49-bb691c38c111` (`Lighter Roll`) failing catalog bootstrap because the Content Studio persisted its hidden `element_ids: []` picker default on a non-elemental Relic Mana Dice modifier.
- Normalized `combat_effects_v1` rows before strict contract validation so `element_ids` is retained only for element-filtered Ability targets and removed everywhere it has no combat meaning.
- Added the exact live Relic row shape as a runtime regression while preserving strict validation for every other unsupported parameter.
- Verified `npm run test:effect-runtime`, `npm run typecheck`, `npm run build`, and `git diff --check`; all seven currently published live effect rows now pass the fixed runtime contract. Ran the required browser smoke client and visually inspected the clean authentication render and expected unauthenticated text state.

## Collection, progression, and loadout UI refinements (2026-07-14, in progress)

- Added interval XP presentation so cumulative totals display as progress within the current level (including the requested 79/80 then 20/100 carryover behavior).
- Added home-loadout passive stat calculation and per-source breakdown data for equipped Relics and active Rollcaster Abilities, including positive, negative, and mixed modification tracking.
- Reworked locked collection entries to open catalog-based details, aligned Critter/Rollcaster progression and point-counter regions, and changed Relic effect copy to named effect rows.
- Added database migration 006 with automatic XP-driven level/point processing, transactional Critter Skill purchasing, optional Rollcaster Ability loadouts, and squad removal that clears the removed Critter's Relics.
- `npm run test:collection-ui`, `npm run typecheck`, and `npm run build` pass after the first implementation slice.
- Completed the interaction slice: all equipped Skills/Abilities show checks, the selected slot occupant uses a green border and can be selected again to unequip, Critters retain the one-Skill minimum, Rollcasters allow zero Abilities, and a selected squad Critter can be removed when another squad member remains.
- Standardized every detail modal at a 900x760 scrollable hidden-scrollbar pane. Unlocked Critter Skills render at full color, level-eligible locked Skills show a centered opaque purchase button, and Rollcaster Ability details now use the same two-column presentation language.
- Expanded `test:collection-layout` and added `test:collection-interaction-ui`; both desktop/mobile layout screenshots and the skills/abilities/stats modal screenshot were visually inspected. The collection anchor, 440px card, point-counter, stat alignment, effect-row, modal-size, unlock-overlay, equipped-border, and stat-tooltip checks pass.
- Final local verification passed `npm run test:effect-runtime`, `npm run test:effect-ui`, `npm run test:collection-ui`, `npm run test:collection-layout`, `npm run test:collection-interaction-ui`, `npm run test:sprite-containment`, `npm run typecheck`, `npm run build`, `npm run db:migrate:dry`, and `git diff --check`. The required web-game client rendered a clean unauthenticated app with no captured app errors.
- Migration 006 was intentionally not applied to the configured Supabase database: the remote schema/data mutation requires explicit user approval. Apply `006_collection_progression_and_loadout.sql` before live-testing level-up point grants, Skill purchases, zero-Ability loadouts, and squad-removal Relic clearing.
- Follow-up collection polish reserves a stable viewport scrollbar gutter so the search control retains the same width across tabs with different result heights. Critter cards retain their 440px height while using larger progression-to-stats and stats-to-points gaps, reduced bottom padding, and responsive spacing that keeps the point counter inside mobile cards.
- Home loadout stat cells now all use the modified-stat border treatment, including unchanged values. Rollcaster popup Ability cards now place their unlock level and Ability Point cost in a separate metadata row beneath each card, matching Critter Skill details.
- Extended the Playwright checks to assert stable search geometry, responsive Critter spacing, visible point counters, uniform home stat borders, and Ability metadata placement. `test:collection-layout`, `test:collection-interaction-ui`, `typecheck`, `build`, and `git diff --check` pass; the updated desktop/mobile collection and popup screenshots were visually inspected.

## Main-page equipped-card layout refinement (2026-07-14)

- Enlarged each equipped Critter header sprite, element logo, name, and level treatment while reducing Skill tiles only inside home-page loadout cards.
- Added interval XP progress to equipped Critter headers and the active Rollcaster panel. Both compact bars place their numeric progress to the right; the Rollcaster bar sits immediately above its level label.
- Removed the visual relic inset by left-aligning the relic frame inside its wider label button, so the first relic frame shares the exact left edge of the Critter sprite and Skill grid.
- Added `test:home-loadout-layout`, which verifies the shared left edge, responsive 112/96/88px Critter frames, reduced 62px Skill tiles, enlarged identity typography/logos, XP placement, single-line representative name, and horizontal containment at 1380px, 980px, and 360px.
- Visually inspected all three home-loadout regression screenshots plus the real unauthenticated app smoke render. Final checks pass: `test:home-loadout-layout`, `test:collection-ui`, `test:collection-layout`, `test:sprite-containment`, `test:effect-ui`, `typecheck`, `build`, and `git diff --check`.

## Fluid multi-device layout system (2026-07-14)

- Unified the signed-in header, notices, home, collection, and combat surfaces under a shared fluid 1920px content ceiling with clamp-based page gutters and section gaps, replacing the mismatched 1280/1380px caps that created unnecessary side dead space.
- Added container-responsive equipped Critter cards so their sprite/header/XP composition responds to the card's real width rather than only the browser width.
- Changed collection and starter grids to auto-fit stable minimum card widths, allowing five/three/two/one collection columns across ultrawide desktop, laptop, iPad, and mobile without changing the card hierarchy.
- Expanded the home regression to six viewports (1920, 1380, 1280, iPad landscape, iPad portrait, and mobile); the first pass passes all alignment, scaling, viewport-fill, layout-mode, and overflow checks.
- Expanded the collection regression to ultrawide, desktop, both iPad orientations, and mobile, with responsive five/three/two/one-column expectations and stable controls/card geometry.
- Added `test:responsive-shell-layout` for matching header/content edges, combat reflow, Rollcaster visibility, header collision prevention, modal viewport containment, and candidate-grid behavior across desktop, iPad, and mobile.
- Visually inspected the generated home, collection, combat, modal, interaction, effect, and sprite-containment screenshots. Final checks pass: `test:home-loadout-layout`, `test:responsive-shell-layout`, `test:collection-layout`, `test:collection-interaction-ui`, `test:collection-ui`, `test:sprite-containment`, `test:effect-ui`, `typecheck`, `build`, and `git diff --check`; the required real-app smoke client also rendered the configured authentication screen cleanly with the expected unauthenticated text state.

## Main-page Critter pane compaction (2026-07-14)

- Changed the equipped Critter header grid so its XP bar follows the name/level block at the normal card gap instead of being pushed toward the right edge by a flexible identity column.
- Extra-wide equipped Critter cards now use one four-column Skill row, reducing oversized Skill tiles and using the available horizontal space without changing the established two-column tablet or one-column mobile presentation.
- Expanded the home-loadout regression fixture to match the live two-row stat block and verify both the close identity-to-XP spacing and responsive 4/2/1 Skill-column behavior.
- Visually inspected wide desktop, standard desktop, iPad portrait, and mobile renders. Final checks pass: `test:home-loadout-layout`, `test:responsive-shell-layout`, `test:sprite-containment`, `typecheck`, `build`, and `git diff --check`; the required real-app smoke client also rendered the configured authentication screen cleanly with the expected unauthenticated state.

## Collection card size and grid invariants (2026-07-14)

- Replaced collapsing, stretch-to-fill collection tracks with shared 320px fixed tracks and preserved empty tracks, so sparse Rollcaster and Relic tabs use the same card width and column coordinates as a full Critter tab.
- Standardized every collection card at a 320x440 footprint across ultrawide desktop, desktop, and iPad; narrow phones scale the complete card, artwork, padding, gaps, typography, progression, and stat geometry together at the same aspect ratio.
- Balanced complete grid columns across identical left and right grid edges while retaining responsive five/three/two/one-column layouts and allowing incomplete rows to remain incomplete.
- Expanded the collection Playwright regression to swap between three Rollcasters, nine Critters, and four Relics at every viewport, asserting identical tab grid edges, column positions, card dimensions, proportional internals, and non-stretching sparse rows.
- Visually inspected ultrawide, desktop, iPad portrait, and narrow-mobile collection renders. Final checks pass: `test:collection-layout`, `test:collection-interaction-ui`, `test:responsive-shell-layout`, `typecheck`, `build`, and `git diff --check`; the required web-game smoke client rendered the configured unauthenticated screen cleanly with matching text state.

## Equipped Critter progression row (2026-07-14)

- Grouped each equipped Critter's level label and XP progress into one flex row beneath its name, with vertically centered text, bar, and progress numbers.
- Simplified the Critter header to a sprite/content composition with a pinned Edit label, allowing the progression row to use the full remaining width on mobile without wrapping or separating the level from its bar.
- Updated the home-loadout regression to assert the level-to-XP gap and exact shared vertical center across six responsive viewports; visually inspected wide desktop, desktop, iPad portrait, and mobile renders.
- Final checks pass: `test:home-loadout-layout`, `test:responsive-shell-layout`, `typecheck`, `build`, and `git diff --check`; the required web-game smoke client rendered the configured unauthenticated screen cleanly with matching text state.

## Skill and Relic loadout matrix (2026-07-14)

- Replaced the wide Skill row and trailing Relic row with a balanced equipment region: a fixed 2x2 Skill grid on the left and a fixed 5x3 Relic grid on the right, both sharing the same rendered height.
- Added progression-derived Relic-slot state generation. Each Critter shows interactive slots up to its current unlocked total, future slots with a lock icon and their first unlock level, and permanently unavailable cells as fully shaded inset null slots.
- Preserved the existing Relic equip dialog behavior for every interactive cell while making future and null cells non-interactive and accessible through explicit disabled labels.
- Added the requested 1-at-level-1, 2-at-level-3, 3-at-level-5 progression example to the logic suite, including the 15-cell cap and twelve null cells.
- Expanded the responsive home regression to require 2 Skill columns, 5 Relic columns, 3 Relic rows, equal grid heights, correct 1/2/12 state counts, and horizontal containment across six viewports. Compact-width Skill metadata now uses a footer row so names remain readable on iPad landscape and mobile.
- Visually inspected wide desktop, desktop, both iPad orientations, and mobile renders. Final checks pass: `test:home-loadout-layout`, `test:collection-ui`, `test:responsive-shell-layout`, `typecheck`, `build`, and `git diff --check`; the required web-game smoke client rendered the configured unauthenticated screen cleanly with matching text state.

## Wider responsive collection cards (2026-07-14)

- Replaced the 320px fixed collection tracks and distributed leftover whitespace with fluid tracks separated by a fixed 12px gap.
- Collection grids now use four columns at the supplied 2022px reference viewport, three on a standard desktop, two on iPad-sized views, and one on phones; incomplete Rollcaster and Relic rows preserve the same track positions as Critters.
- Enlarged cards from 440px to a 500px baseline height and made card padding, gaps, artwork frames, names, and stat text scale against each card's own content width with a proportional narrow-card fallback.
- Expanded the collection layout regression to include the exact 2022x873 reference size and assert track fill, 12px gutters, wider minimum card sizes, responsive internals, and complete child containment. The first updated regression pass succeeds across six viewports, with no horizontal overflow or clipped stats, point counters, effects, or card children.
- Visually inspected the updated reference, desktop, iPad, and mobile collection renders plus the shared desktop/mobile sprite-containment renders. Final checks pass: `test:collection-layout`, `test:collection-interaction-ui`, `test:sprite-containment`, `test:responsive-shell-layout`, `typecheck`, `build`, and `git diff --check`; the required web-game client also rendered the configured authentication screen cleanly with the expected unauthenticated text state.
## Ten-slot Relic matrix and equal Critter stats (2026-07-14)

- Reduced each equipped Critter's Relic matrix from 5×3 to 5×2, capping the visible equipment area at 10 slots and giving every Relic cell more vertical space.
- Updated Relic progression's default visible matrix to 10 slots while preserving unlocked, future-unlock, and permanently unavailable slot states.
- Made all eight Critter stat cells use equal-width columns on both the main loadout and collection cards.
- Added collection-card Mana Dice compaction so its longer value remains readable and contained inside the same-width stat cell.
- Expanded responsive layout coverage to assert the 5×2 Relic matrix, equal Skill/Relic grid heights, correct Relic states, and equal Critter stat widths across wide desktop, desktop, iPad landscape, iPad portrait, and mobile views.
- Verified with `npm run test:collection-ui`, `npm run test:home-loadout-layout`, `npm run test:collection-layout`, `npm run test:responsive-shell-layout`, `npm run typecheck`, `npm run build`, and the required live-page browser smoke test.

## Empty Relic slot plus icon (2026-07-14)

- Replaced the default shield artwork in empty interactive Relic slots with a centered plus icon on both equipped Critter loadouts and the shared Relic slot component.
- Preserved Relic artwork for equipped slots and the shield fallback only when an equipped Relic's artwork cannot load.
- Extended the home layout regression to require the plus empty state and visually verified it across the responsive equipment grid.
- Passed `npm run test:home-loadout-layout`, `npm run typecheck`, `npm run build`, `git diff --check`, and the required live-page browser smoke test.

## Equipped Relic artwork treatment (2026-07-14)

- Expanded equipped Relic artwork to nearly the full interactive slot with a 1px image inset, including the shared legacy Relic slot presentation.
- Replaced the green equipped border/glow with the normal bright equipment border and a purple magic glow.
- Extended the responsive home regression with an equipped Relic fixture that asserts the art footprint, purple glow, non-green border, unchanged 5×2 matrix geometry, and mobile containment.
- Visually verified the updated equipped slot at desktop and mobile sizes; `npm run test:home-loadout-layout`, `npm run typecheck`, and `npm run build` pass.
- The required live-page browser smoke test rendered the clean unauthenticated app with matching text state; `git diff --check` also passes.

## Responsive Skill Equip scaling (2026-07-14)

- Enlarged equipped Skill names, element icons, power/mana metadata, button height, padding, and corner radius with loadout-container-relative sizing instead of fixed compact values.
- Kept element icons visible at every supported width and moved Skill metadata into a compact footer before content becomes cramped.
- Added explicit geometry coverage across seven viewports from 1920px wide desktop through 320px narrow mobile, including monotonic button/content scaling, icon visibility, child containment, equal Skill/Relic grid heights, and horizontal overflow checks.
- `npm run test:home-loadout-layout` passes; wide, desktop, 390px mobile, and 320px mobile screenshots were visually inspected.
- Final verification also passes `npm run test:responsive-shell-layout`, `npm run build`, and `git diff --check`; the required real-app Playwright smoke client rendered the configured authentication screen with the expected unauthenticated text state.

## Compact Critter summary stats (2026-07-14)

- Removed the visible Edit label from occupied squad Critter slots while retaining the full identity area as the accessible squad-change control.
- Moved all eight Critter stats into a compact four-column, two-row block to the right of the sprite/name/level/XP summary on sufficiently wide cards; narrow cards stack the same fixed two-row block below the identity.
- Replaced space-between stat content with tightly centered label/value pairs, reducing the complete stat block to roughly 257px in the responsive home fixture.
- Expanded the home layout regression to verify no Edit label, exact 4×2 stats, close label/value spacing, right-side/stacked responsive placement, one-line level text, containment, and existing Skill/Relic invariants across seven viewports.
- Visually inspected the final wide, desktop, iPad landscape, mobile, collection, and combat screenshots. Final verification passes `test:home-loadout-layout`, `test:collection-layout`, `test:responsive-shell-layout`, `build`, and `git diff --check`; the required real-app smoke client rendered the expected clean unauthenticated state.

## Unified Critter Skill slot and equip-popup presentation (2026-07-14)

- Replaced the separate home `skill-grid` and popup `dialog-skill-grid` wrappers with one `SkillTileGrid` component and one `skill-tile-grid` CSS contract.
- Moved responsive Skill sizing, title/icon placement, power/mana organization, selection-check positioning, and the fixed two-column layout into that shared contract so the popup no longer falls back to the larger generic Skill layout.
- Added `test:skill-equip-layout`, a focused Playwright parity regression that requires matching slot/popup geometry, two-column organization, title/icon row, power/mana footer, selection placement, responsive scaling, and overflow behavior.
- Visually inspected the matching desktop/mobile parity renders, the responsive home loadout, modal Skill states, and mobile modal containment. Final verification passes `test:skill-equip-layout`, `test:home-loadout-layout`, `test:collection-interaction-ui`, `test:responsive-shell-layout`, `typecheck`, `build`, and `git diff --check`; the required real-app Playwright smoke client rendered the configured authentication screen cleanly with matching unauthenticated text state.

## Right-aligned uniform Critter stats (2026-07-14)

- Widened the equipped Critter stat cells with one shared responsive width, keeping all eight boxes exactly equal within each viewport.
- Increased the separation between the Critter identity/XP area and its 4×2 stat block, and anchored the stat block to the card's right edge so it aligns exactly with the right edge of the Relic matrix.
- Preserved the two-row layout on compact cards with 64px cells that right-align without horizontal overflow; roomy tablet and desktop cards reach 76px cells.
- Expanded the home-loadout regression to assert equal widths, the larger identity-to-stat separation, and exact stat-to-Relic right-edge alignment across seven viewports. `npm run test:home-loadout-layout`, `npm run test:responsive-shell-layout`, `npm run build`, and `git diff --check` pass; wide, desktop, mobile, and narrow-mobile renders were visually inspected, and the required real-app smoke client rendered the expected clean unauthenticated state.

## Exact Skill slot/popup sizing and power placement (2026-07-14)

- The clicked home Skill grid now passes its measured rendered width into the equip target, and the popup grid caps itself to that width so candidate tiles resolve to the exact same width, height, padding, typography, and icon sizes as the source slots.
- Restored `PWR X` to the top-right and kept Mana at the bottom-right in the shared Skill tile contract.
- Added a shared width-observed compact state for grids at 180px or narrower. Those tiles preserve the same four corners on both surfaces—element top-left, power top-right, name bottom-left, Mana bottom-right—without hiding the element icon or overflowing at 320px.
- Updated the focused parity and home layout regressions to require exact popup/source grid and tile dimensions, top-right power placement, compact child containment, icon visibility, and responsive scaling.
- Visually inspected matching desktop/compact slot-popup renders, the 390px and 320px home loadouts, mobile modal containment, and the required real-app smoke render. Final verification passes `test:skill-equip-layout`, `test:home-loadout-layout`, `test:collection-interaction-ui`, `test:responsive-shell-layout`, `typecheck`, `build`, and `git diff --check`.

## Stable three-digit Critter level geometry (2026-07-14)

- Reserved a fixed 82px level-label column, enabled tabular numerals, and increased the Level-to-XP separation to a responsive 12–16px so levels through `Level 999` never push the XP block.
- Made the Critter XP bar/number split fluid inside its fixed outer position, preserving readable, contained progress content from wide desktop through 320px narrow mobile.
- Expanded the home regression to snapshot every rendered element in the main-page layout, swap `Level 3` to `Level 999`, and require every box coordinate and dimension to remain unchanged across seven viewports. It also emits explicit three-digit screenshots and checks XP child containment.
- Visually inspected the `Level 999` desktop, mobile, and narrow-mobile renders. `npm run test:home-loadout-layout`, `npm run test:skill-equip-layout`, `npm run test:responsive-shell-layout`, `npm run build`, and `git diff --check` pass; the required real-app smoke client rendered the expected clean unauthenticated state.

## Larger Critter stats and collection Mana alignment (2026-07-14)

- Scaled equipped Critter stat cells and typography to 1.5× their previous size; narrower loadout cards reflow the eight equal cells to a two-column matrix so the larger boxes remain contained.
- Restored the collection Critter Mana cell to the same left-label/right-value alignment as the other seven stats.
- Updated the home and collection layout regressions to cover the enlarged geometry and exact Mana edge alignment across wide desktop, desktop, tablet, mobile, and 320px narrow-mobile layouts.
- Visually inspected the responsive home, collection, stat-detail, combat, and real-app smoke screenshots. Final verification passes `test:home-loadout-layout`, `test:collection-layout`, `test:collection-interaction-ui`, `test:responsive-shell-layout`, `build`, and `git diff --check`; the required web-game client rendered the clean configured authentication state with matching text output and no console errors.

## Relic-aligned equipped Critter stats (2026-07-14)

- Sized the equipped Critter stat grid from the same shared half-row calculation as the Relic matrix, making their total widths and right edges match exactly.
- Kept all eight stat cells identical in width and changed every cell to a left-aligned label with a right-aligned value.
- Added responsive 4×2, 2×4, and 1×8 stat matrices so the shared width remains readable on narrow loadout slots.
- Visually inspected wide desktop, desktop, iPad landscape, mobile, narrow-mobile, Skill equip parity, combat-shell, and real-app smoke screenshots. Final verification passes `test:home-loadout-layout`, `test:skill-equip-layout`, `test:responsive-shell-layout`, `build`, and `git diff --check`; the real-app browser client rendered the expected authentication state with matching text output and no console errors.
