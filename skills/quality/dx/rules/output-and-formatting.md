# Output & Formatting Rules

Output is the primary communication channel between a CLI tool and its user. Every line matters.

## Stream Discipline

| Content | Stream | Rationale |
|---------|--------|-----------|
| Primary data/results | `stdout` | Piped to next command or captured by scripts |
| Error messages | `stderr` | Visible to user even when stdout is piped |
| Warnings | `stderr` | Don't contaminate pipeable output |
| Progress indicators/spinners | `stderr` | Transient; not part of data output |
| Log messages | `stderr` | Informational, not data |
| Debug output | `stderr` | Only shown with `-v`/`--verbose` |
| Action status ("Deploying...done") | `stderr` | Out-of-band information |

**Critical rule**: Never mix human-directed messages into `stdout`. Scripts that pipe `stdout` will break.

## Color Usage

### When to Use Color
- Highlight important information (errors in red, success in green)
- Distinguish different types of output (paths in cyan, commands in bold)
- Status badges: `ERROR` (red bg), `SUCCESS` (green bg), `WARNING` (yellow bg)
- Dim secondary/less important information

### Standard Color Meanings
| Color | Meaning |
|-------|---------|
| Red | Errors, destructive actions, failures |
| Green | Success, created, added |
| Yellow | Warnings, caution, modified |
| Blue | Info, hints, links |
| Cyan | Paths, filenames, URLs |
| Bold | Emphasis, commands to run, key information |
| Dim | Secondary info, timestamps, IDs |

### Color Control
**Must disable color when**:
- `stdout` or `stderr` is not a TTY (piped or redirected)
- `NO_COLOR` environment variable is set (any value) — see [no-color.org](https://no-color.org)
- `TERM=dumb`
- `--no-color` flag passed
- `COLOR=false` or `FORCE_COLOR=0`

**Must respect**:
- `FORCE_COLOR=1` to enable color even when not TTY (for CI that supports it)

### Implementation Pattern
```
if (isatty(stdout) && !env.NO_COLOR && env.TERM !== 'dumb' && !flags.noColor) {
  // Use colors
} else {
  // Plain text only
}
```

## Progress Indicators

| Duration | Pattern | Example |
|----------|---------|---------|
| <100ms | No indicator | Instant operations |
| 100ms-1s | Inline spinner | `⠋ Checking...` |
| 1-5s | Spinner with context | `⠋ Installing dependencies...` |
| 5-30s | Progress bar or percentage | `Installing ████████░░ 80% (4/5 packages)` |
| >30s | Progress + ETA + allow cancel | `Uploading 12/50 files (24%) — ~2min remaining` |

### Rules
- Print something before network requests (don't appear hung)
- Spinners go to `stderr` (don't corrupt piped output)
- Suppress spinners/animations when not a TTY
- Use `\r` (carriage return) for in-place updates, not flooding newlines
- Show what's happening, not just that something is happening

## Structured Output

### --json Flag
- Provide `--json` for any command that outputs data
- JSON output replaces human-readable output (not mixed)
- Include all data, not a subset (machines need completeness)
- Stable schema — additions OK, removals/renames are breaking changes
- Arrays for lists, objects for single items

### Table Output (Human)
- Use aligned columns with consistent spacing
- No table borders (noisy, painful for grep)
- Each row is one logical entry
- Headers optional (use when not obvious)
- Truncate long values with `...` rather than wrapping

### Plain Output (--plain/--terse)
- One record per line
- Tab-separated or fixed-width columns
- No colors, no decorations
- Stable format for `awk`/`cut` parsing

## Verbosity Levels

| Level | Flag | Content |
|-------|------|---------|
| Silent | `-q, --quiet` | Errors only (exit code is the output) |
| Default | (none) | Essential output: results, errors, key warnings |
| Verbose | `-v, --verbose` | + Info messages, detailed progress, decisions |
| Debug | `-vv` or `--debug` | + Debug details, API calls, timings |
| Trace | `-vvv` | + Internal state, full request/response bodies |

### Rules
- Default output should be useful but minimal
- Never show stack traces at default verbosity
- Never show log-level prefixes (`INFO:`, `WARN:`) at default verbosity
- Debug output should help diagnose issues, not drown users

## Success & Completion Output

- Announce what happened: "Created project in ./my-project"
- Suggest next step: "Run `cd my-project && tool start` to begin"
- Keep it brief — success should feel fast
- For bulk operations: summary line ("3 files updated, 1 skipped")

## What to Flag

- Human messages printed to `stdout` instead of `stderr`
- Missing `--json` output for data-producing commands
- Colors not disabled when not a TTY
- `NO_COLOR` environment variable not respected
- No progress indicator for operations >1s
- Spinners/animations printed when stdout is not TTY
- Table output with borders or mixed formatting
- Stack traces shown at default verbosity
- No `--quiet` option for scripting
- Success output that doesn't say what happened
- Verbose output with no way to suppress it
- Missing `--no-color` flag
