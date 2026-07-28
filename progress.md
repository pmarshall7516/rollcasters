Original prompt: Now, I want you to use all of these refined implementation documents to make the first version of my game. This should be functional for the most part with a decent bit of UI and feature polish. Seed initial data in the database, and use a database connection to pull all user and game catalog data. Do not seed any user data, as I will test the sign up and log in flows when the first version is built. In this repo, I have a .env file, and I can provide all needed database connection information to it, just let me know what else I need to add to this documentation or repo so you can go though implementation iterations of building and testing to refine a first version of this game.

Current request (2026-07-28): Display passive and combat action-cost modifiers in loadout/combat UI; show source tooltips with cost-aware colors; make Critter/Rollcaster collection detail XP bars match the challenge panel width and move points inline with Skills/Abilities.

- Added shared action-cost breakdown helpers used by combat validation/display and loadout previews. Discounts render green, increases red, and source rows retain names such as `-1 (Mana Talisman)`.
- Main loadout now applies passive Skill Mana, Block, and Swap cost modifiers; combat controls show and submit resolved costs, including temporary Skill/Relic/Ability/Status modifiers.
- Collection Critter and Rollcaster detail modals now render full-width XP progress bars and inline blue Skill/Ability point counters.
- Verification: typecheck, build, collection UI logic, effect runtime, home/collection/skill layout, combat swap UI, effect UI, and required web-game smoke pass. Static browser probe confirms XP/challenge width parity and cost tooltip content.

Current request (2026-07-23): Clean up `/play` Dungeon cards — remove description/stat overlap, equalize card heights to the longest description, align the grid with the heading/Back edges like Collection, widen cards, and add dynamic 20-per-page number tabs above and below the grid.

Current request (2026-07-21): Add owner-qualified combat narration, active effect/status hover details with exact deltas and sources, equipped Relics on Critter combat cards, and larger single-line Skill cost/power metadata; keep rollcaster-sim behavior and UI in parity.

Current request (2026-07-22): Restrict active-effect tooltips to each Critter's sprite box and stage stat, healing, and status changes event-by-event with specialized, source-Skill narration in both the game and simulator.

# Rollcasters project handoff

## Current request (2026-07-27): Shield Projector relic trigger

- Reproduced the live Shield Projector catalog effect in the effect-runtime suite.
- The reactive trigger was activating, but `maximum_shield: null` was coerced through `Number(null)` to `0`, so every 10 Shield grant was capped at zero.
- Fixed nullable `maximum_shield` handling in `src/lib/game.ts` and added an exact catalog-shaped regression in `scripts/effect-runtime-tests.ts`.
- Focused `npm run test:effect-runtime` passes.

## Current request (2026-07-27): Unified HP and Shield bar

- Replaced the separate Shield bar in combat cards with one fixed-height overlapping bar: HP is the left segment and Shield follows it in blue.
- Normal shields use the max-HP scale and visually cover the HP they protect; shields larger than max HP expand the scale to current HP + Shield so oversized builds remain proportional.
- HP is consistently green and Shield consistently blue so the two resources remain immediately distinguishable at every health level.
- Kept the numeric `HP · Shield` text row and relic position unchanged; the bar is always present so granting/removing Shield does not shift card content.
- Verified the segment geometry with 50/50 + 10 Shield, 45/50 + 10 Shield, 20/50 + 10 Shield, and 1/1 + 30 Shield fixtures. Build, combat-swap UI, and effect UI tests pass.

## Current request (2026-07-27): Shield combat narration

- Shield-only hits now narrate the absorbed amount, for example `Your Critter's Shield absorbed 5 damage.` instead of `took 0 damage.`
- A hit that reduces Shield to zero adds a separate `Shield broke.` status event with negative polarity, red negative-effect animation, and its own playback text box.
- Added runtime regressions for partial Shield damage, no `0 damage` narration, and Shield-break event polarity.

## Current request (2026-07-28): HP bar track styling

- Matched all combat HP bar tracks to the XP-bar treatment: dark empty space, cyan outline, and inset black edge.
- Preserved the green HP and blue Shield fills and the fixed bar geometry.

## Current request (2026-07-28): HP and Shield bar seam

- Overlapped the Shield segment by 2px and removed its inner left rounding so the green HP and blue Shield fills meet cleanly without a track-colored seam.

## Current request (2026-07-27): Clear temporary combat stat modifiers on swap/KO

- `recomputeCombatStats` now removes Skill/Status-style `CombatModifier` entries whose holder is inactive or at 0 HP.
- Cleanup occurs before damage/KO presentation snapshots, including direct-health and timed damage paths.
- Equipped Relic/Ability stat setup effects are recomputed as persistent sources, so a Relic/Ability DEF boost survives a swap and cannot stack a second copy on return.
- Added effect-runtime regressions for swap cleanup, KO cleanup, event snapshots, and persistent setup stat restoration.
- Focused `npm run test:effect-runtime` passes.
- Synced `rollcaster-sim/src/generated/game/` from the updated engine; simulator typecheck and all 11 core tests pass.

## Current request (2026-07-23): Play Dungeon grid cleanup

- Dungeon cards no longer use fixed 550px/`grid-template-rows` that caused Difficulty/Format/Encounters/Clears to overlap descriptions.
- Cards grow with description content; every card on the current page matches the tallest card height via measured `grid-auto-rows`.
- Grid spans the same content width as the heading (left with "Dungeons", right with Back), with wider fractional columns like Collection.
- Pagination shows 20 Dungeons per page with numbered tabs above and below the grid; page count scales with catalog size (5 tabs for 100 Dungeons).
- Verified: typecheck, layout-only live Dungeon browser gate (`DUNGEON_LAYOUT_ONLY=true` → 20 cards/page, 5 tabs, equal heights, stats below descriptions, heading alignment, zero browser errors), and unauthenticated web-game smoke. Full combat browser suite still has a pre-existing Swap handoff assertion failure unrelated to this layout work.

## TODOs / next agent

- Re-run full `npm run test:dungeons:browser` with Node 24 and fix the Swap incoming-slot persistence assertion if still failing.
- Optional: expose play-page pagination in `render_game_to_text` for QA hooks.

## Current request (2026-07-23): Critter XP bar color

- Critter XP bars (loadout, collection, combat) now use a light neon mana-blue fill (`#3376a8` → `#4ba6d8` → `#7de8ff`) instead of green.
- Rollcaster XP bars stay purple to match the existing combat outcome styling.

## Prior request (2026-07-23): Immediate reactive relic combat timing

- Fixed post-damage reactive resolution for Spiky Shield and Gambler's Rune.
- Damage presentation is now staged before the synchronous reactive effect, so retaliation/stat changes resolve before the next queued action is processed and play back in the correct order.
- Added focused runtime regressions covering Spiky Shield retaliation damage, Gambler's Rune mana loss and ATK gain, nullable activation limits, and event ordering.

Last condensed: 2026-07-20

## Current state

- The first playable Rollcasters build is implemented in React, TypeScript, and Vite with Supabase Auth, Postgres, RLS, RPC-backed mutations, Storage, and persistent player accounts.
- The local player app is configured for the published catalog path (`VITE_GAME_CATALOG_MODE=release`) and compact player bootstrap (`VITE_GAME_PLAYER_BOOTSTRAP_MODE=v1`).
- Production-style catalog data and optimized art come from the public Supabase `game-releases` bucket. Editable source/master art remains in `game-assets` for authoring and immutable history fallbacks.
- The project requires Node 22 or newer. The bundled Node 24 runtime is used for Supabase browser/database scenarios in this workspace because the system Node 20 runtime lacks the required native WebSocket support.
- The primary runtime remains concentrated in `src/App.tsx` and `src/styles.css`. Further modularization should be incremental and protected by the existing visual and business-rule tests.

## Player-facing features

- Account signup, login, email-confirmation handling, and durable sessions.
- Starter Rollcaster and starter Critter selection with authored choices and shard-equivalent onboarding rewards.
- Main loadout screen with active Rollcaster, squad management, Critter Skills and Relics, Rollcaster Abilities, progression, currencies, and tracked challenges.
- Collection tabs for Rollcasters, Critters, and Relics with natural collectible ordering, search/filtering, locked states, unlock requirements, challenge tracking, level progress, points, stats, effects, and detail popups.
- Critters support one or two Elements. Element identities, matchups, Skills, statuses, owner effects, and targeting rules are integrated into combat and collection UI.
- Progression grants Skill points and Ability points at authored levels. Players can purchase eligible unlocks and equip or unequip loadout items through server-validated RPCs.
- Shard and Relic Shops support authored prices, stock/max-owned states, duplicate conversion, reward banners, and persistent purchases.
- Promo Codes support case-insensitive claims, finite or unlimited per-player/global uses, immutable redemption history, reward outcomes, and current/retired reward artwork.
- Dungeon selection, regular/boss encounters, persistent runs, deterministic server commands, action selection, Mana Dice, attacks, block, swap, effects, knockout handling, rewards, XP, drops, and completion progression.
- Responsive desktop, tablet, and mobile layouts with keyboard focus, reduced-motion support, contained sprites, compact notifications, and accessible dialogs/tooltips.

## Published catalog and asset architecture

- Catalog releases contain four canonical packs: `core`, `combat`, `collectibles`, and `dungeons`.
- `latest.json` points to one immutable release. The client verifies pointer, manifest, pack, and asset-manifest SHA-256 values before using a release and rejects mixed, tampered, incompatible, or incomplete data.
- Verified artifacts are cached in browser Cache Storage. If the network is unavailable, the last fully verified compatible release can load without mixing versions.
- The exporter creates optimized WebP variants such as icon, thumb, card, battle, and portrait assets with hashed immutable filenames and byte budgets.
- The player app uses published registry variants for its current catalog. Promo reward snapshots can fall back to their immutable source `game-assets` path when an item is retired from the active release.
- Live catalog and legacy player loading remain explicit emergency/development fallbacks only. Normal operation does not combine live source paths with the hashed release asset origin.
- Supabase Storage is the current published-release host. The publisher remains S3-compatible and retains optional R2 support if measured production egress later justifies a provider change.

## Database and migration contract

The current additive migration chain is:

1. `20260719000000_rollcasters_baseline.sql` — consolidated schema, catalog, functions, triggers, RLS, grants, and source asset bucket contract for a fresh environment.
2. `20260720000000_content_releases.sql` — shared immutable content-release ledger/channel contract.
3. `20260720020000_player_bootstrap_v1.sql` — compact authenticated player snapshot and catalog-version compatibility.
4. `20260720030000_fix_indirect_player_revision_trigger.sql` — safe Critter/Rollcaster transition-record handling for equipment changes.

Important rules:

- The baseline is for a fresh environment and must not be applied over an already-populated Rollcasters schema without a reviewed reconciliation.
- Authenticated game mutations are server validated; the client must not be trusted for rewards, prices, drops, progression, damage, or ownership.
- Player state revisions advance for indirect loadout changes so compact snapshots refresh correctly.
- The unequip regression covers Critter Skill, Critter Relic, and Rollcaster Ability clearing inside a rolled-back database fixture.

## High-value fixes retained

- Collection Critter, Rollcaster, and Relic spriteboxes are equal responsive squares. Collection and Relic popup art use the 300px card variants instead of stretched legacy icons.
- Promo redemption sprites resolve to optimized release art, with source-bucket fallback for retired immutable snapshots.
- Critter and Rollcaster equipment revision triggers no longer reference fields that do not exist on the active transition record.
- Combat refunds a queued action's Mana when its Critter is knocked out before acting.
- Swap playback performs an ordered outgoing/incoming handoff and blocks later event playback until the incoming unit is revealed.
- Shop reward banners coalesce rapid purchases so only the latest Shop reward is queued while unlock and Promo notifications remain intact.
- Challenge gates enforce authored order in database progress, tracking, collection cards, detail panels, and the home HUD.
- Published catalog verification includes a portable SHA-256 fallback for browser contexts without `crypto.subtle`.

## Repository conventions

- `src/` contains the player application and reusable game/runtime helpers.
- `supabase/migrations/` is the source of truth for deployable database changes.
- `scripts/` contains focused unit, database, browser, migration, asset audit, export, and publish tools. Every retained script is referenced by an npm command or another script.
- Generated `dist/`, `output/`, local `.env`, certificates, planning documents, Supabase CLI state, and OS metadata are ignored.
- The runtime ships only the optimized WebP logo. The former 1.1 MB PNG duplicate is no longer required by the app or visual tests.

## Verification baseline

The normal non-destructive gate is:

- `npm run typecheck`
- `npm run build`
- `npm run test:catalog-release`
- `npm run test:collection-ui`
- `npm run test:collectibles-shop`
- `npm run test:promo-codes`
- `npm run test:effect-runtime`
- Focused Playwright layout suites for collection, home/loadout, responsive shell, Skills, sprite containment, notifications, and combat swap.
- Published-release browser coverage for online verification, offline cache recovery, tamper rejection, portable SHA-256, configured runtime loading, and decoded release artwork.
- The required web-game client smoke, followed by inspection of both its screenshot and `render_game_to_text` state.

Database and signed-in browser tests may create rollback-only fixtures or disposable users. Run them only against the intended development environment and retain their cleanup audits.

## Remaining work

- Continue adding authored Critters, Rollcasters, Relics, Skills, Abilities, Dungeons, challenges, Shop offers, balance passes, and final presentation polish.
- Monitor release bucket bandwidth, cache-hit behavior, initial-load bytes, and player bootstrap payload size as the catalog grows.
- Keep the Content Studio release publisher and this player runtime on the same schema/runtime contract before publishing future releases.
- Before a public launch, complete a dedicated production security, accessibility, multi-browser, failure-recovery, balance, and load test pass.

## Combat ownership and inspection parity (2026-07-21)

- Combat presentation now qualifies Critters as `Your …` or `The enemy …`; action selection and Mana-roll narration use the same player-relative language.
- Added shared, ordered per-Critter effect summaries with exact applied stat deltas and source ownership. Healthy active combat cards reveal positive/negative/mixed effects and statuses on hover, including Skill, Relic, Status, and Rollcaster Ability sources.
- Equipped Relics now render beside each Critter's HP text with their existing detailed tooltips.
- Combat Skill buttons place Power and the larger Mana icon/cost on one metadata row without changing card or battlefield dimensions.
- The published `2026.07.21.2` catalog's inert empty `overheal_effect_ids` default is accepted only when overhealing is not configured to convert; active child-effect lists remain strictly validated.
- Verification passed: typecheck, production build, effect runtime (including exact `+5 ATK` summary regression), combat Swap UI, effect/status tooltip UI, required web-game smoke, and a signed-in live Effect combat run. The live browser fixture equipped a Relic, verified the hover summary and Relic icon, geometrically asserted one-line Power/Mana layout, completed both encounters, and reported zero browser errors.

## Latest verified snapshot (2026-07-20)

- Cleaned tracked OS metadata and the unused 1.1 MB PNG logo duplicate; the app and responsive fixtures now share the 53 KB WebP asset.
- Aligned `.env.example` with the published-release and compact-bootstrap configuration, while retaining explicit emergency fallback flags.
- Published release `2026.07.20.2` passed online verification, offline cache recovery, tamper rejection, portable hashing coverage, and decoded artwork checks for all 172 registered variants.
- Typecheck, production build, npm audit, core catalog/gameplay rule suites, six focused visual suites, and the prescribed web-game smoke all pass. The final smoke screenshot and text state show a clean unauthenticated login view.
- No known cleanup blocker remains from the published-release/storage transition.

## Dungeon Swap state-conflict fix (2026-07-21)

- Fixed stale `DungeonRunState` updates in combat playback and controls by using functional React state updates, preserving the latest server `state_version` returned by autosave.
- The affected path was the delayed Swap reveal: an autosave could finish before the 720 ms reveal timer, after which the old closure overwrote the fresh run version and the next save raised `DUNGEON_STATE_CONFLICT`.
- `npm run typecheck` passes after the fix. Re-run the live Dungeon browser regression with the bundled Node 24 runtime when database/browser credentials are available.
- `npm run build`, `npm run test:combat-swap-ui`, and the required unauthenticated web-game smoke pass. The signed-in Dungeon browser regression reached the combat shell but currently stops at its pre-existing short-wide layout assertion before the Swap scenario; no `DUNGEON_STATE_CONFLICT` was reported.

## New effects and unlock challenge runtime (2026-07-20)

- Added player-side Challenge v2 types, generated/display override text, all ten tracked Challenge families, and a pure event matcher/derived-progress helper in `src/lib/challenges.ts`.
- Published/live catalog loading now preserves Challenge Template metadata, Challenge `parameters`/`display_text`, and Effect `classification`/`execution`.
- Expanded combat validation accepts the documented Effect runtime/version pairs. Combat now supports Shield durability, direct HP changes, Stat Modifier v2 action/slot stats, damage prevention/modification, action-cost modifiers, resource/scaling/compound child resolution, reactive/delayed/repeating runtime instances, and richer normalized progress events.
- Added `20260720060000_player_effects_challenge_runtime.sql`, widened the idempotent combat event receipt RPC, and added scope-progress storage. The migration was applied successfully to the configured development database.
- Added the forward-only `20260720070000_fix_challenge_matcher_jsonb_filter.sql` repair and applied it successfully to the configured development database.
- Verified with typecheck, production build, catalog-release, collection-UI, effect-runtime, effect tooltip UI, combat swap UI, live migration, unauthenticated web-game smoke, and signed-in combat browser coverage. The system Node 20 live browser harness still needs the bundled Node 24 runtime because Supabase Realtime requires native WebSocket support.

## Challenge/effect reconciliation and schema-v2 release (2026-07-20)

- Fixed the release/live-catalog split that could pair an old published Challenge definition with a newer live player-progress snapshot. Catalog schema v2 now publishes all 15 Challenge Templates with every canonical Challenge parameter, and the client derives a safe authored fallback instead of rendering a stale `0 / 0` row.
- Reconciled Critter 028's stable Challenge UUID to `Own 7 different Critters`, preserving the UUID while resetting stale progress/tracking. Reconciled Critter 027's three-copy Relic requirement to quantity rather than impossible unique ownership.
- Reclassified all currently authored harmful Status/Skill Effects as negative and corrected Chilling Wind from the accidental ATK increase to its authored DEF −20% behavior.
- Aligned published and live Effect normalization so hidden inert `element_ids` values do not make a valid Relic Effect fail only in release-mode combat.
- Published production catalog release `2026.07.20.4` (schema v2). Signed-in release verification displays Ceratusk's exact `Own 7 different Critters.` text and authoritative `1 / 7` progress.
- Signed-in combat verification loaded the production release, froze five Effects into the run snapshot, resolved both Dungeon encounters to a persisted terminal outcome, and reported no console/page errors.
- The database audit reports 15 active Challenge Templates, both repaired ownership definitions in canonical form, zero harmful classification errors, and zero Chilling Wind parameter errors.
- Typecheck, production build, collection/challenge logic, combat Effect runtime, catalog-release contract, shop business rules, migration drift, and the required generic web-game smoke all pass.

## Event-synchronized combat effects (2026-07-22)

- Combat presentation events now freeze the exact visible Mana, unit stats/HP/Shield, modifiers, statuses, and runtime effects at each narration step. Dungeon playback applies those snapshots as it advances, so a multi-target debuff becomes hover-visible one target at a time on the matching message.
- Stat, HP, healing, and Status narration uses exact applied amounts and authored Skill/source names; embedded owner phrases use lowercase `your` / `the enemy` while sentence-leading names retain capitalization.
- Active-effect tooltips now open only from the healthy active Critter's sprite box. `render_game_to_text` also exposes each visible unit's active effects.
- Added a two-target debuff playback regression plus sprite-only hover assertions. Effect runtime, typecheck, production build, effect UI, Swap UI, signed-in effect-combat browser coverage, and the required web-game client pass with no browser errors.

## Base-referenced percentage stacking (2026-07-22)

- Percentage stat modifiers now calculate every application from the Critter's unchanged pre-temporary-effect stat instead of the already modified current value.
- Any nonzero percentage whose rounded magnitude would be zero now applies a signed one-point minimum.
- Repeated modifiers from the same source and stat are combined into one cumulative tooltip row, so two identical Glare applications display their total DEF loss instead of hiding the later stack.
- Added regressions for repeated percentage debuffs, one-point minimum buffs/debuffs, cumulative tooltip totals, and exact repeated-application narration. Main-game runtime/typecheck/build, Effect UI, signed-in combat browser coverage, and required web-game QA pass.

## Combat healing/reactive fixes and Heal HP Challenges (2026-07-27)

- Gambler's Rune now presents the actual clamped squad Mana loss (`You lost 3 mana.` or the lower remaining amount) after each qualifying incoming hit.
- Spiky Shield's root attacker-targeted Direct Health Effect is retained as an equipped-Critter retaliation, resolves only when that equipped Critter is attacked, presents exact reflected damage, and targets the attacker for the normal damage animation.
- Enemy knockouts now dispatch `owner_defeats_enemy` reactions after both base attack damage and Effect-driven HP loss. Battle Medic I resolves its all-friendly 5% heal as one staged event with every changed HP bar and animation; authored data now opts into healing modifiers.
- Healing amplification is installed as a persistent runtime Effect. Stim Shot's 20% received-healing modifier applies across direct-health and restore-HP sources with round-half-up behavior, then healing progress records only actual restored HP after amplification and the missing-HP cap.
- Added `hp_healed` Challenge events and the `heal_hp` collectible template contract, including friendly/enemy recipient filters plus Critter-species and Element subsets. The matching forward migration is mirrored in the game and Content Studio repositories and was dry-run, applied, and read back successfully in the configured development database.
- Skill equip uses a wider three-column desktop dialog with name/Element search. Relic equip adds name search and omits general Relic descriptions while retaining Effect summaries.
- Verification passed: typecheck, production build, Effect runtime (including low Mana, reflected damage ordering, Effect-driven knockout healing, multi-target Battle Medic, Stim Shot rounding, and amplified Challenge progress), Challenge text/matching, Collection UI, Effect UI, signed-in Effect combat, live equip-dialog Playwright, schema/editor Playwright in Content Studio, and the required generic web-game client. Visual artifacts are in `output/equip-collectible-order-browser/` and `output/combat-healing-web-client/`.
- No game catalog release was created or published. Build and publish the next release manually after reviewing these changes.

## Active lead Relic runtime and block odds (2026-07-27)

- Fixed Dungeon lead activation so setup Relic runtime Effects are reinstalled after the initial inactive formation. This restores live Spiky Shield Thorns and Stim Shot instances in actual encounters, not only in synthetic active-state tests.
- Healing now rounds each stage independently: base percentage heal first, then each amplifier, with Stim Shot turning 48 max HP × 10% into 5 then 6.
- Added per-Critter consecutive Block streaks. Block odds are `1/(streak + 1)`, failures narrate and reset the streak, and successful/failed blocks have dedicated combat animations.
- Added regressions for lead runtime refresh, staged Stim rounding, 1/2 Block failure narration, and reset 1/1 success. Game typecheck/build, runtime/UI/challenge tests, signed-in Effect combat, and the required web-game smoke pass.
- Combat playback now holds status/block/other Effect events long enough for their target animation and changes a presentation token per event so consecutive target Effects restart their animation reliably.
- Block narration is intentionally concise: successful blocks say `Your <Critter> blocks.` and failures say `<Critter>'s block failed.` with no odds included in player-facing text.
- Failed consecutive Blocks now queue two presentation events: the declaration text first, then the concise failure text on the next combat advance. Successful Blocks queue only the declaration event.
- Healing-stage rounding now uses half-up rounding at the base and every amplifier stage, with a minimum of 1 for any positive result below 1. This yields 48 × 10% = 5, then Stim Shot = 6, while 48 × 5% Battle Medic = 2.
- Setup runtime Effects now refresh on every Critter Swap as well as lead activation. A Critter entering an attacked battlefield slot can immediately take damage and trigger equipped Spiky Shield retaliation in the same turn.

## Combat lead selection and action order (2026-07-27)

- Lead-selection checks are now absolutely positioned overlays with permanent right-side space reserved, so selecting a Critter never reflows its name/HP text.
- Player action selection now orders living active Critters by fixed battlefield slot (top to bottom), rather than squad-array order. This preserves top-to-bottom selection after a 2vX Swap introduces a benched Critter into the top slot.
- Added an effect-runtime regression for the swapped top/bottom action-selection ordering.
- Verification passed: typecheck, effect runtime, production build, existing combat Swap UI test, required web-game smoke, and focused lead-card geometry/screenshot check. No browser errors were reported by the web-game smoke.
