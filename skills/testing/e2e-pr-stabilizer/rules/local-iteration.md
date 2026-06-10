---
title: Phases 2 + 6 — Local reproduction and the 3-consecutive-pass gate
impact: HIGH
tags:
  - local-iteration
  - playwright-trace
  - opentelemetry
  - verification-gate
  - selector-evidence
---

# Phases 2 + 6 — Local reproduction and the 3-consecutive-pass gate

The local runner is the primary evidence source.
Phase 2 runs the queued tests locally to capture trace artifacts that match what CI would produce.
Phase 6 re-runs each fixed test until it passes three consecutive times before we are willing to commit a CI cycle to it.

Both phases share the same execution machinery, so they live in one rule file.

---

## Resolve the local test command

Before either phase, find the command this repo uses to invoke Playwright.
Probe in order; stop at the first match.

```bash
# 1. Prefer a documented script.
jq -r '.scripts | to_entries[] | select(.key | test("^test:e2e($|:)")) | "\(.key)\t\(.value)"' \
  tests/e2e/package.json 2>/dev/null || \
jq -r '.scripts | to_entries[] | select(.key | test("^test:e2e($|:)")) | "\(.key)\t\(.value)"' \
  package.json 2>/dev/null

# 2. Look for a Playwright config — confirms the project root.
fd -t f 'playwright\.config\.(ts|js|mjs)' tests/e2e/ 2>/dev/null || \
fd -t f 'playwright\.config\.(ts|js|mjs)' .

# 3. Fall back to a direct invocation rooted at the Playwright config dir.
#    Detect the package manager from the target repository's lockfile
#    (pnpm-lock.yaml → pnpm, yarn.lock → yarn, package-lock.json → npm, bun.lockb → bun)
#    and the E2E package name from that package's package.json.
#    The target repository's CLAUDE.md often documents the canonical command — check it first.
#    Example shape (pnpm workspace with an E2E package):
<package-manager> --filter <e2e-package> exec playwright test --help >/dev/null
```

Record the resolved invocation as `PLAYWRIGHT_CMD` and use it verbatim in both phases.
An example resolution (placeholders filled in for a pnpm workspace whose E2E package is `@acme/ui-e2e`):

```bash
PLAYWRIGHT_CMD='pnpm --filter @acme/ui-e2e exec playwright test'
```

If no resolution succeeds, print the candidates and stop — do not guess.

## Resolve the live app target

Playwright needs the app running.
Inspect `playwright.config.ts`'s `webServer.url` — that is the canonical baseURL.

```bash
# Validate that Playwright can load the config (handles TypeScript configs,
# which `node -e "require(...)"` cannot).
npx playwright test --list --config <path-to-playwright-config> >/dev/null 2>&1 \
  && echo "config-ok" || echo "config-error"

# Extract the baseURL / webServer.url from the config source.
grep -nE "baseURL|webServer" <path-to-playwright-config>
```

If `webServer.command` is set, Playwright will start the app itself — no external action needed.
If not, the user must already have the app running on the baseURL.
Probe with `curl -sf "$BASE_URL" -o /dev/null` once; if it fails, print: `App not running on <BASE_URL>. Start it with <suggested command> and re-run.` and stop.

---

## Phase 2 — Local reproduction + trace capture

Run each queued test from the Phase 1 fix queue locally with traces on.

### Per-test invocation

```bash
# One test, one trace.
$PLAYWRIGHT_CMD \
  --grep "<exact test.name>" \
  --trace on \
  --reporter list \
  --workers 1 \
  --retries 0
```

Notes:

- `--trace on` always records, even on pass — Phase 3 needs the trace whether or not the local run reproduces the failure.
- `--workers 1` removes worker-parallelism noise (helpful when correlating spans).
- `--retries 0` makes flake visible immediately rather than masking it.
- Pass `--grep` with the exact `test.name` from the span; escape regex metacharacters.
- If the test file is small and the title is unique within it, `<file>:<line>` is also acceptable.

### Where the trace lands

Playwright writes to `test-results/<test-hash>/trace.zip` relative to the Playwright project root.
Snapshot the path immediately — subsequent runs overwrite it.

```bash
# Capture the trace under a known location.
RUN_ID=$(date +%s)
mkdir -p ".artifacts/<PR_NUMBER>/local/$RUN_ID"
cp -R tests/e2e/test-results/* ".artifacts/<PR_NUMBER>/local/$RUN_ID/"
```

Feed the resulting directory to [`/playwright-trace-analyzer`](../../../analysis/playwright-trace-analyzer/SKILL.md) — the trace schema is identical to what CI produces.

### Local Dash0 spans (when configured)

If the repo's Playwright reporter is wired to the OTel exporter (typical for `ui-e2e`), local runs still emit spans to Dash0 with `ci.is_ci=false`.
Query them with the canonical filter set from [`references/dash0-mcp-filters.md`](../references/dash0-mcp-filters.md) but replace the `ci.is_ci` clause:

```jsonc
{ "key": "ci.is_ci", "operator": "is_one_of", "values": ["false"] }
```

And add a `vcs.ref.head.revision` filter for the local commit SHA (so you don't see other developers' local runs):

```jsonc
{ "key": "vcs.ref.head.revision", "operator": "is_one_of", "values": ["<local_head_sha>"] }
```

If the OTel exporter is **not** configured locally, that is fine — the trace.zip is sufficient evidence and the Phase 1 baseline spans cover the historical layer.
Note the missing local-span layer in the dossier as `local-spans: not-emitted` and proceed.

### Reproducibility budget

Some flakes do not reproduce in the first local attempt.
If the first run passes, repeat **up to 3 times** to try to surface the failure.
If still passing, the local run is not yet reproducing — record the trace as `local-pass-only` evidence and rely on the CI-layer evidence already in Dash0.
Do **not** declare the bug fixed just because it passed locally — that's Phase 6's job, against an *applied fix*.

### Gate

Phase 2 is complete when every test in the fix queue has either:

- A local `trace.zip` that reproduces the same failure shape as the Dash0 baseline (preferred), or
- A `local-pass-only` note plus the CI-side trace from a recent run (fallback).

---

## Phase 6 — Local verification: 3 consecutive passes

Phase 6 runs only in `stabilize` mode and only on tests whose fix passed Phase 5's selector-validity gate ([`fix-validation.md`](./fix-validation.md)).

A fix is only credible when the test passes **three times in a row** locally with traces on.
Any failure or flake within the streak resets the counter to zero.

### Invocation per attempt

Same command as Phase 2:

```bash
$PLAYWRIGHT_CMD \
  --grep "<exact test.name>" \
  --trace on \
  --reporter list \
  --workers 1 \
  --retries 0
```

**Low-flake-rate hardening:** when the Phase 1 measured `failure_rate` is below `0.33`, add `--repeat-each=3` to every Phase 6 invocation.
Each attempt then executes the test 3 times in one invocation, and the attempt counts as `passed` only if **every** repeat passes.
This stays within the existing 10-attempt budget — repeats do not consume extra attempts.
The "Why three" section below explains why the extra executions are needed at low flake rates.

### Loop logic

```text
streak       = 0
attempts     = 0
trace_paths  = []

while streak < 3 and attempts < 10:
  attempts += 1
  result, trace_path = run_playwright()
  trace_paths.append(trace_path)
  if result == "passed":
    streak += 1
  else:
    streak = 0
    record_failure_trace(trace_path, attempts)
    if attempts < 10:
      analyse(trace_path)            # update the dossier with the new evidence
      consider_re_entering_phase_5() # if the failure shape disagrees with the fix
```

### Why three, and why "consecutive"

- **Why three — the honest math:** an *unfixed* flaky test with per-run failure probability `p` still passes `n` consecutive runs with probability `(1 − p)ⁿ`.
  At `p = 0.33` (a 1-in-3 flake), three consecutive passes happen by luck with probability `(0.67)³ ≈ 30 %` — the gate catches the unfixed flake about 70 % of the time, which is acceptable for a local pre-filter.
  At `p = 0.10` — exactly the `stabilize` entry threshold in [`telemetry-driven-analysis.md`](./telemetry-driven-analysis.md) — the false-pass probability is `(0.90)³ ≈ 73 %`, so three bare runs would catch the unfixed flake only ~27 % of the time.
  That is why the low-flake-rate hardening above applies `--repeat-each=3`: three passing attempts then mean ~9 executions, with false-pass probability `(0.90)⁹ ≈ 39 %` at `p = 0.10` — better, but still not proof.
- **The streak is necessary, not sufficient:** a clean local streak is required evidence before spending a CI cycle, but it never *confirms* the fix on its own.
  Real confirmation is Phase 7's CI ratification plus the telemetry comparison against the Phase 1 baseline, and [`guard-rails.md`](./guard-rails.md) already forbids closing the loop on a single passing CI run when the baseline failure rate was below 100 %.
- **Why consecutive:** a fix that passes 3 / 5 is not stable; it is "improved" at best. The skill must distinguish "the flake is gone" from "the flake is rarer". Consecutive passes test the former.

### When the streak breaks

A failure mid-streak is not a setback — it is new evidence.
Capture the trace and decide:

| Failure shape vs. Phase 4 dossier | Action |
|------------------------------------|--------|
| Same root cause, same locator, same hotspot | The fix did not address the cause. Re-enter Phase 4 with the new trace; the previous hypothesis was wrong. |
| Different locator or different action timing out | The fix addressed the original cause but exposed a second flake. Add the new dossier, treat as a fresh fix candidate. |
| Environment failure (server crashed, port in use) | Not a test failure. Reset attempts; do not count against the budget. |

Never paper over a failure mid-streak.
A skipped failure makes the gate meaningless.

### Attempt budget

10 attempts per fix.
Beyond that, the fix is not stable locally and pushing it to CI is wishful thinking.
Emit the report with the test marked `requires-human-judgment` and the streak log included verbatim.

### Per-attempt trace retention

Keep every attempt's trace under `.artifacts/<PR_NUMBER>/local/<run_id>/<attempt>/trace.zip`.
The report cites the failing attempts; the passing-streak attempts confirm the gate cleared.
Disk cost is bounded (10 traces × ~5 MB each = ~50 MB per test).

### Multiple fixes in the queue

Run Phase 6 per fix, sequentially.
Do not interleave — a fix for test A can perturb test B's setup if they share fixtures, and you want each gate to attribute cleanly.

Order:

1. Apply fix for test A (Phase 5).
2. Run Phase 6 for test A until 3 consecutive passes (or budget exhausted).
3. Commit the fix for test A locally.
4. Apply fix for test B (Phase 5).
5. Run Phase 6 for test B until 3 consecutive passes — but on top of the test-A fix already in the working tree.
6. Commit the fix for test B locally.
7. Continue.

This way, every gate runs against the cumulative state that CI will see in Phase 7.

### Gate

Phase 6 is complete when every fix from Phase 5 has either:

- Three consecutive local passes recorded (commit goes onto the branch locally — **not yet pushed**), or
- 10 attempts exhausted and a `requires-human-judgment` entry queued for the report.

Move to [`verification-loop.md`](./verification-loop.md) for Phase 7 (single push + single CI watch).

---

## What this phase does **not** do

- It does not push.
   Pushing is Phase 7's single, deliberate action.
- It does not re-pull historical Dash0 spans.
   The historical baseline was captured in Phase 1; local runs only add the local-span layer when available.
- It does not run the full suite.
   It runs only the test(s) being fixed.
   Full-suite verification belongs to CI in Phase 7.
- It does not weaken the test.
   The guard-rails in [`guard-rails.md`](./guard-rails.md) still apply — `.skip`, `waitForTimeout`, and friends are forbidden even between local attempts.
