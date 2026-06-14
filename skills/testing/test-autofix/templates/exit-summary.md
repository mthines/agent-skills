# test-autofix exit summary template

Always end a run with this block, regardless of outcome.
Fill every field; omit optional fields only when clearly not applicable.

```text
test-autofix run
  Outcome: <green | escalated | regression-reverted | max-iterations>
  Resolved: <N> failures
  Escalated: <N> failures (<comma-separated verdicts, e.g.: prod-bug, unsure>)
  Iterations: <N>/<max>
  Surface: <path to surface file>
  Plan: .agent/{branch}/test-autofix-plan.md
  Successful run: <detect-command output summary>      # if outcome is green
  Escalation reason: <one sentence per escalated failure>  # if outcome is not green
```

## Field guide

| Field | Required | Notes |
| --- | --- | --- |
| `Outcome` | Always | One of: `green`, `escalated`, `regression-reverted`, `max-iterations` |
| `Resolved` | Always | Count of failures that went from failing to passing |
| `Escalated` | Always | Count and verdicts of failures handed back to the user; `0` if none |
| `Iterations` | Always | `N/max` where max is `--max-iterations` value (default 5) |
| `Surface` | Always | Full path to the surface file used |
| `Plan` | Always | Path to the plan artifact written during Phase 1 |
| `Successful run` | Green only | Brief summary confirming all tests passed |
| `Escalation reason` | Non-green | One sentence per escalated failure explaining what blocked resolution |

## Outcome definitions

- **`green`** — all tests in the detect-command output are passing.
- **`escalated`** — one or more failures were `prod-bug` or `unsure` and were handed to the user.
- **`regression-reverted`** — a fix introduced a new failure; the fix was reverted; the user owns the next step.
- **`max-iterations`** — the `--max-iterations` cap was reached before all failures were resolved.

On success, also include: which failures were fixed (one line each), confirmation that the
full surface re-run passed, and any notable observations (e.g., a snapshot was updated).

On escalation, also include: what was tried per iteration (one line per attempt) and
concrete suggested next steps for the user to investigate manually.
