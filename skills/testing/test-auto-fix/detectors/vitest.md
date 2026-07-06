---
title: Vitest Detector
stack: vitest
tags:
  - vitest
  - javascript
  - typescript
---

# Vitest Detector

Bootstrap template for projects using Vitest.

## Detection signals

- `vitest.config.ts` or `vitest.config.js` in the project root
- `"vitest"` in `package.json` devDependencies

## Surface starter template

Use this as the starting point when writing `surfaces/<project-key>.md`.
Replace placeholder values with the actual commands from the project.

```yaml
---
project-key: <normalised-git-remote-key>
stack: vitest
detect-command: pnpm exec vitest run --reporter verbose
single-test-command: pnpm exec vitest run {file} -t "{name}"
failure-parser: '^\s*FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)\s*>\s*(.+?)\s*$'
# group 1 = file path, group 2 = test name (may include suite prefix)
cache-bust-flag: --no-cache
---
# Notes
# Adjust detect-command to match your project's npm script (e.g., `npm test` or `yarn test`).
# For Nx monorepos: pnpm exec nx run <project>:test
# For Turborepo: pnpm turbo run test
```

## Failure output format

```
 FAIL  src/lib/utils/parser.test.ts > parseConfig > "handles missing keys"
AssertionError: expected { foo: undefined } to deeply equal { foo: 'default' }
 ❯ src/lib/utils/parser.test.ts:24:5
```

Parser regex: `^\s*FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)\s*>\s*(.+?)\s*$`

- Group 1: file path (e.g., `src/lib/utils/parser.test.ts`)
- Group 2: full nested suite + test name (e.g., `parseConfig > "handles missing keys"`)

## Single-test re-run

```bash
pnpm exec vitest run src/lib/utils/parser.test.ts -t "handles missing keys"
```

For React Native / jsdom tests that need an explicit environment:

```bash
pnpm exec vitest run --environment jsdom src/components/Button.test.tsx -t "renders correctly"
```

## Cache note

Vitest itself does not cache test results by default.
If the project uses Nx or Turborepo, the caching layer wraps the runner.
Set `cache-bust-flag: --skip-nx-cache` (Nx) or `--force` (Turborepo) if you
observe phantom-green runs.

## Common failure families

- **Snapshot drift** — visual output changed; update snapshot after review.
- **Module mock mismatch** — `vi.mock()` returns stale shape after refactor.
- **React / hook timing** — use `findBy*` / `waitFor` instead of `getBy*` for async.
- **Import alias drift** — path alias (`@/`, `~/`) moved; update the import.
- **TypeScript strict mode** — null checks or generic constraints tightened upstream.
