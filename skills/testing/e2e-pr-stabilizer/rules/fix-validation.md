---
title: Phase 5 — Selector-existence check
impact: HIGH
tags:
  - fix-validation
  - selector-existence
  - anti-hallucination
---

# Phase 5 — Selector-existence check

The single most common way an automated E2E fix makes things **worse** is by inventing a selector that does not exist.
The trace shows `getByRole('button', { name: 'Save' })` timed out; the skill confidently rewrites the test to use `getByTestId('save-button')`; the production component never emits `data-testid="save-button"`; now the test fails harder than before.

This check exists to refuse that class of error before a commit ever lands.

The check runs **after the diff is drafted** (per Phase 5 in [`root-cause-and-fix.md`](./root-cause-and-fix.md)) and **before the commit**.
A fix whose new locators do not resolve is not "tried again with a worse selector" — it is discarded and the dossier re-enters Phase 4 with the failed-validation evidence attached.

The check is **deterministic and empirical**: it greps source code and runs `locator.count()` against the live app.
It does not score the diff or predict whether the fix will work — Phase 6's 3-consecutive-pass gate does that, by actually running the test.

---

## When this check runs

| Trigger | Action |
|---------|--------|
| Phase 5 has produced a draft diff for a single test | Run the full check (Steps 1–3 below). |
| Phase 6 broke a streak with a "selector did not resolve" failure | Re-run only against the locators that timed out. |
| Multiple fixes in the working tree | Run the check per fix, in the same order Phase 6 will run them. |

This check is local-only.
It never modifies the diff under review; it accepts or rejects it whole.

---

## Step 1 — Static selector existence check

For every new locator the diff introduces, verify the selector resolves against the repo source code.

### Extract the new locators

Diff the old and new versions of each touched file, collecting every locator call:

```bash
git diff --unified=0 -- 'tests/e2e/**/*.spec.ts' 'tests/e2e/**/*.ts' \
  | grep -E '^\+' \
  | grep -oE 'getBy(Role|TestId|Text|Label|Placeholder|AltText|Title)\([^)]*\)|page\.locator\([^)]*\)|\[data-testid=[^]]+\]'
```

For each result, identify the *discriminator* — the string that uniquely names the element:

| Locator shape | Discriminator |
|---------------|---------------|
| `getByTestId('save-button')` | `save-button` (testid) |
| `getByRole('button', { name: 'Save changes' })` | `'Save changes'` (accessible name) + `button` (role) |
| `getByText('Welcome back')` | `Welcome back` (visible text) |
| `getByLabel('Email')` | `Email` (label text) |
| `page.locator('[data-testid="save-button"]')` | `save-button` (testid) |
| `page.locator('.save-btn')` | CSS class — **demote**, see below |

### Verify against source

For each discriminator, grep the product source for evidence the element actually exists:

```bash
# Testid discriminator — look for data-testid attribute in JSX / TSX / HTML.
rg -n --type-add 'jsx:*.{tsx,jsx}' \
  -tjsx -ttsx -thtml \
  "(data-testid|data-test-id)=[\"']<discriminator>[\"']" \
  src/ components/ apps/

# Accessible-name discriminator — match strings inside JSX text nodes or aria-label.
rg -n -ttsx -thtml -e "<discriminator>" -e "aria-label=[\"']<discriminator>[\"']" \
  src/ components/ apps/

# Localised text — also check i18n catalogues.
rg -n -tjson "<discriminator>" locales/ public/locales/ messages/ 2>/dev/null
```

Outcomes:

| grep result | Verdict |
|-------------|---------|
| One or more matches in a file the test actually navigates to | **Verified.** Continue to Step 2 to confirm rendering (or skip Step 2 if the match is unambiguous). |
| Matches only in another product surface (different page, different feature) | **Ambiguous.** Run Step 2 against the live app to confirm the actual page renders it. |
| Zero matches in product code | **Hallucinated.** Refuse the diff. Go to Step 3. |
| Match is in a comment, string literal, or storybook file but never reaches the rendered DOM | **Hallucinated** (the test will not see it). Refuse the diff. Go to Step 3. |

### Special cases

- **CSS-class locators (`.save-btn`)**: the static grep will find the class, but Playwright resolution depends on visibility and DOM placement. Always require a Step 2 live check for CSS locators.
- **i18n strings**: if the discriminator is a UI string and the app uses i18n, the JSX shows `{t('save.button')}` rather than the literal. Grep the i18n catalogue for the discriminator string; if found, treat the JSX `t('save.button')` call as the match.
- **Generated DOM (codegen, mdx)**: if the discriminator only appears in a generator, run Step 2 — the generated output is what Playwright sees, not the input.

---

## Step 2 — Live selector existence check

For locators that the static check flagged as **ambiguous**, or for CSS-class locators, verify against the running app.

### Setup

The app must already be running on the baseURL Playwright targets (see [`local-iteration.md`](./local-iteration.md) for resolution).
If `playwright.config.ts` defines `webServer.command`, Playwright will start it on demand.

### One-shot probe via Playwright eval

Create a temporary probe script (keep it on disk only for the duration of the check):

```typescript
// tests/e2e/.tmp/selector-probe.spec.ts — created and deleted by the skill
import { test, expect } from '@playwright/test';

test('selector probe', async ({ page }) => {
  await page.goto('<URL the test navigates to before the failing action>');
  // Replicate any necessary setup from the original test (login, fixture
  // load) — copy verbatim from the spec being verified.

  // Landmark check — a locator the original test resolves successfully
  // *before* the failing action (take it from the trace). This is the
  // probe's own sanity check: it proves the setup reached the right state.
  console.log('PROBE_URL', page.url());
  console.log('LANDMARK_COUNT', await page.locator('<known-good landmark locator>').count());

  const count = await page.locator('<the new locator under review>').count();
  console.log('LOCATOR_COUNT', count);
});
```

Run it:

```bash
$PLAYWRIGHT_CMD --grep 'selector probe' --workers 1 --retries 0
```

Then delete the probe file (Phase 5 must leave no `.tmp/` artefacts behind).

### Interpretation

| `LOCATOR_COUNT` | Verdict |
|-----------------|---------|
| ≥ 1 | **Verified live.** The selector resolves. Continue. |
| 0 and the landmark check passed | **Hallucinated** at runtime. Refuse the diff. Go to Step 3. |
| 0 and the landmark check failed | **Probe-setup error** — see "Disambiguating a zero count" below. Fix the probe, not the selector. |
| ≥ 2 and the diff uses `.first()` to dedupe | **Refuse** — `.first()` is forbidden as a disambiguation strategy ([`guard-rails.md`](./guard-rails.md)). Rewrite the locator and re-run Step 1. |
| ≥ 2 and the diff uses `.and(...)` or accessible-name disambiguation | **Verified** — multiple matches are acceptable when the diff narrows on a property the matches do not share. |

### Disambiguating a zero count

The probe copies the original test's setup, so a probe with **wrong setup** (broken login, missing fixture, redirect to an error page) also yields `LOCATOR_COUNT 0` — indistinguishable from a hallucinated selector unless you check the page state first.

When `LOCATOR_COUNT` is `0`, decide in this order:

1. **Check `PROBE_URL`** — it must match the route the failing action runs on. A redirect to `/login`, `/404`, or an error page is a probe-setup error.
2. **Check `LANDMARK_COUNT`** — the landmark is a locator the original test resolves successfully before the failing action, so it must be ≥ 1 on a correctly-set-up page.
3. **Both checks pass and `LOCATOR_COUNT` is still 0** → the new locator is genuinely **hallucinated**. Refuse the diff and go to Step 3.
4. **Either check fails** → classify as a **probe-setup error**. Fix the probe (auth, fixture load, navigation), not the selector, and re-run Step 2. A probe-setup error never counts as a selector-existence refusal in Step 3's two-refusal accounting.

### Live-check fallback when probe is impossible

Some fixes target a state the test reaches only after several interactions (login + navigate + open a modal).
If a probe is too expensive to replicate, run the actual fixed test once (it is already part of Phase 6) and inspect the trace:

```bash
# After one local run, the trace shows whether the new locator resolved.
node <skill_dir>/scripts/trace-summary.mjs \
  .artifacts/<PR_NUMBER>/local/<run_id>/<attempt>/trace.zip \
  | jq '.actions[] | select(.kind == "locator")'
```

Look for the new locator in the action timeline.
If it appears with `count > 0` and dur < 1000 ms, it resolves cleanly.
If it shows the locator timing out, treat as hallucinated and go to Step 3.

In this path, Step 2 and Phase 6 share a run — the probe is the first Phase 6 attempt.
That is acceptable; Phase 6 just rolls one attempt forward.

---

## Step 3 — Refuse the diff

A diff that fails Step 1 (zero static matches and Step 2 not run) or Step 2 (zero live matches) is refused.

Refusal procedure:

1. **Do not commit** the diff. Run `git restore --staged` and `git restore` on the touched files to undo it cleanly. If the files were already modified pre-skill (worktree dirty), use `git stash` / `git stash pop` around the discard instead.
2. **Record the failure** in the dossier:
   ```text
   selector-check: refused
     reason: <static-zero-matches | live-zero-matches | first-dedupe-forbidden>
     refused locator: <the new locator>
     evidence: <grep output | LOCATOR_COUNT>
   ```
3. **Re-enter Phase 4** with the new evidence attached.
   The previous hypothesis pointed at a locator the app never renders; the dossier needs either a different fix pattern or a different selector strategy.
4. If two consecutive Phase 4 → Phase 5 cycles end in refusal for the same test, mark the test `requires-human-judgment` and stop iterating on it.
   Continue with the next test in the queue.

A refusal is not a failure of the skill — it is the skill working as designed.
It prevents the worst class of "automated test heal" outcome.

---

## Recording the check outcome

For every fix that reaches a commit, record the check's evidence in the commit message body (extends the format in [`root-cause-and-fix.md`](./root-cause-and-fix.md)):

```text
fix(e2e): <test.name>

Pattern: P<N> — <name>
Span signature: failure_rate=<X>%, attempts=<N>, error=<class>
Trace hotspot:  <action> dur=<ms> @ <file>:<line>
Selector check: static=<verified|n/a> live=<verified|n/a>

<one-sentence reason>.
```

---

## What this check is **not**

- It is not a substitute for Phase 6. The 3-consecutive-pass gate still runs, because static + live selector existence does not prove the *timing* of the fix is right.
- It is not a confidence score. It is a deterministic existence check — the selector either resolves or it does not. Predictive judgement about whether the fix will work is delegated to Phase 6 (which runs the test) rather than scored on paper.
- It is not a code review. It does not opine on style, naming, or maintainability.
- It is not a product-code reviewer. If the trace evidence points at product code, [`root-cause-and-fix.md`](./root-cause-and-fix.md) Rule 4 already routes that to a recommendation rather than an autonomous edit — this check never even sees that diff.
