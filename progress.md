# Rollcasters progress
Original prompt: On the main page, show level-eligible Critter skills in skill-slot popups and allow unlocking them with skill points.

## 2026-07-29

- Updated the home Critter skill picker so level-eligible locked skills use the same dimmed tile and opaque centered unlock-button treatment as the Critter collection popup.
- Verified the overlay with a Playwright fixture, including opaque button, button-over-tile placement, requirement text below the tile, and no horizontal overflow.

The working progress log is maintained in the shared Obsidian vault:
`../rollcaster-docs/10 Source Docs/rollcasters/progress.md`.

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

## 2026-08-05 — Collection dynamic card height and Rollcaster descriptions

- Collection height measurement now observes every hidden card across the Critter, Rollcaster, and Relic grids, so the shared row height remeasures when any collectible’s content changes.
- Rollcaster cards now show their authored description below unlock challenges when locked or below XP progress when unlocked; descriptions participate in the tallest-card measurement.

## 2026-08-05 — Collectible popup descriptions

- Critter, Rollcaster, and Relic detail popups now end with a shared styled Description section using each collectible’s authored description, with a fallback when the catalog description is blank.

## 2026-08-05 — Rollcaster collection description alignment

- Rollcaster collection descriptions now align left with challenge copy; unlocked descriptions have a larger gap below the XP progress row.

## 2026-08-05 — Animated combat loading copy

- Combat’s locked narration now cycles quickly through `Loading.`, `Loading..`, and `Loading...` while action submission is pending, resetting cleanly for each pending state. Updated the browser assertion and text-state loading flag to recognize the animated copy. Typecheck, production build, focused combat UI regression, and Chromium smoke capture pass.
