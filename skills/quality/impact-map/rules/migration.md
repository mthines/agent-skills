# Migration map — the second figure, only when the diff has a migration

Phase 4b of `impact-map`.
It answers one question the system diagram cannot: is this migration safe to deploy, and who touches the new shape?
Keep it to one screen. Three parts, nothing else.

## When it applies

The diff adds or edits a file in a migrations directory (`**/migrations/**`, `**/db/migrate/**`, `*.sql` under a `schema` or `migrations` path) or a Kysely, Prisma, Alembic, Flyway, or Goose migration.
No migration in the diff: skip this phase and emit no section. `--no-migration` skips it on request.
Several migrations in one PR: one figure, tiles computed over all of them, one schema row per table.

## The three parts

1. **Verdict line and four tiles.** One sentence, then these tiles, each `ok`, `warn`, or `bad`:

   | Tile | `ok` | `warn` | `bad` |
   | --- | --- | --- | --- |
   | Change | Additive: new table, new nullable column, new index on a new table | Adds a `NOT NULL` column with a default, or an index on a live table | Drops or renames a column or table, narrows a type |
   | Locks / backfill | None | Rewrites the table, builds an index without `CONCURRENTLY`, or backfills rows | Backfill or rewrite of a table the hot path reads |
   | Old pods | Old code never names what changed | — | Old code still selects, writes, or joins a dropped or renamed column |
   | Rollback | `down()` loses nothing | `down()` loses data the feature wrote | No `down()`, or `down()` cannot restore what `up()` removed |

   The verdict says "Safe in any deploy order" only when all four are `ok` or the single `warn` is Rollback.
   Never print a row count you did not measure; write "estimate from `pg_class.reltuples`" or leave it out.
2. **Schema summary.** A table of the changes as rows, grouped, not one row per column: `+` added (new, blue), `~` changed (amber), `−` dropped (grey, struck).
   A new table is one `13 columns` row plus one row per constraint or index, each with a four-word reason.
   Show a column by name only when it is changed or dropped.
3. **Who touches it.** One small SVG, at most five boxes: callers → the code that names the table → the table.
   Draw a dashed amber zone around everything behind a feature flag and label it with the flag and its default.
   Red dashed boxes and arrows (`n risk`, `e risk`) mark code that still names a dropped or renamed column.
   Find them with a search for the old name in the head checkout, never from memory.

## Checks to run before writing a tile

- Replica identity: a new Postgres table needs a primary key or `REPLICA IDENTITY FULL`; a missing one is a `bad` Change tile.
- Readers of every dropped or renamed column: `rg` the name across the repo.
- Whether callers are gated by a flag, and the flag's default, from the flag registry.
- Whether `down()` exists and what it drops.

## Page and PNGs

Fill the optional `<section id="migration">` block in `templates/page.html`, after the "Where it shows up" table and before the decisions.
`render-png.mjs` then also writes `migration-light.png` and `migration-dark.png`.
Open the light one before uploading, as for the system diagram.

```text
✓ Right — "Safe in any deploy order. New table, nothing reads it until the flag is on." + 4 tiles + 4 schema rows + a 3-box diagram
✗ Wrong — every column listed, a rollout timeline, a worked example of other migrations
```
