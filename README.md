# Rollcasters

The shared project documentation lives in the Obsidian vault at
`../rollcaster-docs/docs/rollcasters-README.md`.

The game uses the shared migration directory in that vault. Run
`npm run db:migrate:dry` to inspect the selected files or `npm run db:migrate`
to apply them. Set `ROLLCASTER_MIGRATIONS_DIR` to override the default path.
