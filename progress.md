# Player Game Progress

**Status:** current as of 2026-09-03

## Verified baseline

- Stable production Game: `1.0.7`
- Production Catalog: `2026.08.26.2`
- Production client: signed Tauri desktop artifacts for macOS arm64 and Windows x64
- Current source shape: `App.tsx` composition root with extracted `app/`, `components/shared/`, and `features/` boundaries plus canonical `src/lib/` runtime/integration modules
- Local preview Auth and release alignment: local Game `1.0.8` / Catalog `2026.09.03.1`, with data-preserving release sync and fail-fast packaging checks
- Local packaged desktop transport: Tauri native HTTP is used only for Local loopback Supabase traffic; Stable keeps browser HTTPS fetch and production-only CSP rules
- Local preview packaging: DMG and app-only builds complete without updater-signing requirements; updater artifacts remain Stable-only
- Local and Production player databases: `20260903120000_fast_path_empty_challenge_tracking` applied; empty tracked-challenge reconciliation no longer blocks first bootstrap

## Active work

- Keep desktop packaging/update behavior, release-backed catalog loading, persistence, and canonical combat runtime aligned with the central vault.

## Verification and blockers

- Use [[../rollcaster-docs/02-game/game-verification|Game Verification]]. Live checks depend on configured Supabase/release access and must be reported with exact blockers.
- Use [[../rollcaster-docs/02-game/local-player-preview-auth-plan|Local Preview Account and Database Plan]] for the local Auth/release workflow and verification matrix.
- Latest runtime checks: exact Tauri Local bundle reached Auth without `TypeError: Load failed`; built-renderer sign-up/sign-in reached starter onboarding and cleaned its disposable user; Stable renderer resolved the production Supabase URL with no local endpoint.

## Knowledge links

- [[../rollcaster-docs/02-game/player-game-overview|Player Game Overview]]
- [[../rollcaster-docs/02-game/desktop-runtime|Desktop Runtime]]
- [[../rollcaster-docs/01-shared/game-systems/combat-system|Combat System]]
