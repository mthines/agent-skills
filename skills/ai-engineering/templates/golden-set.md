<!--
Literal YAML scaffold for an eval golden set.
For methodology (sizing, error analysis, regression gating), see
../rules/evals.md.

Convention: one file per feature, named `<feature>.golden.yaml`,
committed in-repo, PR-reviewed, semver-tagged.
-->

```yaml
# <feature>.golden.yaml
# Versioned regression suite for <feature>.
# Run on every prompt change. CI gates on regression > 0pp.

version: '1.0.0'
feature: <feature-name>
prompt_under_test: prompts/<feature>.v3.md
model_under_test: claude-sonnet-4-7@2026-04-15  # Pin snapshots, see model-migration.md.

# Aim for 50–500 items. Below 50 is statistically noisy.
# Cluster by failure mode discovered in error analysis.
items:
  - id: <feature>-001
    input: |
      <verbatim user input>
    expected:
      <field_1>: <value>
      <field_2>: <value>
    failure_mode: <tag from error-analysis clusters, e.g. "missing_receipt">
    notes: |
      Was failing pre-<date> — model would mis-classify intent as <X>.
      Fixed by adding the rule in prompts/<feature>.v3.md L42.

  - id: <feature>-002
    input: |
      <verbatim>
    expected:
      <field_1>: <value>
    failure_mode: <tag>
    notes: |
      Edge case from production trace #<trace_id> on <date>.

# Optional: counter-examples (inputs that should be REFUSED or ABSTAINED on).
refusals:
  - id: <feature>-refuse-001
    input: |
      <out-of-scope or adversarial input>
    expected:
      action: refuse
      reason_contains: <substring>

# Eval rubrics applied to each item (per ../templates/eval-rubric.md).
# One pass per dimension; do not collapse into one 1–10 score.
rubrics:
  - faithfulness
  - completeness
  - format
  - safety

# CI gating policy.
gates:
  pass_rate_min: 0.95           # Strict pass-rate floor.
  regression_threshold_pp: 0    # 0pp regression blocks the merge.
  latency_p95_max_ms: 4000
  cost_per_call_max_usd: 0.05
```

## Item-writing rules

1. **One failure mode per item.**
   Items that test multiple things at once make regressions ambiguous
   to triage.
2. **Verbatim production inputs, not invented ones.**
   Pull from real traces (see `../rules/observability-and-versioning.md`).
3. **Expected outputs come from a hand-labelled reference**, not from
   the current model's output.
   Otherwise you regression-test against drift, not against truth.
4. **Tag with `failure_mode`** to cluster regressions during triage.
5. **Note the provenance** — which trace, which date, which fix.
   Future readers (including future-you) need the why.

## Sizing

| Phase                      | Items     |
| -------------------------- | --------- |
| First pass after launch    | 20–50     |
| Steady-state production    | 50–200    |
| Mature, multi-feature       | 200–500   |
| Comprehensive (rare)       | > 500     |

If you're past 500 items per feature, split by sub-feature.
A 1000-item single set is hard to maintain and slow to run.

## Running the set

```bash
# Use the Batch API for cost (50% off; see token-optimization.md).
# Cache the prompt prefix; only the variable input changes per item.

run-golden-set \
  --file <feature>.golden.yaml \
  --batch \
  --cache-prefix \
  --output runs/$(date +%Y-%m-%d)/<feature>.json
```

## CI gating

```yaml
# .github/workflows/golden-set.yml
on:
  pull_request:
    paths:
      - 'prompts/<feature>.**'
      - 'evals/<feature>.golden.yaml'

jobs:
  golden-set:
    runs-on: ubuntu-latest
    steps:
      - run: run-golden-set --file evals/<feature>.golden.yaml --gate
```

The runner exits non-zero if any gate in the YAML is breached.
Reviewers see the regression diff inline in PR review.
