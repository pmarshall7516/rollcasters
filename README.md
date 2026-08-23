# Rollcasters

Rollcasters is an online-required Tauri 2 desktop game. The React/Vite application remains the local development and browser-test harness; only the Tauri packages are versioned player-facing releases. Combat stays canonical in `src/lib/`.

Desktop profiles are isolated:

- Development: `com.rollcasters.dev`
- Beta/Staging: `com.rollcasters.beta`
- Stable/Production: `com.rollcasters.game`

Before packaging, stage an immutable verified Catalog Release with `npm run desktop:stage-catalog -- <release-directory>`. Development packaging uses `npm run desktop:build:development`. Beta/Stable packaging additionally requires protected environment configuration, `ROLLCASTERS_GAME_VERSION`, the correct Supabase project reference, and the paired `TAURI_UPDATER_PUBLIC_KEY`; signing private keys are supplied only through protected CI.

Official candidates use `release/game-update-candidate.example.json` and `.github/workflows/game-update.yml`. The workflow checks out exact commits, verifies the private Catalog handoff, certifies AI Lab parity, builds macOS/Windows artifacts, signs updater payloads, emits checksums/SBOM/evidence, and stops at a private draft bundle. Publishing or activating Stable is a separate explicit operator action.

The shared project documentation lives in the Obsidian vault at
`../rollcaster-docs/docs/rollcasters-README.md`.

The game uses the shared migration directory in that vault. Run
`npm run db:migrate:dry` to inspect the selected files or `npm run db:migrate`
to apply them. Set `ROLLCASTER_MIGRATIONS_DIR` to override the default path.
