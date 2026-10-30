---
title: pr-reviewer — gate criteria and Step 1.8
impact: HIGH
tags:
  - pr-reviewer
  - gates
---

# pr-reviewer — gate criteria and Step 1.8

**Read at Step 1.8 by every run that evaluates gates** (skipped only under `--skip-gates`, which still reads *Gate states* for the `⏭️` cell rule). Owns the six gate criteria, the gate states, and the Step 1.8 procedure. Step 2.9c re-evaluates Gate 3 by the same rules. Rationale: [`../references/gate-rationale.md`](../references/gate-rationale.md).

## Contents

- [Gate criteria](#gate-criteria)
  - [Gate states](#gate-states)
- [Step 1.8: Run pre-merge gate checks](#step-18-run-pre-merge-gate-checks)

---

## Gate criteria

A PR PASSES when ALL of the following are true:

1. **Description vs. code** — the description accurately reflects what the diff does; an independent reader reaches the same conclusion about intent and scope from the description alone as from the diff. A mismatch is a **soft warning** (⚠️), not a failure — see *Gate states* below.
2. **CI status** — all build, test, lint, and docs checks are green. CI is informational-in-`Run`, not a graded gate — red or pending CI never contributes to this PR's verdict (see *Gate states*). It is NOT shown as a row in the review table; GitHub's checks section shows the detail, and `CI_NOTE` carries the substance.
3. **Prior review feedback** — all prior review comments — from bots (Cursor, Claude, other agents) or human reviewers — are resolved or explicitly dismissed. An open thread whose ask is non-blocking, or which has already been answered on-thread, is a **soft warning** (⚠️) — only an *unanswered blocking* ask fails this gate. See *Gate states* below.
4. **Self-review signals** — no debug logs, commented-out code, leftover TODO/FIXME/HACK markers on new lines, or obvious unreviewed AI stubs in the diff.
5. **Documentation adequacy** — description, inline comments, and any docs are sufficient for an independent reader to understand the change's purpose and behavior.
6. **Code review** — the finder + verifier pass (Phases D–E) finds no blocking issues. Non-blocking findings do **not** fail this gate (see *Gate states* below).

A PR FAILS if Gate 4 or Gate 5 is not met, or if the Prior review feedback (Gate 3) or Code review (Gate 6) gate is ❌. Gate 1 (Description vs. code) is a soft-warning gate — it yields ⚠️ and never fails the PR; Gate 2 (CI) is informational-in-`Run` and never contributes to the verdict; Gates 3 and 6 are tri-state and reach ❌ only on a *blocking* item.

### Gate states

Gates 4 and 5 are **hard** gates: binary ✅ / ❌, and any ❌ fails the PR.

The other three are **graded** — a non-blocking problem yields a warning (⚠️) that never fails the PR and is never counted in `FAILING_GATE_COUNT`. Gate 1 is two-state (it can only warn); Gates 3 and 6 are tri-state and reach ❌ only on a blocking item. Gate 2 (CI) is neither hard nor graded — it is informational-in-`Run` and out of the grade entirely:

**Gate 2 (CI) is informational, never part of the grade.** Report its state in full in `CI_NOTE`
(`Run`); a red check that the *diff* demonstrably causes is a Gate 6 finding on this reviewer's own
evidence, where it blocks properly.

**Gate 1 — Description vs. code** is two-state:

| Status | Condition |
|---|---|
| ✅ | The description accurately reflects the diff. |
| ⚠️ | The description omits or misrepresents a scope of the diff. Soft warning only — never fails the PR. |

**Gate 3 — Prior review feedback** is tri-state, on the same *blocking* bar as Gate 6:

| Status | Condition | Verdict effect |
|---|---|---|
| ✅ | `OPEN_BOT_COMMENTS[]` is empty — every prior review thread is resolved. | Passes. |
| ⚠️ | Threads are open, but none is both **blocking** and **unanswered**. | **Passes — soft warning only.** NOT counted in `FAILING_GATE_COUNT`; never flips the verdict to FAIL. |
| ❌ | At least one open thread carries a **blocking** ask that nobody has answered. | Fails — counted in `FAILING_GATE_COUNT`. |

An open thread is **answered** when it has at least one reply after its root comment — a fix
announcement, a rationale for declining, a counter-argument — or when this run's Step 2.9c
classified it `declined` / `acknowledged` but the `resolveReviewThread` mutation failed. An
answered thread is bookkeeping: the ask has been engaged with and only the Resolve click is
missing, which is not a defect in the PR. A reply by the thread's **own** author is not
engagement and does not count — see Step 1.0's `answered` field for why that case needs no
carve-out. The open-threads checklist renders on ⚠️ exactly as it does
on ❌, so no open thread disappears from the report — only the verdict changes.

**Gate 6 — Code review** is tri-state, because criterion 6 is scoped to *blocking* issues:

| Status | Condition | Verdict effect |
|---|---|---|
| ✅ | No inline finding survived the pipeline (Steps 2.2–2.9b). | Passes. |
| ⚠️ | One or more findings survived, but **none is blocking**. | **Passes — soft warning only.** NOT counted in `FAILING_GATE_COUNT`; never flips the verdict to FAIL. |
| ❌ | At least one **blocking** finding survived. | Fails — counted in `FAILING_GATE_COUNT`. |

A finding is **blocking** only if it is broken behaviour, security (auth bypass / injection / secret leak / CSRF), data loss/corruption, or misimplemented intent — the same bar as the Step 3 verdict table, applied to the findings decorated `(blocking)` at Step 2.9 (`conventional-comments.md`). Everything else — `suggestion`, `question`, `nitpick`, and any non-blocking `issue` — is non-blocking and yields ⚠️ at most.

**Gate 3 applies that same bar to the other bot's own decoration** — and only to a decoration on this closed list, matched on the raw root comment by `BLOCKING_DECORATION_RE` in [`finalize/gates.mjs`](../scripts/finalize/gates.mjs) — never to a fresh adjudication of the finding by this reviewer:

| Decoration on the thread's root comment | Example | Blocking |
|---|---|---|
| a `(blocking)` marker | `issue (blocking): token is never refreshed` | yes |
| a bare `issue:` conventional-comment prefix at a line start | `issue: token is never refreshed` | yes |
| `Severity: Critical` or `Severity: High` | `Severity: high` | yes |
| Cursor Bugbot's label line `Critical Severity` or `High Severity`, alone on its line, bold or not, also inside `<!-- … -->` | `**High Severity**` | yes |
| Cursor Bugbot's `Medium Severity` / `Low Severity`, or `Severity: Medium` / `Low` | `**Medium Severity**` | no |
| anything else, including "high severity" inside a sentence | `this looks high severity to me` | no |

**Why:** Bugbot's `High Severity` makes the same claim as `Severity: High`, so the two grade the same; a reply from anyone but the bot answers the thread and drops ❌ to ⚠️. Reading another bot's comment and deciding for it how serious it *really* is puts words in its mouth, which Step 1.0 already forbids for the `ask` text. An undecorated or unparseable ask is read as **non-blocking**, the same way an unreadable thread state is read as not-open: the reviewer never manufactures a severity it cannot evidence. If that ask is in fact serious, this run's own review pass finds it and files it under Gate 6, where it blocks on this reviewer's own evidence.

The overall verdict is **FAIL** when Gate 4 or Gate 5 fails **or** the Prior review feedback or Code review gate is ❌; otherwise **PASS** (with the Description vs. code, Prior review feedback, and Code review rows each showing ✅ or ⚠️, and CI's state in `CI_NOTE`). Gate 2 (CI) does **not** feed the verdict: it is surfaced in GitHub's checks section and in `CI_NOTE`, never as a table row and never in `FAILING_GATE_COUNT`. The PASS/WARN/FAIL presentation in Steps 3–4 is chosen from the review gates (3, 4, 5, Description vs. code, and Code review) only.

`--skip-gates` bypasses Gates 1–5 and runs only the inline review pass (Gate 6).
Those gates then render `⏭️` in every gate table, with the Details cell holding the carried prior text plus its `(carried from …)` suffix when Step 2.5c dispositioned the row `CARRY`, and `not evaluated this run` otherwise.
`⏭️` is a fourth cell value alongside ✅ / ⚠️ / ❌: it is never counted in `FAILING_GATE_COUNT`, never selects the FAIL presentation, and never changes the verdict.

## Step 1.8: Run pre-merge gate checks

Skip this step entirely if `--skip-gates` was passed; set all Gate 1–5 results to `SKIPPED`.

Run all gate evaluations now, before the expensive holistic pass.
Collect ALL findings before moving on — do not stop early on the first failure.

**Gate 1 — Description vs. code consistency**
Read the PR title and body (Step 1.1 command A) and the diff (Step 1.1 command B).
Does the description accurately reflect what the diff does? Flag every scope the
description omits or misrepresents.
Finding format: one sentence per mismatch, file names only (no diff quotes).
Result: PASS (✅) or WARN (⚠️) with finding text — a mismatch is a soft warning, never a hard failure (see *Gate states*).

**Gate 2 — CI status** (reported, informational-in-`Run` — excluded from the review body table and
from the verdict computation)
Read the CI checks output (Step 1.1 command C). List every failing or still-pending
check by name, and — where the output makes it readable — say what each failure is on.
Result: PASS (✅, all green) or WARN (⚠️) with the failing check names, for reporting purposes only —
it never feeds `FAILING_GATE_COUNT` or `WARN_GATE_COUNT`. **Never ❌** — see
*Gate states*. Report the detail in `CI_NOTE`; a red check the diff demonstrably causes is filed
under Gate 6 instead, on this reviewer's own evidence.

**Gate 3 — Unresolved prior review feedback**
Use `OPEN_BOT_COMMENTS[]` from Step 1.0, which already restricts admission to comments whose thread
state was read and is `isResolved == false` — an unknown or unpaged thread is excluded there, not
here, so it can never fail this gate.
Finding format: one line per unresolved item, rendered as a **clickable entry with the thread's own
lead line** `- [\`<path>:<line>\`](<url>) — <ask> (<bot|human> · \`<author>\`)` using the Step 1.0
fields — the author clicks straight through to each thread instead of hunting for a bare `path:line`.
Whenever any thread is open — ⚠️ as well as ❌ — this list renders **inside** the `Review details`
accordion as `OPEN_THREADS_LIST`, and the accordion's own `<summary>` carries `OPEN_THREADS_SUFFIX`
(the open count, plus the blocking subset on ❌), so the collapsed report still shows *that* threads
are open and *how many block*; the accordion's Gate 3 Details cell stays terse — `<N> unresolved
review thread(s) — see the thread list below`.

Result: PASS (✅), WARN (⚠️), or FAIL (❌) — the same tri-state `gate3()` implements
(`agents/pr-reviewer/scripts/finalize/gates.mjs`, self-tested), graded on the `blocking` and
`answered` fields Step 1.0 captures (*Gate states*):

- ✅ — `OPEN_BOT_COMMENTS[]` is empty.
- ❌ — at least one entry has `blocking == true` **and** `answered == false`.
- ⚠️ — otherwise: threads are open, but every one of them is non-blocking, already answered, or
  both.

Rationale for grading by severity, and where the severity itself comes from (the other bot's own decoration, never this reviewer's re-adjudication): see *Gate states* above.

**Gate 4 — Self-review signals**
This is a coarse safety net for the residue a careful author strips out before pushing — not a style or design review (Gate 6 owns those). It scans **only `+`-prefixed additions** for a fixed set of unambiguous "this was never self-reviewed" tells, which is exactly why it is green on almost every PR: a clean diff simply does not contain these artifacts, so the gate stays quiet and only trips when genuinely unfinished or debug material was committed. Treat a green result as "no smoking guns", not "the code is good".
In `full` mode: read the full PR diff (Step 1.1 command B).
In `incremental` or `incremental-quick` mode: read `REVIEW_DIFF` (the delta from Step 1.2b) — only new additions since the prior review can introduce new debug logs or stubs.
Flag any of the following when it appears on a `+`-prefixed line:
- **Debugging leftovers** — `console.log` / `console.debug`, `print` / `pp`, `debugger`, `breakpoint()`, `binding.pry`, `fmt.Println`, `dbg!`, `System.out.println`, and similar trace calls added for local debugging.
- **Commented-out code** — a block of real code disabled with comment syntax instead of deleted (distinct from explanatory prose comments).
- **Unfinished markers** — `TODO`, `FIXME`, `HACK`, `XXX`, `WIP`, `TEMP`, or a `TODO(owner)` that this PR does not resolve.
- **Merge-conflict / rebase residue** — `<<<<<<<`, `=======`, `>>>>>>>` markers left in a file.
- **Test focus / silent skips** — `.only` / `fdescribe` / `fit` (which quietly drop the rest of the suite) and newly added `.skip` / `xit` / `@pytest.mark.skip` with no reason given.
- **Newly added suppressions without justification** — `eslint-disable`, `// @ts-ignore` / `// @ts-nocheck`, `# noqa`, `# type: ignore`, `#nosec`, `//nolint` introduced on a new line with no explanatory comment.
- **Obvious unreviewed AI / placeholder output** — narrator comments ("Here's the function that…", "This code does…"), `lorem ipsum`, `foo`/`bar`/`baz` stand-ins shipped as real values, uncustomised scaffold text, or a body that plainly contradicts its surroundings.
- **Committed secrets or local noise** — apparent hardcoded credentials/tokens/API keys on a new line, inlined `.env` values, or stray absolute local paths.
Scope discipline: flag only what is on new (`+`) lines and unambiguous. Do not moralise about naming, structure, or approach here — a borderline judgement call belongs in Gate 6 as a finding, never in this gate. One clear signal is enough to fail it.
Prose-vs-code carve-out: a `+` line that **names or enumerates** one of the patterns above as its subject matter — documentation, a rule file, a checklist, a test fixture, or a review agent's own marker list — is not a hit; only a line that **is** the artifact (an actual unfinished marker, an actual suppression, actual conflict residue, an actual debug call) counts. Concrete test: would deleting the pattern from this line remove leftover work, or remove the sentence's meaning? Removes leftover work → flag it. Removes the meaning → skip it. Apply the same test to every bullet above except the credentials half of **Committed secrets or local noise** — that is, apparent hardcoded credentials, tokens, API keys, and inlined `.env` values — not just the unfinished markers. Those are exempt from the carve-out because a credential is harmful by its mere presence, whatever the surrounding sentence is doing: flag one on a `+` line even when it is the subject matter of documentation or a fixture. Concrete test for the exempt half: is the value an explicit placeholder (`<YOUR_API_KEY>`, `sk-xxxxx`, `changeme`, a documented vendor example key) or visibly redacted? Placeholder or redacted → skip it. Real-looking secret → flag it, in prose as much as in code. The other half of that bullet — stray absolute local paths — is **not** exempt: a path is leftover work rather than a live hazard, so it takes the general test above (a doc, rule file, or fixture line that names an example path as its subject matter is skipped; a path baked into code or config as a real value is flagged).
Finding format: `file:line — description`.
Result: PASS or FAIL with finding text.

**Gate 5 — Documentation adequacy**
Read the PR title and body (Step 1.1 command A) and the diff (Step 1.1 command B).
Are description, inline comments, and docs sufficient for an independent reader to
understand the change's purpose and behavior?
Finding format: one sentence per gap.
Result: PASS or FAIL with finding text.

**Token-economy skip heuristic:** if all three of Gates 3 (❌ only), 4, and 5 fail (Gate 1 is a soft warning and no longer counts toward this heuristic, and neither does a ⚠️ Gate 3 — the heuristic's premise is that the PR is clearly not ready, and ⚠️ is a passing state) and `--no-holistic` was not already set, skip Steps 2.4 and 2.4b (holistic passes) — the PR is clearly not ready and holistic tokens would be wasted. Note the skip in the Quality Gate summary. Gate 6 (inline review) always runs regardless of gate outcomes.
