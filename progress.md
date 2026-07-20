Original prompt: Now, I want you to use all of these refined implementation documents to make the first version of my game. This should be functional for the most part with a decent bit of UI and feature polish. Seed initial data in the database, and use a database connection to pull all user and game catalog data. Do not seed any user data, as I will test the sign up and log in flows when the first version is built. In this repo, I have a .env file, and I can provide all needed database connection information to it, just let me know what else I need to add to this documentation or repo so you can go though implementation iterations of building and testing to refine a first version of this game.

# Rollcasters project handoff

Last condensed: 2026-07-20

## Current state

- The first playable Rollcasters build is implemented in React, TypeScript, and Vite with Supabase Auth, Postgres, RLS, RPC-backed mutations, Storage, and persistent player accounts.
- The local player app is configured for the published catalog path (`VITE_GAME_CATALOG_MODE=release`) and compact player bootstrap (`VITE_GAME_PLAYER_BOOTSTRAP_MODE=v1`).
- Production-style catalog data and optimized art come from the public Supabase `game-releases` bucket. Editable source/master art remains in `game-assets` for authoring and immutable history fallbacks.
- The project requires Node 22 or newer. The bundled Node 24 runtime is used for Supabase browser/database scenarios in this workspace because the system Node 20 runtime lacks the required native WebSocket support.
- The primary runtime remains concentrated in `src/App.tsx` and `src/styles.css`. Further modularization should be incremental and protected by the existing visual and business-rule tests.

## Player-facing features

- Account signup, login, email-confirmation handling, and durable sessions.
- Starter Rollcaster and starter Critter selection with authored choices and shard-equivalent onboarding rewards.
- Main loadout screen with active Rollcaster, squad management, Critter Skills and Relics, Rollcaster Abilities, progression, currencies, and tracked challenges.
- Collection tabs for Rollcasters, Critters, and Relics with natural collectible ordering, search/filtering, locked states, unlock requirements, challenge tracking, level progress, points, stats, effects, and detail popups.
- Critters support one or two Elements. Element identities, matchups, Skills, statuses, owner effects, and targeting rules are integrated into combat and collection UI.
- Progression grants Skill points and Ability points at authored levels. Players can purchase eligible unlocks and equip or unequip loadout items through server-validated RPCs.
- Shard and Relic Shops support authored prices, stock/max-owned states, duplicate conversion, reward banners, and persistent purchases.
- Promo Codes support case-insensitive claims, finite or unlimited per-player/global uses, immutable redemption history, reward outcomes, and current/retired reward artwork.
- Dungeon selection, regular/boss encounters, persistent runs, deterministic server commands, action selection, Mana Dice, attacks, block, swap, effects, knockout handling, rewards, XP, drops, and completion progression.
- Responsive desktop, tablet, and mobile layouts with keyboard focus, reduced-motion support, contained sprites, compact notifications, and accessible dialogs/tooltips.

## Published catalog and asset architecture

- Catalog releases contain four canonical packs: `core`, `combat`, `collectibles`, and `dungeons`.
- `latest.json` points to one immutable release. The client verifies pointer, manifest, pack, and asset-manifest SHA-256 values before using a release and rejects mixed, tampered, incompatible, or incomplete data.
- Verified artifacts are cached in browser Cache Storage. If the network is unavailable, the last fully verified compatible release can load without mixing versions.
- The exporter creates optimized WebP variants such as icon, thumb, card, battle, and portrait assets with hashed immutable filenames and byte budgets.
- The player app uses published registry variants for its current catalog. Promo reward snapshots can fall back to their immutable source `game-assets` path when an item is retired from the active release.
- Live catalog and legacy player loading remain explicit emergency/development fallbacks only. Normal operation does not combine live source paths with the hashed release asset origin.
- Supabase Storage is the current published-release host. The publisher remains S3-compatible and retains optional R2 support if measured production egress later justifies a provider change.

## Database and migration contract

The current additive migration chain is:

1. `20260719000000_rollcasters_baseline.sql` — consolidated schema, catalog, functions, triggers, RLS, grants, and source asset bucket contract for a fresh environment.
2. `20260720000000_content_releases.sql` — shared immutable content-release ledger/channel contract.
3. `20260720020000_player_bootstrap_v1.sql` — compact authenticated player snapshot and catalog-version compatibility.
4. `20260720030000_fix_indirect_player_revision_trigger.sql` — safe Critter/Rollcaster transition-record handling for equipment changes.

Important rules:

- The baseline is for a fresh environment and must not be applied over an already-populated Rollcasters schema without a reviewed reconciliation.
- Authenticated game mutations are server validated; the client must not be trusted for rewards, prices, drops, progression, damage, or ownership.
- Player state revisions advance for indirect loadout changes so compact snapshots refresh correctly.
- The unequip regression covers Critter Skill, Critter Relic, and Rollcaster Ability clearing inside a rolled-back database fixture.

## High-value fixes retained

- Collection Critter, Rollcaster, and Relic spriteboxes are equal responsive squares. Collection and Relic popup art use the 300px card variants instead of stretched legacy icons.
- Promo redemption sprites resolve to optimized release art, with source-bucket fallback for retired immutable snapshots.
- Critter and Rollcaster equipment revision triggers no longer reference fields that do not exist on the active transition record.
- Combat refunds a queued action's Mana when its Critter is knocked out before acting.
- Swap playback performs an ordered outgoing/incoming handoff and blocks later event playback until the incoming unit is revealed.
- Shop reward banners coalesce rapid purchases so only the latest Shop reward is queued while unlock and Promo notifications remain intact.
- Challenge gates enforce authored order in database progress, tracking, collection cards, detail panels, and the home HUD.
- Published catalog verification includes a portable SHA-256 fallback for browser contexts without `crypto.subtle`.

## Repository conventions

- `src/` contains the player application and reusable game/runtime helpers.
- `supabase/migrations/` is the source of truth for deployable database changes.
- `scripts/` contains focused unit, database, browser, migration, asset audit, export, and publish tools. Every retained script is referenced by an npm command or another script.
- Generated `dist/`, `output/`, local `.env`, certificates, planning documents, Supabase CLI state, and OS metadata are ignored.
- The runtime ships only the optimized WebP logo. The former 1.1 MB PNG duplicate is no longer required by the app or visual tests.

## Verification baseline

The normal non-destructive gate is:

- `npm run typecheck`
- `npm run build`
- `npm run test:catalog-release`
- `npm run test:collection-ui`
- `npm run test:collectibles-shop`
- `npm run test:promo-codes`
- `npm run test:effect-runtime`
- Focused Playwright layout suites for collection, home/loadout, responsive shell, Skills, sprite containment, notifications, and combat swap.
- Published-release browser coverage for online verification, offline cache recovery, tamper rejection, portable SHA-256, configured runtime loading, and decoded release artwork.
- The required web-game client smoke, followed by inspection of both its screenshot and `render_game_to_text` state.

Database and signed-in browser tests may create rollback-only fixtures or disposable users. Run them only against the intended development environment and retain their cleanup audits.

## Remaining work

- Continue adding authored Critters, Rollcasters, Relics, Skills, Abilities, Dungeons, challenges, Shop offers, balance passes, and final presentation polish.
- Monitor release bucket bandwidth, cache-hit behavior, initial-load bytes, and player bootstrap payload size as the catalog grows.
- Keep the Content Studio release publisher and this player runtime on the same schema/runtime contract before publishing future releases.
- Before a public launch, complete a dedicated production security, accessibility, multi-browser, failure-recovery, balance, and load test pass.

## Latest verified snapshot (2026-07-20)

- Cleaned tracked OS metadata and the unused 1.1 MB PNG logo duplicate; the app and responsive fixtures now share the 53 KB WebP asset.
- Aligned `.env.example` with the published-release and compact-bootstrap configuration, while retaining explicit emergency fallback flags.
- Published release `2026.07.20.2` passed online verification, offline cache recovery, tamper rejection, portable hashing coverage, and decoded artwork checks for all 172 registered variants.
- Typecheck, production build, npm audit, core catalog/gameplay rule suites, six focused visual suites, and the prescribed web-game smoke all pass. The final smoke screenshot and text state show a clean unauthenticated login view.
- No known cleanup blocker remains from the published-release/storage transition.
