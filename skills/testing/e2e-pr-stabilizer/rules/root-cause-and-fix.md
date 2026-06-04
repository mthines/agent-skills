---
title: Phases 3–5 — Root-cause synthesis, fix drafting, selector-existence check
impact: HIGH
tags:
  - root-cause
  - playwright-test-healer
  - fix-patterns
  - selector-existence
---

# Phases 3–5 — Root-cause synthesis, fix drafting, selector-existence check

Every fix carries **three** citations before it is committed:

1. A span-side signature (from Phase 1 — historical evidence).
2. A trace-side hotspot (from Phase 2 — local reproduction).
3. Selector existence verified (from Phase 5 — [`fix-validation.md`](./fix-validation.md)).

No citations, no fix.
The skill validates fixes empirically — selectors must resolve before commit, and the test must pass three consecutive local runs after commit (Phase 6).

## Phase 4 — Root-cause synthesis

For each dossier from Phase 3, produce one root-cause hypothesis.
A hypothesis is a sentence in this exact shape:

```text
<test.name> fails because <cause in code terms>, evidenced by
<span signature> and <trace hotspot>, fixable by <named pattern>.
```

Example:

```text
"organization switching > switches between two orgs" fails because the
locator `getByRole('option', { name: 'Acme' })` is queried before the
option list re-renders post-load, evidenced by 3/12 failure rate over 12
attempts (span signature: TimeoutError @ line 47) and trace hotspot
(click action waited 30,000ms with `before` snapshot showing the listbox
in pre-load state), fixable by an explicit `await
expect(option).toBeVisible({ timeout: 5000 })` wait before the click.
```

The hypothesis must:

- Name a specific cause in code terms (a selector, a wait condition, a state-management call) — not a vague "test is slow".
- Cite both layers (span signature **and** trace hotspot). One layer is not enough.
- Map to a named pattern from the catalogue below (P1–P6) **or** be flagged `novel` and handed back to the user.

A hypothesis that does not meet these requirements is `recommendation-only` — write it to the report and move on. Do not draft a fix.

## Phase 5 — Fix drafting + selector-existence check (stabilize only)

**Skip this phase entirely in `optimize` mode.**
Optimize mode produces recommendations, not edits — jump from Phase 4 directly to the report.
See the "Optimize-mode finding catalogue" section below for what to put *in* those recommendations.

Drive code edits through the [`playwright-test-healer`](../../../agents/playwright-test-healer.md) methodology.
The healer agent's principles are non-negotiable.

Phase 5 has **three sub-steps**:

1. **Draft** the diff per the fix-pattern catalogue below.
2. **Verify selectors** per [`fix-validation.md`](./fix-validation.md) — every new locator must resolve against source (static grep) or the live app (`locator.count() ≥ 1`).
3. **Commit locally only after every new locator is verified.** Do not push — pushing is Phase 7's single deliberate action after Phase 6 ratifies the fix locally.

If a new locator does not resolve in either check, the diff is hallucinated.
Discard it, attach the refusal evidence to the dossier, and re-enter Phase 4 with that evidence — see [`fix-validation.md`](./fix-validation.md) Step 4.
Do not retry blindly with a different selector.

### Fix-pattern catalogue

The most common Playwright flake patterns and their measured fixes.
Pick one per dossier — every entry maps a *trace evidence shape* to a *code change shape*.

#### P1. Race against post-render mutation

**Trace evidence:** `click` or `fill` action with `dur > 5000ms`; `before` snapshot shows stale DOM, `after` snapshot shows the new DOM mid-mutation.

**Fix:** add `await expect(locator).toBeVisible()` (or `toBeEnabled()`) immediately before the action.
Default `timeout` is 5 s; extend only if a span shows median wait > 4 s in healthy runs.

```typescript
// before
await page.getByRole('option', { name: 'Acme' }).click();

// after
const option = page.getByRole('option', { name: 'Acme' });
await expect(option).toBeVisible();
await option.click();
```

#### P2. Strict-mode locator collision

**Trace evidence:** `Error: strict mode violation: locator resolved to N elements`.

**Fix:** narrow the locator using `.first()` is **forbidden** unless the dossier proves the elements are truly interchangeable.
Prefer an `.and(page.locator(...))` chain or an accessible-name disambiguation.

#### P3. Network-blocked action

**Trace evidence:** `click` or `goto` waited > 10 s while a request to `/api/...` was still pending; the request never resolved before the action timeout.

**Fix:** either (a) await the relevant response before triggering the action, or (b) mock / pre-warm the endpoint at the test-setup boundary.
**Do not** add a blanket `page.waitForLoadState('networkidle')` — the [`playwright-test-healer`](../../../agents/playwright-test-healer.md) agent explicitly forbids it.

```typescript
// before
await page.click('text=Save');

// after — await the API the click depends on
const save = page.waitForResponse(r => r.url().includes('/api/save') && r.status() === 200);
await page.getByRole('button', { name: 'Save' }).click();
await save;
```

#### P4. Stateful test contamination

**Trace evidence:** test passes in isolation, fails when run after a sibling; the trace shows the failing action operating on state created by the prior test.

**Fix:** isolate fixtures — move the contaminated state into a `test.beforeEach` reset, or scope it to a `test.describe` with its own fixture.
**Do not** add a `test.skip` or split into a separate file as a workaround.

#### P5. Animation- or transition-gated visibility

**Trace evidence:** locator is `attached` in DOM but `visible: false` for 200–800 ms while a CSS transition runs; the action retries until the transition completes.

**Fix:** assert the post-transition state with `await expect(locator).toBeVisible()` — Playwright's auto-wait already handles this.
If the test bypasses it via `force: true`, remove `force` and let auto-wait do its job.

#### P6. Time-range / data-loading race

**Trace evidence:** the test asserts data that depends on a time-range API call; the call resolves slightly after the assertion.

**Fix:** await the data response or use a `getByTestId` on an element that only appears post-load.
Match the existing repo pattern — `tests/e2e/src/lib/` typically contains a helper for this.

### Patterns NOT in the catalogue

If the dossier evidence does not map to P1–P6, do **not** invent a new pattern silently.
Hand back to the user with:

```text
Pattern: novel
Test:    <test.name>
Evidence: <one-paragraph summary>
Suggested next step: <concrete diagnostic, e.g. "re-run with --trace=on">.
```

### Editing rules

1. **One test, one commit.** Each fix is a separate commit so Phase 6's local 3-pass gate and Phase 7's CI ratification can attribute regression risk per test.
2. **Commit only after every new locator is verified.** See [`fix-validation.md`](./fix-validation.md). A draft with a hallucinated locator is discarded, not committed and "tested in CI".
3. **Edit the test, not the framework.** Helpers in `tests/e2e/src/lib/` are fair game when the dossier shows the bug originates there.
4. **No product-code edits without explicit user OK.** If the trace points to product code, write the proposed change to the report under `Recommendations` and stop — do not silently mutate `src/` or `components/`.
5. **Mirror the repo style.** Read at least one neighbouring spec before editing — locator helpers, `expect.poll`, and assertion patterns vary across teams. Conformance matters more than novelty.
6. **No `.skip` / `.fixme` as a fix.** See [`guard-rails.md`](./guard-rails.md). The healer agent allows `.fixme` only when the test is provably correct *and* the failure is in app code — and even then, the stabilizer surfaces it as a recommendation rather than applying it autonomously.

### Per-test commit message

Commit message records the evidence and the selector check, so reviewers (and the Phase 7 CI verdict) can audit what was changed and why.

```text
fix(e2e): <test.name>

Pattern: P<N> — <name>
Span signature: failure_rate=<X>%, attempts=<N>, error=<class>
Trace hotspot:  <action> dur=<ms> @ <file>:<line>
Selector check: static=<verified|n/a> live=<verified|n/a>

<one-sentence reason>.
```

### Gate

Phase 5 is complete when every dossier has either:

- A locally-committed fix on the branch whose new locators all passed the [`fix-validation.md`](./fix-validation.md) check (static and / or live), **or**
- A `requires-human-judgment` entry in the report (selector-existence check refused twice in a row, or the hypothesis remained `novel` and unmapped to a pattern), **or**
- A `recommendation-only` entry citing product-code evidence.

Move to [`local-iteration.md`](./local-iteration.md) Phase 6 for the local 3-consecutive-pass gate.
Phase 7 (single CI push + watch) lives in [`verification-loop.md`](./verification-loop.md).

---

## Optimize-mode finding catalogue

In `optimize` mode, the same dossier flow runs (Phases 1–4) but Phase 5 is **report-only**.
The catalogue below maps trace-evidence shapes to *recommendations*, not commits.
Each recommendation cites estimated `ms saved` based on measured trace data.

#### O1. Excessive default-timeout wait on an already-actionable element

**Trace evidence:** an action (`click`, `fill`) completed quickly once the locator resolved, but Playwright polled for several seconds before that. The `before` snapshot shows the element actionable; the action started late because nothing was awaiting it.

**Recommendation:** add an explicit `await expect(locator).toBeVisible()` before the action, so the wait happens at the assertion (where it's explicit) rather than hidden in the action's auto-wait.
**Estimated savings:** the measured pre-action wait — typically 100–800 ms per occurrence.

#### O2. `waitForTimeout(N)` already in the test

**Trace evidence:** a `frame.waitForTimeout` action with `dur ≈ N` ms appears in the timeline; the next action starts immediately after.

**Recommendation:** replace with the specific wait condition the timeout was masking (request, locator, response).
**Estimated savings:** `N` minus the measured time the condition would actually need (often `N - 200 ms` or better).

#### O3. Serial waits that could be parallelised

**Trace evidence:** two or more `waitForResponse` / `waitForRequest` calls in sequence whose URLs are independent.

**Recommendation:** wrap them in `Promise.all([...])` so the test awaits the slower of the two, not the sum.
**Estimated savings:** `sum(durs) − max(durs)` per occurrence.

#### O4. Slow `beforeEach` / login flow run per test

**Trace evidence:** the trace shows the same login or seed sequence at the top of every test, each costing > 1 s.

**Recommendation:** promote the work to a Playwright `setup` project or a shared `storageState` fixture so it runs once per worker, not once per test.
**Estimated savings:** `(beforeEach_dur) × (test_count − 1)` per worker.

#### O5. Network-bound action waiting on a slow upstream

**Trace evidence:** an action waited > 2 s on a single request to an API the test does not need to validate (telemetry, analytics, marketing pixel).

**Recommendation:** mock or block the upstream at the `page.route(...)` boundary. Cite the URL and status code.
**Estimated savings:** the measured response time of the blocked request.

#### O6. Locator strategy slower than necessary

**Trace evidence:** a `text=` or CSS selector took > 200 ms to resolve where a `getByRole` / `getByTestId` exists on the element (verified by the DOM snapshot).

**Recommendation:** swap to the role / testid locator. Cite the locator from the snapshot.
**Estimated savings:** the measured resolution delta — small individually, but multiplied across a suite.

### Optimize gate

Phase 4 + the optimize catalogue is complete when every queued test has:

- A dossier mapped to one of the optimize patterns (O1–O6), **or**
- A `requires-human-judgment` entry (no pattern fits the trace evidence).

Then jump straight to Phase 8 — the report.
**Do not** edit, commit, push, or invoke Phases 5–7.
