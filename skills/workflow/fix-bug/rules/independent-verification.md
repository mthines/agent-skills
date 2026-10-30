---
title: Verification — Phase 7 checks before a human undrafts
impact: HIGH
tags:
  - verification
  - fail-to-pass
  - pass-to-pass
  - draft-pr
---

# Verification

Read this at Phase 7, after Phase 6 has opened a draft PR.
Run the four checks below yourself, in your own context, then write the evidence into the PR body.
The context that did not write the code has already looked: `branch-reviewer` in Phase 6 Step 3 and `feature-pr-verifier` at PR open; these four checks are mechanical and graded against artefacts, so they do not need a fresh context.
**`/fix-bug` never undrafts.**
The PR stays draft; a human reads the evidence and runs `gh pr ready`.

**Why:** a check run by the same session that wrote the fix skews positive, so the final judgement stays with a person.
See [`../references/design-rationale.md`](../references/design-rationale.md#phase-7-verification).

## Contents

- [When this phase runs](#when-this-phase-runs)
- [Grading discipline](#grading-discipline)
- [Check 1 — Fail to pass](#check-1--fail-to-pass)
- [Check 2 — Pass to pass](#check-2--pass-to-pass)
- [Check 3 — Diff sanity](#check-3--diff-sanity)
- [Check 4 — Repro integrity](#check-4--repro-integrity)
- [Outcomes](#outcomes)

## When this phase runs

Runs only when **all** hold:

- Phase 6 opened a draft PR via either lane (Step 7.pre passed).
  Verification is identical for both lanes.
- Phase 5 was not `--analyse-only`.
- A non-best-effort repro exists from Phase 2.5.

When the repro is best-effort only, skip Checks 1 and 4, run Checks 2 and 3, and write `FAIL_TO_PASS: n/a (best-effort repro)` in the PR body so the human reviewer knows the fix is unproven.

## Grading discipline

Grade against the artefacts, not against what you remember intending:

- Inputs: the Evidence Record, the repro path and command, the bug-notes ledger, the PR head and base SHAs, the PR diff (`gh pr diff`), and the project test command.
- Do not consult `plan.md` or Phase 6's own summary while grading — they describe what was meant, and the checks measure what landed.
- Run Checks 1–4 in order and stop at the first red.

The run mechanic for Checks 1 and 2 delegates to `Skill("verify-behavior", "change")`; you keep the grading:

```text
Skill("verify-behavior", "change")
  target: <repro path or full test suite>
  expected: "fails on base, passes on PR head" | "no PASS_TO_PASS regressions"
  review_relation: "self"
  caller: "fix-bug"
```

If `verify-behavior` is not installed, log `verify-behavior — skipped (not installed)` and run the commands below directly.

## Check 1 — Fail to pass

`FAIL_TO_PASS`: the repro must fail on the base SHA and pass on the PR head.
The repro is committed on the PR branch only, so bring it onto base and clean it up after:

```bash
git checkout <base_sha>
git checkout <pr_head_sha> -- <repro_path>
<repro_command> 2>&1 | tee /tmp/base_run.txt; echo "base exit: ${PIPESTATUS[0]}"
git rm -f -q <repro_path>
git checkout <pr_head_sha>
<repro_command> 2>&1 | tee /tmp/pr_head_run.txt; echo "pr_head exit: ${PIPESTATUS[0]}"
```

| Result | Verdict |
|--------|---------|
| Base exit 0 | Red — the repro does not reproduce the bug |
| PR head exit non-zero | Red — the fix does not fix the bug |
| Base failure is "file not found", "cannot resolve module", or an import of PR-only code | Red — repro-integrity failure; the repro cannot demonstrate the bug on base |
| Base failure matches the Evidence Record symptom and PR head exits 0 | Pass |

## Check 2 — Pass to pass

`PASS_TO_PASS`: run the full suite on base and on the PR head with the framework's structured reporter, and compare `(test id, status)` sets — never raw stdout, which carries timings and ordering noise:

```bash
#   vitest / playwright: --reporter=json   jest: --json
#   pytest: --json-report                  go: go test -json ./...
git checkout <base_sha>;    <test_command> --reporter=json > /tmp/base_results.json 2>/dev/null
git checkout <pr_head_sha>; <test_command> --reporter=json > /tmp/pr_results.json 2>/dev/null
jq -r '.testResults[] | .name as $f | .assertionResults[] | "\($f)::\(.fullName)\t\(.status)"' /tmp/base_results.json | sort > /tmp/base_set.txt
jq -r '.testResults[] | .name as $f | .assertionResults[] | "\($f)::\(.fullName)\t\(.status)"' /tmp/pr_results.json  | sort > /tmp/pr_set.txt
diff /tmp/base_set.txt /tmp/pr_set.txt
```

A test that passed on base and fails on the PR head is red.
A test that failed on base and passes on the PR head is fine.

## Check 3 — Diff sanity

Read the PR diff and report every match, not only the first:

| Anti-pattern | Examples |
|--------------|----------|
| Catch-all exception swallow | `try: ... except: pass`, `catch (e) {}`, `.catch(() => {})` |
| Debug statement in production code | `console.log`, `print(`, `dbg!`, `fmt.Println` |
| New comment marker | `// TODO`, `// FIXME`, `// XXX`, `// hack` |
| Deleted test | a `.test.*` file, or an `it()` / `test()` / `def test_` block |
| Skipped or focused test | `.skip`, `.only`, `xit`, `xdescribe`, `pytest.mark.skip` |
| Loosened assertion in a non-repro test | `toEqual(1)` → `toBeDefined()` |

Any match is red.

## Check 4 — Repro integrity

Inspect the diff for changes to the repro path:

| Move | Verdict |
|------|---------|
| Repro deleted, skipped, or marked `.todo` | Red |
| Repro assertion loosened, or its expected value changed to match the buggy behaviour | Red — "fixed the test, not the bug" |
| Repro assertion strengthened (an extra expected case) | Pass — note it |

## Outcomes

### Green (all four pass)

1. Leave the PR draft.
2. Add the evidence to the PR body under a `## Verification` heading with `gh pr edit <PR> --body-file <file>`, preserving the existing body:

   ```markdown
   ## Verification

   - FAIL_TO_PASS: pass (base exit 1 — `<symptom line>`; head exit 0)
   - PASS_TO_PASS: pass (412 tests on base and head, 0 newly failing)
   - Diff sanity: pass
   - Repro integrity: pass
   - Verdict: green — ready for a human to review and undraft
   ```

3. Append the same block to the bug-notes ledger under `### Verification (Phase 7)`.
4. Continue to Phase 8 if the input was a telemetry source; otherwise report the PR URL with "draft, verified green — undraft after review".

### Red (any check failed)

1. Leave the PR draft and write the failing check and its evidence into the PR body's `## Verification` section.
2. Append the evidence to the bug-notes ledger as `counterexamples`.
3. Surface the failing check, the evidence, and three options:
   - **refine** — append the findings to `plan.md` and re-enter [Phase 6 Step 6b](./autonomous-handoff.md#step-6b--work-the-plan-here) in the same worktree, capped at 3 rounds per the CEGIS contract.
   - **escalate** — re-run `Skill("confidence", "analysis fix")` on the failed verification to surface root-cause concerns.
   - **abandon** — close the draft PR and return the bug-notes ledger as the artefact.

Never run `gh pr ready`, and never merge, on either outcome.
