# Rollcasters

Rollcasters is an online-required Tauri 2 desktop game. The React/Vite application remains the local development and browser-test harness; only the Tauri packages are versioned player-facing releases. Combat stays canonical in `src/lib/`.

There is one player distribution profile: Stable/Production (`com.rollcasters.game`). `npm run dev` remains the browser harness and deliberately reads saved authoring content; `npm run dev:catalog -- --release <id>` pins one exact local immutable Catalog for parity testing.

Before packaging, stage an immutable verified Catalog Release with `npm run desktop:stage-catalog -- <release-directory>`. Stable packaging requires protected environment configuration, `ROLLCASTERS_GAME_VERSION`, the correct Supabase project reference, and the paired `TAURI_UPDATER_PUBLIC_KEY`; signing private keys are supplied only through protected CI.

Official candidates use `release/game-update-candidate.example.json` and `.github/workflows/game-update.yml`. The workflow checks out exact commits, downloads and verifies the exact published Catalog, certifies AI Lab parity, builds macOS/Windows artifacts, signs updater payloads, emits checksums/SBOM/evidence, and stops at an unpublished public-repository draft. Publishing or activating Stable is a separate explicit operator action in Content Studio.

The shared project documentation lives in the Obsidian vault at
`../rollcaster-docs/docs/rollcasters-README.md`.

The game uses the shared migration directory in that vault. Run
`npm run db:migrate:dry` to inspect the selected files or `npm run db:migrate`
to apply them. Set `ROLLCASTER_MIGRATIONS_DIR` to override the default path.
