# Player Game Progress

**Status:** current as of 2026-08-27

## Verified baseline

- Stable production Game: `1.0.7`
- Production Catalog: `2026.08.26.2`
- Production client: signed Tauri desktop artifacts for macOS arm64 and Windows x64
- Current source shape: `App.tsx` composition root with extracted `app/`, `components/shared/`, and `features/` boundaries plus canonical `src/lib/` runtime/integration modules

## Active work

- Keep desktop packaging/update behavior, release-backed catalog loading, persistence, and canonical combat runtime aligned with the central vault.

## Verification and blockers

- Use [[../rollcaster-docs/02 Game/Game Verification|Game Verification]]. Live checks depend on configured Supabase/release access and must be reported with exact blockers.

## Knowledge links

- [[../rollcaster-docs/02 Game/Player Game Overview|Player Game Overview]]
- [[../rollcaster-docs/02 Game/Desktop Runtime|Desktop Runtime]]
- [[../rollcaster-docs/01 Shared/Game Systems/Combat System|Combat System]]
