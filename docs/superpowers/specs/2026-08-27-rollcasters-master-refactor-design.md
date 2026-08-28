# Rollcasters Master Refactor & Codebase Cleanup Design

**Date:** 2026-08-27

**Status:** Approved in conversation; implementation pending written-plan review.

**Repository:** Rollcasters React/TypeScript game with a Vite browser client and Tauri desktop shell.

## Purpose

This design defines a conservative, incremental refactor of the existing Rollcasters codebase. The implementation will improve organization, readability, cohesion, and testability while preserving the current game as the source of truth.

The work is an internal refactor. It does not redesign the game, correct gameplay behavior, rebalance mechanics, modernize the UI, change player-facing copy, or replace working infrastructure for stylistic reasons.

## Non-negotiable constraints

The following constraints apply to every implementation batch:

1. Existing game behavior has priority over architectural elegance.
2. Existing UI markup, CSS, layout, sizing, visual styling, animation timing, copy, navigation appearance, and player experience must remain unchanged.
3. Damage, healing, stats, type effectiveness, dice, probabilities, RNG state transitions, critical behavior, statuses, durations, stacking, turn ordering, speed, XP, evolution, skill effects, skill costs, relic effects, AI, combat transitions, rewards, dungeon progression, save behavior, and win/loss behavior are immutable.
4. Numeric operation order, rounding, truncation, clamping, comparisons, boundary conditions, zero handling, and floating-point behavior must remain identical unless equivalence is demonstrated by tests and direct comparison.
5. The number, order, and timing of random-number-generator calls must not change.
6. React state ownership, initialization, event ordering, effect timing, dependencies, subscriptions, cleanup, context behavior, callback identity, and asynchronous behavior must not change without explicit characterization and verification.
7. Existing routes, URL paths, query parameters, RPC names, RPC arguments, serialized state shapes, catalog identifiers, asset paths, skill IDs, relic IDs, critter IDs, status IDs, effect IDs, and configuration keys must remain compatible.
8. No dependency upgrades, framework migration, state-library replacement, database/schema changes, or authentication changes are in scope.
9. Dead code may be removed only after direct references, indirect references, configuration, registries, serialization, tests, assets, build scripts, and runtime selection paths have been checked.
10. Each meaningful batch must be independently verifiable and reviewable.

## Current baseline

The audit was performed before implementation on branch `fix/code-cleanup`. The working tree was clean.

### Repository shape

- `src/App.tsx` is the application composition root and contains app lifecycle, routing, persistence orchestration, keyboard navigation, screens, dialogs, combat presentation, asset presentation, and reusable UI primitives.
- `src/styles.css` contains the complete visual system and is approximately 6,344 lines.
- `src/lib` contains domain logic, data normalization, persistence, desktop integration, presentation helpers, and small utilities without subdirectories.
- `scripts` contains the verification suite, release/catalog tooling, desktop tooling, database tests, browser tests, and developer commands.
- `src-tauri` contains the desktop shell, generated schemas, icons, catalog resources, and Rust entry points.
- `supabase/migrations` contains database-side behavior contracts used by the client and integration tests.

### Size and risk inventory

The highest-risk files are:

| File | Approximate size | Responsibility/risk |
| --- | ---: | --- |
| `src/App.tsx` | 7,952 lines | Application state, lifecycle, all major screens, combat UI, dialogs, helpers |
| `src/lib/game.ts` | 4,906 lines | Combat state, RNG, AI, action resolution, effects, damage, statuses, dice |
| `src/lib/supabase.ts` | 1,787 lines | Catalog loading, normalization, auth, sessions, RPCs, retries, persistence |
| `src/lib/dungeon-run.ts` | 981 lines | Dungeon state machine, event playback, combat transitions, serialization |
| `src/lib/types.ts` | 870 lines | Shared catalog, player, combat, dungeon, collectible, and persistence types |
| `src/lib/effects.ts` | 772 lines | Effect metadata, contracts, matching, grouping, runtime validation |
| `src/lib/collectibles.ts` | 637 lines | Collectible lookup, challenge progress, unlocks, shop availability |
| `src/lib/challenges.ts` | 432 lines | Challenge event interpretation and derived progress |
| `src/lib/catalog-release.ts` | 430 lines | Catalog release parsing, compatibility, assembly, and loading |

`App.tsx` contains approximately 140 functions, 48 effects, and 45 state hooks. Its largest cohesive presentation units include `CombatScreen` at approximately 1,032 lines, `EquipDialog` at approximately 270 lines, `LootboxModal` at approximately 260 lines, `ShopScreen` at approximately 225 lines, and `BattleUnit` at approximately 222 lines.

### Existing verification

- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run audit:game-assets` passed with 128 active registry paths and no missing local masters.
- 75 offline, non-database, non-browser, non-live test scripts were run: 74 passed and 1 failed.
- The pre-existing failure is `test:unlock-notification-ui`, failing its desktop click-through assertion.
- `npm run lint` is not defined, and no ESLint configuration or ESLint executable is present.
- `npm test` is not defined; the repository has no aggregate test command.
- Database, live browser, and external release tests were not run during the audit because they require external state and may mutate the configured database or release environment.
- The current runtime reports Node `20.19.5`, while `package.json` declares Node `>=22.0.0`. This is an environment/tooling debt item, not a reason to change application behavior.

## Behavioral architecture map

### Application shell and routing

`App` owns the current `View`, browser history updates, onboarding redirects, startup loading, session state, desktop update gates, active dungeon recovery, navigation revision guards, error display, and top-level screen selection. Routes are represented by pathname values such as `/shop`, `/collection`, `/bag`, and `/play`; the shop tab is represented by the `tab` query parameter.

The refactor must keep `App` as the composition root. Its responsibility should become orchestration and dependency wiring, not a second domain engine. Routing behavior must be preserved byte-for-byte at the URL contract level.

### Persistence and remote integration

`src/lib/supabase.ts` is a compatibility boundary around authentication, the immutable catalog, player bootstrap, gameplay sessions, player mutation outbox behavior, dungeon run persistence, shop purchase recovery, lootbox operations, promo redemption, challenge events, and asset URLs.

This module must remain the public compatibility facade while pure normalization and narrowly scoped adapters may be extracted behind it. RPC names, argument names, fallback behavior, retry behavior, timeout behavior, error codes, request IDs, and authoritative/optimistic update ordering are protected contracts.

### Catalog, identifiers, and assets

The catalog is assembled from release packs and includes critters, Rollcasters, skills, abilities, relics, statuses, effects, elements, dungeons, opponents, progression, challenges, shop entries, lootboxes, assets, and release metadata. Many relationships are represented by strings and lookup tables rather than direct imports.

No catalog data, identifiers, asset path, release compatibility check, or lookup semantics may change. Any helper extraction must preserve fallback order, active-record filtering, checksum/version query behavior, and missing-record behavior.

### Combat and RNG

`src/lib/game.ts` is the protected domain engine. It contains combat state construction, stat calculation, action-cost calculation, enemy policies, action resolution, reactive/timed effects, status and modifier handling, damage and effectiveness, dice, and seeded RNG. `src/lib/dungeon-run.ts` wraps this engine in the dungeon event/state machine.

The first implementation phases will not rewrite `resolveAction`, `resolveEffect`, `resolveReactiveEffects`, `resolveTimedEffects`, `startTurn`, or the seeded RNG pipeline. These functions may only be split after characterization tests cover their externally observable results and RNG state. Pure helper extraction must retain function signatures or provide compatibility exports.

### UI and interaction

The current UI uses source/layout tests that read `App.tsx` and `styles.css` directly, as well as browser-based fixtures. Several tests assert the presence or placement of source strings, including persistence and combat behavior. The refactor must account for this coupling explicitly.

Moving a component or handler requires updating the corresponding source-based test to inspect the new owning module or to assert an observable boundary. Tests must not be weakened merely to accommodate a move. CSS remains in place and unchanged unless a test proves a purely mechanical, behavior-neutral organization change is safe.

## Target organization

The target organization is incremental, not a mandatory one-shot migration.

### Application and feature code

Introduce feature folders only when a cohesive unit is extracted:

```text
src/
  App.tsx                         # composition root and top-level orchestration
  app/                            # app-level routing, notifications, persistence hooks when justified
  components/                     # truly shared visual primitives only
  features/
    home/                         # home screen and loadout presentation
    collection/                   # collection, detail, challenge, and equip flows
    bag/                          # bag, lootbox, and reward presentation
    shop/                         # shop and promo presentation
    dungeon/                      # dungeon selection, entry, recovery, and outcome presentation
    combat/                       # combat screen and combat-only presentation pieces
  lib/                            # existing domain, persistence, and framework-neutral modules
  assets/
```

This structure is aspirational and should be adopted one vertical slice at a time. A component belongs in `components` only if it is genuinely reusable outside a feature. Feature-specific components stay with their feature. The repository should not gain generic wrappers or barrel files without a concrete import and maintenance benefit.

### Domain modules

Keep current `src/lib` module names as compatibility boundaries. Where files become too large, extract by responsibility while retaining the original module as a facade when practical. Potential future boundaries include:

- combat state construction and stat calculations
- combat action and cost calculation
- combat effect resolution
- combat presentation event derivation
- catalog row normalization and release assembly
- player bootstrap normalization
- persistence operations grouped by lifecycle, dungeon, economy, or collectibles

These are candidate boundaries, not permission to split blindly. Each extraction requires a clear interface, tests, and a diff review.

## Staged implementation strategy

### Stage 0 — verification harness and characterization foundation

Add only the minimum test/tooling support needed to make future batches repeatable. Prefer an offline test runner over a new test framework. It should enumerate the existing safe scripts, exclude database/browser/live/external-state tests by explicit rules, report each command and exit code, and preserve the baseline failure rather than masking it.

Add focused characterization tests only for pure logic that is about to move. Tests should assert observable results, not implementation details. Do not add broad snapshots or tests that encode CSS formatting.

### Stage 1 — low-risk App helper extraction

Extract pure, framework-light helpers whose behavior can be tested directly:

- route parsing and URL formatting
- notification data construction and queue ordering
- asset record selection and versioned asset paths
- stat/cost breakdown formatting
- XP threshold and animation-segment calculations

Keep constants and compatibility exports available where source tests or consumers rely on them. Do not alter the notification timing, queue insertion rules, or formatting strings. Update source-based tests to follow the owning module while retaining an app-level assertion that the helper is wired into the user-visible flow.

### Stage 2 — shared visual primitive extraction

Move only visually reusable, low-state primitives such as `Modal`, `Sprite`, `AssetIcon`, `SpriteFrame`, stat cells/grids, progress bars, tooltip scaffolding, and shared reward/identity primitives where their dependencies are explicit.

The extracted components must render the same element hierarchy, class names, attributes, text, event handlers, focus behavior, loading behavior, asset fallback behavior, and portal behavior. Do not combine this batch with CSS edits or state-management changes.

### Stage 3 — vertical screen decomposition

Move screen-specific components into feature folders, beginning with the lower-coupling screens and ending with combat:

1. home/loadout
2. collection/detail/equip
3. bag/lootbox
4. shop/promo
5. dungeon selection/outcome
6. combat presentation

`App` continues to own the same state and callbacks initially. Extracted components receive explicit props and callbacks. No state is moved solely to make a component look smaller. If a callback closes over App state, preserve its behavior and identity implications; only change it when tests show no observable dependency.

### Stage 4 — focused React workflow hooks

After screen boundaries are stable, extract cohesive stateful workflows from `App` and `CombatScreen`, such as:

- navigation/history synchronization
- desktop session/update lifecycle
- dungeon persistence scheduling and shutdown flushing
- app keyboard focus navigation
- combat keyboard focus and interaction hold behavior
- notification lifecycle

Each hook must have one responsibility. Hooks must preserve effect dependencies, cleanup order, ref semantics, debounce values, timeout values, request sequencing, and race guards. Domain logic remains in plain functions.

### Stage 5 — protected domain decomposition

Only after characterization coverage is sufficient, extract pure portions of `game.ts`, `dungeon-run.ts`, `effects.ts`, `collectibles.ts`, and `supabase.ts`. Preserve old exports through direct re-exports or wrappers where consumers and test scripts depend on them.

Priority is readability and testability, not maximal file count. Do not split the effect runtime or combat resolver into speculative strategy classes. Keep data-driven runtime dispatch explicit and inspectable.

### Stage 6 — conservative dead-code and consistency pass

Produce a reference report for unused exports/files, then manually verify dynamic and indirect paths. Remove only proven-dead code. Normalize names/imports/comments only where the change is local and behavior-neutral. Document unusual invariants, protected RNG behavior, persistence boundaries, and source-test coupling.

### Stage 7 — final review

Run the complete available offline suite, typecheck, production build, asset audit, relevant browser/source checks, and any safe desktop checks. Review the diff for mechanics, RNG, numeric constants, IDs, state/effect dependencies, markup, CSS, assets, routes, and generated files. Request a whole-branch code review before declaring completion.

## Testing strategy

### Required per-batch checks

Every meaningful batch must run:

1. `npm run typecheck`
2. The offline verification runner or the exact relevant test scripts
3. `npm run build`
4. Relevant source/layout/browser tests
5. `git diff --check`
6. A changed-file and diff review

The existing `test:unlock-notification-ui` failure must remain separately tracked. It must not be silently attributed to later work, and a batch touching notification markup or CSS must either fix it only if the refactor directly explains it or document why it remains pre-existing.

### Domain characterization

Before changing protected game code, tests must cover at least the affected observable contract:

- stat/progression calculation outputs
- action cost and modifier ordering
- seeded RNG state advancement
- damage roll bounds and effectiveness
- action order and target selection
- status application/removal/duration
- reactive and timed effect activation
- dungeon serialization/restoration
- XP and reward projection

Tests may use deterministic seeds and explicit random functions already supported by the code. They must not replace the runtime RNG with a new implementation.

### UI characterization

For moved components, preserve existing source/layout test intent. Prefer testing:

- rendered role/name/text and key data attributes
- routing transitions
- focus and keyboard behavior
- animation/timer boundaries
- event callback outcomes
- asset fallback and loading behavior
- unchanged bounding boxes and layout fixtures where the existing suite covers them

Do not solve source-test failures by deleting assertions or broadening regexes beyond the behavior they were intended to protect.

### External tests

Database, live browser, release publication, and catalog upload tests require explicit environment safety checks. Do not run destructive or production-mutating scripts as part of a normal refactor batch unless the exact test scope is confirmed safe. Report these as limitations when they are not run.

## Risk register and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| RNG call order changes | Alters gameplay even with identical probabilities | Do not restructure RNG paths early; compare state and event outputs with deterministic seeds |
| Numeric semantics drift | Changes damage, costs, XP, or rewards at boundaries | Preserve expression order; characterize boundary cases; inspect arithmetic diffs |
| React effect timing changes | Causes races, duplicate requests, or stale state | Keep dependencies and cleanup intact; extract hooks only after screen boundaries stabilize |
| Persistence race regression | Can lose dungeon state or duplicate purchases | Keep request IDs, revisions, queues, timeouts, and authoritative refresh ordering unchanged |
| Source-based test coupling | Moving code can make tests pass/fail for the wrong reason | Update tests to the new owner while preserving their behavioral intent |
| Dynamic identifiers | Static search may miss runtime reachability | Inspect registries, lookup tables, JSON, catalog rows, RPC names, serialization, and assets |
| CSS/UI drift | Internal moves can accidentally change markup or class relationships | No CSS edits; compare markup, screenshots/layout tests, and class attributes |
| Over-abstraction | More files can make a small codebase harder to follow | Extract only cohesive responsibilities with named interfaces and real reuse |
| Generated/ignored artifacts | Builds and scripts can create noisy diffs | Check status after every verification batch and keep generated changes out of scope |
| Existing baseline failure | Can be confused with a regression | Track the notification failure separately and compare against the baseline each batch |

## Rollback and batch discipline

Each batch should be a single logical commit or a small sequence of commits with one responsibility. Before each batch, record the current commit. After each batch, verify the diff and checks. If a batch introduces a new failure or uncertain behavior, revert that batch or restore the pre-batch state before proceeding.

Do not use destructive repository commands such as `git reset --hard` or broad cleanup commands. Preserve unrelated user changes if they appear.

## Explicit non-goals

This design does not authorize:

- fixing gameplay bugs discovered during inspection
- changing combat balance, probabilities, stats, rewards, or progression
- changing UI design, CSS, assets, animation, or copy
- introducing new features, content, screens, mechanics, critters, skills, relics, or effects
- changing routes, persistence schemas, RPC contracts, authentication, or release protocols
- upgrading dependencies merely for modernization
- adding a full state-management library
- converting the project to a different framework or test runner
- deleting source-based tests because they are inconvenient
- removing any code whose runtime reachability is uncertain

## Acceptance criteria

The refactor is complete only when all applicable criteria are met:

1. The repository is organized into understandable feature and shared boundaries without arbitrary layering.
2. `App.tsx` is materially smaller and primarily coordinates state and feature composition.
3. Large screen responsibilities are separated without changing markup, CSS classes, props behavior, or player-visible output.
4. Shared primitives and pure helpers have focused responsibilities and direct tests where practical.
5. Combat, RNG, effect, dungeon, persistence, catalog, and economy contracts remain behaviorally identical.
6. No unproven dead code or dynamic identifier is removed.
7. Every changed batch has typecheck, relevant tests, build, diff inspection, and review evidence.
8. The final report distinguishes baseline failures, unrun external checks, remaining technical debt, and newly introduced issues.
9. No completion claim is made without fresh verification evidence.

## Planned implementation handoff

The implementation plan will translate these stages into bite-sized tasks with exact files, interfaces, tests, commands, commit boundaries, and review checkpoints. The plan must not authorize a later stage to bypass the characterization and verification gates defined here.
