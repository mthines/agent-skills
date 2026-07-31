---
title: Log Output Visibility — Never Swallow a Command's Output
impact: CRITICAL
tags:
  - logging
  - observability
  - agents
  - debugging
  - ci-auto-fix
---

# Log Output Visibility

Every command a workflow runs must write its stdout **and** stderr to the run log.
This rule applies to every step of every workflow this skill scaffolds or reviews, and it outranks brevity, log-noise preferences, and prettiness of output.

**Why:** downstream automation reads a failure with `gh run view <run-id> --log-failed`.
That command returns the raw job log — nothing else.
Output that went only to a file, only to an artifact, only to `$GITHUB_STEP_SUMMARY`, or to `/dev/null` does not exist as far as `/ci-auto-fix`, `/test-auto-fix`, `/implement-suggestion`, or a human on-call reading the log is concerned.
A failing step that printed nothing is unactionable: the agent cannot classify the failure, cannot locate the file and line, and escalates or no-ops instead of fixing it.

## Decision flow

| Situation                                                    | Do this                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Command output is only needed by a human/agent               | Run it plain. Do not redirect, do not silence.                          |
| Output is also needed as a file (parser, artifact, summary)  | `set -o pipefail` then `cmd 2>&1 \| tee report.txt`.                     |
| Output is also needed in a variable                          | `out=$(cmd 2>&1); echo "$out"` — echo it before using it.                |
| Step is allowed to fail (`continue-on-error` / `\|\| true`)   | Capture the exit code, print the output **and** the code.               |
| Tool has a machine format (JUnit, SARIF, JSON)               | Emit the machine format **to a file** and the human format to stdout.   |
| Output would exceed a few thousand lines                     | Narrow the command, not the visibility — never add `--quiet` to fix noise. |
| Output contains credentials                                  | Still log it. Actions masks registered secrets; fix the leak at its source. |

## Hard rules

1. **No suppression.** `> /dev/null`, `2> /dev/null`, `&> /dev/null`, `--silent`, `--quiet`, `-q`, `--no-progress`, `--reporter=silent`, `--log-level=error` on a step whose purpose is to report — all forbidden.
2. **No file-only redirection.** `cmd > out.txt 2>&1` hides everything. Use `tee`.
3. **`tee` requires `pipefail`.** Without `set -o pipefail` the pipeline reports `tee`'s exit code and the step passes while the command failed.
4. **`$GITHUB_STEP_SUMMARY` is additive, never a substitute.** The summary is not part of the log stream and is not returned by `gh run view --log`.
5. **Artifacts are additive, never a substitute.** `actions/upload-artifact` output is not readable from the log.
6. **Failure paths must print.** Any `if: failure()` / `if: always()` step must emit the diagnostic it collected, not just upload it.
7. **Swallowed exit codes must be announced.** `|| true` without an accompanying `echo` of the output and the code is forbidden.
8. **Never wrap a failing command's output in `::group::`.** Groups are collapsed by default in the UI; keep errors ungrouped so they are visible without a click.
9. **Never `set +x` away the only evidence.** If a `run:` block does non-obvious shell work, `set -x` it.
10. **Bound the output at the source.** Unbounded `--verbose` dumps get truncated by the log limit and blind the agent just as effectively as silence. Log the relevant output fully; do not log everything.

## Examples

### Good — visible, captured, and exit-code-correct

```yaml
- name: Run unit tests
  shell: bash
  run: |
    set -euo pipefail
    npm test -- --reporter=default --reporter=junit --outputFile=junit.xml 2>&1 | tee test-output.log

- name: Type-check
  shell: bash
  run: |
    set -euo pipefail
    npx tsc --noEmit 2>&1 | tee tsc.log
```

### Good — advisory step that is allowed to fail but still reports

```yaml
- name: Check bundle size (advisory)
  shell: bash
  run: |
    set -uo pipefail
    output=$(npx size-limit 2>&1) && code=0 || code=$?
    echo "$output"
    echo "size-limit exit code: $code"
    exit 0
```

### Bad — output goes to a file, the log is empty

```yaml
- name: Run unit tests
  run: npm test > test-output.log 2>&1

- name: Upload test log
  if: failure()
  uses: actions/upload-artifact@<sha>      # v4.x
  with: { path: test-output.log }
```

Why bad: `gh run view --log-failed` returns the step name and nothing else.
The agent sees "tests failed" with zero diagnostics and cannot act.

### Bad — silenced, grouped, and exit-code-lost

```yaml
- name: Install
  run: npm ci --silent > /dev/null

- name: Lint
  run: |
    echo "::group::lint"
    npx eslint . || true
    echo "::endgroup::"
```

Why bad: the install failure reason is gone, the lint failure is collapsed **and** swallowed by `|| true`, and the job goes green on a broken lint.

## Verification

Before finishing a scaffold, and as a `review`-mode check, grep the workflow:

```bash
grep -rnE '(>[[:space:]]*/dev/null|2>[[:space:]]*/dev/null|&>[[:space:]]*/dev/null|--silent|--quiet|(^|[[:space:]])-q([[:space:]]|$)|\|\|[[:space:]]*true|>[[:space:]]*[^|>]*\.(log|txt|json|xml))' \
  --include='*.yml' --include='*.yaml' .github
```

Two things this form guarantees that a shell glob does not.

- **It never hard-errors on a repository without composite actions.**
  `.github/actions/*/action.yml` stays unexpanded when that directory does not exist, so the glob form exits `2` with `grep: .github/actions/*/action.yml: No such file or directory` — which an agent reads as "violations found".
  Recursing into `.github` with `--include` exits `1` on a clean repository instead.
- **It is portable.**
  `\s` is a GNU extension; `[[:space:]]` is the POSIX character class and works on GNU grep and BSD/macOS grep alike.

Exit codes: `0` = at least one hit (investigate each), `1` = clean, `2` = the grep invocation itself failed (fix the invocation; never read it as a FAIL).
The recursive form scans every `*.yml` and `*.yaml` under `.github`, so it also covers `.yaml`-spelled workflows and `action.yaml` composite actions — and unrelated config such as `dependabot.yml`, which is expected to be clean.

Every hit must be either removed or justified by a `tee` on the same line.
Report each unjustified hit as **FAIL — log visibility** with its line number.

## Common mistakes

- **`tee` without `pipefail`.** Green job, failed command. **Fix:** `set -o pipefail` at the top of the `run:` block.
- **Machine reporter replaces the human one.** `--reporter=junit` alone writes a file and prints nothing. **Fix:** pass both reporters, or `tee` the human one.
- **Summary-only reporting.** Everything renders on the run page, nothing in the log. **Fix:** print the same content to stdout before appending it to `$GITHUB_STEP_SUMMARY`.
- **`continue-on-error: true` on a silent step.** No signal at all — neither a red check nor a log line. **Fix:** print the output and the exit code.
- **Silencing to reduce noise.** **Fix:** narrow the command's scope or drop `--verbose`; never drop the failure output.
- **Assuming the artifact is enough.** **Fix:** artifacts are a supplement; the log is the contract.
