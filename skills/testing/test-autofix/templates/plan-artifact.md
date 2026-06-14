# test-autofix run — <branch> — iteration <N>

## Surface

- Surface file: `surfaces/<project-key>.md`
- Stack: <vitest | jest | deno | playwright | pytest | maestro | storybook>
- Detect command: <detect-command from surface>

## Failure inventory

| # | File | Test name | Verdict | Confidence | Status |
| - | ---- | --------- | ------- | ---------- | ------ |
| 1 | `<file>` | `<test name>` | `<test-bug \| prod-bug \| unsure>` | <score> | <pending \| fixed \| escalated \| reverted> |

## Proposed fix — failure #<N>

- Verdict: `<test-bug | prod-bug | unsure>`
- Root cause (one sentence): <…>
- Files touched: <list>

<diff sketch or one-paragraph description>

## Confidence — failure #<N>

- Score: <0–100>
- Risk tag: <test-only | prod-touch>
- Action: <auto-apply | ask-once | escalate>
- Escalation reason: <one sentence — fill in only when Action is `escalate`>

## Iteration <N> — <result>

- Outcome: <green | same-failure | subset | regression-reverted>
- Notes: <…>

## Iteration <N> — reverted

- Fix that was reverted: <one-line summary>
- Baseline SHA after revert: <git SHA>
- Notes: <why the fix introduced a regression>

## Exit

- Resolved: <N> failures
- Escalated: <N> failures (<verdicts>)
- Iterations used: <N>/<max>
