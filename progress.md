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
