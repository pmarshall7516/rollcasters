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
