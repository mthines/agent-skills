# Composability Rules

"Expect the output of every program to become the input to another, as yet unknown, program."
— Doug McIlroy, Unix philosophy

## Pipe-Friendly Output

### stdout Rules
- Primary data goes to `stdout` — this is what gets piped
- One logical record per line (for `grep`, `awk`, `head`, `tail`)
- Consistent field separators (tabs for `cut`, spaces for human reading)
- No decorative elements (borders, boxes, emoji) in piped output
- Detect TTY: human formatting when interactive, clean data when piped

### stdin Rules
- Accept input from stdin when no file argument provided
- Support `-` as explicit "read from stdin" argument
- Handle empty stdin gracefully (don't hang, don't crash)
- Stream processing when possible (don't buffer entire stdin into memory)

### Pattern: Dual-Mode Output
```
if (isatty(stdout)) {
  // Pretty output: colors, tables, alignment, badges
  printPrettyTable(data);
} else {
  // Pipe output: plain, one-record-per-line, parseable
  data.forEach(row => console.log(row.join('\t')));
}
```

## Structured Data

### --json Flag
- Every data-producing command should support `--json`
- JSON output replaces (not supplements) human output
- Include all available data (machines need completeness)
- Use consistent key names across commands (camelCase or snake_case — pick one)
- Arrays for lists, objects for single records
- Schema should be stable — additions OK, removals are breaking

### Integration with jq
```bash
# Users expect these patterns to work:
tool list --json | jq '.[].name'
tool show --json | jq '.status'
tool list --json | jq 'map(select(.active))'
```

## Exit Codes

### Rules
- `0` = success, always
- Non-zero = failure, always
- Different non-zero codes for different failure modes (when useful for scripts)
- "No results" is success (`0`), not failure — the query succeeded
- Document exit codes for automation-heavy tools

### Script Patterns to Support
```bash
# Users expect these to work correctly:
if tool check; then echo "OK"; else echo "FAIL"; fi
tool build && tool deploy      # Short-circuit on failure
tool list || echo "No items"   # Fallback on failure
result=$(tool get --json)      # Capture structured output
```

## Signal Handling

| Signal | Expected Behavior |
|--------|------------------|
| `SIGINT` (Ctrl-C) | Clean exit, minimal cleanup, restore terminal state |
| `SIGTERM` | Graceful shutdown (same as SIGINT in most tools) |
| `SIGPIPE` | Exit silently (output piped to `head` or closed pipe) |
| `SIGHUP` | Depends on tool — either ignore or graceful shutdown |

### SIGPIPE
- **Critical**: Handle SIGPIPE silently — don't print error when pipe closes
- Example: `tool list | head -5` — tool should exit cleanly when `head` closes the pipe
- Many languages throw an error on write to closed pipe — catch and exit cleanly

## Idempotency

- Commands should be safe to re-run: `tool init` on already-init'd project = no-op or update
- Partial failures should be recoverable by re-running the same command
- Design for "up-enter" workflow (re-run last command after fixing the issue)
- Document when commands are NOT idempotent

## Composition Patterns

### Filter Pattern
```bash
# Tool reads from stdin, writes to stdout, transforms in between
cat data.txt | tool filter --criteria=X | sort | uniq
```

### Generator Pattern
```bash
# Tool produces output that feeds into other tools
tool list --plain | xargs -I{} tool process {}
```

### Wrapper Pattern
```bash
# Tool wraps another command, adding behavior
tool watch -- npm test    # Runs 'npm test' on file changes
```

Support `--` to separate tool flags from wrapped command arguments.

## What to Flag

- Human-formatted output when stdout is piped (not TTY)
- Missing `--json` flag for data commands
- Non-zero exit code on "no results found" (query success)
- No stdin support when it would be natural
- SIGPIPE errors printed to terminal
- Commands that aren't idempotent without documentation
- Missing `--` separator support for command wrapping
- Structured output (JSON) with inconsistent key naming
- Piped output that includes progress bars or spinners
- No way to capture output for scripting (only human-formatted)
