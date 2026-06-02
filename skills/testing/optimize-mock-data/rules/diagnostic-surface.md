---
title: optimize-mock-data — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - optimize-mock-data
  - meta
---

# optimize-mock-data — Diagnostic Surface

This file declares the contract `/create-skill diagnose optimize-mock-data` reads to parameterize the generic Diagnose Mode procedure for this skill.
The contract spec lives at [`skills/authoring/create-skill/rules/diagnostic-surface.md`](../../../authoring/create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/testing/optimize-mock-data/`

---

## Phase model

| Phase | Name              | Rule file                                                              | Gate                                                                |
| ----- | ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 0     | Resolve corpus    | —                                                                      | Target resolved to ≥ 2 JSON / JSONL files; peer-glob expansion run  |
| 1     | Shape extraction  | [shape-extraction.md](./shape-extraction.md)                           | Every file has a deterministic fingerprint                          |
| 2     | Drift detection   | [drift-detection.md](./drift-detection.md)                             | Clusters computed; reference picked; drift sites enumerated         |
| 3     | Apply (mode-gated)| [shrink-policy.md](./shrink-policy.md), [trim-policy.md](./trim-policy.md) | `analyze` exits; `normalize` / `shrink` / `trim` writes pass round-trip |

This skill is not phase-stuck — it is a four-stage pipeline executed in a single run.
Phase 3 has four sub-paths keyed on the mode (`analyze` writes nothing; `normalize`, `shrink`, and `trim` all mutate files).

---

## Existing guards per phase

| Phase | Existing guards                                                                                                        | Typical gaps                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Minimum-2-file check; peer-glob expansion when given a single file; exclusion list (`node_modules`, `dist`, `.next`, `coverage`, `.git`, `build`) | User passes a single file with no peers in the directory → halts before any work, but the message may not explain the peer-glob rule clearly |
| 1     | `shape.py` deterministic algorithm (sorted keys, sorted union members); JSONL line-by-line handling; explicit type-token enumeration | Heterogeneous arrays with > 2 element shapes produce a long union string that is hard to diff visually; empty-array `[]` compatibility rule may mask real "this should be `[T]`" drift |
| 2     | Majority-wins cluster selection with `mtime` tiebreaker; severity rubric (HIGH = type drift, MED = > 25 % missing, LOW = < 25 % missing or formatting); per-cluster diff (not pairwise) | Reference cluster size < 50 % of corpus emits only a soft warning, not a hard halt — the diagnoser should consider whether to upgrade this to a halt when *all* clusters are roughly equal; type-drift on a deeply-nested optional path may report `<not present>` vs concrete type and look like additive drift rather than type drift |
| 3 (normalize / shrink) | Round-trip parse check on every rewrite (Python-object equality, not string equality); protected-key list (`*Id$`, `hash`, `actionId`, `threadId`, `userId`, `panelId`, `dashboardId`, `traceId`, `spanId`, `sessionId`, `key`, `type`, `role`, `name`, `version`); parseable-string heuristics (URL, JSON-in-string, base64, PEM); idempotency marker (`…(truncated, was N chars)`); URL-special-case (keep scheme+host+path, collapse query) | A new identifier key not on the protected list (e.g. `correlationId`, `requestId` would match `*Id$`, but a custom snake_case `correlation_id` would NOT) → silently truncated; a base64-with-padding string just under the 40-char regex threshold → silently truncated; a stringified JSON blob whose first character is whitespace not `{` or `[` → silently truncated; **`content` is NOT on the protected list, so `shrink` will truncate long `content` strings — by design, but a related-failure diagnose should propose adding `content` to the protected list** |
| 3 (trim)               | Round-trip parse check (Python-object equality); protected top-level roots (`$.messages`, `$.thread.*`) refused entry unless an `artifacts` ancestor sits in between; strict allowlist of data-point parent keys (`webEvents`, `logRecords`, `scopeLogs`, `scopeSpans`, `resourceSpans`, `series`, `dataPoints`, `points`, `samples`, `metrics`, `events`, `spans`, `rows`, `records`, `results`, `attributes`, `catalog`) — no default fallback; top-level `len($.messages)` pre/post-equality assertion; source-indent detection (tab vs N-space) preserved on render; idempotency via byte-equality check before write; **strings are never modified under any condition** | A new data-point key not on the allowlist (e.g. a custom `tracePoints`) → never trimmed until the user adds it via `--max-array`; a fixture that nests `artifacts` deeper than expected (e.g. `artifacts.detail.artifacts.events`) → the `'artifacts' in ancestry` check still fires, which is correct; a corpus where every in-budget array is already ≤ budget → file rewrite is a true no-op (indent preservation prevents tab→space drift) |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID      | Class                   | Symptom                                                                                                                                   | Primary phase | Primary gate / companion                                          |
| ------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| F1      | Array-cardinality bloat | `shrink` saves little because file size is dominated by long arrays of short-string objects (telemetry records, time-series samples, attribute lists, catalog entries), not by individual long strings | Phase 3       | `trim` mode (added 2026-05-14)                                    |
| F-novel | Novel mode              | Does not match any existing row                                                                                                           | —             | Diagnosis proposes a new row inline (added on user approval only) |

The taxonomy is **append-only** — every novel failure mode adds a new row, the row is justified by a diagnosis that cleared `confidence(analysis) ≥ 90 %` AND was user-approved at apply time.
Speculative categories are intentionally not pre-populated — they push the diagnoser toward forcing a match where none exists.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Round-trip parse safety is non-removable.** Every rewrite in `normalize` and `shrink` modes must compare the re-parsed Python object against the pre-write Python object and revert (exit 3) on mismatch. The diagnoser cannot weaken this to a string-equality check, a "best-effort" compare, or a try/except swallow.
- **`analyze` mode is read-only.** No file mutation under any condition, including "obvious" formatting-only fixes. The user must explicitly invoke `normalize` or `shrink`.
- **Protected-key list is append-only.** Names may be added; never removed. The `*Id$` suffix regex is load-bearing — diagnose may propose extending it (e.g. snake_case `_id$`) but never narrowing or deleting it.
- **Idempotency is non-negotiable.** Running `normalize` twice with the same flags produces zero changes on the second run; running `shrink` twice with the same `--max-string` and `--keep-urls` produces zero changes on the second run. The truncation marker (`…(truncated, was N chars)`) is the on-disk witness that enables this — the diagnoser cannot propose removing it.
- **Minimum-2-file gate at Phase 0 is non-removable.** Single-file optimization is out of scope; the user is redirected to `prettier`. Without ≥ 2 files there is no drift to detect.
- **Reference cluster selection is mechanical.** Largest cluster wins; tiebreaker is most-recently-modified file. The diagnoser must not propose hand-picking a "canonical" reference or letting the user override it — that re-introduces the bias the majority-wins rule is designed to remove.
- **Shape extraction omits leaf values.** Fingerprints encode *types*, never literal strings, numbers, or booleans. Leaking values into the fingerprint would defeat the entire skill (every thread id would be a different fingerprint). The diagnoser cannot propose any "smarter" fingerprint that captures value statistics.
- **Stdlib-only Python.** No `pip install`, no third-party dependencies. The skill must run in any sandbox, CI, or pre-commit hook without setup.
- **Arrays are ordered.** Only object keys are sorted — array elements never are. Test fixtures rely on order (a chat-thread mock has messages in chronological order). The diagnoser cannot propose array-element sorting under any pretext.
- **`trim` mode descends only into `artifacts.*` subtrees.** Top-level keys (`$.messages`, `$.thread.*`, anything sibling to `messages` reached without crossing an `artifacts` ancestor) are off-limits. The trimmer tracks ancestry and refuses to trim arrays under protected roots unless they sit inside a nested `artifacts` key. The diagnoser cannot propose extending `trim` to top-level conversation arrays under any pretext.
- **`trim` mode preserves array order.** Always keep the first N entries in source order. Never sort, shuffle, or sample. Test fixtures rely on order; randomised selection would create non-reproducible diffs.
- **`trim` mode never modifies strings.** Not `content`, not panel descriptions, not tool arguments, not any string field anywhere in the document. The mode is array-cardinality only. String truncation is reserved for `shrink` mode (which requires explicit user opt-in and a separate `--max-string` threshold). The diagnoser cannot propose adding any string-touching code path to `trim` under any pretext.
- **`trim` mode uses a strict allowlist of data-point parent keys.** There is no `default` fallback budget. Adding a `default` fallback would risk silently trimming structural arrays (e.g. `panels`, `widgets`, `queries`) that fixture consumers need intact. New parent keys must be opted in via the allowlist constant or the `--max-array` CLI flag — never via a wildcard. The diagnoser cannot propose adding a default-budget fallback under any pretext.
- **`trim` preserves source indentation.** The script detects the input file's indentation (tab vs N-space) and renders with the same indent. Trim is not allowed to silently re-indent a file; that is `normalize` mode's job. Running `trim` on a file with zero in-budget arrays must produce a true byte-equal no-op.
- **Top-level `len($.messages)` is invariant under `trim`.** The script asserts pre/post equality and exits 3 on mismatch. The diagnoser cannot propose weakening this to a "soft warning."

---

## Artifacts

| File pattern                                | Produced by                          | When                                                  |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| stdout (drift report)                       | `scripts/diff-shapes.py`             | `analyze` mode (default)                              |
| stdout (JSON drift summary)                 | `scripts/diff-shapes.py --json`      | `analyze --json` mode                                 |
| `<path>` (rewritten in place)               | `scripts/normalize.py --in-place`    | `normalize` mode                                      |
| `<path>` (rewritten in place)               | `scripts/shrink.py --in-place`       | `shrink` mode                                         |
| `<path>` (rewritten in place)               | `scripts/trim.py --in-place`         | `trim` mode                                           |
| stderr (one-line size delta)                | `normalize.py` / `shrink.py` / `trim.py` | After any successful rewrite                          |

This skill produces **no persistent artifact under `.agent/`**.
Diagnosis relies on the transcript, the stdout drift report (which the user can capture by redirection), and `git diff` of the rewritten fixture files.
A skill with no artifact trail is harder to diagnose — the report should call that out explicitly when the failure is post-rewrite (e.g. "user discovered the regression hours later, no captured drift report available").

---

## Validators

Local commands the diagnoser can run after `--apply` to confirm the change did not break the skill:

- `python3 skills/testing/optimize-mock-data/scripts/shape.py <file> --sha256` — verify shape extraction still produces a deterministic hash on a known fixture (sha256 must match a pre-recorded value).
- `python3 skills/testing/optimize-mock-data/scripts/diff-shapes.py <dir>` against a curated single-cluster fixture set — must exit 0 and report "None — every file shares the reference shape."
- `python3 skills/testing/optimize-mock-data/scripts/normalize.py --in-place <file> && python3 skills/testing/optimize-mock-data/scripts/normalize.py --in-place <file>` — second invocation must print "no changes needed" to stderr.
- `python3 skills/testing/optimize-mock-data/scripts/shrink.py --in-place --max-string 200 <file> && python3 skills/testing/optimize-mock-data/scripts/shrink.py --in-place --max-string 200 <file>` — second invocation must report `0 truncated` (idempotency).
- Round-trip canary: pick any fixture with a long protected `*Id` field, run `shrink.py --max-string 50`, confirm the id is unchanged.
- `python3 skills/testing/optimize-mock-data/scripts/trim.py --in-place <file> && python3 skills/testing/optimize-mock-data/scripts/trim.py --in-place <file>` — second invocation must print `no changes` to stderr (idempotency).
- Message-count canary: capture `len($.messages)` before `trim.py`, run it, capture after — must be equal.
- Content-immutability canary: for any fixture, snapshot every `$.messages[*].content` string before `trim.py`, run it, snapshot after — every string must be byte-identical.
- Order canary: snapshot `messages[0].id` before `trim.py`, run it, snapshot after — must be unchanged (first-entry preservation).
- Indent canary: run `trim.py` on a tab-indented fixture with zero in-budget arrays — output must be byte-equal to input (no tab→space drift).
