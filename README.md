# Rollcasters

Rollcasters is an online-required Tauri 2 desktop game. The React/Vite application remains the local development and browser-test harness; only the Tauri packages are versioned player-facing releases. Combat stays canonical in `src/lib/`.

There is one player distribution profile: Stable/Production (`com.rollcasters.game`). `npm run dev` remains the local browser harness and reads saved authoring content. It synchronizes its read/write RPC compatibility headers to the currently active Production Game Update, so an older `.env` version does not hit the required-update gate. `npm run dev:catalog -- --release <id>` pins one exact local immutable Catalog for parity testing; when the matching `release/game-update-candidate.json` exists, it also uses that candidate's Game version.

Use the exact-candidate preview before publishing or activating a Game Update:

```bash
npm run dev:catalog -- --release YYYY.MM.DD.N
```

This serves the candidate Catalog and artwork locally while leaving the Production Catalog pointer and Stable Game Update unchanged. The browser harness uses the active Production tuple only for server RPC compatibility; rendered Catalog data, client runtime, and asset paths come from the selected local release. Pass `--game-version X.Y.Z` when the candidate is not recorded in `release/game-update-candidate.json`. New server-authoritative content is not active until the matching Game Update is published and activated.

Before packaging, stage an immutable verified Catalog Release with `npm run desktop:stage-catalog -- <release-directory>`. Stable packaging requires protected environment configuration, `ROLLCASTERS_GAME_VERSION`, the correct Supabase project reference, and the paired `TAURI_UPDATER_PUBLIC_KEY`; signing private keys are supplied only through protected CI.

Official candidates use `release/game-update-candidate.example.json` and `.github/workflows/game-update.yml`. The workflow checks out exact commits, downloads and verifies the exact published Catalog, certifies AI Lab parity, builds macOS/Windows artifacts, signs updater payloads, emits checksums/SBOM/evidence, and stops at an unpublished public-repository draft. Publishing or activating Stable is a separate explicit operator action in Content Studio.

The shared project documentation lives in the Obsidian vault at
`../rollcaster-docs/docs/rollcasters-README.md`.

The game uses the shared migration directory in that vault. Run
`npm run db:migrate:dry` to inspect the selected files or `npm run db:migrate`
to apply them. Set `ROLLCASTER_MIGRATIONS_DIR` to override the default path.
