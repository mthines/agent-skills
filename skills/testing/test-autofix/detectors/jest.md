---
title: Jest Detector
stack: jest
tags:
  - jest
  - javascript
  - typescript
---

# Jest Detector

Bootstrap template for projects using Jest.

## Detection signals

- `jest.config.ts`, `jest.config.js`, or `jest.config.cjs` in the project root
- `"jest"` in `package.json` devDependencies

## Surface starter template

```yaml
---
project-key: <normalised-git-remote-key>
stack: jest
detect-command: pnpm exec jest --verbose
single-test-command: pnpm exec jest --testPathPattern="{file}" --testNamePattern="{name}"
failure-parser: '^\s*●\s+(.+?)\s*›\s*(.+?)\s*$'
# group 1 = describe block, group 2 = test name
# Note: Jest does not print the file path in the failure line itself.
# Use the "FAIL src/..." header line to extract the file.
cache-bust-flag: --no-cache
---
# Notes
# For Nx monorepos: pnpm exec nx run <project>:test
# Adjust --testPathPattern to match your project structure.
# If using Jest with Babel/ESM, consider: NODE_OPTIONS='--experimental-vm-modules' pnpm exec jest
```

## Failure output format

```
FAIL  src/services/auth.test.ts
  ● AuthService › login › "returns token on valid credentials"

    expect(received).toEqual(expected)

    Expected: {"token": "abc123"}
    Received: undefined

      24 |   it("returns token on valid credentials", async () => {
    > 25 |     expect(await authService.login(creds)).toEqual({ token: "abc123" });
         |                                            ^
      26 |   });
```

The file path is in the `FAIL  src/...` header line.
The test identity is in the `●  <describe> › <test>` line.

Header parser: `^FAIL\s+(\S+\.(?:test|spec)\.[jt]sx?)`
Test parser: `^\s+●\s+(.+?)\s*$`

## Single-test re-run

```bash
pnpm exec jest --testPathPattern="src/services/auth.test.ts" \
  --testNamePattern="returns token on valid credentials"
```

## Common failure families

- **Snapshot drift** — call `jest --updateSnapshot` after reviewing the diff.
- **Module mock stale shape** — `jest.mock()` returns outdated API.
- **Timer mocks** — `jest.useFakeTimers()` not cleared between tests; use `afterEach(() => jest.useRealTimers())`.
- **DOM cleanup** — components leak DOM state without `@testing-library/jest-dom` `cleanup`.
- **ESM import** — mixing CJS and ESM; check `transform` config.
