# Playwright Trace Analysis — {{ test-name }}

## Summary

- **Source:** {{ trace.zip path or GitHub run URL }}
- **Test:** {{ file:line — test name }}
- **Failure mode:** {{ action-timeout | assertion-timeout | nav-timeout | selector-fail | app-error | network-failure | slow-but-passing | worker-init }}
- **Primary metric:** {{ action duration ms | TTFB ms | wall-clock ms | request count }}
- **Baseline:** {{ measured value, e.g. 30,007ms timeout, or 800ms in passing run }}
- **Target:** {{ goal value, e.g. < 2,000ms or "no flake in 50 runs" }}
- **Confidence (post-iteration):** {{ score }}%

## The race (root cause)

State the race in one sentence:

> **{{ Action X at file:line races against producer Y at app-file:line; if Y > Z ms, the action hits a non-actionable element. }}**

### Evidence chain

1. {{ trace observation 1 — timestamp + verbatim quote }}
2. {{ trace observation 2 — timestamp + verbatim quote }}
3. {{ network or console correlation }}
4. {{ source mapping — file:line in app or test }}

## Top hotspots

### Slow / failing actions

| # | Method                 | Duration  | File:line                           | Status                |
| - | ---------------------- | --------- | ----------------------------------- | --------------------- |
| 1 | {{ Frame.click }}      | {{ ms }}  | {{ tests/foo.spec.ts:42 }}          | {{ TIMEOUT/PASS }}    |
| 2 | {{ ... }}              | {{ ms }}  | {{ ... }}                           | {{ ... }}             |
| 3 | {{ ... }}              | {{ ms }}  | {{ ... }}                           | {{ ... }}             |

### Slow / failed requests

| # | Method | URL                                  | TTFB    | Total   | Status                          |
| - | ------ | ------------------------------------ | ------- | ------- | ------------------------------- |
| 1 | {{ POST }} | {{ /api/save }}                  | {{ ms }} | {{ ms }} | {{ 200 / failed: net::ERR_... }} |
| 2 | {{ ... }} | {{ ... }}                        | {{ ... }} | {{ ... }} | {{ ... }}                       |

### Page errors / console

| # | Kind             | Message (verbatim)                                  | Source frame                  |
| - | ---------------- | --------------------------------------------------- | ----------------------------- |
| 1 | {{ pageerror }}  | {{ TypeError: Cannot read property 'id' of ... }}    | {{ webpack:///./src/...:88 }} |

## Ranked fixes

| # | Fix                                            | Estimated saving | Confidence | Effort | Risk         |
| - | ---------------------------------------------- | ---------------- | ---------- | ------ | ------------ |
| 1 | {{ Wait for `toBeEnabled` before click }}      | {{ ~30s }}       | {{ H }}    | {{ XS }} | {{ low }}    |
| 2 | {{ Disable animations in test config }}        | {{ ~1s/test }}   | {{ H }}    | {{ S }}  | {{ low }}    |
| 3 | {{ ... }}                                       | {{ ... }}        | {{ ... }}  | {{ ... }} | {{ ... }}    |

### Fix 1 — {{ title }}

**File:** {{ tests/foo.spec.ts:42 — or app file path:line }}

**Change:**

```ts
// before
await page.locator('text=Save').click();

// after
const saveBtn = page.getByRole('button', { name: 'Save' });
await expect(saveBtn).toBeEnabled();
await saveBtn.click();
```

**Why this closes the race:** {{ one paragraph — what producer this
new condition observes, and why the previous wait was insufficient. }}

**Verification:**

```bash
npx playwright test tests/foo.spec.ts --repeat-each=20 --workers=1 --trace=on
```

Run 20 times; confirm 20/20 pass. If any fail, re-run
[`scripts/trace-diff.mjs`](../scripts/trace-diff.mjs) on a passing
trace vs. the new failing trace and return to Phase 3.

### Fix 2 — {{ title }}

…

### Fix 3 — {{ title }}

…

## Things to leave alone

- {{ low-impact item with reason — names a non-action explicitly }}
- {{ ... }}

## Open questions / what would raise confidence

- {{ specific question for the user, OR a request for an additional
     trace, OR a pointer to source code we couldn't see }}
- {{ ... }}

## Verification plan

1. Apply fix 1.
2. Re-run the test with `--repeat-each=20` (or trigger CI shard).
3. Compare: failure rate must drop from {{ baseline rate }} to 0/N.
4. If improvement < expected, return to Phase 3 and re-analyse — the
   model of the race was wrong.
5. Once green, remove any `test.retry` workarounds left from before
   this fix.
