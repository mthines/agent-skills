---
title: Preflight — Install + Dev-Server Gates
impact: HIGH
tags:
  - preflight
  - install
  - playwright
  - ffmpeg
  - gating
---

# Preflight

Runs before any recording.
Halts and asks the user before installing anything.
The skill cannot succeed without Playwright + Chromium; it can succeed
without `ffmpeg` but the recording will not be cropped.

## Contents

- Checks (decision table)
- Install plan template (package-manager detection)
- `ffmpeg` install plan
- Localhost reachability probe
- Auth gate for staging / production
- Live-URL consent
- Examples
- Common mistakes

## Checks

Run all three in order; each is read-only.

| # | Check                                            | Command                                                        | If missing                                                                |
| - | ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 | Node + `npx` available                           | `command -v npx`                                               | **Halt.** Node ≥ 18 required.                                             |
| 2 | Playwright package installed                     | `npx --no-install playwright --version 2>/dev/null`            | **Halt.** Print install plan, ask permission.                              |
| 3 | Chromium driver downloaded                       | `npx playwright install --dry-run chromium 2>&1 \| grep -v "is already installed"` | **Halt.** Print `npx playwright install chromium`, ask first.   |
| 4 | `ffmpeg` available                               | `command -v ffmpeg`                                            | **Warn.** Cropping disabled. Print install plan, ask permission.          |
| 5 | Output directory writable                        | `mkdir -p .agent/recordings && [ -w .agent/recordings ]`       | **Halt.** Cannot proceed without a writable output dir.                    |
| 6 | If `url` is `http://localhost:*`, dev server up  | `curl -sf --max-time 2 "$URL" >/dev/null`                      | **Halt.** Ask the user to start the dev server.                            |

## Install plan template

When Playwright is missing, print this exact block and wait for `y/N`:

```text
Playwright is not installed. To proceed, run:

  pnpm add -D playwright
  npx playwright install chromium

This downloads ~150 MB (Chromium driver). The skill will not record
until you approve.

Proceed? [y/N]
```

For `pnpm`, swap to the active package manager (`npm`, `yarn`, `bun`)
detected from the lockfile in the repo root. Detection table:

| Lockfile present  | Install command                                          |
| ----------------- | -------------------------------------------------------- |
| `pnpm-lock.yaml`  | `pnpm add -D playwright`                                 |
| `yarn.lock`       | `yarn add -D playwright`                                 |
| `bun.lockb`       | `bun add -d playwright`                                  |
| `package-lock.json` | `npm install -D playwright`                            |
| None              | `npm install -D playwright` (default, mention assumption) |

## `ffmpeg` install plan

```text
ffmpeg is not installed. Cropping the recording to a single element
needs it. Without ffmpeg, the recording will be the full viewport.

To install:

  macOS:   brew install ffmpeg
  Debian:  sudo apt-get install ffmpeg
  Other:   https://ffmpeg.org/download.html

Proceed without cropping? [y / install / abort]
```

## Localhost reachability

If the user passed `http://localhost:<port>/<path>`, probe before
launching Chromium:

```bash
URL="http://localhost:3000/services"
if ! curl -sf --max-time 2 "$URL" >/dev/null; then
  echo "Dev server at $URL is not responding."
  echo "Start it (e.g. 'pnpm dev') and rerun."
  exit 1
fi
```

Skip the probe for staging / production URLs — those are network
dependent and probing leaks intent.

## Auth gate (staging / production only)

If the URL matches a staging or production host the user has named,
record but **do not** capture credentials or POST bodies. Mitigations:

- Use an existing authenticated state file at
  `.browser/auth-state.json` if it exists (`storageState:` on
  `browser.newContext`).
- Never type credentials in the recording script — if the page is
  unauthenticated and no state file is available, halt and ask.
- Strip query strings from the printed delivery URL if they contain
  tokens.

**Critical:** If `.browser/auth-state.json` exists AND the URL is not
`localhost:*`, surface an additional prompt before launching Chromium:

```text
Auth state found at .browser/auth-state.json. The recording will
capture your authenticated session (cookies, tokens, user-specific DOM).
This clip may be attached to a public PR or shared externally.
Load the auth state and proceed? [y/N]
```

Halt on anything other than `y`.
If the caller is `reviewer` (PR Mode), also warn: "This clip will be
uploaded and embedded in a public PR comment."
Never silently load auth state for a live URL.

## Consent for live URLs

Before recording a host that is not `localhost`, ask:

```text
About to record https://app.example.com/path. Live recordings can
contain real user data (authenticated session, PII). Confirm the user
has named this host explicitly and accepts that the recording may be
shared? [y/N]
```

Halt on anything other than `y`.

## Examples

### Good

```bash
$ command -v npx && npx --no-install playwright --version
/opt/homebrew/bin/npx
Version 1.56.0
$ command -v ffmpeg
/opt/homebrew/bin/ffmpeg
$ curl -sf --max-time 2 http://localhost:3000/services && echo OK
OK
# Preflight pass — proceed to Phase 1.
```

### Bad — installing silently

```bash
$ npm install -D playwright   # ← never run this without asking
```

**Fix:** print the install plan, wait for `y/N`, then run.

## Common mistakes

- **Skipping the dev-server check.**
  Recording an unreachable URL gives a 3-second clip of `ERR_CONNECTION_REFUSED`.
  **Fix:** probe with `curl -sf --max-time 2`.
- **Installing without consent.**
  The user may not want a 150 MB Chromium download on this machine.
  **Fix:** print the install plan, ask, do not auto-run.
- **Treating `ffmpeg` as required.**
  It is not — fall back to uncropped delivery.
  **Fix:** warn and continue, do not halt.
- **Probing live hosts.**
  `curl` against staging from an automation context can be policed.
  **Fix:** skip the probe for non-`localhost` URLs.
