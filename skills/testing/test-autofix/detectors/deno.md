---
title: Deno Test Detector
stack: deno
tags:
  - deno
  - typescript
---

# Deno Test Detector

Bootstrap template for projects using Deno's built-in test runner.

## Detection signals

- `deno.json` or `deno.jsonc` in the project root
- `deno.lock` present
- Source files use `Deno.test(...)` calls

## Surface starter template

```yaml
---
project-key: <normalised-git-remote-key>
stack: deno
detect-command: deno test --allow-read --allow-env
single-test-command: deno test --allow-read --allow-env {file} --filter "{name}"
failure-parser: '^\./([^ ]+) => (.+?) \.\.\. FAILED'
# group 1 = file path relative to cwd, group 2 = test name
cache-bust-flag:
---
# Notes
# Adjust permissions to match your project's requirements:
#   --allow-net  (for integration tests hitting real endpoints)
#   --allow-write  (for tests that write temp files)
#   --env-file=.env.test  (for tests that need env vars from a file)
# For Nx monorepos: pnpm exec nx run <project>:test
```

## Failure output format

```
./tests/unit/parser_test.ts => parseConfig > "handles missing keys" ... FAILED (12ms)
error: AssertionError: Values are not equal:
   -   actual: undefined
   +   expected: "default"
    at file:///path/to/tests/unit/parser_test.ts:18:5
```

Parser regex: `^\./([^ ]+) => (.+?) \.\.\. FAILED`

- Group 1: file path relative to the test run directory (e.g., `tests/unit/parser_test.ts`)
- Group 2: full test name including suite prefix (e.g., `parseConfig > "handles missing keys"`)

## Single-test re-run

```bash
deno test --allow-read --allow-env tests/unit/parser_test.ts \
  --filter "handles missing keys"
```

The `--filter` flag accepts a substring match.
Wrap the name in quotes to handle spaces.

## Common failure families

- **Assertion drift** — `assertEquals(actual, expected)` fails after a schema change.
  Check both the returned shape and the expected value in the test.
- **Permission mismatch** — test needs `--allow-net` but detect-command only has `--allow-read`.
  Add the missing permission flag to the surface file.
- **env-file missing** — integration tests read secrets from `.env.test`;
  confirm the file exists and the flag is included in the command.
- **Import map drift** — `import_map.json` updated upstream; a module path changed.
- **Stale lock file** — `deno.lock` out of sync; run `deno cache --reload <entrypoint>`.
