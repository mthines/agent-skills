# Shell Scripting Rules

Rules for reviewing shell scripts (bash, zsh, sh, fish). Apply when the target
is a shell script rather than a compiled CLI tool.

## Script Header

### Required Shebang
```bash
#!/usr/bin/env bash    # Portable bash
#!/bin/bash            # Fixed path (less portable)
#!/bin/sh              # POSIX sh only (no bashisms)
```
- Always include a shebang — never rely on the caller's shell
- Use `#!/usr/bin/env bash` for portability across systems
- If using POSIX sh, don't use bash-specific features

### Defensive Options
```bash
set -euo pipefail
```

| Option | Effect | Why |
|--------|--------|-----|
| `set -e` (errexit) | Exit on any command failure | Prevents cascading failures from unnoticed errors |
| `set -u` (nounset) | Error on undefined variable use | Catches typos and missing values |
| `set -o pipefail` | Pipeline fails if any command fails | `cmd1 | cmd2` fails if `cmd1` fails, not just `cmd2` |

**Always use `set -euo pipefail`** unless there's a documented reason not to.

### Optional Strict Mode
```bash
set -euo pipefail
IFS=$'\n\t'    # Safer word splitting (no space splitting)
```

## Variable Handling

### Quoting
- **Always quote variables**: `"$variable"` not `$variable`
- Unquoted variables undergo word splitting and glob expansion — the #1 source of bash bugs
- Exception: inside `[[ ]]` (but quote anyway for consistency)

### Naming
- UPPER_CASE for exported/environment variables: `export DATABASE_URL="..."`
- lower_case for local variables: `local file_count=0`
- Prefix script-specific env vars to avoid collisions: `MYTOOL_DEBUG=1`

### Defaults and Checks
```bash
# Default value
output_dir="${OUTPUT_DIR:-./dist}"

# Required variable check
: "${API_KEY:?Error: API_KEY environment variable is required}"
```

## Error Handling

### Trap for Cleanup
```bash
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT    # Runs on normal exit AND on error
trap 'echo "Interrupted"; exit 130' INT   # Ctrl-C
```

### Error Functions
```bash
error() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "WARNING: $*" >&2
}
```

### Exit Codes
- Use meaningful exit codes (not just 0 and 1)
- Document non-standard exit codes
- Return 130 on SIGINT (128 + signal number)

## Input Validation

- Validate all arguments before executing any side effects
- Check file/directory existence before operating: `[[ -f "$file" ]] || error "File not found: $file"`
- Check command dependencies early: `command -v jq >/dev/null || error "jq is required. Install: brew install jq"`
- Validate numeric inputs: `[[ "$port" =~ ^[0-9]+$ ]] || error "Port must be a number"`

## Temporary Files

```bash
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

# Use tmp_dir for temporary files
tmp_file="$tmp_dir/output.txt"
```

- Always use `mktemp` — never hardcode `/tmp/myscript.tmp`
- Always clean up via `trap EXIT`
- Use `TMPDIR` if set

## Script Quality Checklist

### Structure
- [ ] Shebang line present and correct
- [ ] `set -euo pipefail` enabled
- [ ] Functions for reusable logic (not one giant script)
- [ ] `main()` function pattern for complex scripts
- [ ] Comments on non-obvious logic (not every line)

### Safety
- [ ] All variables quoted: `"$var"` not `$var`
- [ ] Temporary files use `mktemp` with cleanup trap
- [ ] Input validated before use
- [ ] Dependencies checked early (`command -v`)
- [ ] No hardcoded paths that vary by system

### Output
- [ ] Errors go to `stderr` (`>&2`)
- [ ] Exit codes are meaningful
- [ ] Progress/status visible for long operations
- [ ] Supports `--help` or `-h` flag

### Testing
- [ ] Passes `shellcheck` with no warnings
- [ ] Passes `shfmt` formatting
- [ ] Works on target platforms (macOS + Linux if cross-platform)
- [ ] Tested with edge cases (spaces in paths, empty input)

## Common Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| `cd dir && cmd` without returning | Use subshell: `(cd dir && cmd)` or `pushd/popd` |
| `cat file \| grep pattern` | `grep pattern file` (useless use of cat) |
| Parsing `ls` output | Use globs: `for f in *.txt` or `find` |
| `[ -z $(cmd) ]` | `[[ -z "$(cmd)" ]]` (quote command substitution) |
| `echo "$password"` | Leaks to process list; use `printf '%s'` or files |
| String comparison with `[ $a == $b ]` | `[[ "$a" == "$b" ]]` (double bracket, quoted) |
| `eval "$user_input"` | Never eval user input — command injection risk |
| Hardcoded `/tmp/file` | `mktemp` for unique, race-condition-free temp files |

## Portability

### macOS vs Linux Differences
| Feature | macOS (BSD) | Linux (GNU) |
|---------|------------|-------------|
| `sed -i` | Requires `''`: `sed -i '' 's/a/b/'` | No arg: `sed -i 's/a/b/'` |
| `date` | BSD syntax | GNU syntax |
| `readlink -f` | Not available (use `realpath` or custom function) | Available |
| `grep -P` | Not available | Perl regex available |
| `find` | Slightly different flags | GNU find |

- Test on both macOS and Linux if distributing cross-platform
- Use POSIX-compatible commands when possible
- Document platform requirements

## What to Flag

- Missing shebang line
- Missing `set -euo pipefail`
- Unquoted variables (especially in conditions and command args)
- No `trap` for cleanup of temporary files
- `eval` on user-provided input
- Hardcoded temporary file paths
- Missing dependency checks (`command -v`)
- Error messages going to `stdout` instead of `stderr`
- No `--help` flag
- `shellcheck` violations
- Platform-specific commands without portability notes
- Functions longer than ~50 lines without decomposition
