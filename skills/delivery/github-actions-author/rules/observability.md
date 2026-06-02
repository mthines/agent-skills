---
title: Observability — Names, Annotations, Summaries, Errors
impact: HIGH
tags:
  - observability
  - errors
  - annotations
  - step-summary
  - debugging
---

# Observability

When a workflow fails at 02:00, the on-call engineer reads two things:
the failing step's name, and the line that surfaces in the PR. If
those don't pinpoint the problem, the next click is "view raw logs"
— and that's the failure mode you're optimising against.

## The four surfaces

| Surface                       | Where                                                   | Use for                                                    |
| ----------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Step `name:`                  | Job timeline, PR status checks                          | What the step **does** (imperative).                       |
| Workflow commands             | `echo "::error::msg"`                                    | Surface an error message with file/line.                   |
| Step summary                  | `$GITHUB_STEP_SUMMARY` (markdown)                       | Rich human report shown on the run page.                   |
| Job outputs                   | `$GITHUB_OUTPUT`                                        | Structured data for downstream jobs.                       |

## Step names

Every `run:` and `uses:` step **must** have a `name:`. It is the title
the human sees in the failed-checks view.

| Good                              | Bad                            |
| --------------------------------- | ------------------------------ |
| `Install dependencies`            | (omitted; `run: npm ci`)       |
| `Run unit tests`                  | `tests`                        |
| `Build production bundle`         | `build`                        |
| `Sync dist/ to S3 (production)`   | `deploy`                       |
| `Wait for healthcheck (max 60s)`  | `wait`                         |

Name describes the **outcome**, in imperative voice.

## Annotations — workflow commands

`echo "::<command>::<message>"` in any `run:` produces a typed
annotation surfaced in the PR Checks tab and the workflow summary.

```bash
# Error with file + line
echo "::error file=src/auth.ts,line=42::Token is undefined"

# Warning
echo "::warning::Deprecated config key 'foo' — use 'bar'"

# Notice (info)
echo "::notice::Skipping deploy because branch is not main"

# Group + endgroup (collapsible in logs)
echo "::group::Detailed dependency tree"
npm ls
echo "::endgroup::"
```

For tools that emit their own diagnostics, use a matcher
(`echo "::add-matcher::path/to/matcher.json"`) so plain stderr becomes
typed annotations. Most modern tools (`tsc`, `eslint`, `pytest`,
`golangci-lint`) already emit GitHub-compatible output if invoked with
the right flag (`--format github`, `--output-format github-actions`).

```yaml
- name: Lint
  run: npx eslint . --format github
```

## Step summaries — `$GITHUB_STEP_SUMMARY`

Append Markdown to `$GITHUB_STEP_SUMMARY` and it renders at the top of
the run page. Use for human-readable results (coverage, package size,
deploy URL).

```yaml
- name: Compute bundle size
  run: |
    SIZE=$(du -sh dist/main.js | cut -f1)
    {
      echo "## 📦 Bundle size"
      echo ""
      echo "| File         | Size  |"
      echo "| ------------ | ----- |"
      echo "| dist/main.js | $SIZE |"
    } >> "$GITHUB_STEP_SUMMARY"
```

Patterns worth standardising across workflows:

- **Coverage report** with delta vs `main`.
- **Deploy URL** with a clickable link.
- **Test failure list** with file + line.
- **Bundle / image size table** with delta.

## Error propagation

A workflow step fails when its exit code is non-zero. Two failure
shapes to plan for:

| Shape                                                | Pattern                                                   |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Single failing command — let it propagate.           | Default — don't wrap.                                     |
| Multiple commands — fail on **any** failure.         | `set -euo pipefail` at the top of the `run:` block.       |
| Some failures are OK — continue.                     | `continue-on-error: true` on the step.                    |
| Need the failure but want a useful summary.          | Capture exit code, write summary, then `exit $code`.      |

```yaml
- name: Run integration tests
  shell: bash
  run: |
    set -euo pipefail
    pytest tests/integration/ --junit-xml=junit.xml || EXIT=$?
    {
      echo "## ❌ Integration tests"
      python scripts/junit-to-md.py junit.xml
    } >> "$GITHUB_STEP_SUMMARY"
    exit "${EXIT:-0}"
```

## `if:` — conditional execution

```yaml
- name: Notify Slack on failure
  if: ${{ failure() }}            # also: success(), always(), cancelled()
  uses: slackapi/slack-github-action@<sha>     # v1.x
```

Conditionals:

| `if:`            | When                                                  |
| ---------------- | ----------------------------------------------------- |
| `success()`      | All previous steps succeeded (default).               |
| `failure()`      | Any previous step failed (in this job).               |
| `always()`       | Always — even after cancellation.                     |
| `cancelled()`    | Workflow was cancelled by user / concurrency.         |
| Custom expression | `github.ref == 'refs/heads/main'`                    |

`always()` is the right answer when you want a cleanup or summary
step regardless of outcome.

## Job outputs — structured handoff

```yaml
jobs:
  detect:
    runs-on: ubuntu-latest
    outputs:
      changed_files: ${{ steps.diff.outputs.files }}
    steps:
      - uses: actions/checkout@<sha>      # v4.x
        with: { fetch-depth: 0 }
      - id: diff
        run: |
          FILES=$(git diff --name-only HEAD~1 | jq -R . | jq -s . | tr -d '\n')
          echo "files=$FILES" >> "$GITHUB_OUTPUT"
```

Outputs are **strings**. JSON-encode anything structured.

## Examples

### Good — named, summarised, annotated

```yaml
- name: Type-check
  run: npx tsc --noEmit

- name: Run unit tests
  run: npm test -- --reporter=github

- name: Upload coverage summary
  if: always()
  run: |
    {
      echo "## ✅ Coverage"
      echo ""
      cat coverage/coverage-summary.md
    } >> "$GITHUB_STEP_SUMMARY"
```

### Bad — anonymous + silent

```yaml
- run: npx tsc --noEmit
- run: npm test
- run: echo "done"
```

Why bad: PR Checks list reads "Step 3 failed" with no context. No
summary in the run page. Failed test output buried in logs.

## Debug runtime

If a workflow is mysteriously failing, you can re-run it with debug
logging enabled (Settings → Secrets → Actions → enable
`ACTIONS_RUNNER_DEBUG`/`ACTIONS_STEP_DEBUG`).

For interactive debug, `tmate` actions exist but are a security risk on
public repos — use sparingly, on private branches.

## Common mistakes

- **Anonymous steps.** Untraceable failures. **Fix:** `name:` every
  step.
- **Tools' native output not pasted as annotations.** Failures hidden
  in logs. **Fix:** invoke tools with their GitHub Actions formatter
  (`--format github`).
- **No `set -euo pipefail` in multi-line `run:`.** A failure on line 2
  is silently ignored if line 3 returns 0. **Fix:** prepend
  `set -euo pipefail`.
- **`continue-on-error: true` on the wrong step.** Hides a real
  failure. **Fix:** use it only on advisory steps (e.g., bundle-size
  comment).
- **Job outputs treated as JSON.** They're strings. **Fix:** JSON-
  encode and `fromJSON()` downstream.
- **No `$GITHUB_STEP_SUMMARY`.** Every run requires "view logs" to
  see what happened. **Fix:** even three lines of summary are worth
  it — coverage %, deploy URL, bundle size delta.
