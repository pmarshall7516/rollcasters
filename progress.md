Original prompt: Now, I want you to use all of these refined implementation documents to make the first version of my game. This should be functional for the most part with a decent bit of UI and feature polish. Seed initial data in the database, and use a database connection to pull all user and game catalog data. Do not seed any user data, as I will test the sign up and log in flows when the first version is built. In this repo, I have a .env file, and I can provide all needed database connection information to it, just let me know what else I need to add to this documentation or repo so you can go though implementation iterations of building and testing to refine a first version of this game.

## Skill and Ability point unlocks (2026-07-16)

- Current request: fix the collection-popup `unlock_critter_skill` schema-cache failure and make both Skill points and Ability points spendable on their authored unlocks.
- Confirmed the live schema had neither `unlock_critter_skill(uuid,text)` nor `unlock_rollcaster_ability(uuid,text)`. The Critter popup called the missing Skill RPC, while the Rollcaster popup had no Ability unlock action at all.
- Added secure transactional RPCs that lock the owned character row, validate the authenticated owner, authored character/Skill or Rollcaster/Ability association, level gate, point balance, and duplicate state, then atomically deduct the exact cost and persist the unlock. Anonymous execution is explicitly revoked.
- Added the missing Rollcaster Ability API call and collection-popup purchase action with busy/error states, point preflight copy, immediate refresh, and matching locked/unlockable presentation.
- Per user direction, migration 014 adds no Skill, Ability, or unlock-mapping catalog rows. Database and browser tests use a disposable Ability mapping only when no paid authored Ability exists, then remove it.
- Applied only migration 014 to the configured development database. Both functions are present in the live schema cache and the real signed-in popup flow successfully unlocked Headbutt with Skill points and a temporary-fixture Harden with Ability points, leaving 1 point in each balance.
- Added rollback-only database coverage for function privileges, cross-user ownership, authored association, level gates, insufficient balances, exact deductions, persistence, and retry safety. Added a disposable-user browser fixture that exercises both popup buttons, verifies database persistence, captures pre/post states, checks browser errors, and audits cleanup.
- Passed `npm run test:point-unlocks:db` before and after live application, `npm run test:point-unlocks:browser`, `npm run test:collection-interaction-ui`, `npm run test:collection-ui`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app web-game smoke client. Visually inspected both unlock controls, both unlocked popup states, and the smoke render; the final audit found zero temporary Ability mappings and zero disposable users.
- No outstanding TODOs for the unlock mechanism. Paid Ability mappings will become player-visible as the user authors them.

## Level progression point rewards (2026-07-16)

- Current request: ensure Critters receive authored Skill point grants and Rollcasters receive authored Ability point grants as they level, including already-saved level progression that missed rewards.
- Confirmed live Ramber is level 3 with 0 Skill points and a level-1 processed cursor despite authored level-2/3 grants of 1 + 2; live Roland has the equivalent missing Rollcaster rewards (2 + 2 Ability points).
- Added migration 013 with idempotent processed-level triggers for single/multi-level jumps and an additive backfill that preserves already-spent points.
- Added rollback-only database coverage for historic backfill, multi-level jumps, repeated level writes, later milestone rewards, point spending, and down-level/re-level idempotency.
- Applied only migration 013 to the configured development database. Ramber now persists 3 Skill points at level 3, Roland persists 4 Ability points at level 3, and both processed-level cursors are 3.
- Added a disposable-user signed-in browser fixture that levels Ramber/Roland through the real database triggers, reloads Collection, asserts the exact point-counter text, captures both cards, and cleans up the user.
- Passed `npm run test:progression-points:db` both before and after live application, `npm run test:progression-points:browser`, `npm run test:collection-ui`, `npm run test:collection-interaction-ui`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app web-game client smoke. Visually inspected the live-backed Ramber/Roland Collection cards and the real app auth render; zero progression-browser errors and zero disposable users remained.

## Gate challenge runtime (2026-07-15)

- Current request: review `docs/11-gate-challenges.md` and limit challenge tracking, progress, effective completion, and collectible unlocking until authored Gate Challenges are complete.
- Confirmed the pre-change runtime counted raw goal progress as completion, permitted blocked tracked challenges, and incremented stale tracked rows without gate eligibility checks.
- Added and applied migration 012 with contiguous Gate Order/threshold integrity checks, ordered eligibility/effective-completion evaluation, `CHALLENGE_GATED` tracking enforcement, stale tracking reconciliation/slot compaction, combat-time eligibility checks, gate-aware unlock counting, explicit snapshot state, authoring snapshot support, safe Gate Order swaps, and progress-preserving gate/sort edits.
- Added Gate badges plus blocked/goal-reached/complete UI states. Blocked Tracked rows expose no Track action and never appear in the Home tracking HUD; full blocked Global/Shop numerators remain visible without completed styling.
- Added rollback-only database coverage for malformed gates, threshold bypasses, full-but-blocked later gates, Gate Order swaps, progress preservation, stale combat tracking, immediate reevaluation, post-eligibility progress, and final unlock. Added a disposable signed-in browser fixture for blocked-to-eligible tracking and visually inspected clean modal/panel/HUD captures with zero browser errors.
- Passed `npm run typecheck`, `npm run build`, `npm run test:collectibles-shop`, `npm run test:gate-challenges:db`, `npm run test:collection-interaction-ui`, `npm run test:collection-layout`, `npm run test:responsive-shell-layout`, browser fixture logic/visual checks, script syntax checks, and `git diff --check`.
- The separate generic web-game client smoke could not launch because the desktop approval service reported its usage limit. The feature-specific real-app Playwright pass completed before that restriction and covered signed-in game state, screenshots, and console errors.

## Currency balance hover tooltips (2026-07-15)

- Added a custom hover/focus tooltip for each header currency using the exact accessible balance label (`<currency name>: <owned amount>`) and the currency's computed authored text color.
- Rendered the tooltip outside the horizontally scrollable currency cluster so it remains visible instead of being clipped, and removed the competing name-only native title.
- Kept one persistent, directly positioned tooltip node so hover updates do not re-render the header's transparent logo/currency assets; currency PNGs also use ordinary contained positioning inside their fixed 24px frames.
- Expanded the disposable signed-in browser fixture to assert Coins and Prismite tooltip visibility, exact formatted text, authored colors, direct pill-to-pill hover updates, loaded icons, and zero app errors. Direct sequential screenshots retain a known Chromium transparent-layer tiling artifact, so the already-asserted Prismite state is recaptured on a fresh paint surface; headed normal-compositor screenshots for both states were inspected cleanly.
- Passed `npm run typecheck`, `npm run build`, `npm run test:collectibles-shop`, `npm run test:responsive-shell-layout`, the signed-in browser fixture under the bundled Node runtime, `git diff --check`, and the required real-app web-game client smoke render with matching auth text state and no errors.

## Starter selection 50-shard equivalence (2026-07-15)

- Traced starter collection popup progress to `user_collectible_shards`; the live `select_starter_critter` RPC granted ownership but did not create the equivalent shard balance.
- Added migration 011 to atomically grant at least 50 shards during starter selection and safely backfill historic starters identified by their matching unlock/selection timestamps.
- Added rollback-only database coverage for starter IDs 001, 004, and 007 plus a disposable signed-in browser assertion that the selected starter popup renders the shard challenge as complete at 50 / 50.
- The first browser pass reached Collection but exposed an ambiguous fixture selector because other challenge copy can mention starter ID 001; narrowed the locator to the card's direct collectible-ID badge before rerunning.
- The corrected shared browser scenario passed the new starter selection/popup assertions and produced the expected 50 / 50 completed-state screenshot, then failed later on an unrelated pre-existing Shop hover-glow assertion. Added a focused disposable-user browser scenario for all three starter IDs so this feature can be verified without the unrelated Shop tail.
- The first focused run passed its DOM/database assertions with no browser errors. Visual inspection found a Chromium full-page compositing artifact in the 001 overlay capture, so feature screenshots now use the visible viewport containing the complete challenge panel.
- Viewport capture fixed 001, but 004 still showed random black compositing bands under forced SwiftShader/ANGLE despite correct DOM values. Removed those unnecessary WebGL flags from this focused UI-only fixture before the final visual rerun.
- Standard headless Chromium produced two clean captures but one intermittent backdrop-filter artifact. Added an opt-in headed mode for the fixture so the visual QA pass can use the normal compositor while CI remains headless.
- Headed Chromium reproduced the same intermittent banding on 004, indicating post-modal paint timing rather than headless-only rendering. Added a 750ms paint settle before screenshots and explicit failed-response URL capture for the final run.
- The paint settle produced clean 001/004 images, but the third sequential browser context still showed intermittent bands. Isolated each starter scenario in a fresh Chromium process to match independent player sessions and avoid cross-context compositor residue.
- Fresh processes confirmed the opaque bands come from Chromium screenshot tiling of the full-screen backdrop blur. The fixture now disables only modal backdrop/header blur after all DOM and state assertions pass, preserving the feature visuals while stabilizing screenshot evidence.
- The post-open blur override could leave already-created compositor tiles behind, so the capture-only override now loads before opening the modal.
- Whole-viewport captures could still include opaque Chromium tiles outside or across the overlay. Switched visual evidence to direct native-size `.modal` screenshots with animations disabled, which contain the complete requested popup without unrelated page compositor layers.
- Direct modal capture showed that 004's transparent sprite can still corrupt unrelated tiles on the same Chromium surface. Narrowed final screenshots to the exact requested challenge panel: owner name, completed count, completed styling, and 50 / 50 progress.
- The 004 tile followed Spreagle's transparent PNG even in an isolated panel capture. Excluded sprite-image layers from the capture-only stylesheet; the exact challenge panel contains no sprite art and remains visually unchanged.
- For deterministic final visual evidence, the already-asserted live challenge panel is detached into an otherwise empty document immediately before its element screenshot, removing every unrelated compositor layer.
- Applied only migration 011 to the configured development database. The existing selected Critter 001 was backfilled and now returns 50 shards plus 50 / 50 completed challenge progress.
- Rollback-only database coverage passed for starter IDs 001, 004, and 007, including exact 50-shard grants, completed goals, squad placement, and idempotent retries.
- The final focused browser run selected all three starters with separate disposable users and verified persisted quantity 50, `1 complete`, the completed row class, `50 / 50`, and zero browser errors; its cleanup audit returned zero disposable users/offers.
- Passed `npm run typecheck`, `npm run build`, `npm run test:collectibles-shop`, `npm run test:collection-interaction-ui`, migration 011 dry-run selection, `git diff --check`, and the required real-app web-game client smoke render with matching auth text state.

## Right-aligned popup challenge progress (2026-07-15)

- Moved collection-detail challenge actions ahead of the numeric progress column so every progress value reaches the same right content edge, including rows without a Track action.
- Preserved the compact desktop row and the responsive full-width action row on narrow screens with explicit grid areas.
- Expanded the collection-interaction fixture to assert exact progress-edge alignment and action placement on desktop and mobile; both renders were visually inspected. `npm run test:collection-interaction-ui`, `npm run typecheck`, `npm run build`, and `git diff --check` pass, and the required real-app web-game client rendered the clean configured authentication state with matching text output.

## Flattened Shard offer diamonds (2026-07-15)

- Treating the user's final clarification/reference image as applying the flattened diamond frame to Shard Shop offers; Relic Shop offers retain their rounded square SpriteFrame.
- Suppressed catalog descriptions containing the generated `Shop offer for` template on both Shop tabs while preserving genuinely authored custom descriptions.
- Replaced the jagged Shard outline with a transparent 1.7:1 diamond and intentionally oversized the contained collectible Sprite so its top/bottom edges crop slightly within the frame.
- Moved the Shard hover glow to layered SVG border strokes instead of CSS filters on the Sprite/wrapper; this keeps the art unglowed and avoids the Chromium compositing artifact reproduced during the first hover screenshot pass.
- Expanded the signed-in shop fixture to assert hidden generated descriptions, exact diamond geometry, no pre-hover glow, outline-only hover activation, unchanged Sprite/wrapper filters, preserved sold-out states, square Relic frames, and zero browser errors.
- Passed `npm run typecheck`, `npm run test:collectibles-shop`, the live collectibles-shop browser fixture under the bundled Node runtime, `npm run test:sprite-containment`, `npm run build`, and `git diff --check`. Visually inspected normal/hovered/owned Shard diamonds, hovered Relic offers, desktop/mobile sprite containment, and the required web-game client smoke render; cleanup finished with zero disposable offers or Auth users.

## Dynamic top-bar currencies (2026-07-15)

- Confirmed the live active catalog contains Coins (sort 0) and Prismite (sort 2), while the current user ledger only contains Coins; the previous header filter therefore hid Prismite entirely.
- Added active-catalog currency ordering with the default currency first and zero-balance fallback behavior, plus an additive schema/RPC migration that returns every active currency in the player snapshot.
- Added an optional validated `text_color` currency field and Content Studio save support; Coins defaults to `#FFD65A` and Prismite to `#7DE8FF`, chosen from their actual sprites.
- Updated the header to render every active currency in order, apply authored text colors, preserve accessible balance labels, and move currency-heavy/narrow layouts onto a non-overlapping second header row.
- Applied only migration 010 to the configured development database. The live catalog now returns Coins/Prismite with their authored colors, and the player snapshot returns balances `24`/`0` respectively even though Prismite has no materialized ledger row.
- Expanded the responsive header fixture to cover four ordered/colorized currencies at desktop, tablet, and mobile widths, including overflow safety and non-overlap with the logo and account controls.
- Expanded the disposable signed-in browser fixture to require real Coins/Prismite sprites, exact zero-balance labels, authored text colors, matching text game state, and clean browser errors; its cleanup audit found zero disposable offers or Auth users.
- Passed `npm run typecheck`, `npm run build`, `npm run test:collectibles-shop`, `npm run test:collectibles-shop:db`, the live collectibles-shop browser fixture under the bundled Node runtime, `npm run test:responsive-shell-layout`, migration dry-run, and `git diff --check`. Visually inspected the live signed-in Coins/Prismite header, four-currency desktop/mobile stress fixtures, and required web-game client smoke render.

## Shop offer sold-out and hover treatment (2026-07-15)

- Made Shard offer artwork sit in a transparent shard-shaped frame, removing the nested square Sprite background/border while retaining a thin shard outline for hover-glow geometry.
- Added explicit sold-out presentation only for already-unlocked Shard offers and Relic offers that would exceed `max_owned`; ordinary locked, underfunded, and otherwise unavailable offers keep their existing presentation.
- Added offer-card border glows on hover/focus, square SpriteFrame glows for Relics, and shard-contour glows for Shard offers.
- Expanded the disposable signed-in browser fixture to buy an owned Relic repeatedly through `max_owned`, verify it remains enabled below the cap, and assert the greyed maximum-owned state at the cap. The same run unlocked a Shard offer and verified its transparent nested Sprite, transparent shard background, disabled grey button/card, red `Already unlocked` text, and hover glows.
- Passed `npm run test:collectibles-shop`, the live collectibles-shop browser fixture under the bundled Node 24 runtime, `npm run test:sprite-containment`, `npm run typecheck`, `npm run build`, and `git diff --check`. Visually inspected active/owned Shard offers, active/max-owned Relic offers, both hover states, sprite containment, and the required web-game client smoke render; no browser errors were captured, and the final cleanup audit found zero disposable catalog rows or Auth users.

## Compact background-refresh indicator (2026-07-15)

- Removed the page-width game-data loading notice shown below the Rollcasters logo during loadout and other background mutations.
- Added a compact animated refresh status in the signed-in header's top-left cell, aligned with the currency, username, and logout controls while preserving the centered logo.
- Added responsive-shell coverage for indicator placement, animation, accessible status copy, mobile compaction, and the absence of the old loading notice.
- Passed `npm run typecheck`, `npm run build`, `npm run test:responsive-shell-layout`, `npm run test:home-loadout-layout`, and `npm run test:collection-interaction-ui`; also ran the required real-app web-game client and visually inspected desktop, mobile, loadout, equip-dialog, and unauthenticated app screenshots.

## Collection lower-content alignment (2026-07-15)

- Added a shared bounded state track to Critter and Relic cards so owned progression, authored unlock challenges, and the non-unlockable message cannot shift content below them.
- Anchored Critter stat grids and Relic effect previews to explicit card rows; Relic effect previews now reserve a consistent 96px area so every first effect row begins at the same vertical offset.
- Expanded the collection layout fixture to cover owned, locked/unlockable, and not-currently-unlockable cards and assert Critter stat and Relic first-effect alignment across six responsive viewports.
- Passed `npm run test:collection-layout`, `npm run typecheck`, `npm run build`, and `git diff --check`; visually inspected the desktop/mobile alignment fixtures and the required real-app Playwright smoke render with no captured app errors.

## Persistent Rollcasters logo (2026-07-15)

- Traced intermittent text-only branding to `BrandLogo`, which intentionally rendered a “Rollcasters” text fallback until the Supabase-hosted image loaded and after any image error; session/data loading screens also omitted the logo.
- Added the existing full Rollcasters logo as a bundled frontend asset, switched every brand surface to that local image, removed the text fallback states, and added the logo to session/data loading panels.
- Removed the logo's CSS drop-shadow filter after the required live login-to-signup transition reproduced a Chromium compositing failure that masked the center of the transparent PNG after rerendering.
- Updated responsive shell coverage to require a loaded, unfiltered image logo and reject the old text-fallback element.
- Passed `npm run typecheck`, `npm run build`, `npm run test:responsive-shell-layout`, and `git diff --check`; visually inspected the real login and signup screens plus authenticated-shell desktop/mobile fixtures. The required web-game client reported the auth state correctly and captured no browser errors.

## Rollcaster Ability unequip fix (2026-07-15)

- Traced the main-page `Unable to update loadout.` failure to the live `set_rollcaster_ability_slot` RPC, whose older definition still rejects removing the final equipped Ability even though the current loadout UI and later direct-removal migration support empty Ability slots.
- Added an additive migration that preserves ownership, unlock, duplicate, and slot-lock validation while allowing any individual Ability slot to be cleared.
- Updated loadout error handling to surface structured Supabase error messages instead of replacing them with the generic fallback.
- Applied only migration 009 to the configured development database. A rollback-only authenticated database test cleared the sole equipped Ability and verified the slot became empty, then restored the original player loadout.
- Passed `npm run typecheck`, `npm run build`, `npm run test:collection-interaction-ui`, `npm run test:home-loadout-layout`, migration dry-run, and `git diff --check`; visually inspected the Ability interaction fixture, responsive main page, and required real-app web-game smoke render.

## Main-page compact actions and separate challenge tracking (2026-07-15)

- Moved Challenge Tracking out of the Active Rollcaster card and into its own bordered pane directly below the Rollcaster pane.
- Restored the intended compact Play, Collection, and Shop button heights by preventing the main-actions grid from stretching to the full squad-column height.
- Expanded the responsive home layout regression to assert the separate pane geometry and maximum 90px desktop / 68px responsive menu-button heights across seven viewports.
- Passed `npm run test:home-loadout-layout`, `npm run build`, and `git diff --check`; visually inspected the desktop and mobile main-page fixtures and the required real-app Playwright smoke render with no captured app errors.

## Shop and unlockable-collectibles implementation planning (2026-07-15)

- Audited `docs/09-shop-implementation.md`, `docs/10-unlockable-collectibles.md`, `supabase/migrations/005_collectibles_and_shop.sql`, the current React/Supabase integration, and the connected development database without mutating game or user data.
- Confirmed the player client does not yet load currencies, shop entries, collectible requirements/challenges, shard balances, challenge progress, or tracked challenges. Shop remains disabled, the header reads legacy `profiles.coins`, collection cards show generic locked states, and combat is resolved client-side before `resolve_dungeon_run` grants rewards.
- Confirmed migration 005 supplies catalog/player tables plus purchase and track/untrack RPCs, but does not supply the required unlock evaluator, canonical reusable collectible grant functions, durable unlock-event outbox, idempotent purchase receipts, or idempotent server-authoritative combat-event ingestion.
- Connected-data audit: Coins is the only currency; the existing profile has a matching Coins ledger with no mismatch; there are no shard, challenge-progress, or tracked rows. Cragram (Critter 002) is configured to require owning Ramber (001) plus reaching Ramber level 20, while Ramber currently has progression authored only through level 5. The final catalog audit also found four active offers (one Shard, three Relic); offers without their required Shop challenge correctly render with an unavailable reason.
- Migration-history warning: the worktree currently deletes the committed `005_dev_collectible_commands.sql` and `006_collection_progression_and_loadout.sql` while adding an untracked `005_collectibles_and_shop.sql`; the live database still contains functions/triggers from those deleted migrations. Normalize the additive migration lineage before implementing or deploying another environment.
- Recommended implementation order: normalize migration history; add server runtime/evaluator/outbox/idempotency APIs; extend TypeScript data models and bootstrap; add collection challenge UI/tracking/unlock notifications; add the routed shop/currency pills/purchase states; integrate authoritative structured combat events; then run SQL, unit, layout, Playwright, live-authenticated, concurrency, and retry verification.

## Shop and unlockable-collectibles implementation (2026-07-15)

- Added and applied `006_collectibles_and_shop_runtime.sql`: canonical collectible grants, derived progress snapshots, fixed-point unlock evaluation, durable unlock events, retry-safe purchase receipts, active-content purchase validation, idempotent combat-event ingestion, automatic evaluator triggers, RLS, and authenticated RPCs. Added/applied `007_collectibles_shop_safe_catalog.sql` for exact bigint JSON strings and `008_fix_collectible_unlock_alias.sql` for an evaluator alias collision caught by integration testing.
- Extended frontend contracts/bootstrap for currencies, shop entries, unlock requirements/challenges, shard balances, challenge progress, tracking slots, purchase receipts, and pending unlock events using 64-bit-safe strings for balances, prices, goals, and receipts.
- Added URL-backed Shop navigation, active currency pills, grouped Shard/Relic shop cards, disabled Lootbox information architecture, search/empty states, shard-shaped full-art frames, server-derived purchase states, and non-optimistic purchase feedback.
- Added collection challenge rows, interactive detail histories, three main-page tracking slots, durable unlock notifications, and structured combat progress events for actual HP loss, knockouts, successful Skill uses, and attributable status damage.
- Added focused business-rule/runtime tests plus a rollback-only database integration suite covering bigint serialization, insufficient funds, atomic balance deduction, final-bundle overflow/discard, Relic `max_owned`, atomic grants, receipt retry idempotency, combat-event deduplication, tracked progress, unlock cleanup, outbox delivery, and RPC privileges.
- Ran a disposable signed-in browser scenario that created and cleaned up its own Auth user/content rows; visually verified locked challenge details, Track/Untrack, all three HUD slots, both enabled shop tabs, shard purchase progress, currency pills, and the unlock popup with no browser errors. A cleanup audit confirmed zero disposable rows/users remained.
- Passed `npm run test:collectibles-shop`, `npm run test:collectibles-shop:db`, `npm run test:collectibles-shop:browser`, `npm run test:effect-runtime`, `npm run test:collection-ui`, `npm run test:effect-ui`, `npm run test:collection-layout`, `npm run test:home-loadout-layout`, `npm run test:skill-equip-layout`, `npm run test:responsive-shell-layout`, `npm run test:collection-interaction-ui`, `npm run test:sprite-containment`, `npm run typecheck`, `npm run build`, `npm run db:migrate:dry`, and `git diff --check`. Also ran and visually inspected the required web-game client smoke render.

## Main-page empty squad slot consistency (2026-07-15)

- Made the squad grid use equal-height rows so every empty squad slot always matches occupied squad slot dimensions across responsive layouts.
- Replaced the empty squad slot's circled text glyph with the same Lucide Plus icon and sizing class used by empty relic slots.
- Expanded the home loadout layout regression fixture to cover an occupied and empty squad slot together and assert equal dimensions plus shared icon treatment.
- Verified exact width/height equality across seven responsive viewports from 1920px desktop through 320px mobile, visually inspected desktop/mobile screenshots, passed `npm run build` and `git diff --check`, and completed the required real-app Playwright smoke render without captured app errors.

## Fixed critter squad slot geometry (2026-07-15)

- Authenticated as the supplied Patrick account and measured the live Ramber slot at 696.34×454.27px in the 1280×720 app viewport.
- Replaced equal-fraction grid stretching with an explicit shared squad-slot height synchronized from the first occupied slot, recalculated when the responsive squad width or equipped-slot set changes.
- Anchored occupied cards to a stable summary/equipment row structure so later equipped Critters use identical sprite, stat, Skill, and Relic coordinates.
- Expanded the responsive home regression to render two occupied Critters plus an empty slot and compare every external dimension and internal anchor.
- Confirmed the authenticated Patrick page now exposes a shared `454.27px` slot height at 1280×720; Ramber and both empty slots each render at exactly 696.34×454.27px with no browser warnings/errors.
- Passed `npm run build`, the seven-viewport `npm run test:home-loadout-layout` suite, `git diff --check`, and the required real-app web-game smoke render; visually inspected laptop and mobile two-equipped-plus-empty fixtures.

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

## Compact gated-challenge collection cards (2026-07-16)

- Current request: remove compact collection-card Gate pills, prevent large challenge lists from being clipped while preserving card/section height, update the ungated blocker copy, and render challenges Gate 1 → Gate 2 → ungated regardless of Content Studio insertion order.
- Removed Gate pills only from compact collection-grid challenge rows; the detail popup retains Gate pills where the extra hierarchy is useful.
- Changed shared challenge ordering to sort gated challenges by ascending `gate_order`, then by authored `sort_order`/ID within a gate, with all ungated challenges last. Updated the blocked ungated copy to `Complete all above challenges first` everywhere.
- Converted the fixed collection-card state track from clipped overflow to a bounded vertical scroll pane with wheel/touch support, scroll snapping, contained overscroll, and hidden scrollbars in WebKit, Firefox, and legacy Edge. Card heights, Critter stat offsets, and lower content alignment remain unchanged.
- Expanded unit coverage for shuffled gate/sort input, the responsive collection fixture with eight wrapping challenges and real wheel input, and the live disposable-user gate fixture with compact-card pill absence, row order, updated copy, loaded artwork, popup state, tracking eligibility, and cleanup.
- Passed `npm run test:collectibles-shop`, `npm run test:collection-layout` across six responsive viewports, `npm run test:gate-challenges:browser` with zero browser errors, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app web-game smoke client. Visually inspected the compact live gated Critter card, blocked/eligible popup states, tracking HUD, full grids, top/bottom challenge-pane states on desktop/mobile, and the unauthenticated smoke render.
- No outstanding TODOs for this UI change.

## Collection-card challenge tracking (2026-07-16)

- Current request: allow eligible Trackable challenges to be tracked directly from collection grid cards.
- Added compact Track/Untrack actions to locked collectible challenge rows. Actions honor gate eligibility, effective completion, the three-slot global limit, one-tracked-challenge-per-collectible replacement behavior, busy states, and the same safe RPC error messages as the detail popup.
- Replaced collection grid cards' outer button elements with semantic article containers so challenge actions are valid standalone buttons rather than nested controls. Whole-card pointer navigation remains intact, and every card now has a small keyboard-accessible details button.
- Wrapped Rollcaster card progression/challenges in the same fixed scroll track used by Critters and Relics, preserving card height and hidden-scrollbar behavior across all collection tabs.
- Expanded the responsive collection fixture to cover article semantics, zero nested buttons, details controls, Track/Untrack pressed states, containment, and eight-action scrolling at six viewports.
- Expanded the disposable live gate scenario to prove blocked rows expose no action, final-gate completion reveals an enabled grid Track action, tracking does not open the modal, the card refreshes to Untrack, the detail popup reflects Slot 1, and the home HUD receives the challenge. The run completed with zero browser errors and cleaned up its disposable user/content.
- Passed `npm run test:collectibles-shop`, `npm run test:collection-layout`, `npm run test:gate-challenges:browser`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app web-game smoke client. Visually inspected desktop/mobile action grids, scrolled panes, blocked/trackable/tracked live card states, popup synchronization, the tracking HUD, and the clean authentication smoke render.
- No outstanding TODOs for this interaction.

## Collection-card challenge row alignment (2026-07-16)

- Current request: keep every compact challenge description and its progress value on the same row, without allowing progress from a blocked challenge to rise beside the `Complete all above challenges first` message.
- Split blocker/status copy, challenge description, progress, and tracking action into explicit grid areas. Blocker copy now owns a full-width row above its challenge, while the description and progress share the next row and the Track/Untrack action remains below the progress value.
- Added responsive geometry assertions that require description/progress top-edge alignment and require the blocker row to remain above both. The live gated-content browser scenario now verifies the same layout against real challenge data.
- Passed the six-viewport `npm run test:collection-layout` suite and the disposable-user `npm run test:gate-challenges:browser` scenario with zero browser errors. Visually inspected desktop/mobile wrapping, the scrolled hidden-scrollbar pane, and blocked, trackable, and tracked live collection-card states.
- No outstanding TODOs for this alignment fix.

## Single moving challenge-gate boundary (2026-07-16)

- Current request: show `Complete all above challenges first` only once before the currently locked portion of an ordered challenge list, move it below each newly completed gate, and remove it after the final gate completes.
- Replaced per-row compact blocker copy with one shared boundary inserted before the first challenge whose player snapshot reports `eligible === false`. Blocked rows retain their muted state and tracking restrictions without repeating the message.
- Applied the same single-boundary behavior to the challenge detail panel while retaining Gate badges on individual gated rows.
- Expanded the responsive fixture to assert exactly one boundary before a contiguous locked group and preserved description/progress row alignment.
- The live disposable fixture now contains Gate 1, Gate 2, and two ungated challenges. It proves the single boundary starts between Gate 1/Gate 2, moves between Gate 2/ungated after Gate 1 completes, disappears after Gate 2 completes, and then exposes grid-card tracking. Grid and detail rows never duplicate the blocker copy, description/progress alignment remains exact, and the run reports zero browser errors.
- Passed `npm run test:collection-layout` across six viewports, `npm run test:gate-challenges:browser`, `npm run test:collectibles-shop`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app smoke client. Visually inspected initial, moved, and removed boundary states, the blocked and eligible detail panels, desktop/mobile scroll panes, and the clean auth smoke render.
- No outstanding TODOs for this boundary behavior.

## Slim collection challenge scrollbar (2026-07-16)

- Current request: when a collectible card has more challenges than its fixed-height pane can show, display a very slim, sleek oval scrollbar to the right of the challenge progress values.
- Replaced platform-dependent native overlay scrollbars—which macOS can auto-hide even when authored—with a measured in-card scrollbar that renders only when `scrollHeight` exceeds the fixed pane height.
- Added a subtle 2px oval track and a visible 4px violet-to-cyan pill thumb inside a 10px interaction area. Challenge panes reserve 10px to the right of progress values, so the thumb never overlaps numbers or Track/Untrack controls.
- The thumb follows wheel/touch scrolling, supports track clicks and pointer dragging, exposes current/max values through an accessible scrollbar role, and supports Arrow, Page, Home, and End keys. Resize observation keeps thumb size and overflow visibility synchronized as challenge data changes.
- Expanded the six-viewport regression to require overflow-only rendering, exact track/thumb geometry, 999px rounding, progress clearance, hidden native scrollbars, real wheel movement, and synchronized top/bottom captures. The disposable live gate scenario verifies the same geometry with real challenge data plus thumb movement and Home/End behavior, and reports zero browser errors.
- Passed `npm run test:collection-layout`, `npm run test:gate-challenges:browser`, `npm run test:collectibles-shop`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app smoke client. Visually inspected desktop/mobile top and bottom states, the real gated card and moving gate boundary, and the clean auth smoke render.
- No outstanding TODOs for this scrollbar behavior.

## Inline compact challenge tracking action (2026-07-16)

- Current request: keep collection-grid Track buttons small and place them on the same row as their challenge description.
- Changed compact challenge rows to one three-column grid: flexible description, tabular progress, and a fixed 46×20px Track/Untrack action at the far right. Long descriptions may wrap within their own column without pushing progress or the action onto a staggered second row.
- Expanded responsive and live gated-card geometry checks to require identical description/progress/action top positions, rightward action order, exact compact button dimensions, card containment, and preserved scrollbar clearance.
- The six-viewport collection suite and disposable live gate scenario pass. Visual inspection confirms Track and Untrack remain inline and small on desktop/mobile and with real challenge copy, while gate boundaries, wrapped descriptions, progress alignment, fixed card heights, and the slim overflow scrollbar remain clean. The live interaction refreshes to Untrack without opening the detail modal and reports zero browser errors.
- Passed `npm run test:collection-layout`, `npm run test:gate-challenges:browser`, `npm run test:collectibles-shop`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app smoke client.
- No outstanding TODOs for this inline action layout.

## Consistent locked-card challenge scrollbar (2026-07-16)

- Current request: show the slim challenge scrollbar on every locked collectible grid card, using a full-height thumb when the challenge pane does not need to scroll.
- Added an explicit locked-card scrollbar state to Rollcaster, Critter, and Relic collection cards. Overflowing panes retain the proportional moving thumb; non-overflowing panes render the same 4px thumb across the full track and expose it as disabled/non-interactive. Owned cards remain scrollbar-free.
- Changed scrollbar clearance to follow the locked-card state rather than challenge-row presence, so `Not currently unlockable` and short challenge panes receive the same consistent right-side treatment without overlap.
- Expanded responsive and disposable live-card coverage to require one scrollbar on every locked card, no scrollbar on owned cards, exact track/thumb widths, full-height disabled thumbs for non-overflow, and proportional enabled thumbs for overflow.
- Passed `npm run test:collection-layout` across six responsive viewports and `npm run test:gate-challenges:browser` with zero browser errors. Visual inspection confirms full-height pills on non-overflowing locked cards, proportional pills on scrolling challenge panes, consistent treatment across locked collectible types, and no scrollbar on owned cards.
- Passed `npm run test:collectibles-shop`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app web-game smoke client. The fresh app rendered its clean unauthenticated state successfully.
- No outstanding TODOs for this consistency change.

## Collection-card Track button placement (2026-07-16)

- Current request: place compact collection-grid Track/Untrack controls to the left of challenge progress values and vertically center them with the challenge description and progress.
- Reordered the compact challenge grid to description → action → progress and changed row alignment from top-aligned to vertically centered.
- Updated responsive and live gate-challenge geometry coverage to compare vertical centers and enforce that every compact action ends before its progress value begins.
- Passed `npm run test:collection-layout` across six responsive viewports, `npm run typecheck`, `npm run build`, and the required real-app web-game smoke client. Visually inspected desktop/mobile collection renders, the scrolled challenge panes, and the clean unauthenticated smoke render.
- No outstanding TODOs for this layout change.

## Light-purple compact tracking buttons (2026-07-16)

- Current request: make compact collection-card Track buttons light purple and ensure both `Track` and `Untrack` fit completely.
- Changed the compact control to a high-contrast light-lavender treatment with a brighter hover/focus state and a distinct light-purple tracked state.
- Increased the fixed width from 46px to 60px, added explicit nowrap behavior, and preserved the existing 20px compact height and vertical alignment.
- Expanded responsive and live gate-challenge coverage to assert both button colors, exact width, nowrap behavior, and full label containment.
- Passed `npm run test:collection-layout` across six responsive viewports, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app web-game smoke client. Desktop/mobile collection screenshots confirm the complete Track/Untrack labels remain visible; the smoke render and text state show a clean unauthenticated app with no captured errors.
- No outstanding TODOs for this button treatment.

## Critter two-Element types (2026-07-16)

- Current request: fully implement `docs/13-two-types.md` so every Critter has required ordered Element 1 plus optional distinct Element 2.
- Restored the missing idempotent `009_two_critter_elements.sql` contract: canonical columns, generated deprecated alias, cascading foreign keys, distinct-slot constraint, slot indexes, dual-slot aggregate save validation, and dual-slot Element usage.
- Replaced the player model's deprecated `element_id` with canonical `element_1_id`/`element_2_id`, added mixed-schema boundary normalization plus unknown/duplicate diagnostics, and exposed ordered membership/filter helpers.
- Added one accessible reusable ordered logo group and applied it to starter cards, home/loadout and equip views, collection cards/details, Shop Critter targets, combat/target/reward presentation, and unlock notifications. One-type Critters reserve no second gap; compact/mobile views retain both; Skill logos remain single-type.
- Collection Element filtering now matches either slot and flat results remain unique. `render_game_to_text` exposes ordered Element IDs for combat units.
- Preserved existing combat results by continuing to use Element 1 anywhere the pre-change runtime used the legacy primary alias; Element 2 is classification/presentation data until a later combat contract.
- Added rollback-only database coverage for idempotency, schema metadata, alias compatibility, constraints, validation, persistence, cascading foreign keys, and secondary-slot usage. Added a disposable-user live browser fixture for starter, home, Collection, Element-2 filtering, details, mobile, Skill-logo isolation, browser errors, and cleanup.
- Passed `npm run test:two-critter-elements:db`, `npm run test:two-critter-elements:browser`, `npm run test:effect-runtime`, `npm run test:collection-ui`, `npm run test:collectibles-shop`, `npm run test:home-loadout-layout`, `npm run test:collection-layout`, `npm run test:collection-interaction-ui`, `npm run build`, script syntax checks, `git diff --check`, and the required web-game smoke client.
- Visually inspected dual-logo home, filtered Collection, detail, and mobile states plus responsive regressions and the final auth smoke render. The live cleanup audit confirmed Critter 001 was restored to its original one-type state and zero disposable users remained.
- No outstanding TODOs for two-Element Critter support.

## Starter Rollcaster selection (2026-07-17)

- Current request: add a Rollcaster selection step before starter Critter selection, driven by game data, with all three starter Rollcasters shown in one card row alongside their name, portrait, description, and starter Ability; selecting one must grant its full 20 shards.
- Audited the live catalog: active Rollcasters 001 Roland, 002 Pippa, and 003 Chance each have one free level-1 Ability and an authored 20-shard unlock challenge.
- Added migration 016 with `starter_rollcaster_options`, `profiles.starter_rollcaster_selected_at`, historical-player backfill, 20-shard equivalence, a transactional `select_starter_rollcaster` RPC, removal of the automatic Roland grant for new players, and database enforcement that Rollcaster selection precedes Critter selection.
- Added the two-step client onboarding state, explicit text-game-state stages/options, and a responsive first-step row of portrait cards with Rollcaster names, descriptions, starter Ability summaries, authored effect text, and selection actions.
- Applied only migration 016 to the configured development database. The live audit reports all three starter options with their exact 20-shard challenges/default Abilities, zero owned starter Rollcasters missing a selection timestamp, zero historical starters below 20 shards, authenticated-only selection RPC access, and zero disposable browser users.
- Expanded rollback-only database coverage for no automatic Roland grant, Rollcaster-before-Critter enforcement, all three starter Rollcasters, 20/20 shard completion, active selection, default Ability unlock/equip, retry safety, all three starter Critters, and 50/50 completion.
- Expanded the disposable-user browser fixture to select each Rollcaster with a paired Critter, assert the single desktop row and complete card copy, validate `render_game_to_text`, persist 20/50 shards, verify active Rollcaster/default Ability state, inspect both completed collection challenges, and clean up every user. Updated all other disposable-user browser fixtures to traverse the new first onboarding step.
- Passed `npm run test:starter-selection:db`, the live starter-selection browser fixture with zero browser errors, `npm run test:effect-runtime`, `npm run test:collection-ui`, `npm run test:collectibles-shop`, `npm run test:responsive-shell-layout`, `npm run test:collection-layout`, `npm run test:home-loadout-layout`, `npm run test:collection-interaction-ui`, `npm run typecheck`, `npm run build`, script syntax checks, migration dry-run selection, `git diff --check`, and the required web-game client.
- Visually inspected the clean Rollcaster and Critter starter screens plus the final auth smoke render. No outstanding TODOs for starter Rollcaster selection.

## Main-page occupied Critter box reference (2026-07-17)

- Current request: create `docs/20-critter-box-ui.md` as a detailed reproduction contract for the occupied main-page Critter box.
- Documented the exact component hierarchy, dynamic squad-height synchronization, sprite/name/ordered Element/level/XP layout, eight-stat matrix, persistent Relic and active-Ability modifier calculation, positive/negative/mixed colors, hover/focus breakdowns, four-Skill grid, ten-cell Relic state matrix, equip-dialog behavior, responsive container queries, accessibility, data dependencies, implementation examples, and acceptance checklist.
- Ran `npm run test:home-loadout-layout` across all seven responsive viewports and visually inspected the wide, mobile, and 320px results. The first sandboxed Chromium launch was blocked by macOS Mach-port permissions; the approved unrestricted rerun passed.
- Passed `npm run test:collection-ui`, `npm run test:collection-interaction-ui`, and `git diff --check`; visually inspected the focused mixed-modifier tooltip and exact positive/negative/mixed colors. The required real-app web-game client rendered the clean unauthenticated screen with matching text state.
