# Rollcasters Cleanup Audit

Date: 2026-08-27/28
Baseline: `95afdf7`
Working branch: `fix/code-cleanup`

## Scope completed

- Added a repeatable offline verification runner that excludes database, browser, live, and published-catalog scripts while preserving failures.
- Extracted routing, banner queue insertion, asset-path selection, presentation calculations, error mapping, shared visual primitives, starter screens, shop primitives, and lootbox presentation calculations.
- Isolated catalog row normalization, critter/stat calculations, combat calculations, and combat cost calculations behind focused modules while retaining compatibility exports from existing public modules.
- Added focused characterization scripts for each extracted pure boundary and updated source-inspection tests only where implementation moved.
- Preserved `src/styles.css` and did not delete any source or data files.

## Reachability and contract audit

The review checked direct imports plus indirect surfaces that static unused analysis does not fully model:

- dynamic Tauri imports in desktop window/update modules
- route and query strings in `App.tsx` and browser/source tests
- catalog IDs, asset categories, skill/relic/critter identifiers, and release projections
- runtime effect registries and serialized dungeon/combat state
- local-storage keys and session synchronization
- Supabase RPC names, argument shapes, retry request IDs, and normalization fallbacks
- source-based and Playwright test references to markup and CSS selectors

No file was removed because no candidate met the repository’s proof standard for unreachable code. The remaining large modules and broad type assertions are intentionally retained until stronger characterization coverage exists.

## Risk controls used

- Mechanics-sensitive arithmetic, rounding, clamps, modifier ordering, and RNG helpers were copied into seams without changing operation order.
- Combat action/effect resolution, React state ownership, effect timing, modal lifecycle, persistence calls, and CSS were left in place unless only a pure helper was extracted.
- Every logical batch was typechecked, built, diff-checked, and tested against the most relevant existing regression scripts before commit.

## Remaining debt intentionally outside this pass

- `src/App.tsx`, `src/lib/game.ts`, `src/lib/supabase.ts`, and `src/styles.css` remain large and should only be split in further characterized vertical slices.
- There is no repository `lint` script and no aggregate `test` script; the new `test:offline` command is the local substitute for the available offline suite.
- Database, live browser, release-publication, and external-state tests were not run as part of the safe local loop.
- Persistence and runtime snapshot boundaries still contain deliberate casts because their inputs are remote or legacy-shaped; replacing them requires schema-level characterization.
- The existing `test:unlock-notification-ui` desktop failure remains: `desktop: banner intercepted interaction.` It was reproduced before and after the cleanup and was not changed as a gameplay or UI fix.

