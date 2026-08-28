# Player Game Instructions

`rollcasters/` is the production player application: a signed Tauri desktop shell around a React/Vite renderer. Browser/Vite runs are development, preview, or test surfaces; they are not the production product boundary.

## Source ownership

- `src/App.tsx` is the composition root.
- `src/app/`, `src/components/shared/`, and `src/features/` contain extracted app/presentation boundaries.
- `src/lib/` owns framework-light catalog, persistence, progression, desktop, and combat modules.
- `src/lib/game.ts` and related runtime modules are the canonical combat source.
- `src-tauri/` owns native window, capability, resource, updater, and platform packaging behavior.
- `rollcaster-sim/src/generated/game/` is generated from this runtime; never edit it directly.

## Required workflow

Read [[../rollcaster-docs/02 Game/Player Game Overview|Player Game Overview]], [[../rollcaster-docs/02 Game/Desktop Runtime|Desktop Runtime]], and [[../rollcaster-docs/01 Shared/Operations/Vault Maintenance Standard|Vault Maintenance Standard]]. Preserve routes, catalog IDs, RPC contracts, serialized state, RNG order, numeric semantics, UI markup/CSS, and persistence timing unless the task explicitly changes them.

For combat/runtime changes:

```bash
npm run typecheck
npm run build
cd ../rollcaster-sim
npm run sync:combat
npm run typecheck
npm test
```

Run focused Game tests and safe browser/database checks proportional to the change. Do not publish a Catalog or Game Update unless explicitly requested.

## Database

Use the shared vault migrations and [[../rollcaster-docs/01 Shared/Database/Migration Workflow|Migration Workflow]]. The Game migration runner is the history-aware apply path. Verify live migration history and effects before documenting application.
