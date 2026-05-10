# Bug Notes — <slug>

## Evidence Record

### Symptom
<one paragraph: what the user observed>

### Sources
- <Dash0 span URL / video summary / stack trace / code pointer / Linear ticket URL>

### Affected code (initial scope)
| File | Line(s) | Symbol | Role | Source of suspicion |
|------|---------|--------|------|---------------------|
| ...  | ...     | ...    | entry / boundary / leaf | top-of-stack frame / Dash0 attribute / label-derived |

### Telemetry summary (Dash0 only)
- Service / env / version: ...
- Span attributes that matter: ...
- Linked spans: ...

### Reproduction (if known)
<from video, from Dash0 user_id / request_id, or "unknown">

### Bug class (Phase 0)
<one of: null-deref | race | off-by-one | contract-mismatch | perf | config | regression | logic | unknown>

---

## Pre-flight findings (Phase 1.5)

| Probe | Result | Suspicion |
|-------|--------|-----------|
| Recent commits | ... | ... |
| Last-known-green | ... | ... |
| Diff vs last-green | ... | ... |
| Lockfile diff | ... | ... |
| Env diff | ... | ... |
| CI flips | ... | ... |

### Regression window
- last_green_sha: <sha or "n/a">
- failing_sha: HEAD
- candidate commits: <count>

---

## Reproduction (Phase 2.5)

- Path: <repro/<id>.test.ts | repro/test_<id>.py | repro/<id>.md>
- Command: <pnpm test repro/<id>.test.ts | pytest repro/test_<id>.py | manual>
- Status: <failing on HEAD as expected | best-effort>
- Failing assertion / behaviour: <verbatim output>

### Bisect result (if run)
- Offending commit: <sha>
- Author: <author>
- Subject: <subject>
- Diff size: <N> lines
- Files: <list>

---

## Hypotheses ledger

| # | Hypothesis | State | Evidence-for | Evidence-against | Source |
|---|------------|-------|--------------|------------------|--------|
|   |            | open  |              |                  |        |

States: `open` | `confirmed` | `ruled-out`.

---

## Counterexamples

Input/output pairs that broke a candidate fix during the executor's CEGIS refinement loop.

| Round | Input | Expected | Actual | Notes |
|-------|-------|----------|--------|-------|
|       |       |          |        |       |

---

## Confidence trajectory

| Phase | Score | Breakdown | Trigger |
|-------|-------|-----------|---------|
|       |       |           |         |

---

## Phase log

| Phase | Timestamp (ISO 8601 UTC) | Action / outcome |
|-------|--------------------------|------------------|
| 0     | <ts>                     | Input classified as <type>; bugClass = <class> |
| 1     | <ts>                     | Evidence resolved; pre-flight ran |
| 2     | <ts>                     | Reproduction locked: <path> |
| 3     | <ts>                     | Holistic analysis: root cause <verbatim> |
| 4     | <ts>                     | Confidence: <X%> |
| 5     | <ts>                     | Branch decision: <auto-fix | proposal | stop> |
| 6     | <ts>                     | Planner: <plan ready | below gate>; Executor: <PR url | failed> |
| 7     | <ts>                     | Verifier: <green | red> |
| 8     | <ts>                     | Telemetry verification: <decayed | persistent | skipped> |

---

## Outcome

<one of:>
- **Auto-implemented**: PR <url> on branch <name>. Verifier green. Telemetry decayed (rate <X%> of baseline).
- **Below gate**: <X%>. Proposal returned for review. Missing evidence to raise score: <list>.
- **Stopped**: <reason>.
