Plan a fix for the following bug.

## Symptom
<one paragraph from the Evidence Record>

## Bug class (Phase 0)
<null-deref | race | off-by-one | contract-mismatch | perf | config | regression | logic | unknown>

## Sources
<bullet list of evidence sources: Dash0 span URL, stack trace excerpt, code pointer, video
summary, Linear ticket URL — whatever was resolved in Phase 1>

## Pre-flight findings (Phase 1.5)
<verbatim from Evidence Record's Pre-flight section, including last_green_sha and any bisect
result>

## Reproduction (Phase 2.5)
- Path: <repro/<id>.test.ts | repro/test_<id>.py | repro/<id>.md (best-effort)>
- Command: <pnpm test repro/<id>.test.ts | pytest repro/test_<id>.py | manual>
- Status: <failing on HEAD as expected | best-effort>

This repro is the executor's `FAIL_TO_PASS` contract. **The plan must:**
1. Run the repro before any code edit and confirm it fails for the expected reason.
2. Run the repro after each implementation edit; on failure, capture the failing input/output
   verbatim and append to `.agent/<branch>/bug-notes.md` under `Counterexamples`, then refine.
3. Cap refinement at **3 rounds**. After the third failure, stop and return to
   `confidence(bug-analysis fix)` rather than guessing further.

## Root cause (from holistic-analysis)
<root cause paragraph + supporting evidence from holistic-analysis Phase 4>

## Proposed change (from holistic-analysis)
<plain-language description + impact analysis from holistic-analysis Phase 7>

## Confidence
- bug-analysis: <X%>
- breakdown:
  - Evidence strength: <Y%>
  - Root cause certainty: <Y%>
  - Fix confidence: <Y%>

## Affected files (initial scope)
| File | Line(s) | Symbol | Role |
|------|---------|--------|------|
| ...  | ...     | ...    | entry / boundary / leaf |

## Bug-notes ledger
- Path: `.agent/<branch>/bug-notes.md`
- Pre-existing entries from Phases 0–5 are present; the planner and executor must read on entry
  and append on exit per the [bug-notes-ledger contract](../rules/bug-notes-ledger.md).

## Requirements
- Branch: fix/<short-slug>
- The PR description (created later by the executor) must reference the Dash0 span / Linear
  ticket / source URL where applicable.
- Open the PR as a draft. The Phase 7 verifier decides when to undraft.
- Do **not** modify the repro file under `repro/` to make tests pass — the verifier checks for
  this and will reject the PR.
