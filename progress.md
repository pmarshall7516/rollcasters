# Rollcasters progress
Original prompt: On the main page, show level-eligible Critter skills in skill-slot popups and allow unlocking them with skill points.

## 2026-08-15 — Unified Shop cards and derived progress

- Aligned Shard, Relic, and Lootbox cards around the same art/name/purchase/action rows; Shard names retain Critter element logos, price lines contain one item count and the saved currency asset, and Shard/Relic cards share progress bars.
- Added touch-friendly decrement/input/increment controls and automatic quantity reset after an offer reaches its ownership cap.
- Shop Shards and Shop Relic challenge displays and gate eligibility now derive from the same inventory state used by Shop progress, ignoring stale or missing generic challenge-progress counters.
- Focused collectible/shop, quantity projection, and purchase-flow tests, typecheck, production build, and the required generic browser smoke pass. The authenticated Shop visual run remains blocked by DNS resolution for the configured Supabase database host.
- Follow-up: all three Shop tabs now use identical art/name/price/filler/action grid rows, cyan 19px item names, matching card surfaces, reduced top padding, and bottom-pinned quantity/Purchase controls. Quantity is a read-only display changed only by −/+, capped at 99 for Lootboxes and at the bundle-aware remaining Shard/Relic ownership requirement.
- Follow-up: live account audit found durable progress was already correct (`critter:001` 49/50 and Gambler's Rune 35/50). The false maxed Shop state came from the deprecated local deferred-purchase ledger, not database rows. Removed deferred/optimistic Shop sessions, clear old ledgers on load, await each selected-quantity purchase immediately, and block repeat clicks while it commits.
- Applied the existing `20260814120000_quantity_shop_purchases` migration to live through the TLS-verified pooler and verified `purchase_shop_entry(uuid,uuid,bigint)` is exposed by PostgREST. No live inventory/challenge data was changed.
- Shared quantity controls now use a purple/cyan/gold themed presentation in both cards and the Lootbox popup. Shard/Relic bars show a distinct gold projected segment for the selected quantity. Focused Shop suites, typecheck, build, diff check, live schema verification, and generic browser smoke pass. The full Lootbox browser fixture could not find its authored Common Lootbox, and the rollback DB fixture had no unowned Critter available.

## 2026-08-14 — Combat Swap cancel affordance

- Regular Swap now enters a dedicated swap menu on the acting Critter card, keeping its action-space Back row visible as `Back to Action Menu` while squad targets remain selectable.
- Clicking that Back row, or using the combat Shift-back shortcut, clears only the pending swap selection and returns to the normal action menu.
- Typecheck, Swap UI/presentation, action-layout regressions, production smoke capture, and screenshot inspection pass. Live authenticated combat interaction was not available in the smoke environment.

## 2026-08-14 — Quantity shop purchases

- Current task: add integer quantity controls to every shop, multiply displayed prices, make rapid purchases optimistic and responsive, and reconcile durable currency/inventory safely without duplication.
- Added client quantity pricing/projection helpers and a serialized per-account purchase queue. Rapid clicks on one offer coalesce into one idempotent batch request after a short quiet period; the server receipt replaces the optimistic projection.
- Added the quantity purchase RPC migration and focused client/DB regression coverage. Migration application and live browser verification remain to be run.
- Typecheck, production build, collectible/shop business rules, quantity projection tests, responsive shell browser tests, the generic web-game smoke capture, and inspected quantity-row geometry pass. The configured Supabase hostname is unreachable from this environment, so the migration and rollback-only DB test remain unapplied/unrun here.
- Follow-up: quantity inputs now use the shared shop theme radius, borders, hover state, and focus ring. Lootbox card purchases open the purchase popup with the selected count visible, keeping the same 25/75 quantity-to-purchase row on desktop and mobile.
- Follow-up: purchase buttons now stay labeled `Purchase`; changing quantity updates only the adjacent `quantity × currency icon cost` display on Shop cards and Lootbox purchase popups.
- Follow-up: multi-quantity purchases now detect an unavailable deployed quantity RPC and serialize deterministic, idempotent legacy unit calls instead of surfacing the generic purchase error. Partial legacy batches reconcile their committed receipt without rolling the local state back; stale refreshes are ignored while a purchase revision is newer, and pending batches flush on tab changes, Back, or Shop unmount.
- Follow-up: Lootbox purchases retain every granted box in the Bag, opening consumes one fresh idempotent request at a time, and the result action becomes `Open Another (X left)` while local remainder is available. Focused purchase-flow, projection, collectible/shop, typecheck, build, and app smoke checks pass; live Supabase verification remains blocked by DNS resolution for the configured project host.
- Follow-up: fixed the remaining spam-purchase snap-back. The missing quantity-RPC compatibility guard incorrectly threw for every coalesced quantity greater than one, which invoked optimistic rollback before the legacy fallback could run. The fallback decision now applies to any valid batch quantity, with regression coverage for `PGRST202` bulk fallback and optimistic-to-durable currency/inventory continuity.
- Follow-up: Shop purchases now remain in an App-owned, localStorage-backed optimistic intent ledger for the full Shop visit. Purchase rewards and Lootbox acquisition controls appear immediately; changing Shop tabs stays local, while leaving Shop sends one `purchase_shop_entries(jsonb)` RPC that reprices and applies every currency debit and item grant in one server transaction. The ledger keeps stable request IDs for safe retry and Lootbox opening awaits any outstanding flush. Added the generated `20260814193615_atomic_shop_session_purchases.sql` migration and atomic rollback/success coverage; live DB execution remains blocked by the configured Supabase hostname DNS failure.
- Follow-up: Lootbox results now show `Back` and `Open Another (X left)` side-by-side. `Back` closes the modal to its Shop or Bag origin; when no boxes remain, Back expands across the result action row. Typecheck, build, focused Shop tests, migration selection, browser smoke, and inspected mobile result geometry pass.

## 2026-08-14 — Combat opponent Critter sprite sizing

- Removed a legacy opponent descendant `.sprite` grid-placement rule that could interfere with the current shared Critter sprite frame layout.
- Added `npm run test:combat-critter-sprite-layout` coverage across desktop, tablet, small-PC, and mobile viewports to verify matching player/enemy frame, sprite, and image dimensions, contained art, and enemy-only horizontal flipping.
- Typecheck, production build, combat panel/action/swap regressions, sprite containment, and the required web-game smoke capture pass; focused desktop/mobile captures were inspected.

## 2026-08-14 — Enemy replacement swap direction

- Fixed the incoming half of the combat Swap animation using the inverse of the field-to-squad vector, which made an automatically selected enemy replacement enter from the wrong side and look like a zoom.
- Shared the field-to-squad offset calculation between outgoing and incoming Swap legs and added `npm run test:combat-swap-motion` with red-before-fix coverage for both directions.
- Typecheck, production build, effect runtime, combat Swap UI, and generic web-game smoke checks pass; inspected the Swap and smoke screenshots. The disposable live Dungeon flow remains blocked by its existing three-Critter fixture setup before combat begins.

## 2026-08-14 — Combat Mana reservation display

- Player combat Mana now derives its visible value from the battle balance minus queued action costs during action selection. The reserved balance is yellow, and submitting the complete action set starts a shake/color transition toward the normal blue value.
- Follow-up: removed the submit color fade so the value switches directly from yellow reservation styling to the normal blue/cyan while the shake plays.
- Follow-up: kept the submit blue state active until the combat phase advances, preventing slow turn loading from restoring yellow before the resolved state arrives.
- Added `npm run test:combat-mana-selection` for source, color, animation, accessibility-label, and settled-state coverage.
- Typecheck, production build, combat Mana/panel/action/target Playwright regressions, and the generic web-game smoke capture pass; the new reserved/shake/settled captures were inspected.

## 2026-08-14 — Back to Skill Menu during target selection

- Combat target selection now keeps the acting Critter's back-control row visible.
- The control reads `Back to Skill Menu` and returns to the selected Critter's Skill Menu without submitting or clearing the action.
- Typecheck, production build, combat action-layout and target-emphasis Playwright regressions, and the generic web-game smoke capture pass; the generated screenshots were inspected.

## 2026-08-10 — Critter send-out presentation

- Combat Swap narration now uses explicit send-out copy: `You sent in <Critter>` for the user and `<enemy name> sent out <Critter>` for enemy replacements/Swaps.
- Knockout replacements at the next turn boundary are staged as the same animated Swap presentation used by ordinary Swaps. The outgoing slot remains visible, the incoming Critter reveals from the squad pane, and the next turn is unavailable until the reveal settles.
- Confirmed player replacements and automatic enemy replacements both use the staged event path; entry dialogue is not replayed during a replacement.
- Typecheck, production build, inline combat runtime tests, and the Playwright swap animation fixture passed. Inspected outgoing/incoming captures with the new narration and zero fixture browser errors.

## 2026-08-10 — Combat primary action grid anchoring

- Fixed the primary Skill/Block/Swap/Skip menu placing into the reserved Back-control row when no Back control is visible, which caused the two action rows to overlap at narrow combat viewports.
- Anchored all combat action submenus to the second action-space row so primary actions and the Back + skills menu share stable geometry.
- Added `npm run test:combat-action-layout` with narrow viewport geometry assertions and inspected primary/skills captures; typecheck, build, and the existing combat swap UI regression pass.

## 2026-08-10

- Added home-page Critter equip slot compaction: selecting a Critter for an empty higher-numbered squad slot now uses the earliest open slot up to the requested slot, while replacements and removals stay in the selected slot.
- Added pure helper coverage for slot 4/5 requests with slot 3 open and the occupied-slot guard.

## 2026-07-29

- Updated the home Critter skill picker so level-eligible locked skills use the same dimmed tile and opaque centered unlock-button treatment as the Critter collection popup.
- Verified the overlay with a Playwright fixture, including opaque button, button-over-tile placement, requirement text below the tile, and no horizontal overflow.

The working progress log is maintained in the shared Obsidian vault:
`../rollcaster-docs/10 Source Docs/rollcasters/progress.md`.

## 2026-08-10 — Equip Relic tooltips

- Moved Relic effects out of the equip-popup cards and into the shared hover/focus tooltip, preserving positive/negative/mixed effect coloring and source-Critter inactive styling.
- Kept each card focused on the Relic sprite, name, and available count; normalized the tooltip-wrapped card width and three-row layout.

## 2026-07-30

- Added Critter Revival and Skill Usage Restriction combat runtimes, per-Critter use/recharge state, Dungeon persistence, disabled Skill UI, and knocked-out bench targeting.
- Focused runtime tests, typecheck/build, simulator parity, and inspected web-game client captures pass.

## 2026-07-31

- Fixed Mana dice modifier bounds so the minimum is capped at the maximum in combat and loadout stat displays/tooltips. Added focused combat, direct-roll, and loadout regressions; game and simulator typechecks pass.

## 2026-08-01

- Collection detail modals now reset to the top when opened and focus the visible close control without scrolling the pane.
- Skill and ability cards now share a solid light-blue background across detail popups, equip popups, equip slots, starter selection, and combat displays.
- Verified with TypeScript/production build, focused desktop/mobile Playwright layout checks, computed-style parity checks, inspected screenshots, and the web-game client auth-screen smoke test. No follow-up TODOs for this change.
- Lootbox shop and Bag cards now use square, centered grid cards with larger transparent sprite presentation, clean names, prices, quantities, and purchase actions. Lootbox detail popups now hide scrollbars, use a larger hero sprite, and present possible rewards in a consistent multi-column card grid with reliable collectible art.
- The purchased Lootbox popup now focuses Open Now automatically and keeps Space as the keyboard shortcut without displaying a separate Space keycap. Bag category tabs stay in one row across the inventory view.
- Verified with `npm run build` and the live disposable `test:lootboxes:browser` flow, including purchase, Bag storage, opening reel alignment, persisted opening count, and browser error checks.
- Added a visible sprite fallback while authored lootbox/currency assets are loading so shop cards never present an empty art slot.

## 2026-08-03

- Final lootbox cleanup in progress: shop-card purchases stay on the grid and expose Open Now / Send to Bag, while the purchase RPC remains the durable Bag write.
- Replaced the runtime-variable CSS reel keyframes with one measured Web Animation API transform so the predetermined winner settles smoothly without a timing-function step.
- Opening now starts the visual sequence immediately after the atomic open RPC returns; the snapshot refresh runs in the background because the reward and inventory mutation are already committed server-side.
- Tightened lootbox shop cards and preserved non-interactive sprites on shop cards; expanded the disposable browser flow to cover direct grid purchase, refresh persistence, Bag visibility, idle popup state, sprite activation, reel alignment, and opening persistence.
- Finalized the Bag handoff: the shop-grid Send to Bag action refreshes the durable inventory projection and navigates to Bag, and the browser flow now verifies compact card height, popup action ordering, click activation, Space activation, reload persistence, and two idempotent openings.
- Final live validation passed with no browser errors; inspected shop, Bag, idle popup, reel, and result screenshots. The generic web-game client smoke check also passed after allowing the local Chromium process launch.

## 2026-08-04

- Lootbox shop Purchase buttons now open the unowned popup; the popup Purchase action performs the durable purchase before exposing Open Now and Send to Bag.
- Lootbox pool shard art now uses the same clipped diamond sprite frame and proportions as Bag and Shard Shop cards, without the popup-only rounded square treatment.
- Updated the live browser flow to verify Purchase-to-popup behavior, popup purchase, Bag handoff, and rendered diamond styling. Build, typecheck, and browser smoke validation pass.
- Fixed Lootbox Shop affordance state so durable Bag ownership does not make a fresh shop visit show Open Now / Send to Bag. The shop now starts each entry at Purchase, records the current purchase locally after the popup Purchase action, and resets to Purchase after either decision.
- Refined Bag Lootbox cards into compact interactive cards with an explicit Open button. Owned Lootbox modals now show only Open Now, and the disposable browser flow checks card height, Open activation, and the absence of Send to Bag.
- Narrowed Lootbox-only shop and Bag grid columns, inset and compacted card action buttons, and reduced popup width/footer button sizing across purchase and owned-item flows. Browser coverage now checks the rendered widths.

- Skill unlock actions in the main-page equip dialog now stay opaque and clickable when the Critter lacks enough skill points, matching the collection popup's unlock button. Insufficient-point clicks flash the unlock button border red on both skill unlock surfaces; successful unlocks still use the existing saving state.

## 2026-08-04 — Lootbox opening layout

- Reserved fixed grid rows for the opening box, reel, and result content so adding the reel or win message cannot reflow the other elements.
- Normalized the Lootbox modal to a stable 820×872 desktop footprint (responsive 760px mobile footprint) across idle, reel, and result phases.
- Added live browser assertions for popup size stability, anchored slot positions, predetermined reel alignment, persisted opening counts, and browser errors. Build, smoke check, and full Lootbox browser flow pass; inspected idle, reel, and result screenshots.
- Main-page equipped-skill popups now show every skill authored for that Critter, including future level-locked skills. Level-eligible unowned skills retain their centered Unlock action, while future skills stay greyed out with their level requirement. The skill list is now the scroll surface so the popup header, search, point balance, and actions remain usable with large skill catalogs.
- Typecheck, skill-equip layout, and home-loadout layout checks pass. The live point-unlock flow passed the Critter skill popup checks and later stopped at an unrelated Rollcaster Ability fixture assertion; the shell's Node 20 run was also replaced with the bundled Node 24 runtime for that check.
- Matched popup-locked skill tiles to the existing equipped-disabled treatment: the same grayscale and opacity values, removing the extra yellowish/different tint. Rebuilt, reran the focused layout check, rendered an isolated comparison fixture, and inspected the smoke capture.
- Split the main-page skill picker into labeled Unlocked skills and Locked skills sections with a horizontal divider. Added left scroll padding so first-column equipped circles are fully visible. Typecheck, focused layout validation, isolated visual comparison, and smoke capture pass.
- Made the Locked skills header use the same left-aligned label component and typography as Unlocked skills, with the divider rendered beneath it. Build, focused layout validation, and final visual smoke checks pass.

## 2026-08-04 — Lootbox reward copy and Bag handoff

- Lootbox result popups now use one reward line in the format `You Won x<amount> <reward name>`, with collectible shard rewards explicitly ending in `Shards`.
- Sending a purchased Lootbox to the Bag refreshes durable inventory state but keeps the user on the Lootbox Shop so they can continue purchasing.
- Updated the disposable Lootbox browser flow to assert the Shop stay-on-page behavior and exact reel/result reward copy. Build, typecheck, live Lootbox flow, and local Chromium smoke check pass.

## 2026-08-04 — Lootbox result spacing polish

- Restored the yellow `YOU WON` label above the single `x<amount> <name> Shards` reward line.
- Matched the vertical spacing above and below the reel by top-aligning the reward slot and using the same opening-stage gap.
- Re-ran the live Lootbox flow and inspected the result screenshot; copy, spacing, alignment, and browser assertions pass.

## 2026-08-04 — Lootbox reward inventory progress

- Shard and Relic lootbox rewards now show animated progress against the shard unlock cap or Relic `max_owned` cap, using the pre-opening count and server-confirmed granted amount.
- Maxed or overflowing rewards animate the bar to the cap, shake the progress panel, and show the converted duplicate currency amount inside the panel.
- Added live assertions for reward progress presence and result-content bounds. Shard and Relic screenshots were inspected; build, typecheck, and live flow pass.

## 2026-08-04 — Receive Damage challenge progress

- Reproduced the missing Doc `Receive Damage (Any Species)` progress through the live combat-progress RPC: a first `hp_damage_taken` event was accepted but skipped because a challenge with no history row projected `complete = NULL`, so `NOT state.complete` filtered it out.
- Added shared migration `20260804120000_null_safe_challenge_progress_state.sql` to normalize missing event progress to zero and make challenge state booleans null-safe.
- Added `npm run test:challenge-progress:db`, a rollback-only regression that submits a first normalized damage event and verifies persisted progress. The regression passes after migration.

## 2026-08-04 — Collectible challenge runtime audit

- Combat actions that consume Mana now emit normalized `resource_spent` events with the actual cost and authored Critter/action context.
- Shop purchases now emit normalized coin, Prismite, or custom-currency spend events, allowing global Resource Spending challenges to advance without occupying a tracking slot.
- Shared collectible challenge runtime migrations now evaluate global event challenges for every submitted event, enforce Resource Spending filters, and project unique Critter requirements correctly for collection-diversity challenges.
- Audited the live catalog across all collectible challenge types and tracking configurations. Added rollback-only coverage for global versus selected Resource Spending, real shop purchases, Dungeon Clear, authored Critter filters, gating, persistence, and duplicate event handling.

## 2026-08-04 — Lootbox release pricing

- Reproduced Common Lootbox pricing drift: the active release snapshot charges 40 Coins while the editable live Shop row was changed to 100.
- Added `20260804170000_release_shop_purchase_pricing.sql` to charge Lootbox purchases from the active production release snapshot and fail closed when no released price exists; editable Shop prices remain available for future releases.
- Added `npm run test:release-shop-pricing:db`, a rollback-only regression that passes with release=40 and unpublished=100. Typecheck and production build pass.
- The live browser flow was not run because its disposable authenticated purchase was blocked by the safety review; the database regression exercises the real purchase RPC.

## 2026-08-04 — Unlock-aware collectible ownership

- `own_collectible` progress now counts only collectibles that are unlocked through their own configured challenge requirement, so raw Relic inventory cannot satisfy a dependent Critter unlock.
- Added shared migration `20260804180000_unlock_aware_collectible_ownership.sql` and rollback-only `npm run test:collectible-ownership:db` coverage for a raw-but-locked Relic dependency.
- Client projections use the same unlock authority. Focused business-rule tests, the live database regression, typecheck, and production build pass.

## 2026-08-04 — Mech Core combat effects

- Shield grants now honor `can_stack` and `replace_existing_shield`: non-stacking grants raise a smaller Shield to the authored value without lowering a larger Shield.
- Dungeon root Shield Relic effects are applied at encounter start only, including after lead selection, and do not reapply when a Critter swaps back in during that encounter.
- Mech Core’s Mechanical-only 10 Shield and Mechanical/Thunder 10% ATK behavior has focused runtime and Dungeon lifecycle coverage; the live Shield row is now non-stacking.
- Focused effect tests, typecheck, production build, and the local Playwright smoke run pass. The current published catalog release predates Mech Core, so it will require the normal next catalog/app release to appear in production.

## 2026-08-04 — Mechanical Press Shield timing

- Attack Skills with root `shield_modifier` Effects using `operation: "destroy"` now resolve those Effects against all Skill targets before the attack damage loop.
- Added a Mechanical Press regression proving a shielded enemy loses its Shield first and then takes HP damage, without a Shield-absorbed damage presentation.
- Verified the live Mechanical Press definition is an attack Skill targeting one enemy with a root `targets` Shield destroy Effect. Runtime tests, typecheck, production build, and Playwright smoke pass.

## 2026-08-05 — Relic collection card details scroll

- Moved Relic card effects into the existing collection-card scroll surface, after the unlock challenge/ownership content, and removed the fixed 96px effect cap that was cutting rows off.
- Relic cards now expose a dedicated `Scroll relic details` scrollbar when the combined content overflows.
- Updated the collection layout fixture to assert effects are inside the Relic scroll pane and that overflow can be scrolled. Typecheck, production build, six-viewport layout validation, screenshot inspection, and generic web-game smoke check pass.

## 2026-08-05 — Tracked challenge completion banner and slot compaction

- Added a queued completion banner with the target collectible sprite, challenge description, and completion copy when a previously tracked challenge is completed during a refreshed game-state commit.
- Main-page tracking and collection tracking controls now derive a compact active list, so completed or manually untracked entries do not leave holes and reported slot numbers stay aligned with the display.
- Added sparse-slot regression coverage and production banner source assertions. Typecheck, collection UI logic tests, production build, and the generic web-game smoke capture pass; the smoke capture was inspected at `output/web-game-challenge-feature/shot-0.png`.

## 2026-08-05 — Shard Shop completion styling

- Shard Shop entries at or above their unlock goal now use the same completed state as Bag Shards: green diamond outline/glow, green progress bar, and completed shard status metadata while remaining disabled for purchase.
- Added completed-state assertions to the disposable Shard Shop browser flow. Typecheck, collectible shop business-rule tests, production build, local Chromium smoke, and direct rendered-style inspection pass. The disposable live fixture could not seed because the shared catalog currently has no isolated Critter available.

## 2026-08-05 — Completed Shop entry status copy

- Already-unlocked Shard Shop entries now replace the disabled button and red unavailable copy with green `Already Unlocked!` text.
- Max-owned Relic Shop entries now keep the normal full-card presentation instead of the greyed `sold-out` treatment, with green `Max Owned!` status text and no purchase button.
- Updated the disposable Shop browser assertions and inspected a side-by-side rendered fixture; typecheck, shop business-rule tests, production build, syntax/diff checks, and Chromium smoke pass.

## 2026-08-05 — Deduplicate tracked challenge completion banners

- Fixed repeated completion banners across browser refreshes by persisting seen challenge IDs per user in local storage, while retaining the in-memory guard for concurrent same-session refreshes.
- Added a red-before-fix / green-after-fix storage regression to the collection UI logic tests. Production build, notification fixture, and final browser smoke capture pass; inspected `output/web-game-challenge-dedupe/shot-0.png` and verified no console/runtime errors.

## 2026-08-05 — Bag grid card sizing

- Unified the Currency, Shards, and Lootboxes Bag grids under one responsive four/two/one-column layout with shared 240px desktop columns and fixed 270px card rows.
- Removed the visible `coins`/`prismite` ID labels from Currency cards.
- Enlarged Bag Lootbox sprites to 164px, compacted Shard cards and their progress bars to 170px, and removed the excess bottom spacing from the shared card height.
- Typecheck and production build pass; rendered desktop/mobile fixtures measured every Bag card at the same height and were visually inspected. The authenticated live flow was unavailable because the configured Supabase host could not resolve in the environment.

## 2026-08-05 — Bag Shard card alignment

- Removed the Shard collectible category pill from Bag cards.
- Centered the Shard sprite, collectible name/ID, progress bar, and count within the shared Bag card so the content sits lower in the slot without changing card dimensions.
- Typecheck, production build, desktop/mobile Shard renders, and the generic Chromium smoke capture pass.

## 2026-08-05 — Bag Lootbox popup spacing

- Bag-owned Lootbox popups now hide the currency balance pills while Shop purchase popups retain them.
- Added bottom padding below the Possible rewards grid and nudged closed Lootbox sprites upward by 6px to compensate for transparent top space in the authored art.
- Updated the disposable Lootbox browser assertions for the hidden Bag currencies, rewards-grid bottom spacing, and closed-sprite offset.

## 2026-08-05 — Shop and Bag grid anchors

- Added a shared heading-height slot before every Shop and Bag grid.
- Visible Shard group headings and invisible heading slots in Currency, Relic, and Lootbox tabs now use the same 29px heading height and 13px grid gap, keeping grid tops aligned across tabs.
- Desktop/mobile anchor fixtures report the same 42px grid offset for heading and headingless variants.

## 2026-08-05 — Shop card sizing

- Standardized Shard, Relic, and Lootbox Shop cards to the same 260px desktop/two-column width and 420px row height, with one-column full-width cards on mobile.
- Enlarged and vertically centered Lootbox Shop content inside the shared footprint so the common dimensions remain visually balanced.
- Representative desktop/mobile Shop fixtures measured all three card types identically with no overflow; typecheck, build, and Chromium smoke validation pass.

## 2026-08-05 — Combat turn loading

- Combat action submission now yields one browser turn so the transient loading state can paint inside the narration box as `Loading`, removes that box from keyboard controls while pending, and suppresses the app-wide Refreshing pill during combat. Combat-progress persistence remains awaited for error reporting, while the full app-data refresh runs in the background so narration can continue as soon as the turn is ready. Added a live browser regression for the pending state; build/typecheck pass, while the disposable Dungeon browser flow is blocked by its unrelated three-Critter fixture assumption.

## 2026-08-05 — Shop card cleanup

- Removed the category pill from Shard and Relic Shop cards and vertically centered their remaining content in the shared Shop card rows.
- Added a small circular info button to Lootbox Shop cards that opens the existing idle details popup without purchasing; shop sprites are nudged upward within the card.
- Updated the Shop browser assertions for the removed pills, info-button geometry/behavior, and current shared card sizing. Typecheck, production build, syntax checks, the authenticated Shard/Relic Shop flow, and the generic Chromium smoke check pass. The Lootbox live flow reached the Shop but the current fixture did not render a Common Lootbox on two retries; the broader disposable Shop fixture remains blocked by its existing no-isolated-Critter catalog assumption.

## 2026-08-05 — Shop action alignment

- Shard and Relic cards now use a dedicated bottom action slot, keeping Purchase buttons and completion status text aligned across cards; unavailable reasons render above the disabled button.
- Lootbox cards reserve the same bottom action row, Purchase buttons share a 214px width cap, and all Shop rows are reduced from 420px to 400px.
- Typecheck, production build, syntax/diff checks, Chromium smoke, and the authenticated Shop flow with width/bottom-alignment assertions pass; Shop screenshots were inspected.

## 2026-08-05 — Collection XP bar width

- Unlocked Critter and Rollcaster collection cards now share a centered 260px XP progress width, keeping the bars equal and more compact than the full card width.
- Increased those collection-only bars to 12px tall to use the available unlocked-card space more effectively.

## 2026-08-14 — Responsive home Critter stat rows

- PC Critter loadout slots now keep the stat grid in four columns and two rows through laptop-sized slot containers instead of collapsing to one-column vertical stats.
- In the compact PC range, stat-cell font size and padding scale with the slot container so stat names and values retain a small readable gap; the existing mobile/tablet fallback remains available below the compact threshold.
- Updated the home loadout layout fixture to assert two-row stats across the PC viewports and allow the tighter compact-cell padding.

## 2026-08-05 — Collection dynamic card height and Rollcaster descriptions

- Collection height measurement now observes every hidden card across the Critter, Rollcaster, and Relic grids, so the shared row height remeasures when any collectible’s content changes.
- Rollcaster cards now show their authored description below unlock challenges when locked or below XP progress when unlocked; descriptions participate in the tallest-card measurement.

## 2026-08-05 — Collectible popup descriptions

- Critter, Rollcaster, and Relic detail popups now end with a shared styled Description section using each collectible’s authored description, with a fallback when the catalog description is blank.

## 2026-08-05 — Rollcaster collection description alignment

- Rollcaster collection descriptions now align left with challenge copy; unlocked descriptions have a larger gap below the XP progress row.

## 2026-08-05 — Animated combat loading copy

- Combat’s locked narration now cycles quickly through `Loading.`, `Loading..`, and `Loading...` while action submission is pending, resetting cleanly for each pending state. Updated the browser assertion and text-state loading flag to recognize the animated copy. Typecheck, production build, focused combat UI regression, and Chromium smoke capture pass.

## 2026-08-10 — Eclipse Order enemies and five-Critter squads

- Original request for this work: implement `rollcaster-docs/docs/26-eclipse-order-enemies-and-new-squad.md` across the game, Content Studio, and AI Lab; create and apply the centralized Dungeon migration; and verify database, runtime, browser, and visual behavior.
- Implemented enemy Rollcaster profiles, relative two-sided Ability targeting, Random Action Block/Skill selection, dialogue-gated encounter flow, five-Critter squads, two-sided reserves/replacements, fixed Boss squads, and the compact five-slot home summary with full loadout modal.
- Synced the combat contract into AI Lab schema/runtime v2 with 1–5 Critters per side, reserve Swap actions for both trainable roles, replay support, and explicit active/reserve setup guidance.
- Added and applied the additive schema, five-slot, compatibility, and 100-Dungeon Eclipse Order migrations. Postflight: 100 reports, 303 Rollcasters/regular encounters, 39 Boss encounters, and zero economy, pool, encounter, profile, or slot violations.
- Added regression coverage for enemy-relative Ability targets, Random Action behavior, enemy forced replacement, Entry/Victor/Defeat sequencing, fixed Boss ordering, non-duplicated Rollcaster rewards, asset-save routing, and Dungeon Ability-tier hydration. All three builds, simulator tests, database integration, Content Studio browser layout, and focused main-game runtime/UI tests pass.

## 2026-08-10 — Home squad slot layout cleanup

- Replaced the home-page five-row squad summary and Edit Squad modal with the existing full `CritterLoadoutSlot` presentation used on `main`.
- Desktop layouts now place five slots in two columns over three rows, with slot five centered in the bottom row; narrower layouts retain full-width slots so the existing skill, relic, stat, and XP design stays readable.
- Updated the home loadout fixture to render five slots and assert slot count, row count, equal sizing, and centered final-slot geometry. Typecheck, production build, focused Playwright layout checks, visual inspection, and the running-app Chromium smoke check pass.

## 2026-08-10 — Home squad card spacing cleanup

- Loadout cards now place the Critter sprite, name, level, and XP in the top row, followed by a full-width four-column, two-row stat grid and the skill/relic equipment immediately below.
- Narrow cards retain responsive two-column and single-column stat fallbacks for readable XP, skill, and relic content. Focused responsive layout checks and visual captures pass.

## 2026-08-10 — Home loadout equipment sizing cleanup

- Limited the home Critter loadout presentation to six visible Relic slots in a three-by-two matrix and gave the two-by-two skill grid the larger share of the equipment width so its labels and icons scale up naturally.
- Empty squad slots now inherit the measured filled-slot height, including the minimum height fallback, keeping all five cards aligned across the three-row layout.

## 2026-08-10 — Combat Rollcaster panels and squad status

- Consolidated the combat squad strips into identical five-slot Rollcaster side panels: sprite, name, Mana, five fixed ability slots, and a centered-final-cell 3×2 Critter squad grid.
- Equipped abilities retain viewport-positioned hover tooltips on both sides; empty ability/squad slots use the filled dark treatment. Enemy reserve Critters remain `?` until revealed, then stay revealed through KO/revive state changes and expose element/name/HP tooltips.
- Relic icons in active Critter cards are larger while remaining in one row, and the Back control now appears only in Skill mode or on later Critter action menus.
- `npm run typecheck`, `npm run build`, the focused combat swap UI regression, and a representative browser geometry/screenshot fixture pass. The disposable live Dungeon regression reaches its existing three-Critter fixture assertion and stops before this combat scenario; no implementation error was reported.

## 2026-08-10 — Home squad equip slot compaction

- Empty higher-numbered Critter equip requests now resolve to the earliest open squad slot up to the requested position; selected Critter replacements and removals remain anchored to their chosen slot.
- Added unit coverage for slot 4/5 requests with slot 3 open and a browser-fixture assertion for the real slot-5-to-slot-3 flow. Typecheck, focused loadout tests, production build, and the authenticated-shell smoke capture pass.
- The disposable live equip-order flow was not counted as a backend pass in this environment: the default Node 20 runtime lacks the native WebSocket required by the installed Supabase client, and the bundled-runtime invocation returned without producing test artifacts.

## 2026-08-10 — Combat turn-loading animation gate

- Resolved combat turns now stay out of the rendered combat tree until turn-loading persistence finishes, preventing presentation animations from starting behind the transient `Loading` narration.
- Added a live Dungeon browser regression that asserts no running combat animations at the loading checkpoint before verifying Swap playback still animates afterward.
- Typecheck, production build, JavaScript syntax validation, and local Chromium auth-screen smoke pass. The live Dungeon regression remains blocked here because the configured Supabase hostname cannot resolve.

## 2026-08-10 — Relic availability and squad cleanup

- Squad Critter replacements/removals now clear the outgoing Critter's equipped Relic slots through the loadout flow so those copies return to availability immediately.
- Relic equip cards now show one bottom-aligned `Available: X` pill, grey out unavailable Relics, and guard zero-availability clicks.

## 2026-08-10 — Repair stale bench Relics

- Added a new post-five-slot migration that clears Relics from existing bench Critters before replacing the squad RPC, so legacy stale rows no longer keep inventory copies unavailable.
- The loadout regression now applies the repair migration in its rollback-only fixture.

## 2026-08-10 — Clear incoming Critter Relics

- Equipping a Critter now clears any stale Relic rows already attached to the incoming Critter as well as the outgoing Critter; skill slots remain remembered.

## 2026-08-10 — Tune combat squad panel proportions

- Slightly reduced the combat Rollcaster panel's five-cell Critter squad footprint, increased the Rollcaster portrait size, raised ability-slot text from 10px to 12px, and removed the enemy-only red ability-slot treatment so both sides share the same slot styling.

## 2026-08-10 — Keep combat hover tooltips inside the viewport

- Rendered viewport tooltips through `document.body` so the combat viewport's responsive transform cannot shift or clip them; the existing edge-aware left/top clamping now applies in true viewport coordinates for enemy ability slots and Critter squad icons.
- Extended the Dungeon browser regression to hover user abilities, enemy abilities, and enemy Critter squad icons and assert every tooltip edge stays within the viewport.

## 2026-08-10 — Combat skill target emphasis

- Removed the `Legal target` pill from skill-targetable Critters.
- Added one stronger yellow hover/focus treatment for legal targets, including keyboard selection, and suppressed the generic purple/blue focus outline so selection reads as an enhanced version of the existing yellow glow.

## 2026-08-14 — Catalog challenge Track alignment

- Catalog detail challenge rows now share their action/progress columns with CSS subgrid, keeping every Track/Untrack button vertically aligned even when progress goals have different digit lengths.
- Expanded the collection interaction fixture to cover multiple Track buttons and differing progress widths.
- Follow-up reproduction showed the same inset in compact catalog-card challenge rows; those rows now also share one action/progress column set, with regression coverage using `0 / 30`, `0 / 100`, and `0 / 500` goals.

## 2026-08-14 — Responsive combat Rollcaster panels

- Fixed the combat Rollcaster side panels so their ability and Critter-squad rows stay in normal vertical flow instead of allowing the squad grid to overflow a collapsed final row.
- Ability rows now size from viewport height and panel width, while the five Critter slots remain square and switch from the compact 2×3 layout to a single five-slot row when the panel container is wide enough.
- Added `npm run test:combat-panel-layout` with desktop, narrow desktop, tablet, and mobile geometry assertions plus screenshots. Typecheck, production build, the existing combat action layout regression, the new panel regression, and the generic Chromium smoke check pass.

## 2026-08-14 — Small-PC combat mobile breakpoint

- Promoted the combat mobile composition through 900px viewport width so narrow PC windows use the compact header, hidden phase badge, two-column battlefield, and mobile-sized controls before the layout becomes crowded.
- Kept the intermediate tablet layout at 960px and added a 900px small-PC assertion to `npm run test:combat-panel-layout`.
- Re-ran the panel, action, and Swap UI regressions, typecheck, production build, and Chromium smoke capture successfully.

## 2026-08-14 — Knockout result loading and completion handoff

- Encounter-result recording no longer leaves the combat narration box blank: it now shows animated `Waiting...` copy, disables narration advancement, removes the temporary loading state from keyboard controls, and exposes an accessible waiting label.
- Removed the smooth XP-section `scrollIntoView` call that could shift the combat shell during the knockout-to-completion transition; completed outcomes can scroll within the combat shell when their content exceeds the viewport.
- Added `npm run test:combat-result-loading` covering the shared loading copy and its CombatScreen integration. Typecheck, production build, focused Swap/panel/responsive regressions, and the Chromium smoke capture pass.
- The disposable live Dungeon flow still stops before combat because its existing fixture requires three equipped Critters while the current active catalog cannot supply the two additional records.

## 2026-08-14 — Combat transition latency cleanup

- Turn resolution now presents the deterministic resolved state without waiting for the non-authoritative collectible-progress RPC; those writes remain serialized in the background and errors still surface normally.
- Encounter results now use the authoritative battle-result payload immediately instead of blocking on a full catalog/player reload before showing dungeon completion or failure.
- Knockout completion skips the outcome-dialogue step when the encounter has no authored outcome line, while authored victory/defeat dialogue remains unchanged.
- Added source/runtime regression coverage for the non-blocking paths and no-dialogue result handoff. `npm run test:combat-latency`, `npm run test:combat-result-loading`, `npm run test:effect-runtime`, `npm run typecheck`, `npm run build`, the focused Chromium combat/layout checks, and the generic browser smoke capture pass.

## 2026-08-14 — Keep combat narration mounted during KO playback

- Found the exact disappearing-box cause: `CombatScreen` intentionally removed `.combat-narration` for `mana_refund` events. That changed the viewport-fit content height and let the remaining combat UI reflow/scale.
- The narration control now stays mounted for every normal combat phase. Mana-refund playback uses a disabled `Mana restored.` placeholder while its automatic transition completes, so the footer height and fit-scale inputs remain stable.
- Added `npm run test:combat-narration-layout`; it was red against the original conditional and passes after the fix. Result-loading, effect-runtime, typecheck, production build, focused Chromium layout/swap checks, and the browser smoke capture also pass.

## 2026-08-15 — Final Ramber shard purchase and projection timing

- Reproduced the 49/50 Ramber purchase failure in a rollback-only live transaction: the unlock evaluator recursively re-entered `collectible_challenge_states` through Own Collectible dependencies until PostgreSQL exhausted its stack.
- Challenge-gated ownership now uses the durable unlock event written atomically by the evaluator as its non-recursive authority. A live audit found no event-less gated ownership row with historical challenge completion, and the migration was applied without changing player progress.
- The exact final Ramber purchase now reaches 50/50 and materializes its unlock in a rollback-only regression, leaving the real account at 49/50 for the player to purchase normally.
- Shard and Relic projected progress remains hidden at the default quantity of 1 and appears only after the quantity is increased. Focused source coverage, typecheck, and the production build pass.

## 2026-08-15 — Lootbox Open Another transition

- Fixed `Open Another` briefly resetting the Lootbox modal to the idle Possible rewards popup. The result modal now remains in the animation shell until the next opening response is loaded, then enters the existing shaking/reel sequence.
- Added a focused source regression and an authenticated browser assertion for the no-idle transition. The source regression, typecheck, production build, and generic browser smoke pass; the live Lootbox flow remains blocked here by Supabase hostname DNS resolution.

## 2026-08-15 — Critter-scoped Relic equip availability

- Relic equip popups now grey out and disable every Relic already equipped to the target Critter, even when extra inventory copies exist; Relics equipped to other Critters remain eligible when available.
- Added pure loadout coverage for target-Critter Relic detection and a focused source regression for the popup condition. Typecheck, collection UI tests, production build, focused Chromium UI regression, and generic web-game smoke pass; the smoke run reached the unauthenticated login screen.
