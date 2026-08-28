# Rollcasters Master Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task with verification checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Rollcasters’ organization, readability, cohesion, and testability while preserving the existing game, UI, mechanics, persistence contracts, and player experience exactly.

**Architecture:** Keep `src/App.tsx` as the application composition root and keep existing `src/lib` modules as compatibility boundaries. Extract pure helpers first, then shared visual primitives, then feature presentation, then narrowly scoped React workflows, and only afterward split protected domain/persistence internals behind compatibility-preserving exports.

**Tech Stack:** React 18, TypeScript 5.6, Vite 7, Tauri 2, Supabase JS, Node-based offline/source tests, Playwright fixtures, and existing Rust/Tauri packaging.

**Spec:** `docs/superpowers/specs/2026-08-27-rollcasters-master-refactor-design.md`

## Global Constraints

- Existing game behavior has priority over architectural elegance.
- Existing UI markup, CSS, layout, sizing, visual styling, animation timing, copy, navigation appearance, and player experience must remain unchanged.
- Damage, healing, stats, type effectiveness, dice, probabilities, RNG state transitions, critical behavior, statuses, durations, stacking, turn ordering, speed, XP, evolution, skill effects, skill costs, relic effects, AI, combat transitions, rewards, dungeon progression, save behavior, and win/loss behavior are immutable.
- Numeric operation order, rounding, truncation, clamping, comparisons, boundary conditions, zero handling, and floating-point behavior must remain identical unless equivalence is demonstrated by tests and direct comparison.
- The number, order, and timing of random-number-generator calls must not change.
- React state ownership, initialization, event ordering, effect timing, dependencies, subscriptions, cleanup, context behavior, callback identity, and asynchronous behavior must not change without characterization and verification.
- Existing routes, URL paths, query parameters, RPC names, RPC arguments, serialized state shapes, catalog identifiers, asset paths, skill IDs, relic IDs, critter IDs, status IDs, effect IDs, and configuration keys must remain compatible.
- Do not upgrade dependencies, migrate frameworks, replace state libraries, change database/schema behavior, or alter authentication.
- Delete code only after direct and indirect reachability checks.
- Do not edit `src/styles.css` during structural extraction unless a separate review proves the edit is mechanically behavior-neutral.
- Preserve the baseline `test:unlock-notification-ui` failure as a separately tracked issue unless a notification-specific change directly explains and safely resolves it.

## Baseline evidence

- Baseline commit before plan execution: `95afdf7`.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run audit:game-assets`: passed; 128 active paths and 0 missing local masters.
- Offline non-database/non-browser/non-live scripts: 74 passed, 1 failed.
- Existing failure: `test:unlock-notification-ui`, desktop click-through assertion.
- `npm run lint`: unavailable because no script/config/executable exists.
- `npm test`: unavailable because no aggregate test script exists.
- Database, live browser, release publication, and external-state tests are not part of the default local loop.

## File map and boundary rules

Initial files to create only when their corresponding task begins:

- `src/app/routing.ts`: pure pathname/query parsing and URL formatting; no React or Supabase import.
- `src/app/notifications.ts`: `BannerNotification` domain type and pure queue insertion; no DOM or timers.
- `src/lib/asset-paths.ts`: catalog asset selection/versioning; no rendering.
- `src/components/shared/Modal.tsx`: portal dialog and focus behavior, preserving current markup and lifecycle.
- `src/components/shared/Sprite.tsx`: `Sprite`, `AssetIcon`, and `SpriteFrame` presentation primitives.
- `src/components/shared/Stats.tsx`: stat breakdown cells/grid and progress bar presentation.
- `src/features/home/*`: home/loadout presentation only.
- `src/features/collection/*`: collection, detail, challenge, and equip presentation only.
- `src/features/bag/*`: bag, lootbox, and bag reward presentation only.
- `src/features/shop/*`: shop, promo, and purchase presentation only.
- `src/features/dungeon/*`: dungeon selection, entry, recovery, outcome, and reward presentation only.
- `src/features/combat/*`: combat screen and combat-only presentation pieces only.
- `src/app/hooks/*`: focused hooks only after their workflows have been characterized.
- `src/lib/*` extracted domain modules: only after direct tests protect the affected contracts; existing module names retain compatibility exports.

Test files to create or modify are the existing `scripts/*-tests.*` files that exercise the moved boundary. Do not introduce a second test framework. Source-inspection tests may be updated to follow moved code, but their behavior assertions must remain equivalent.

---

### Task 1: Create a repeatable offline verification command

**Files:**

- Create: `scripts/offline-tests.mjs`
- Modify: `package.json`
- Test: existing offline `scripts/*-tests.*` commands selected by the runner

**Interfaces:**

- Produces `npm run test:offline`.
- The runner selects package scripts whose names begin with `test:`, excludes the runner itself (`test:offline`), and excludes names containing `db`, `browser`, `live`, or `published-catalog`.
- It executes each selected script sequentially, prints `PASS <name>` or `FAIL <name>`, prints a final count, and exits nonzero when any selected command fails.
- It must not change the existing scripts or treat the known notification failure as a pass.

- [ ] **Step 1: Add the runner’s failing contract test as an inline self-check.**

Implement a small exported-free runner with a local `selectOfflineTests(scripts)` function so the selection rules can be tested by invoking the script with `--self-test` before normal execution. The self-check must assert that `test:effect-runtime` is selected and `test:dungeons:db`, `test:effect-browser`, and `test:collectible-commands:live` are excluded.

- [ ] **Step 2: Run the self-check before the runner exists.**

Run: `node scripts/offline-tests.mjs --self-test`

Expected: fail because `scripts/offline-tests.mjs` does not exist yet.

- [ ] **Step 3: Implement the minimal runner.**

Use `spawnSync("npm", ["run", name], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })`, preserve each child’s exit code, and print only compact summaries plus the last failure lines. Do not invoke database, browser, live, or external-release scripts.

- [ ] **Step 4: Run the self-check and the complete offline baseline.**

Run: `node scripts/offline-tests.mjs --self-test`

Expected: PASS.

Run: `npm run test:offline`

Expected: 75 selected scripts, 74 passing, 1 failing at `test:unlock-notification-ui`.

- [ ] **Step 5: Add the package script and verify the package entry point.**

Add exactly:

```json
"test:offline": "node scripts/offline-tests.mjs"
```

Run: `npm run test:offline`

Expected: the same 74-pass/1-known-failure baseline.

- [ ] **Step 6: Review and commit.**

Run: `git diff --check`, `git status --short`, and inspect the package/script diff. Commit with:

```bash
git add package.json scripts/offline-tests.mjs
git commit -m "test: add offline verification runner"
```

---

### Task 2: Extract pure routing helpers

**Files:**

- Create: `src/app/routing.ts`
- Modify: `src/App.tsx`
- Create: `scripts/routing-tests.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export type ShopTab = "shard" | "relic" | "lootbox" | "promo";
export type RouteLocation = Pick<Location, "pathname" | "search">;
export type AppRoute = { view: View; shopTab: ShopTab };
export function routeFromLocation(location?: RouteLocation): AppRoute;
export function viewUrl(view: View, shopTab: ShopTab): string;
```

`routeFromLocation()` must use the current browser location when no argument is supplied and must preserve the current defaults and accepted tab values. The App import must use the extracted functions without changing call sites’ observable behavior.

- [ ] **Step 1: Add characterization tests for all route branches.**

Test `/shop` with each valid tab, an invalid tab, `/collection`, `/bag`, `/play`, and an unknown pathname. Assert the exact returned `view`, `shopTab`, and URL strings.

- [ ] **Step 2: Run the new test before implementation.**

Run the direct TypeScript compile/run command used by the repository:

```bash
tsc scripts/routing-tests.ts src/app/routing.ts src/lib/types.ts --outDir /tmp/rollcasters-routing-tests --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2022,DOM --skipLibCheck
node /tmp/rollcasters-routing-tests/scripts/routing-tests.js
```

Expected: fail because `src/app/routing.ts` does not exist.

- [ ] **Step 3: Implement `src/app/routing.ts` by copying the existing branch order exactly.**

Do not normalize paths, change query serialization, add trailing slash behavior, or alter the fallback view.

- [ ] **Step 4: Replace the local App definitions with imports.**

Remove only the local `ShopTab`, `routeFromLocation`, and `viewUrl` definitions. Keep collection/bag tab types and all route call sites unchanged.

- [ ] **Step 5: Run direct and application verification.**

Run the routing test, `npm run typecheck`, `npm run build`, and the source tests `test:dungeon-entry:source`, `test:dungeon-exit:source`, `test:shop-exit-sync`, and `test:responsive-shell-layout`.

- [ ] **Step 6: Review and commit.**

Inspect the diff for pathname strings, query defaults, history calls, and no CSS changes. Commit:

```bash
git add src/app/routing.ts src/App.tsx scripts/routing-tests.ts package.json
git commit -m "refactor: extract app routing helpers"
```

---

### Task 3: Extract pure notification queue behavior

**Files:**

- Create: `src/app/notifications.ts`
- Modify: `src/App.tsx`
- Create: `scripts/notification-queue-tests.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export type BannerNotification =
  | { id: string; kind: "collectible-unlock"; event: CollectibleUnlockEvent }
  | { id: string; kind: "challenge-completed"; challengeId: string }
  | { id: string; kind: "shop-reward"; targetCategory: CollectibleType; targetId: string; shard: boolean; granted: string; discarded: string }
  | { id: string; kind: "promo-reward"; redemption: PromoCodeRedemption }
  | { id: string; kind: "shop-error"; message: string }
  | { id: string; kind: "lootbox-error"; message: string };

export function enqueueBannerNotification(
  current: readonly BannerNotification[],
  notification: BannerNotification,
): BannerNotification[];
```

The pure helper must preserve duplicate suppression, FIFO behavior for non-shop notifications, and insertion of newer shop rewards before older shop rewards while retaining non-shop ordering. `BANNER_NOTIFICATION_DURATION_MS`, error constructors, rendering branches, and timer effects remain in `App.tsx` initially so source-based tests retain their intended coverage.

- [ ] **Step 1: Write tests for duplicate, FIFO, and shop-reward ordering.**
- [ ] **Step 2: Run the focused test and observe the missing-module failure.**
- [ ] **Step 3: Implement the type and pure queue function by moving the existing branch logic without semantic changes.**
- [ ] **Step 4: Replace App’s local type and queue body with imports and a state setter call to `enqueueBannerNotification`.**
- [ ] **Step 5: Run the focused test, `npm run test:offline`, `npm run typecheck`, `npm run build`, and notification source tests.**

The known `test:unlock-notification-ui` failure must be reported separately if unchanged.

- [ ] **Step 6: Inspect the diff for notification IDs, timer constants, queue order, and JSX branches; commit:**

```bash
git add src/app/notifications.ts src/App.tsx scripts/notification-queue-tests.ts package.json
git commit -m "refactor: isolate notification queue behavior"
```

---

### Task 4: Extract asset path and catalog lookup helpers

**Files:**

- Create: `src/lib/asset-paths.ts`
- Modify: `src/App.tsx`
- Create: `scripts/asset-path-tests.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export function findAssetRecord(data: AppData, category: string, ownerId: string, variant: string): GameAsset | undefined;
export function versionedAssetPath(data: AppData, path: string | null | undefined): string | null;
export function catalogAssetPath(data: AppData, category: string, ownerId: string | null | undefined, directPath: string | null | undefined, variant?: string): string | null;
export function findAssetPath(data: AppData, category: string, ownerId: string, variant?: string): string | null;
```

Preserve active filtering, direct-path precedence, URL passthrough, checksum/update-version precedence, query separator choice, and missing-record behavior exactly.

- [ ] **Step 1: Build minimal catalog fixtures covering active/inactive records, direct paths, URLs, checksums, timestamps, and missing paths.**
- [ ] **Step 2: Run the focused test before implementation and confirm failure.**
- [ ] **Step 3: Implement the helpers without changing lookup order or string formatting.**
- [ ] **Step 4: Update `App.tsx` imports and remove only the duplicate helper definitions.**
- [ ] **Step 5: Run asset tests, `npm run audit:game-assets`, `npm run typecheck`, `npm run build`, `test:local-asset-source`, `test:sprite-containment`, and relevant layout tests.**
- [ ] **Step 6: Review asset URLs and all `preferredAssetPath` call sites; commit:**

```bash
git add src/lib/asset-paths.ts src/App.tsx scripts/asset-path-tests.ts package.json
git commit -m "refactor: isolate catalog asset path helpers"
```

---

### Task 5: Extract pure stat, cost, and XP display helpers

**Files:**

- Create: `src/app/presentation.ts`
- Modify: `src/App.tsx`
- Create: `scripts/presentation-helper-tests.ts`
- Modify: `package.json`

**Interfaces:**

```ts
export function modificationTone(breakdown?: StatBreakdown, cost?: boolean): "positive" | "negative" | "mixed" | "";
export function actionCostTone(breakdown?: ActionCostBreakdown): "positive" | "negative" | "mixed" | "";
export function signedAmount(amount: number): string;
export function costBreakdownText(label: string, breakdown: ActionCostBreakdown): string;
export function breakdownText(label: string, breakdown: StatBreakdown): string;
export function xpStateAtTotal(progression: XpThreshold[], totalXp: number): XpStateAtTotal;
export function orderedXpThresholds(progression: XpThreshold[]): XpThreshold[];
export function buildXpAnimSegments(progression: XpThreshold[], startingTotal: number, finalTotal: number): XpAnimSegment[];
export function visualForXpTotal(progression: XpThreshold[], totalXp: number, levelOverride?: number): XpCardVisualBase;
export function visualForLevelUpHold(progression: XpThreshold[], fromLevel: number): XpCardVisualBase;
```

Move types with their pure helpers. Keep `XpGainCard` effects, timers, requestAnimationFrame usage, and dependency array in `App.tsx` until a later hook task. Preserve all `Math.round`, `Math.min`, `Math.max`, and threshold ordering.

- [ ] **Step 1: Add tests for positive/negative/mixed breakdowns, cost sign handling, exact strings, XP thresholds, multi-level gains, zero gains, and max-level behavior.**
- [ ] **Step 2: Run the focused test before implementation and verify it fails.**
- [ ] **Step 3: Move the pure implementations without changing arithmetic or ordering.**
- [ ] **Step 4: Replace App-local helpers/types with imports.**
- [ ] **Step 5: Run focused tests, XP/reward presentation tests, `npm run typecheck`, `npm run build`, and all offline tests.**
- [ ] **Step 6: Inspect every changed arithmetic expression and commit:**

```bash
git add src/app/presentation.ts src/App.tsx scripts/presentation-helper-tests.ts package.json
git commit -m "refactor: isolate presentation calculations"
```

---

### Task 6: Extract shared visual primitives without changing markup

**Files:**

- Create: `src/components/shared/Modal.tsx`
- Create: `src/components/shared/Sprite.tsx`
- Create: `src/components/shared/Stats.tsx`
- Modify: `src/App.tsx`
- Modify: source/layout tests that currently read moved definitions

**Interfaces:**

Keep the current prop shapes as named exported types. The key exported components are:

```tsx
export function Modal(props: ModalProps): JSX.Element;
export function Sprite(props: SpriteProps): JSX.Element;
export function AssetIcon(props: AssetIconProps): JSX.Element | null;
export function SpriteFrame(props: SpriteFrameProps): JSX.Element;
export function StatCell(props: StatCellProps): JSX.Element;
export function StatGrid(props: StatGridProps): JSX.Element;
export function ProgressBar(props: ProgressBarProps): JSX.Element;
```

Preserve exact class names, element nesting, aria attributes, portal target, focus restoration, title-derived IDs, asset loading modes, failure fallback, locked text, and image decoding behavior.

- [ ] **Step 1: Inventory source tests that inspect these definitions and record their assertions.**
- [ ] **Step 2: Add focused component fixtures only where current tests cannot protect the moved behavior.**
- [ ] **Step 3: Move `Modal`, `Sprite`, `AssetIcon`, and `SpriteFrame` one group at a time; keep the old names absent to prevent duplicate implementations.**
- [ ] **Step 4: Run typecheck, build, modal/asset/sprite/layout tests after the first group.**
- [ ] **Step 5: Move stat and progress primitives, then rerun their tests.**
- [ ] **Step 6: Update source-inspection tests to inspect the new owning file or an observable boundary without deleting assertions.**
- [ ] **Step 7: Verify `src/styles.css` is byte-identical to the pre-task version and commit:**

```bash
git diff HEAD~1 -- src/styles.css
git add src/components/shared src/App.tsx scripts
git commit -m "refactor: extract shared visual primitives"
```

---

### Task 7: Extract the home and collection vertical slices

**Files:**

- Create: `src/features/home/HomeScreen.tsx`
- Create: `src/features/home/StarterScreens.tsx`
- Create: `src/features/collection/CollectionScreen.tsx`
- Create: `src/features/collection/EquipDialog.tsx`
- Create: `src/features/collection/ChallengeComponents.tsx`
- Modify: `src/App.tsx`
- Modify: home/collection/equip source and layout tests

**Interfaces:**

Retain the existing prop contracts, expressed as exported named types. `App` continues to own `data`, `collectionTab`, `detail`, `loading`, save callbacks, refresh callbacks, navigation callbacks, and notification callbacks.

```tsx
export function HomeScreen(props: HomeScreenProps): JSX.Element;
export function StarterScreen(props: StarterScreenProps): JSX.Element;
export function StarterRollcasterScreen(props: StarterRollcasterScreenProps): JSX.Element;
export function CollectionScreen(props: CollectionScreenProps): JSX.Element;
export function EquipDialog(props: EquipDialogProps): JSX.Element;
```

- [ ] **Step 1: Capture current source spans and all imports used by each component.**
- [ ] **Step 2: Move starter and home components with unchanged JSX and callback expressions.**
- [ ] **Step 3: Run home layout, collection layout, loadout, keyboard, typecheck, and build checks.**
- [ ] **Step 4: Move collection/detail/challenge/equip components without moving App state.**
- [ ] **Step 5: Update source tests to inspect feature files where appropriate and retain observable assertions.**
- [ ] **Step 6: Review class names, tab values, element filters, relic/skill identifiers, and callback arguments; commit:**

```bash
git add src/features/home src/features/collection src/App.tsx scripts
git commit -m "refactor: separate home and collection features"
```

---

### Task 8: Extract bag and shop vertical slices

**Files:**

- Create: `src/features/bag/BagScreen.tsx`
- Create: `src/features/bag/LootboxModal.tsx`
- Create: `src/features/shop/ShopScreen.tsx`
- Create: `src/features/shop/PromoCodesPanel.tsx`
- Modify: `src/App.tsx`
- Modify: bag/shop/promo source and layout tests

**Interfaces:**

Preserve current callback contracts for purchase, open, refresh, optimistic receipts, notification dispatch, promo state changes, and exit navigation. Keep lootbox timers, phase events, random reel generation, and opening error behavior in the extracted component unchanged.

- [ ] **Step 1: Move `BagScreen` and its purely bag-specific children.**
- [ ] **Step 2: Run lootbox, bag, notification, source, typecheck, and build checks.**
- [ ] **Step 3: Move `ShopScreen`, quantity controls, entry cards, and promo panel.**
- [ ] **Step 4: Run shop purchase, promo, layout, source, typecheck, and build checks.**
- [ ] **Step 5: Review purchase request IDs, optimistic receipt application, quantity bounds, promo usage labels, and error notifications; commit:**

```bash
git add src/features/bag src/features/shop src/App.tsx scripts
git commit -m "refactor: separate bag and shop features"
```

---

### Task 9: Extract dungeon selection, outcome, and reward presentation

**Files:**

- Create: `src/features/dungeon/PlayScreen.tsx`
- Create: `src/features/dungeon/DungeonDialogs.tsx`
- Create: `src/features/dungeon/RewardPresentation.tsx`
- Modify: `src/App.tsx`
- Modify: dungeon/reward source and layout tests

**Interfaces:**

Keep dungeon start, retry, abandon, resume, next-dungeon, and home callbacks owned by `App`. Keep `DungeonRunState`, `DungeonRewardSummary`, serialized state, and persistence functions imported from existing `src/lib` modules.

- [ ] **Step 1: Move dungeon selection/info and entry/recovery dialogs unchanged.**
- [ ] **Step 2: Run dungeon entry/exit/recovery source tests, grid/opponent layout tests, typecheck, and build.**
- [ ] **Step 3: Move outcome, reward summary, XP section, and XP card presentation using the extracted pure helpers.**
- [ ] **Step 4: Run reward, XP, result-loading, and offline tests.**
- [ ] **Step 5: Review reward ordering, XP totals, animation timing constants, level-up segments, and result retry behavior; commit:**

```bash
git add src/features/dungeon src/App.tsx scripts
git commit -m "refactor: separate dungeon and reward presentation"
```

---

### Task 10: Extract combat presentation in bounded slices

**Files:**

- Create: `src/features/combat/CombatScreen.tsx`
- Create: `src/features/combat/CombatControls.tsx`
- Create: `src/features/combat/CombatUnits.tsx`
- Create: `src/features/combat/CombatDialogs.tsx`
- Modify: `src/App.tsx`
- Modify: combat source/layout tests

**Interfaces:**

`CombatScreen` keeps the existing props and callback signatures, including `setCombat`, combat progress queue dispatch, battle result submission, back/home/replay/next-dungeon callbacks, and control bindings. The extracted component may import presentation helpers and domain selectors, but it must not move the combat engine or alter `DungeonRunState`.

- [ ] **Step 1: Inventory all local state, refs, effects, timers, and keyboard handlers in `CombatScreen`; label which must remain together.**
- [ ] **Step 2: Move stateless combat unit/panel/die/dialog components first.**
- [ ] **Step 3: Run combat panel, action layout, mana, sprite, target, swap, narration, and result-loading tests.**
- [ ] **Step 4: Move the outer `CombatScreen` only after the stateless pieces compile and tests pass.**
- [ ] **Step 5: Preserve every effect dependency, timer duration, phase string, data attribute, focus role, and callback ordering.**
- [ ] **Step 6: Run `test:effect-runtime`, combat source/layout tests, typecheck, build, and the offline suite.**
- [ ] **Step 7: Perform a dedicated diff review of RNG-adjacent action submission code and commit:**

```bash
git add src/features/combat src/App.tsx scripts
git commit -m "refactor: separate combat presentation"
```

---

### Task 11: Extract focused app and combat workflow hooks

**Files:**

- Create: `src/app/hooks/useAppNavigation.ts`
- Create: `src/app/hooks/useDungeonPersistence.ts`
- Create: `src/app/hooks/useAppKeyboardNavigation.ts`
- Create: `src/features/combat/useCombatKeyboardNavigation.ts`
- Create: `src/app/hooks/useNotifications.ts` only if notification lifecycle remains cohesive after Task 3
- Modify: `src/App.tsx`
- Modify: `src/features/combat/CombatScreen.tsx`
- Create/modify: focused workflow source tests

**Interfaces:**

Hooks must have narrow inputs/outputs and no unrelated state:

```ts
export function useAppNavigation(input: UseAppNavigationInput): UseAppNavigationResult;
export function useDungeonPersistence(input: UseDungeonPersistenceInput): UseDungeonPersistenceResult;
export function useAppKeyboardNavigation(input: UseAppKeyboardNavigationInput): void;
export function useCombatKeyboardNavigation(input: UseCombatKeyboardNavigationInput): void;
```

Exact property types must be derived from current App/Combat call sites before writing the implementation. Do not invent a generic controller object.

- [ ] **Step 1: Add characterization checks around navigation revision guards, save debounce/flush, and keyboard focus movement.**
- [ ] **Step 2: Run focused checks against current code and record the expected ordering/timing.**
- [ ] **Step 3: Extract only one workflow at a time, preserving refs and dependency arrays verbatim.**
- [ ] **Step 4: Run relevant source tests after each hook extraction.**
- [ ] **Step 5: Run typecheck, build, offline tests, and relevant desktop/session tests.**
- [ ] **Step 6: Review async race guards, cleanup handlers, timer cancellation, and callback identity; commit:**

```bash
git add src/app/hooks src/features/combat src/App.tsx scripts
git commit -m "refactor: isolate app workflow hooks"
```

---

### Task 12: Add characterization coverage before protected domain extraction

**Files:**

- Create or modify: `scripts/game-characterization-tests.ts`
- Create or modify: `scripts/dungeon-state-characterization-tests.ts`
- Create or modify: `scripts/catalog-normalization-tests.ts`
- Modify: `package.json`

**Interfaces:**

Tests must exercise existing exports and assert observable values. They must cover, at minimum, stat/progression outputs, action-cost modifier ordering, seeded RNG state advancement, damage bounds/effectiveness, action/target ordering, statuses, reactive/timed effects, dungeon serialization/restoration, XP, rewards, catalog normalization, and asset fallback.

- [ ] **Step 1: Add deterministic fixtures and tests for each listed contract.**
- [ ] **Step 2: Run all new tests against the unchanged domain modules and confirm they pass.**
- [ ] **Step 3: Add explicit seeded-RNG state assertions for representative action/effect paths.**
- [ ] **Step 4: Add serialization round-trip assertions that compare all protected fields.**
- [ ] **Step 5: Run the full offline suite, typecheck, and build; commit:**

```bash
git add scripts package.json
git commit -m "test: characterize protected game contracts"
```

---

### Task 13: Extract safe combat-domain helpers behind compatibility exports

**Files:**

- Create: `src/lib/combat-calculations.ts`
- Modify: `src/lib/game.ts`
- Modify: `scripts/effect-runtime-tests.ts` only if imports need to follow the public facade

**Interfaces:**

Potential exports, only after verifying exact dependencies:

```ts
export function roundHalfUp(value: number): number;
export function normalizeManaDiceBounds(min: number, max: number, round: (value: number) => number): { diceMin: number; diceMax: number };
export function elementEffectiveness(catalog: Catalog, skillElementId: string, target: Critter): number;
export function classifyEffectiveness(multiplier: number): EffectivenessClass;
export function calculateSkillDamage(...): SkillDamage;
export function rollDamagePercent(random?: () => number): number;
export function rollManaDie(min: number, max: number, random?: () => number): number;
```

Do not move or rewrite action/effect resolution. `src/lib/game.ts` must re-export every moved public function so existing imports remain valid. No RNG implementation may be duplicated; exactly one implementation owns each roll.

- [ ] **Step 1: Compare current functions against Task 12 characterization coverage and identify only pure, dependency-complete candidates.**
- [ ] **Step 2: Move one function group and keep compatibility re-exports.**
- [ ] **Step 3: Run characterization, effect-runtime, typecheck, build, and inspect RNG state diffs.**
- [ ] **Step 4: Repeat only for the next safe group.**
- [ ] **Step 5: Commit each coherent group separately with `refactor: isolate combat calculations`.**

Do not split `resolveAction`, `resolveEffect`, `resolveReactiveEffects`, `resolveTimedEffects`, or `startTurn` in this task.

---

### Task 14: Extract catalog normalization and persistence helpers conservatively

**Files:**

- Create: `src/lib/catalog-normalization.ts`
- Create: `src/lib/player-bootstrap.ts`
- Create: `src/lib/persistence/*` only if a complete boundary is proven
- Modify: `src/lib/supabase.ts`
- Modify: catalog/player/release source tests

**Interfaces:**

Keep `src/lib/supabase.ts` as the public facade. Extract only pure normalization and grouping first. Any persistence extraction must preserve exported function names and exact RPC payloads through facade wrappers.

- [ ] **Step 1: Map each normalization function’s input rows, output type, and indirect ID relationships.**
- [ ] **Step 2: Add direct tests for missing optional tables, ordering, numeric coercion, active filtering, and override precedence.**
- [ ] **Step 3: Move pure normalization with compatibility imports and run tests.**
- [ ] **Step 4: Do not move auth, session leases, mutation outbox, dungeon retries, shop receipt recovery, or lootbox operations until pure extraction is stable.**
- [ ] **Step 5: If a persistence seam is still clearly safe, extract one lifecycle group while preserving RPC names, arguments, request IDs, timeouts, and fallback ordering.**
- [ ] **Step 6: Run source compatibility tests, typecheck, build, offline tests, and safe desktop checks; commit each group separately.**

---

### Task 15: Conservative dead-code audit and lightweight documentation

**Files:**

- Create: `docs/superpowers/reports/2026-08-27-rollcasters-dead-code-audit.md`
- Create or modify: focused module comments in `src/lib/game.ts`, `src/lib/effects.ts`, `src/lib/dungeon-run.ts`, `src/lib/supabase.ts`, and extracted workflow modules
- Delete: only files/exports proven unreachable by the audit

**Interfaces:**

The report must list each candidate, direct-reference results, indirect-reference checks, decision, and evidence. It must explicitly document preserved candidates where reachability is uncertain.

- [ ] **Step 1: Search direct imports/exports and package/build references.**
- [ ] **Step 2: Search string identifiers, registries, JSON serialization, catalog data, asset manifests, RPC names, dynamic imports, and source tests.**
- [ ] **Step 3: Record candidates without deleting anything.**
- [ ] **Step 4: Delete only candidates with complete evidence and run the full verification loop.**
- [ ] **Step 5: Add concise comments for RNG order, persistence boundaries, serialization invariants, and source-test coupling.**
- [ ] **Step 6: Review and commit:**

```bash
git add docs/superpowers/reports src scripts
git commit -m "chore: document safe cleanup decisions"
```

---

### Task 16: Final verification and whole-branch review

**Files:**

- Modify: only files required to address verified review findings
- Create: final verification report if useful

- [ ] **Step 1: Run `npm run typecheck`.**
- [ ] **Step 2: Run `npm run build`.**
- [ ] **Step 3: Run `npm run audit:game-assets`.**
- [ ] **Step 4: Run `npm run test:offline` and record baseline versus final failures.**
- [ ] **Step 5: Run all relevant source/layout/browser checks for changed feature boundaries.**
- [ ] **Step 6: Run `git diff --check`, `git status --short`, and inspect the complete diff for mechanics, numeric expressions, RNG calls, IDs, route strings, RPC payloads, effect dependencies, JSX, CSS, assets, and generated files.**
- [ ] **Step 7: Request whole-branch code review against the design spec and this plan.**
- [ ] **Step 8: Address critical/important findings with one scoped fix batch and rerun affected checks.**
- [ ] **Step 9: Produce the final engineering report with refactor summary, organization, code quality, exact checks, behavioral safety, remaining debt, discovered issues, and coverage limitations.**

## Execution notes

- Use `apply_patch` for source, test, package, and documentation edits.
- Never use destructive commands to recover from a failed batch.
- Never bundle CSS/UI edits with domain or persistence refactors.
- Do not claim a test, mechanic, flow, or build passed without fresh command output.
- If an implementation reveals that an extraction would require guessing about behavior, keep the code in its current module and document the boundary as intentionally deferred.
