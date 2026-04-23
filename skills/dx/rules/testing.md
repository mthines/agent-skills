# Testing Rules

A CLI tool without tests is a CLI tool that will break. Testing developer tools
requires specific patterns beyond unit testing — you must test the interface itself.

## Testing Layers

| Layer | What to Test | How |
|-------|-------------|-----|
| **Unit** | Individual functions, parsers, validators | Standard test framework |
| **Integration** | Command execution end-to-end | Run actual commands, assert output + exit codes |
| **Output** | Help text, error messages, formatting | Snapshot testing or assertion on stdout/stderr |
| **Behavioral** | Flags, arguments, piping, signals | Simulate real CLI usage patterns |

## Integration Testing Patterns

### Test Harness Pattern
Create isolated environments for each test:
```
// Pattern from gw-tools: GitTestRepo harness
const repo = new TestRepo();
await repo.init();          // Create isolated temp environment
await repo.setup();         // Set up test state
// ... run commands ...
await repo.cleanup();       // Always clean up
```

### What to Test End-to-End
- [ ] Each command produces correct output
- [ ] Exit codes are correct (0 on success, non-zero on failure)
- [ ] Error messages are correct for invalid input
- [ ] `--help` output matches expected format
- [ ] `--json` output is valid JSON with expected schema
- [ ] `--quiet` actually suppresses output
- [ ] `--dry-run` doesn't modify anything
- [ ] Piped input produces correct output
- [ ] Ctrl-C handling doesn't leave temp files

### Isolated Test Environments
- Use temp directories for file-system-dependent tests
- Never test against the real user's environment
- Clean up temp dirs even when tests fail (use `afterEach`/`trap`)
- Mock network calls or use test servers
- Set deterministic environment variables (`HOME`, `TERM`, `NO_COLOR`)

## Output Testing

### Snapshot Testing
- Capture `stdout` and `stderr` separately
- Compare against approved snapshots
- Update snapshots intentionally (not silently)
- Useful for: help text, table formatting, error messages

### Stream Assertion
```bash
# Assert stdout contains expected output
output=$(tool list 2>/dev/null)
assert_contains "$output" "expected text"

# Assert stderr contains error
error_output=$(tool bad-command 2>&1 1>/dev/null)
assert_contains "$error_output" "Unknown command"

# Assert exit code
tool check; assert_eq $? 0
tool bad-input; assert_eq $? 2
```

## Flag & Argument Testing

### Combinatorial Testing
Test flag combinations that users will try:
- Each flag individually
- Common flag combinations
- Conflicting flags (should produce clear error)
- Unknown flags (should suggest alternatives)
- Flags in different order (should be order-independent)
- Short and long form equivalence: `-v` == `--verbose`

### Edge Cases
- Empty input / no arguments
- Very long arguments
- Special characters in arguments (spaces, quotes, unicode)
- Arguments that look like flags (`--` separator)
- Multiple values for single-value flags

## Shell Script Testing

### ShellCheck
- Run `shellcheck` on all `.sh`/`.bash` files
- Zero warnings policy (or explicitly disable with rationale)
- Integrate into CI pipeline
- Use `shellcheck source=` directives for sourced files

### shfmt
- Use `shfmt` for consistent formatting
- Enforce in CI (check mode: `shfmt -d`)
- Agree on indent style (2 spaces is common)

### Script Test Frameworks
- **bats-core**: BDD-style testing for bash scripts
- **shunit2**: xUnit-style testing for shell scripts
- **shpec**: RSpec-style testing for shell scripts

### Script Test Pattern (bats)
```bash
@test "tool --help shows usage" {
  run tool --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "tool fails on missing required flag" {
  run tool deploy
  [ "$status" -eq 2 ]
  [[ "$output" == *"--env"* ]]
}
```

## Custom Test Assertions

Build assertion helpers specific to CLI testing:

| Assertion | Purpose |
|-----------|---------|
| `assertExitCode(cmd, expected)` | Verify correct exit code |
| `assertStdout(cmd, contains)` | Verify stdout content |
| `assertStderr(cmd, contains)` | Verify stderr content |
| `assertFileExists(path)` | Verify side effects |
| `assertFileNotExists(path)` | Verify cleanup |
| `assertJsonOutput(cmd, schema)` | Verify JSON structure |
| `assertNoStdout(cmd)` | Verify quiet/silent mode |

## Mocking Patterns

| Mock Target | Approach |
|-------------|----------|
| **File system** | Temp directories per test, clean up in teardown |
| **Network** | HTTP mock server, recorded fixtures, env var for API URL |
| **stdin** | Pipe from echo or heredoc: `echo "input" \| tool` |
| **Environment** | Save/restore env vars in setup/teardown |
| **Time/date** | Inject via env var or config |
| **External commands** | PATH manipulation: put mock scripts first in PATH |

## CI Integration

- Run full test suite on every PR
- Test on all supported platforms (matrix: linux, macOS, optionally Windows)
- Test with minimum supported runtime version
- Include ShellCheck and shfmt in CI for shell scripts
- Generate coverage reports
- Test install process on clean environments

## What to Flag

- No tests at all
- Tests that only cover happy path
- Missing exit code assertions
- No stderr/stdout separation in tests
- Tests that depend on local environment (user's git config, system tools)
- No CI integration for tests
- Shell scripts without `shellcheck` in CI
- Missing edge case tests (empty input, special characters)
- Tests that don't clean up temp files
- No snapshot testing for help text (changes go unnoticed)
