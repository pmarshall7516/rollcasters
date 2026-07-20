Original prompt: Now, I want you to use all of these refined implementation documents to make the first version of my game. This should be functional for the most part with a decent bit of UI and feature polish. Seed initial data in the database, and use a database connection to pull all user and game catalog data. Do not seed any user data, as I will test the sign up and log in flows when the first version is built. In this repo, I have a .env file, and I can provide all needed database connection information to it, just let me know what else I need to add to this documentation or repo so you can go though implementation iterations of building and testing to refine a first version of this game.

## Game optimization and Supabase cached-egress audit (2026-07-20)

- Current request: audit and optimize the full game codebase, remove safe bloat/duplicates/unused code, root-cause excessive Supabase cached egress, implement a durable fix, and document a reusable optimization/storage strategy in `docs/18-game-optimization-implementation.md` and `docs/19-game-storage-and-db-auit.md`.
- Initial repository findings: the worktree started clean on `main`; the runtime frontend is concentrated in a 4,046-line `App.tsx`, 4,685-line stylesheet, and 777-line Supabase adapter.
- Initial egress signal: every game-data refresh currently reloads the complete catalog through roughly 25 parallel Supabase API requests plus all user state, and catalog sprites are served from the public Supabase Storage bucket. The audit will measure and separate these contributors before finalizing the fix.
- Root cause confirmed: Supabase cached egress came from the public Storage sprite library, where all 62 objects (12.93 MB) used a one-hour browser TTL. The active catalog references 57 objects / 11.49 MB, enough for roughly 435 complete cold/expired-cache loads to consume the Free plan's decimal 5 GB cached-egress allowance.
- Rewrote all 62 live objects with `max-age=31536000`, verified zero remaining policy mismatches, added catalog-derived asset URL versions, lazy/async image delivery, and an optional external asset origin. Added reusable read-only/apply audit commands.
- Deduplicated the catalog fetch for the page lifetime, changed player queries from `select("*")` to explicit columns, replaced repeated Dungeon child scans with grouped lookups, split stable vendor bundles, enabled strict dead-code checks, removed four unused declarations and safe duplicate CSS, and upgraded Vite to 7.3.6 with zero npm audit findings.
- Added the complete implementation and storage strategy in `docs/18-game-optimization-implementation.md` and `docs/19-game-storage-and-db-auit.md`, including a shared development-tool publish workflow, asset byte budgets/variants, immutable static catalog releases, and an R2/custom-domain migration path.
- Passed typecheck, production build, pure rule tests, responsive/collection/home/sprite/skill/effect/notification Playwright suites, the required real-app web-game client, syntax checks, and visual inspection of desktop/mobile captures. The current image masters still need optimized variants, and the large `App.tsx`/stylesheet should be split incrementally under the documented regression gates.

## Equip popup collectible ID order (2026-07-19)

- Current request: list every owned Rollcaster, Relic, and Critter in natural collectible ID order in their equip popups while retaining the current equipped selection treatment.
- Moved the existing natural numeric collectible-ID sorter into the shared collectible utilities and applied it to owned Critters by `critter_id`, owned Rollcasters by `rollcaster_id`, and owned Relics by catalog `id`.
- The Relic popup now lists every owned Relic. A Relic whose copies are fully committed to other slots remains visible with `Available 0` and is disabled; the currently equipped Relic remains selected.
- Preserved the existing green selected candidate and SpriteFrame borders for the active Rollcaster.
- Added business-rule coverage for sorting by catalog ID rather than ownership UUID/payload order, plus a focused disposable-user browser regression covering all three dialogs, the active Rollcaster selection styling, and a fully committed Relic.
- Passed `npm run typecheck`, `npm run build`, `npm run test:collectibles-shop`, browser-script syntax checks, and `git diff --check`.
- The focused signed-in browser run was blocked at its initial read-only catalog request by the environment's exhausted external-access approval quota, before any disposable user was created. The required web-game client was also blocked from launching Chromium by the macOS sandbox, and its escalation hit the same quota; the in-app browser then rejected the local URL by policy. No visual captures were produced in this run.
- TODO: when external/browser execution is available, run `npm run test:equip-collectible-order:browser` and inspect the three screenshots in `output/equip-collectible-order-browser`.

## Latest-only rapid Shop reward banners (2026-07-19)

- Current request: prevent a long banner backlog when the player makes many Shop purchases in succession; skip older purchase banners and show the latest reward.
- Shop reward notifications now coalesce in the shared banner queue. A new purchase replaces every older queued Shop reward, including the currently visible Shop banner, while preserving collectible-unlock and Promo notifications.
- Updated the focused signed-in Shop flow to purchase a Critter Shard and Relic back-to-back, require the Relic banner to replace the Shard banner immediately, and reject any stale Shop reward reappearing after dismissal.
- Passed `npm run build`, `npm run test:collectibles-shop`, browser-script syntax checks, `git diff --check`, the focused bundled-Node signed-in rapid-purchase flow, and the required web-game smoke client against the requested LAN route.
- Visually inspected both purchase captures: the initial Spreagle reward is replaced by the latest Copper Shield reward, only one Shop reward banner is present, and no stale reward returns after five seconds.
- Final cleanup found zero disposable Auth users. No outstanding TODOs for rapid-purchase banner coalescing.

## Critter Shard identity color (2026-07-19)

- Current request: make Critter names on Shard Shop cards use the same color as their collectible ID.
- Applied the existing Shop target cyan directly to the Critter-name identity and expanded browser coverage to compare the computed name/ID colors.
- Passed `npm run build`, browser-script syntax checks, `git diff --check`, the focused bundled-Node signed-in Shard/Relic Shop flow, and the required web-game smoke client against the requested LAN route.
- Visually inspected the signed-in Shard Shop: active Critter names and IDs use the same cyan while sold-out cards retain their muted treatment. Final cleanup found zero disposable Auth users.
- No outstanding TODOs for this color refinement.

## Left-aligned compact Promo history (2026-07-19)

- Current request: return the Promo claim card and Claim history to the Shop content's left edge, and replace square redemption cards with tighter horizontal rectangles.
- Left-anchored the bounded Promo panel and claim card so the claim card, history heading, and history grid share the exact Shop tab/card starting edge.
- Removed forced square sizing and nested card scrolling. Redemption cards now size to their actual header/reward content while the stable outer history grid remains the sole scrolling surface.
- Updated the signed-in Promo browser regression to verify shared Shop-edge alignment, compact landscape card geometry, stable claim/history anchors, and non-overlapping mobile scrolling.
- Passed `npm run build`, `npm run test:promo-codes`, script syntax checks, `git diff --check`, the bundled-Node signed-in Promo claim/repeat/mobile flow, and the required web-game smoke client against the requested LAN URL.
- Visually inspected the left-aligned first/repeated desktop claims and compact mobile history pane. The claim/history left edges match the Shop tabs exactly, repeated cards flow across the row, and no excessive square-card whitespace remains.
- Final cleanup found zero disposable Auth users and zero disposable Promo Codes. No outstanding TODOs for this refinement.

## Static Shop and Promo reward UI (2026-07-19)

- Current request: center the Promo Code claim pane with `Enter code...`, keep Claim history anchored as a borderless scrolling grid of square cards, replace promo and Shop inline success messages with the existing top-left collectible banner presentation, and align Critter Shard names/IDs on one row.
- Replaced the unlock-only queue with one shared five-second fixed banner queue for collectible unlocks, Shop rewards, and promo rewards while preserving the collectible outbox acknowledgement flow and text-state compatibility.
- Removed the inserted `Rewards claimed!` and `Purchase complete.` success regions. Promo claims retain input focus and update the anchored history grid; Shop errors remain inline.
- Centered the claim card, added the requested placeholder, fixed the history viewport height, made its pane borderless/scrollable, and rendered each redemption as a square card with its own bounded reward list.
- Added an explicit single-line Critter target identity wrapper so the element icon, name, and collectible ID share one centered baseline on Shard cards.
- Updated the live Promo and collectibles-Shop browser scenarios to cover the new banners, static geometry, square scroll grid, placeholder, absent inline success UI, and Critter name/ID alignment.
- Added a focused disposable-user Shop reward browser scenario that purchases both an existing Critter Shard offer and an existing Relic offer without changing the shared catalog. The older broad collectibles-Shop fixture could not seed its unrelated isolated-Critter setup because every current Critter now has Shop/challenge coverage.
- Passed `npm run build`, `npm run typecheck`, `npm run test:promo-codes`, `npm run test:collectibles-shop`, `npm run test:unlock-notification-ui`, `npm run test:responsive-shell-layout`, script syntax checks, `git diff --check`, the bundled-Node live Promo flow, the focused live Shard/Relic purchase flow, and the required web-game smoke client against the requested LAN URL.
- Visually inspected the claimed/repeated desktop Promo layout, the non-overlapping mobile history pane, Shard and Relic reward banners, Critter Shard identity rows, desktop/mobile unlock banners, responsive-shell captures, and the unauthenticated LAN smoke. Final cleanup found zero disposable Auth users and zero disposable Promo Codes.
- No outstanding TODOs for this Shop/Promo UI refinement.

## Promo Code uses per player (2026-07-19)

- Current request: honor the Content Studio's new finite/infinite Uses per Player settings in actual game claims.
- Inspected the completed adjacent Content Studio migration 012 and aligned the game to its canonical fields, `PROMO_CODE_PLAYER_LIMIT_REACHED` token, and `playerUses` / `playerUsesRemaining` / `globalUsesRemaining` response counters. Global Infinite Use/Redemption Limit remains independent.
- Added additive migration 018 to preserve existing codes at one use per player, remove the obsolete unique redemption constraint, clean up the transitional duplicate constraint, normalize/validate the new fields, round-trip them through the admin save RPC, and enforce the personal count under the existing locked Promo row before every atomic reward grant.
- Added bigint-safe response normalization, player-facing account-limit copy, and success-summary usage text so repeatable claims clearly show the current claim number plus personal/global uses remaining.
- Expanded rollback-only database coverage for default authoring compatibility, a two-use personal cap, a global cap after multiple accounts, unlimited repeat claims with distinct snapshots, returned usage counters, immutable repeated history, schema/index contract, security policies, and invalid codes.
- Expanded the real-game browser fixture to claim a two-use code twice, verify both reward grants/history records and counters, reject the third claim, and reload both immutable entries.
- Applied only migration 018 to the connected development database. The final audit found only the canonical player-use constraint, the canonical error/counter RPC contract, zero disposable Promo Codes, and zero disposable Auth users.
- Passed `npm run test:promo-codes`, `npm run test:promo-codes:db`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, the live signed-in Promo Code browser flow under the bundled Node 24 runtime, and the required generic web-game smoke client.
- Visually inspected the first and repeated desktop claims, both-entry mobile history, and clean authentication smoke. The second claim showed 250 Coins, two history cards, and `Claim 2 · Account claim limit reached · 8 total claims remaining`; no horizontal overflow or browser errors were present.
- No outstanding TODOs for the per-player redemption limit fix.

## Promo code player feature (2026-07-18)

- Current request: implement the game-facing Promo Code feature from `docs/16-promo-codes.md`.
- Confirmed the shared development database already exposes `redeem_promo_code(text)` and `promo_code_redemption_history()` from the Content Studio implementation, so this game change consumes the existing secured contract rather than duplicating its server migration.
- Added typed Promo redemption/history API adapters, stable player-facing error mapping, reward outcome labels, and a routed Promo Codes Shop tab after the disabled Lootbox Shop tab.
- Added the accessible claim form, lost-response history reconciliation, success reward reveal, immutable snapshot-based reward art, newest-first history, loading/retry/empty states, and responsive one-column behavior.
- Added focused business-rule tests, a rollback-only shared-database contract suite, and a disposable-user real-app browser scenario covering routing, lowercase paste/Enter submission, focus, balances, outcome labels, safe errors, history reload, non-enumeration, accessibility, and mobile layout.
- The database suite passed case-insensitive atomic grants, one-use/global-limit enforcement, immutable code/reward snapshots, function privileges, and RLS policy presence. The browser fixture cleanup audit found zero disposable Promo Codes and zero test users.
- Passed `npm run test:promo-codes`, `npm run test:promo-codes:db`, `npm run test:promo-codes:browser`, `npm run test:collectibles-shop`, `npm run test:responsive-shell-layout`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required web-game smoke client.
- Visually inspected the claimed desktop page, reloaded mobile history, and clean real-app authentication smoke. No outstanding TODOs for the game-facing Promo Code feature.

## Pre-action knockout Mana refunds (2026-07-18)

- Current request: do not spend a Critter's queued action Mana when that Critter is knocked out before it can act.
- Updated the shared turn resolver to return the exact reserved action cost to the owning side when resolution reaches an already-knocked-out actor; the Critter still does not act.
- Added deterministic runtime regressions for both player and opponent Critters, including speed ordering, no outgoing damage, exact Mana restoration, and refund narration.
- Passed `npm run test:effect-runtime`, `npm run typecheck`, `npm run build`, `git diff --check`, and the required real-app web-game smoke with no captured browser errors.
- Visually inspected the clean authentication smoke plus signed-in live Dungeon dice/action-selection captures. The broader disposable-user Dungeon scenario reached real combat, then stopped on an unrelated short-wide viewport-fit assertion before action resolution; its `finally` cleanup removed the temporary user.
- No outstanding TODOs for the Mana refund rule.

## Compact collectible unlock banner (2026-07-18)

- Current request: replace the blocking center-screen collectible unlock popup with a simple, non-interactive top-left banner that overlays any current UI for five seconds without changing layout.
- Reused the existing durable unlock-event queue shared by combat, Shard collection, Shop purchases, and other challenge completion paths.
- Replaced the modal/backdrop, focus trap, and Continue button with a fixed, pointer-transparent, live-region banner; each queued unlock now automatically advances after exactly five seconds.
- Added a compact slide-in/fade-out treatment and updated the live collectibles browser scenario to assert placement, dimensions, stacking, lack of modal/interactivity, animation, accessibility, and automatic dismissal.
- Added a local-only desktop/mobile visual regression after the external Supabase test was blocked by environment policy. It measured a 360x70 banner at (12,12), z-index 1000, zero interactive descendants, successful click-through, unchanged underlying layout, and clean browser errors at 1280x720 and 390x844.
- Passed `npm run typecheck`, `npm run build`, `npm run test:collectibles-shop`, `npm run test:unlock-notification-ui`, `npm run test:responsive-shell-layout`, `npm run test:collection-interaction-ui`, script syntax checks, `git diff --check`, and the required real-app web-game smoke client. Visually inspected desktop/mobile banner captures, existing modal captures, and the clean unauthenticated app render.
- No outstanding TODOs for this change.

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

## Dungeon and combat renovation (2026-07-17)

- Current request: thoroughly review `docs/12-dungeons.md` and `docs/13-combat.md`, then implement the player-game functionality and UI against the already-renovated content data.
- Confirmed the configured development database contains the normalized Dungeon children, all nine Battle Formats, per-opponent/completion drops, and a complete Element effectiveness matrix from the Content Studio migration.
- Confirmed the existing player runtime is still the legacy implementation: it reads flat opponent arrays, chooses rows by order/limit instead of weighted sampling, has no encounter/lead-selection lifecycle, grants every squad member full Critter XP, and lets `resolve_dungeon_run` award an entire run without battle-result journaling.
- Implemented normalized Dungeon bootstrap across root rows, Element effectiveness, ordered Skills/Relics/overrides, normalized Currency/item drops, and first-time/regular completion drops. Dungeon IDs use natural numeric order, user-specific Boss/Regular mode derives from clear progress, and difficulty derives from the effective pool.
- Added migration 017 with immutable run/catalog/squad/opponent snapshots, server-seeded weighted Regular draws with replacement, ordered Boss grouping, idempotent start/save/result commands, versioned active-run restoration, per-defeated-opponent XP/drops, participation XP splitting, completion rewards, duplicate conversion, next-Dungeon unlocks, and authenticated-only runtime RPCs. Applied the idempotent migration to the configured development database.
- Rebuilt `/play` as a responsive Dungeon grid with effective artwork/fallbacks, difficulty/format/encounter/clear data, entry reasons, and a touch-accessible briefing dialog containing pool probability/order, Critter identity/elements/level, XP, and normalized drops.
- Rebuilt combat around fixed three-slot sides, Rollcaster/Enemy Mana panels, concealed enemy lineup before lead confirmation, lead/forced-replacement selection, encounter-scoped Mana and persistent run HP, deterministic dice, sequential action reservation, fixed-size Skill/Block/Swap/Skip controls, legal-target treatment, stage-ordered resolution, seeded Speed tie-breaks, explicit no-refund fizzles, click-through narration, committed encounter rewards, and complete/failure outcomes.
- Added responsive phone behavior with compact inactive slots and viewport-pinned primary combat controls/narration. Desktop and phone screenshots were visually inspected for Dungeon grid/info, lead selection, dice, actions, encounter rewards, reload restoration, and completion.
- Added rollback-only database coverage for immutable selection, idempotency, versioned saves/resume, partial/final rewards, XP, unlocks, loss, and RPC privileges. Extended combat coverage for all nine formats, Boss-to-Regular transition, natural ordering, dual-type chart multiplication, effectiveness boundaries, STAB/floor/immunity, target following, statuses, and no-refund cancellations.
- The disposable live browser scenario completed Dungeon 001 across both encounters, committed six reward entries, reloaded during event playback with identical narration/pre-application HP, persisted one battle result per encounter, incremented clear progress once, and reported zero console/page/network errors. It also verified desktop/mobile grid and combat geometry, hidden pre-lead identities, dice gating, immutable snapshots, result commands, and cleanup.
- Passed `npm run test:dungeons:db`, `npm run test:dungeons:browser`, `npm run test:effect-runtime`, `npm run test:collection-ui`, `npm run test:collectibles-shop`, `npm run test:responsive-shell-layout`, `npm run typecheck`, `npm run build`, script syntax checks, `git diff --check`, and the required real-app web-game smoke client.

## Game-page startup and UUID compatibility (2026-07-17)

- Current request: stop the game page from immediately opening an arbitrary unfinished Dungeon and fix `crypto.randomUUID is not a function`.
- Traced the unwanted screen to unconditional active-run restoration during every initial authenticated load. Startup now honors the URL first: `/` opens Home, while `/play` retains the intended active-Dungeon reload restoration.
- Added a shared request-ID generator that prefers `crypto.randomUUID`, falls back to `crypto.getRandomValues`, and still produces an RFC 4122 version-4-shaped UUID in older environments without Web Crypto.
- Replaced direct browser UUID calls in Dungeon start/result/save commands and Shop purchases.
- Added an authenticated browser regression that removes `crypto.randomUUID`, starts a Dungeon, verifies `/` renders Home with `combat: null`, verifies `/play` restores the same active run, and then completes both encounters.
- The disposable live scenario completed Dungeon 001, committed six reward entries, and reported zero console, page, or network errors. Visually inspected the active-run Home screen, restored event-playback screen, and unauthenticated real-app smoke render.
- Passed the request-ID native/fallback shape check, `npm run typecheck`, `npm run build`, `npm run test:effect-runtime`, `npm run test:collectibles-shop`, browser-script syntax checking, `git diff --check`, the live Dungeon browser scenario, and the required web-game client.
- No outstanding TODOs for this fix.

## Dungeon/combat UI cleanup (2026-07-18)

- Current request: standardize Dungeon cards and pool details, move lead selection into a popup with format-specific fixed battlefield slots, fit combat into the viewport, refine dice/unit metadata, add staged combat animation/effect playback, and add animated Critter/Rollcaster XP results.
- Implemented the foundational formation rule: one active Critter uses the center slot, two use top/bottom, and three use all slots on either side. Lead selection now skips automatically whenever every healthy equipped Critter fits in the authored active count.
- Moved manual lead/replacement choice into a dedicated equipped-party dialog and changed unused battlefield positions to text-free inset slots.
- Standardized Dungeon card tracks/sizing, removed the redundant ready text, simplified briefing copy/probabilities, and moved opponent entries to a narrower two-column grid.
- Reworked the combat shell to fit the complete battlefield, Mana, dice, narration, and actions into the viewport down through 390x844 without document scrolling. Tooltips now measure and clamp themselves to the visible window.
- Centered Roll Dice in the dice bar, placed each die's Mana result above its Critter identity, and consolidated Critter Element, name, level, and Mana range into one stable identity row.
- Added structured staged combat presentation events: the acting Critter animates with the Skill announcement first, then a click advances to damage, healing, or status feedback while the affected HP bar animates. Reloading during narration preserves the correct pre-effect state.
- Added a Party XP section beneath encounter drops and final rewards. Every equipped Critter and the active Rollcaster render with artwork, level progress, gain totals, and a slow animated XP fill, including party members that gained no XP.
- Expanded runtime and disposable-user browser coverage for fixed formations, automatic lead skipping, popup selection, card alignment, briefing copy, dice presentation, tooltip containment, viewport fit, staged effects, XP cards, result-save ordering, and a complete two-encounter Dungeon clear. The live run finished with zero browser errors and also verified automatic top/bottom placement in a 2v2 Dungeon.
- Passed `npm run test:dungeons:browser`, `npm run test:effect-runtime`, `npm run test:effect-ui`, `npm run test:collection-ui`, `npm run test:collection-interaction-ui`, `npm run test:collectibles-shop`, `npm run test:responsive-shell-layout`, `npm run test:home-loadout-layout`, `npm run typecheck`, `npm run build`, `git diff --check`, and the required real-app web-game smoke client. Visually inspected desktop/mobile Dungeon cards, briefing, lead choice, battle phases, staged damage, encounter rewards, and completion.
- No outstanding TODOs for this cleanup.

## Dungeon card centering correction (2026-07-18)

- Current follow-up: the live Dungeon grid still shows internally left-shifted logos, titles, descriptions, stat boxes, and buttons, making otherwise equal card shells appear inconsistent.
- Root cause: the renovated grid retained the earlier flex card's `justify-content: space-between`; on a one-column CSS grid this left-aligned a max-content-width implicit track instead of filling the card.
- Added an explicit full-width grid column, stretch alignment, centered component anchors, and exact 550px minimum/maximum card sizing. Expanded the browser regression to measure every component's horizontal center at the reported 960px viewport as well as equal card dimensions and vertical anchors.
- The compatible Node 24 signed-in browser scenario completed both encounters with zero browser errors after confirming two equal 330x550 cards, exact horizontal center offsets, identical vertical anchors, and overflow-safe mobile sizing. Visually inspected the corrected 960px and 390px Dungeon grids.
- Passed `npm run typecheck`, `npm run build`, script syntax checking, `git diff --check`, and the required real-app web-game smoke client. The ordinary npm browser command currently selects the machine's Node 20 runtime, which the installed Supabase client no longer supports; the identical scenario passes under the repository's bundled Node 24 runtime.
- No outstanding TODOs for the card correction.

## Combat action-space follow-up (2026-07-18)

- Current follow-up: keep Submit Actions visible throughout Dungeon combat but disabled until every active Critter has an action; enlarge Critter slots and their four action/Skill controls; tighten vertical dice padding and the board-to-dice gap.
- Made Submit Actions a persistent combat-row control with phase/readiness gating, rebalanced Critter cards toward the action area, made all four combat Skill tiles explicitly fill a two-by-two grid, and allocated reclaimed dice/gap height back to the three battlefield slots.
- Added adaptive compact-desktop row sizing: at short intermediate windows the currently actionable player row and matching enemy row receive the tall track while non-action rows compress, retaining the authored top/center/bottom formation and preventing slot/dice overlap.
- Expanded the signed-in browser regression across 1440x1000, 960x720, and 390x844. It asserts persistent disabled Submit states before readiness, activation after all actions, four contained Action and Skill controls, 36px/29px minimum control heights, 196px/150px primary Critter cards, 2px dice padding, 5px/3px board gaps, and no viewport overflow.
- The complete two-encounter Dungeon scenario passed with zero browser errors. Visually inspected desktop, compact-desktop, mobile Action menus, mobile/desktop four-Skill menus, the final real-app smoke render, and the text-game state.
- Passed `npm run test:responsive-shell-layout`, `npm run typecheck`, `npm run build`, script syntax checking, `git diff --check`, the compatible Node 24 Dungeon browser scenario, and the required web-game smoke client.
- No outstanding TODOs for this follow-up.

## Combat panel and dice-track correction (2026-07-18)

- Current follow-up: remove the divider overlapping the HP/action boundary, make Critter cards taller again, remove every pixel between the battlefield and dice row, and make the dice row hug its inner die cards vertically.
- Removed the action area's top border, disabled automatic combat-grid row stretching, changed the board-to-dice track gap to zero, removed dice-row vertical padding/minimum height, and increased wide/mobile Critter height caps with the reclaimed space.
- Expanded browser geometry coverage for the absent divider, taller cards, zero board gap, zero dice padding, and a dice container no more than its border thickness taller than the tallest die card.
- The signed-in scenario verified 216px wide and 164px mobile actionable cards, a computed 0px action divider, a literal 0px board-to-dice gap, 0px vertical dice padding, and a dice row exactly 2px taller than its tallest inner die for the outer border.
- Completed both Dungeon encounters with zero browser errors and visually inspected desktop, 960x720 compact desktop, mobile, and roll-result layouts. The battlefield now meets the dice row directly without overlap at every tested size.
- Passed `npm run test:responsive-shell-layout`, `npm run typecheck`, `npm run build`, script syntax checking, `git diff --check`, the compatible Node 24 Dungeon browser scenario, and the required web-game smoke client.
- No outstanding TODOs for this correction.

## Party XP ordering and color (2026-07-18)

- Current follow-up: encounter XP cards must use a two-by-two grid for a Rollcaster plus three equipped Critters, with the Rollcaster first and blue Critter XP bars.
- Moved the active Rollcaster card before squad Critters, replaced the responsive auto-fit grid with an explicit two-column grid, styled Critter XP fills blue, and kept the Rollcaster fill visually distinct in purple.
- Expanded the disposable signed-in fixture to three equipped Critters and added exact DOM order, two-row/two-column alignment, computed blue-gradient, artwork, and final-outcome persistence assertions.
- Added phone-specific compact card internals so the fixed two-by-two grid remains readable at 390px without identity or XP text crossing card boundaries.
- Completed both Dungeon encounters with zero browser errors and verified Rollcaster-first ordering, three following Critters, two columns/two rows, blue Critter bars, purple Rollcaster bar, artwork, and contained mobile content. Visually inspected desktop encounter, mobile encounter, and final outcome XP sections.
- Passed `npm run typecheck`, `npm run build`, script syntax checking, `git diff --check`, the compatible Node 24 Dungeon browser scenario, and the required web-game smoke client.
- No outstanding TODOs for this correction.

## Contextual combat submission and action reselection (2026-07-18)

- Current follow-up: add small gaps around the dice track, give its die cards exactly 5px vertical padding, replace the center Roll Dice control with Submit Actions during action selection, keep selected-action status on one row, color only its target, and retain a back arrow for action changes.
- The dice track now sits 5px below the battlefield, uses 5px top/bottom padding around its die cards, and sits 5px above narration. Its center position switches exclusively between Roll Dice and readiness-gated Submit Actions, with no duplicate bottom submission control.
- Selected actions now use a single non-wrapping status row. Skill and action text retain the normal muted treatment while only target names/descriptions use red for opponents or green for friendlies.
- Added a persistent reselect arrow to every queued player action. Reselecting an earlier Critter removes that action and any later queued actions, restores the correct action menu, and disables submission until the sequence is complete again.
- Expanded the live browser regression for contextual control visibility, exact desktop/mobile gap and padding geometry, one-line selected status, enabled submission after readiness, and functional action reselection.
- The compatible Node 24 signed-in scenario completed both Dungeon encounters with zero browser errors. Visually inspected the desktop action menu, selected-action state, and 390x844 mobile action layout.
- Passed `npm run build`, `git diff --check`, and the complete compatible Node 24 Dungeon browser scenario.
- No outstanding TODOs for this follow-up.

## Combat Mana-panel identity grouping (2026-07-18)

- Current follow-up: place each combat Rollcaster portrait immediately above its name instead of leaving a large flexible gap between them.
- Bottom-aligned the Rollcaster portrait within the wide Mana panel's flexible artwork track so it sits directly over the name while retaining the existing centered panel balance. Applied the same treatment to the enemy emblem and label for side-to-side symmetry; compact horizontal panels remain unchanged.
- Added wide-layout browser geometry checks requiring both artwork-to-label gaps to remain between 0px and 16px.
- Passed `npm run build`, browser-script syntax checking, the required web-game client smoke run, and the complete compatible Node 24 Dungeon browser scenario. The signed-in run cleared both encounters with zero browser errors, and the updated combat capture was visually inspected.
- No outstanding TODOs for this follow-up.

## Compact Dungeon failure outcome and shared logo sizing (2026-07-18)

- Current follow-up: reduce the “Your squad has fallen” heading, stop the failure pane from stretching to the bottom of the viewport, center a lone Final Encounter drops pane, and keep the shared Rollcasters logo at its normal signed-in size throughout Dungeon screens.
- Removed the Dungeon-only desktop/mobile logo size caps, reserved the shared header’s actual height above combat, made outcome panes content-height, reduced failure-only title/emblem sizing, and centered a single reward pane on the same bounded track as Party XP.
- Expanded the responsive shell regression with an exact failure-outcome fixture at 1330x1236 and 390x844. It verifies the normal-page and Dungeon logo dimensions match (360x88 desktop, 116x47.67 mobile), the failure title stays at or below 46px, the lone reward pane is centered and no wider than 620px, and the panel ends within 36px of its action row.
- Passed `npm run build`, `npm run test:responsive-shell-layout`, browser-script syntax checking, `git diff --check`, the required real-app web-game client, and the complete compatible Node 24 Dungeon browser scenario. The live scenario cleared two encounters with zero browser errors and retained overflow-safe combat at 1440x1000, 960x720, and 390x844. Visually inspected the desktop/mobile failure fixtures, the live compact combat screens, the real completion pane, and the unauthenticated app smoke render.
- No outstanding TODOs for this follow-up.

## Anchored Dungeon combat heading (2026-07-18)

- Current follow-up: keep the Dungeon expedition/name/encounter text anchored to the true horizontal center while combat phases change, and add a little breathing room below the Rollcasters logo.
- Replaced the unequal auto-width header sides with equal flexible tracks, fixed the heading to the dedicated center track, anchored the back control and phase badge to the outer edges, and reserved the added logo gap in the combat viewport height.
- Expanded the live Dungeon fixture to measure the heading before rolling and after entering action selection. It requires the heading to match both the combat-header center and the Rollcasters logo center within 0.6px, remain on the exact same x-coordinate across the phase-badge change, and retain at least 8px below the logo; the live render measured a 12px vertical gap.
- Passed `npm run build`, `npm run test:responsive-shell-layout`, browser-script syntax checking, `git diff --check`, the required real-app web-game client, and the complete compatible Node 24 Dungeon browser scenario. The disposable run cleared both encounters with zero browser errors, and the centered 1440x1000 and 960x720 action-selection captures were visually inspected.
- No outstanding TODOs for this follow-up.

## Proportional short-monitor combat fit (2026-07-18)

- Current follow-up: on wide but shorter monitors, keep the complete combat screen visible by shrinking its established composition proportionally instead of clipping the narration at the viewport bottom.
- Added a measured viewport-fit layer around the combat header, battlefield, dice, narration, and contextual command row. It retains scale 1 when the composition already fits and applies one centered uniform scale only when its natural height exceeds the remaining viewport.
- Kept fixed lead-selection and result overlays outside the transformed layer so their viewport anchoring is unchanged.
- Added a 1912x953 live-browser regression matching the reported monitor shape; it requires a slight sub-1 scale, equal side gutters, unchanged logo centering, a fully visible narration panel, and no document overflow.
- The disposable signed-in run completed both encounters with zero console/page/network errors and passed the reported short-wide monitor case plus the existing 1440x1000, 960x720, and 390x844 combat cases. Visually inspected the 1912x953 action-selection capture: the complete narration box is visible, the original formation is preserved, and the centered side gutters are balanced.
- Passed `npm run typecheck`, `npm run build`, `npm run test:responsive-shell-layout`, browser-script syntax checking, `git diff --check`, the compatible Node 24 Dungeon browser scenario, and the required web-game client. Visually inspected the final generic smoke render and confirmed its text state matches the clean unauthenticated screen.
- No outstanding TODOs for this viewport-fit correction.

## Staged combat Swap handoff (2026-07-18)

- Current follow-up: when the Swap resolution step occurs, animate the outgoing Critter toward the player Rollcaster slot, reveal the incoming Critter and all of its slot information in the same battlefield position, and prevent later combat steps from progressing until that reveal is complete.
- Added explicit Swap presentation metadata for outgoing/incoming combat keys and the preserved battlefield slot. Event playback now commits the active-unit handoff and recomputes active effects at the reveal boundary; advancing directly to a later event also commits the handoff defensively.
- Added backward-compatible metadata reconstruction for already-saved Swap playback events created before this animation contract.
- Added a measured Rollcaster-directed motion vector that remains correct under the combat viewport scale, a 720ms outgoing sprite/status animation, a complete incoming-card reveal, and a locked narration control until the new slot has remained visible through the 1.18s staged handoff.
- Extended `render_game_to_text` with combat-unit keys plus Swap details and a `revealed` flag, and expanded the signed-in Dungeon browser scenario to cover the complete outgoing → incoming → later-event sequence when remote disposable-user testing is explicitly permitted.
- Added deterministic runtime coverage for metadata, reveal-time active/stat recomputation, later-event ordering, and legacy playback. Added a local-only Playwright visual regression that verifies the Rollcaster-directed vector, locked narration, incoming sprite/name/level/Mana range/HP, and reveal animation.
- Passed `npm run test:effect-runtime`, `npm run test:combat-swap-ui`, `npm run test:responsive-shell-layout`, `npm run typecheck`, `npm run build`, browser-script syntax checks, `git diff --check`, and the required local web-game client smoke. Visually inspected the outgoing-at-Rollcaster and fully populated incoming-slot captures plus the clean authentication smoke render.
- The remote disposable-user `npm run test:dungeons:browser` execution was not run because the environment safety reviewer rejected service-role mutations without explicit user authorization. The test scenario itself now contains the Swap assertions and remains ready for an explicitly approved development-database run.

## Immutable catalog/static asset release implementation (2026-07-20)

- Current request: fully implement the Game-side optimization and new storage architecture from `docs/18-combo-optimization.md` and `docs/19-combo-storage-and-db-audit.md`, then identify the remaining production/account steps.
- Added a production fail-closed static catalog loader: it revalidates `latest.json`, verifies release/pack/asset-manifest SHA-256 hashes and versions, assembles exactly one four-pack release, enforces minimum Game versions, cross-checks every asset registry checksum, caches only verified artifacts, and recovers from the last compatible Cache Storage release offline. Live catalog and legacy player fallbacks are now explicit development migration paths.
- Added a repeatable-read catalog exporter with explicit public projections, deterministic JSON/key/row ordering, runtime/reference/Element-chart validation, tiered hashed packs, manifests, release report, optional validated-release metadata recording, and fixed published-time support for byte-identical reruns.
- Added a Sharp-powered immutable art pipeline with WebP icon/thumb/card/battle/portrait outputs, per-variant hard budgets, initial-home/full-default total budgets, content-hash filenames, and cross-variant byte deduplication. The live read-only export produced 196 logical variants backed by 99 objects / 1,959,446 bytes; default referenced art is 1,218,456 bytes and initial-home art is 136,354 bytes. A clean deterministic rerun produced the same manifest SHA-256 `abbd8161868e74e6bd91b416af5b78101ebd457efbd78c394dd24a601d28cf6a`.
- Replaced the 1.19 MB bundled logo transfer with a visually verified 53 KB WebP build asset while retaining the original source master.
- Added an R2/S3-compatible publisher that uploads/remote-verifies immutable objects, refuses overwrites, applies one-year immutable caching, and switches the revalidated pointer last. Publishing and database release-state changes remain explicit commands; no remote object or database row was mutated during implementation.
- Added migration `20260720000000_static_catalog_releases.sql` with release/artifact ledgers, narrowed transitional shop-catalog JSON, player revision triggers, and the single authenticated `player_bootstrap_v1()` RPC. Static player startup now rejects a server/client release mismatch.
- Added unit and focused browser coverage. The real generated release loaded 4 packs and 196 variants from the static origin, loaded a hashed art object without Supabase Storage, then reloaded fully from Cache Storage with the static origin intentionally blocked. The required web-game smoke showed the optimized logo and clean auth UI.
- Added `docs/21-static-catalog-release-runbook.md` with exact migration, R2/CORS/cache, export/review, publish, production configuration, rollback, monitoring, and Content Studio follow-up steps.
- Remaining external work: apply the new migration; create/configure the R2 bucket/custom domain/API token; export an approved release with `--record`; upload, preview, and publish it; set production catalog/asset origins; then prove zero current-client Supabase catalog/Storage requests and seven days of budget headroom. The separate Content Studio still needs its protected review/publish UI and remaining route-scoped/paginated hydration work.

## 2026-07-20 — Supabase-first art/catalog release integration

- Kept the current live Supabase catalog and legacy player bootstrap as production-safe defaults. Immutable catalog releases and `player_bootstrap_v1` are now separate explicit opt-ins through `VITE_GAME_CATALOG_MODE=release` and `VITE_GAME_PLAYER_BOOTSTRAP_MODE=v1`.
- Synchronized the release ledger schema with Content Studio and split compact player startup into the shared `20260720020000_player_bootstrap_v1.sql` forward migration. The matching migration files in both repositories have identical SHA-256 hashes.
- Updated the compatibility exporter/publisher for the richer release ledger and Supabase Storage S3 as the default target; R2 remains optional.
- Verified a real read-only catalog/art export: four packs, 196 variants, valid manifests, online/offline load, and tamper rejection. Also loaded the actual Content Studio build in the Game: 172 variants, four canonical packs, online verification, offline cache, and tamper rejection.
- Kept release-mode catalog and legacy player loading compatible during the staged rollout; server catalog-version enforcement activates only with the v1 player bootstrap. The v1 RPC reads the authoritative `content_release_channels.production` pointer instead of choosing an arbitrary published release.
- Ran typecheck, production build, catalog contract tests, browser release tests, npm audit (zero vulnerabilities), the prescribed web-game client, and visual inspection of the auth screen and generated Critter art.
- No production migration, bucket mutation, candidate recording, or release publish was performed.
- Operator TODO: create the public Supabase `game-releases` bucket and S3 credentials, dry-run/apply the three forward migrations, publish from Content Studio, preview release mode, then switch catalog and compact player modes independently as documented in `docs/21-static-catalog-release-runbook.md`.

## 2026-07-20 — Published release art missing in Game

- Diagnosed published release `2026.07.20.2` end to end. The public pointer, hashed manifest, four packs, 172-entry asset manifest, and sampled WebP all return HTTP 200 with matching hashes.
- Root cause: the Game remained in `VITE_GAME_CATALOG_MODE=live` while `VITE_GAME_ASSET_BASE_URL` pointed at the hashed release-art root. Live source-master paths therefore resolved against filenames that exist only in release catalogs.
- Switched the local Game environment to release mode and hardened the runtime so live mode or a live fallback always uses the original Supabase `game-assets` bucket instead of mixing live paths with a release asset root.
- Extended the release browser regression to load the running Game's configured catalog, resolve art through `getGameAssetUrl`, decode the image, assert the `game-releases/game-assets` origin, and capture the rendered published art.
- Passed typecheck, production build, catalog contract tests, the prescribed web-game client, and the live published-release browser flow (online, offline cache, tamper rejection, and rendered Spreagle artwork for `2026.07.20.2`).
