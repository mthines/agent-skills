# Error Handling Rules

Error messages are the most critical copy in a CLI tool. A developer stuck on an error
is a developer who can't work. Great error messages turn frustration into resolution.

## Error Message Structure

**Pattern**: What happened + Why (if helpful) + What to do

| Do | Don't |
|----|-------|
| "Can't write to ./output. Permission denied. Run `chmod +w ./output`" | "EACCES: permission denied" |
| "Unknown flag '--quite'. Did you mean '--quiet'?" | "Error: unrecognized option" |
| "Config file not found at ~/.toolrc. Run `tool init` to create one." | "ENOENT: no such file or directory" |
| "Port 3000 is already in use. Use `--port` to specify a different port." | "EADDRINUSE" |
| "Can't connect to API. Check your internet connection and try again." | "fetch failed" |
| "Missing required flag '--env'. Specify the target environment." | "TypeError: Cannot read property 'env' of undefined" |

## Error Output Rules

### Stream and Format
- All errors go to `stderr`, never `stdout`
- Use red color and/or `ERROR` badge for visual distinction
- Include enough context to identify the problem without `--verbose`
- Use consistent formatting across all error messages

### Content Rules
- **Plain language**: No error codes, no jargon, no stack traces at default verbosity
- **Specific**: Name the exact file, flag, or value that's wrong
- **Actionable**: Tell the user what to do next (command to run, setting to change)
- **Don't blame**: "Can't find config file" not "You didn't create a config file"
- **One error, one message**: Don't combine unrelated errors into one block

### Signal-to-Noise
- Group similar errors under a single header (e.g., "3 validation errors:")
- Place the most important information where the eye is drawn (last line, red text)
- Suppress internal details unless `--verbose` is passed
- For unexpected errors: include debug info and bug report instructions

## Exit Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| `0` | Success | Operation completed as expected |
| `1` | General error | Catchall for any failure |
| `2` | Usage error | Invalid flags, missing required args, bad syntax |
| `126` | Not executable | Permission denied on command execution |
| `127` | Not found | Command or dependency not found |
| `130` | Interrupted | Ctrl-C / SIGINT received |

### Rules
- **Always** return non-zero on failure — scripts depend on this
- **Never** return non-zero on success (including "no results found" for searches)
- Map different failure modes to distinct exit codes when scripts need to differentiate
- Document exit codes in help text for automation-heavy tools

## Error Categories

### Validation Errors (before execution)
- Check all input early, before any side effects
- Show all validation errors at once (don't fix-one-rerun-fix-another)
- Suggest valid values when possible ("Expected one of: staging, production")

### Runtime Errors (during execution)
- Explain what was being done when the error occurred
- If partially complete, say what succeeded and what didn't
- For network errors: distinguish between "can't connect" and "server error"

### Dependency Errors
- Check for required dependencies at startup, not mid-operation
- Show install instructions: "git is required. Install: brew install git"
- Include the minimum version if relevant

### Configuration Errors
- Point to the exact file and line/key that's wrong
- Show the invalid value and what was expected
- Suggest the fix: "Change `port: abc` to a number in ~/.toolrc"

## Bug Reports

For unexpected/internal errors:
```
ERROR Unexpected error: <brief description>

This is a bug. Please report it:
  https://github.com/org/tool/issues/new?title=<url-encoded-title>&body=<debug-info>

Debug information:
  tool v1.2.3, deno 1.40.2, darwin-arm64
  Command: tool deploy --env staging
```

- Pre-populate the bug report URL with context
- Include version, OS, and the command that failed
- Make filing a bug effortless (one click/command)
- Optionally write full debug log to file: "Debug log written to /tmp/tool-debug.log"

## Warning Messages

- Use yellow color and/or `WARNING` badge
- Warnings go to `stderr`
- Use for: deprecation notices, non-fatal issues, upcoming breaking changes
- Include timeline for deprecation: "Warning: --legacy flag will be removed in v3.0"
- Suggest the migration path: "Use --format instead"

## What to Flag

- Error messages with raw error codes, stack traces, or internal jargon
- Errors printed to `stdout` instead of `stderr`
- Missing exit codes (always returning 0, even on failure)
- Generic errors without actionable guidance ("Error occurred")
- Silent failures (no output, but operation didn't succeed)
- No validation of input before executing side effects
- Missing dependency checks at startup
- Errors that don't name the specific file/flag/value that's wrong
- No `--verbose` mode for debugging complex errors
- Bug report mechanism missing for unexpected errors
