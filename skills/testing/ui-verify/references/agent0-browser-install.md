---
title: Rationale — the Agent0 on-demand Playwright install
impact: MEDIUM
tags:
  - ui-verify
  - agent0
  - playwright
  - rationale
---

# Rationale — the Agent0 on-demand Playwright install

Read [`rules/agent0-runtime.md`](../rules/agent0-runtime.md) and the [`SKILL.md` on-demand block](../SKILL.md#on-demand-browser-install--run-and-verify) first; this file explains why each is shaped the way it is.

## Why two stages, not one

`review-loop`'s existing on-demand install (its `rules/agent0-runtime.md § Install on demand when the marker is absent`) runs the setup script with `WITH_PLAYWRIGHT=0` when a marker is entirely absent — it installs the base bundle only and never installs the browser itself.
`ui-verify` needs the browser on **every** unprepared or `WITH_PLAYWRIGHT=0` host — which is every host review-loop's own on-demand install leaves behind — so it cannot simply reuse that call unmodified.
Fusing the browser into that same call would risk exceeding the Bash tool's 600 s call cap: npm install (up to 300 s), a chromium download (up to 300 s, possibly twice for the `--with-deps` retry), and a smoke test (60 s) sum to a worst case north of 900 s.

Splitting into two stages keeps each within budget: stage (a) is the existing fast base install (`WITH_PLAYWRIGHT=0`, seconds), and stage (b) is a dedicated, separately-bounded top-up that installs only the browser.
Both stages call the same script (`agent0-setup.sh`, then `agent0-playwright.sh`), so there is still exactly one install procedure — never a second implementation that can drift from the first.

## Why the top-up script lives at `$HOST`, not `$AGENT_SKILLS_ROOT`

`agents/pr-reviewer/scripts/agent0-setup.sh` copies `agents/.` and every skill under `skills/*` into `$AGENT_SKILLS_ROOT` (`/tmp/workspace/pr-reviewer`) — it does not copy the repo-root `scripts/` directory.
So `$AGENT_SKILLS_ROOT/scripts/agent0-playwright.sh` never exists on a prepared sandbox.
`scripts/agent0-setup.sh` copies the script into `$HOST` (`/tmp/workspace/agent-skills`) instead, right after it creates that directory, and the on-demand block's fallback — curling the script from `main` when the copy is missing (an install from an older commit) — uses the same source as stage (a).

## Why a time budget inside the script, not only an outer `timeout`

An outer `timeout` that kills the process mid-install leaves the four `UI_VERIFY_*`/`PLAYWRIGHT_BROWSERS_PATH` export lines unwritten and can orphan an `npm install`.
`agent0-playwright.sh`'s own `BUDGET` (default 900 s, the on-demand block passes 280) is enforced per step — each step's own `timeout` is `min(step cap, BUDGET − SECONDS)` — so the script always reaches the env-file write, recording either a working browser or a named reason, never nothing.
The outer `timeout 300` in the on-demand block stays as a hard backstop against a hang the internal budget itself cannot cover (a wedged `curl`, a signal the script cannot trap).

## Why the Chrome-for-Testing fallback, and why headless-shell first

A LoreKit lesson (`global::aw-lessons::agent0-sandbox-headless-chrome-in-trusted-hosts-mode`) recorded that some Agent0 network modes allow `storage.googleapis.com` but block the Playwright CDN Playwright's own installer uses.
`agent0-playwright.sh` reads the `chromium-headless-shell` revision and `browserVersion` Playwright itself pinned in `node_modules/playwright-core/browsers.json`, then downloads the matching build directly from `chrome-for-testing-public` — the same binary the CDN would have served, from a host reachable when the CDN is not.
It also best-effort downloads the full `chrome-linux64.zip` at the same revision into the `chromium-<rev>` directory (`chromium-headless-shell` and `chromium` are both Chrome for Testing at the same version): marking both `INSTALLATION_COMPLETE` makes a later, idempotent `playwright install chromium` a no-op instead of a failing CDN download, since Playwright's own idempotency check is "does the marked directory already exist."

Missing system libraries (the `apt-get download` + `LD_LIBRARY_PATH` recipe for a Ubuntu-jammy sandbox with no root) are out of scope for this fallback: the recipe is fragile and distro-specific.
The smoke test's failure reason names the possibility; fixing it is a follow-up, not this change.

## Why the consent is the invocation itself

`run`/`verify` reaching the Agent0 section of `ui-verify` — including `review-loop` Step 1.6's `ui-verify run --unattended` — **is** the consent for the on-demand install, the same shape as `review-loop`'s existing browser-skip consent (`agents/shared/rules/agent0-host.md § No user to ask`).
There is no user present to ask, and an automation that invokes `ui-verify run`/`verify` has already decided it wants a verdict, which needs a browser.
The sentinel (`/tmp/workspace/.agent-skills-install/playwright.attempted`) exists so that decision costs at most one multi-minute attempt per sandbox: a repeat run inside the same sandbox reads the recorded reason instead of re-attempting a download that already failed.
Because Step 1.6 is report-only, a slow or failed top-up never affects `review-loop`'s convergence — it only changes whether that one report line reads `not run` or a real verdict.
