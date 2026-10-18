# Legacy flags

Loaded only when `$ARGUMENTS` carries `--review`, `--simplify`, `--pre-review`, `--no-feedback`, or `--no-preview-spec`.
Each is still accepted; map it before evaluating the Step 6.5 table.

| Legacy flag | Treat as |
| --- | --- |
| `--review` alone | `--no-simplify` (pr-reviewer only) |
| `--simplify` alone | `--no-review` (simplify only) |
| `--review --simplify` | the default (full loop) |
| `--pre-review` | no-op affirmation of the default-on Step 5.5 |
| `--no-feedback` | accepted and ignored (the background external-bot watch it disabled no longer exists) |
| `--no-preview-spec` | `--no-ui-verify` (pre-rename spelling) |
