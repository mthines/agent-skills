# Arguments & Flags Rules

Flags and arguments are the primary input interface for CLI tools. Well-designed
flags are discoverable, memorable, and consistent.

## Arguments vs Flags

| Use | When |
|-----|------|
| **Arguments** | Single, obvious input (file path, name); order is clear; primary operand |
| **Flags** | Named options; multiple inputs; optional settings; anything non-obvious |

**Prefer flags over arguments** when:
- There's more than one input
- Argument order isn't immediately obvious
- The value is optional with a default
- Better error messages are needed ("missing --env flag" vs "missing argument 2")

## Standard Flag Names

Use these conventional names when applicable. Don't reinvent them.

| Short | Long | Purpose |
|-------|------|---------|
| `-h` | `--help` | Show help text |
| `-v` | `--version` | Show version (or `--verbose` — pick one per tool, be consistent) |
| `-V` | `--verbose` | Verbose output (if `-v` is version) |
| `-q` | `--quiet` | Suppress non-essential output |
| `-f` | `--force` | Skip confirmations, override safety checks |
| `-n` | `--dry-run` | Preview without executing |
| `-o` | `--output` | Output file/directory |
| `-p` | `--port` | Port number |
| `-d` | `--debug` | Debug output |
| `-y` | `--yes` | Auto-confirm all prompts |
| | `--no-color` | Disable color output |
| | `--no-input` | Disable all interactive prompts |
| | `--json` | JSON output |
| | `--plain` | Plain/terse output for scripting |

## Flag Design Rules

### Naming
- Use kebab-case for long flags: `--output-dir` not `--outputDir` or `--output_dir`
- Use lowercase only
- Use common verbs: `--include`, `--exclude`, `--filter`, `--format`
- Avoid ambiguous or similar names (`--update` vs `--upgrade` — pick one)
- Boolean flags: positive form only (`--color` with `--no-color` via convention)

### Short Flags
- Reserve single-letter flags for frequently used options only
- Don't create short flags for dangerous/destructive options
- Allow combining: `-abc` equivalent to `-a -b -c` (for boolean flags)
- Be consistent: same letter = same meaning across subcommands

### Flag Values
- Support `--flag=value` and `--flag value` (both forms)
- Show default values in help text: `--port <number> (default: 3000)`
- Use `none` as explicit empty value (not blank, which is ambiguous)
- Enumerate valid values in error messages: "Expected --format=json|yaml|toml"

### Subcommand Flags
- Global flags (help, version, quiet, color) work everywhere
- Command-specific flags documented under each command
- Same flag name = same behavior across all subcommands
- Don't require flags before subcommand name: both `tool --verbose build` and `tool build --verbose` should work

## Arguments Design Rules

### Conventions
- Positional arguments are intuitive for 1 input, fragile for 2+
- Multiple arguments OK for the same type: `rm file1 file2 file3`
- Don't use multiple arguments for different types (use flags instead)
- Support `-` to mean "read from stdin" or "write to stdout"
- Support `--` to signal "everything after this is a literal argument, not a flag"

### Subcommands
- Use consistent ordering: `noun verb` or `verb noun` (pick one)
- Avoid ambiguous names (don't have both `update` and `upgrade`)
- Provide aliases for common commands: `ls` = `list`, `rm` = `remove`
- Don't create catch-all commands that execute arbitrary unmatched arguments

## Security

### Secrets
- **NEVER** accept secrets via flags (visible in `ps`, shell history, CI logs)
- Use `--password-file`, `--token-file`, or stdin for sensitive input
- Read from environment variables only as a fallback (still visible in `/proc`)
- Best: credential files with proper permissions, or piped input

### Dangerous Defaults
- Don't default to destructive behavior
- Require `--force` or explicit confirmation for data loss
- `--dry-run` should be available for any destructive operation

## What to Flag

- Secrets accepted via command-line flags
- Custom flag names where standard names exist (`--silent` instead of `--quiet`)
- Short flags for dangerous operations (`-d` for delete)
- Inconsistent flag naming across subcommands
- Arguments used where flags would be clearer
- Missing `--` separator support
- Missing stdin support (no `-` argument)
- Flag names using camelCase or snake_case instead of kebab-case
- No default values shown in help text
- Ambiguously named flags or subcommands
- Flags that can't be used with both `=` and space syntax
- Required flags with no error message when missing
