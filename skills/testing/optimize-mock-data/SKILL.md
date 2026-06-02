---
name: optimize-mock-data
description: >
  Optimizes a directory of structurally-related JSON / JSONL mock
  fixtures by inferring a shared schema, detecting structural drift
  between files, normalizing formatting and key order, and optionally
  shrinking verbose payloads while preserving shape. Use when fixture
  files have grown inconsistent (mixed tabs / 2-space indent,
  reordered keys, fields present in some files but missing from
  others, megabyte-sized payloads), when adding a new mock that must
  match an existing set, or when preparing fixtures for a
  storage-cost-sensitive context. Three modes — `analyze` (default,
  read-only), `normalize` (rewrites files in place), `shrink` (caps
  verbose string fields). Triggers on "optimize mock data",
  "normalize fixtures", "check mock structure", "audit mocks",
  "shrink test fixtures", "are these mocks consistent",
  "/optimize-mock-data".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - mock-data
    - fixtures
    - json
    - schema-inference
    - normalization
    - drift-detection
    - testing
    - token-economics
---

# Optimize Mock Data

Audit and normalize a set of related JSON (or JSONL) mock fixtures so
every file shares the same shape, formatting, and verbosity budget.
Pure shape work — never touches semantics or business values unless
the user explicitly asks for `shrink`.

> **This `SKILL.md` is a thin index.** Detailed rules live in
> `rules/*.md` and load on demand. Reusable Python scripts live in
> `scripts/*.py` and run via `Bash`. Worked example output lives in
> `references/example-report.md`.

---

## Mode Detection

Parse `$ARGUMENTS` as `<mode> <path> [flags]` where `<mode>` is one of
`analyze`, `normalize`, `shrink`. If the first token is a path
(starts with `/`, `./`, or `~`) treat it as `<path>` and default
`<mode>` to `analyze`.

| Mode        | Default | Trigger                                                                | Side effect                       |
| ----------- | ------- | ---------------------------------------------------------------------- | --------------------------------- |
| `analyze`   | **yes** | `analyze`, `audit`, `check`, `report`, or first arg is a path          | Read-only report                  |
| `normalize` |         | `normalize`, `fix`, `format`, `reorder`                                | Rewrites files                    |
| `shrink`    |         | `shrink`, `shorten`, `truncate-strings`                                | Rewrites files (string truncation) |
| `trim`      |         | `trim`, `trim-arrays`, `cardinality`, `reduce-arrays`, `compact`, `slim` | Rewrites files (array entry reduction; never modifies strings) |

State the detected mode, target path, and file count in one line
before continuing:

```
Mode: analyze
Target: components/ui/src/agent0/mocks/ (22 files)
```

---

## Workflow

A four-phase pipeline. Each phase has a gate; do not proceed until it
passes.

| Phase | Name              | Rule file                                                            | Gate                                              |
| ----- | ----------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| 0     | Resolve corpus    | —                                                                    | Target resolved to ≥ 2 JSON files                 |
| 1     | Shape extraction  | [`rules/shape-extraction.md`](./rules/shape-extraction.md)           | Each file has a shape fingerprint                 |
| 2     | Drift detection   | [`rules/drift-detection.md`](./rules/drift-detection.md)             | Drift report produced (or "no drift")             |
| 3     | Apply (mode-gated)| [`rules/shrink-policy.md`](./rules/shrink-policy.md) (shrink only)   | Rewrites pass round-trip parse; `analyze` skips   |

### Phase 0 — Resolve corpus

1. If `<path>` is a directory: glob `**/*.json` and `**/*.jsonl`
   (exclude `node_modules/`, `dist/`, `.next/`, `coverage/`).
2. If `<path>` is a single file: include it **plus all siblings
   matching the same basename pattern** — e.g.
   `invoke-agent-artifacts-dashboards-4.json` expands to
   `invoke-agent-artifacts-dashboards*.json` in the same directory.
   The user almost always means "this file and its peers".
3. If fewer than 2 files resolve, halt — single-file optimization is
   `npx prettier --write` territory, not this skill's job.

State the resolved corpus before continuing:

```
Resolved 4 peer files for invoke-agent-artifacts-dashboards-4.json:
  - invoke-agent-artifacts-dashboards.json
  - invoke-agent-artifacts-dashboards-2.json
  - invoke-agent-artifacts-dashboards-3.json
  - invoke-agent-artifacts-dashboards-4.json
```

### Phase 1 — Shape extraction

Run [`scripts/shape.py`](./scripts/shape.py) on each file. Each file
gets a deterministic **shape fingerprint** — a sorted, recursive type
signature where:

- Object keys are sorted alphabetically.
- Values become their type (`string`, `number`, `boolean`, `null`,
  `object{...}`, `array[T]`).
- Heterogeneous arrays collapse to `array[union[T1, T2, ...]]`.
- Leaf string values are **not** in the signature — only types.

See [`rules/shape-extraction.md`](./rules/shape-extraction.md) for the
algorithm, the optionality rules, and the JSON Schema mapping.

### Phase 2 — Drift detection

Run [`scripts/diff-shapes.py`](./scripts/diff-shapes.py) over every
fingerprint pair. Cluster files by fingerprint. For each cluster:

- **Majority cluster** (the most common shape) becomes the reference.
- **Outlier clusters** are reported as drift, scored by edit distance.
- For each outlier, list the **key paths** that differ (`messages[].userId`
  present in 18 files, missing in 4).

Output the drift report — see
[`rules/drift-detection.md`](./rules/drift-detection.md) for the
report format and severity rubric. The exact format used in
`analyze` mode is in
[`references/example-report.md`](./references/example-report.md).

### Phase 3 — Apply (mode-gated)

| Mode        | What Phase 3 does                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `analyze`   | **Stop after Phase 2.** Emit the drift report. Do not write files.                                                |
| `normalize` | Run [`scripts/normalize.py`](./scripts/normalize.py) per file: 2-space indent, sorted keys (configurable), trailing newline, LF line endings. Optional `--fill-missing null` adds missing-but-expected keys as `null`. |
| `shrink`    | Run [`scripts/shrink.py`](./scripts/shrink.py) per file: truncates string fields above the threshold per [`rules/shrink-policy.md`](./rules/shrink-policy.md). **Refuses to shrink fields named `id`, `hash`, `actionId`, `threadId`, `userId`, or anything matching `*Id$`.** |
| `trim`      | Run [`scripts/trim.py`](./scripts/trim.py) per file: caps the length of arrays of data points (`webEvents`, `logRecords`, `dataPoints`, `series`, `attributes`, `catalog`, …) nested inside `artifacts.*` subtrees, preserving order. **Strict allowlist of parent keys — no default fallback, so structural arrays (`panels`, `widgets`, `queries`) stay intact.** **Never modifies any string under any condition — `content` and every other string field round-trip byte-identical.** Preserves source indentation. See [`rules/trim-policy.md`](./rules/trim-policy.md). |

After every write, re-parse the file to verify it is still valid JSON
and re-run Phase 1 against the corpus. If post-rewrite drift is worse
than pre-rewrite drift, **revert all writes and halt** — this means
the scripts have a bug or the policy is wrong for this corpus.

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                                              |
| ----- | ---------------------------------------------------------------------------------- |
| 1     | [`rules/shape-extraction.md`](./rules/shape-extraction.md)                         |
| 2     | [`rules/drift-detection.md`](./rules/drift-detection.md)                           |
| 3     | [`rules/shrink-policy.md`](./rules/shrink-policy.md) (shrink mode only), [`rules/trim-policy.md`](./rules/trim-policy.md) (trim mode only) |

Worked output examples in
[`references/example-report.md`](./references/example-report.md) are
optional — load only when the user asks "what does the report look
like?".

---

## Reusable scripts

All scripts are pure Python 3 with stdlib only. No `pip install`
required. They read from stdin or paths, write to stdout, and exit
non-zero on shape-validation failure. Run them from the repo root.

| Script                                                       | One-liner                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| [`scripts/shape.py`](./scripts/shape.py)                     | Emit a JSON shape fingerprint for a file.                   |
| [`scripts/diff-shapes.py`](./scripts/diff-shapes.py)         | Cluster files by fingerprint and report drift.              |
| [`scripts/normalize.py`](./scripts/normalize.py)             | Rewrite a file with canonical formatting + key order.       |
| [`scripts/shrink.py`](./scripts/shrink.py)                   | Truncate verbose string fields above a configurable budget. |
| [`scripts/trim.py`](./scripts/trim.py)                       | Cap arrays of data points inside `artifacts.*` subtrees. Never modifies strings. |

Invocation pattern (run from the repo root, scripts are relative to
this skill directory):

```bash
SKILL_DIR="$HOME/.claude/skills/optimize-mock-data"
python3 "$SKILL_DIR/scripts/shape.py" path/to/mock.json
python3 "$SKILL_DIR/scripts/diff-shapes.py" path/to/mocks/
python3 "$SKILL_DIR/scripts/normalize.py" --in-place path/to/mock.json
python3 "$SKILL_DIR/scripts/shrink.py" --max-string 200 --in-place path/to/mock.json
python3 "$SKILL_DIR/scripts/trim.py" --in-place path/to/mock.json
```

---

## Core Principles

1. **Shape, not semantics.** This skill normalizes structure and
   formatting. It never edits business values (the `content` of a
   message, the `name` of a thread) unless `shrink` is explicit.
2. **Majority wins.** When clusters disagree, the largest cluster is
   the reference. Tie-breaker is the most recently modified file.
3. **Round-trip safety.** Every rewritten file must parse back into
   the same Python object after canonicalization. If not, revert.
4. **Idempotent.** Running `normalize` twice changes nothing the
   second time. Running `shrink` twice with the same threshold
   changes nothing the second time.
5. **No network, no deps.** Scripts use stdlib only so they run in
   any sandbox, CI, or pre-commit hook.

---

## Anti-patterns

- Editing the value of a field (`"role": "human"` → `"role": "user"`)
  in normalize mode. **Shape work only.**
- Sorting array elements. Arrays are ordered; only **object keys**
  are sorted.
- Truncating an `*Id` or `hash` field. Identifiers are load-bearing
  for fixture lookups even in tests.
- Treating a `.jsonl` file as a single JSON document. JSONL is
  newline-delimited; each line is a separate fingerprint.
- Inferring a schema from one file. Need ≥ 2 to detect drift.
- Trimming arrays outside `artifacts.*`. Top-level conversation
  arrays (`$.messages`, `$.thread.*`) are off-limits to `trim`.
  **`trim` only descends into `artifacts.*` subtrees.**
- Trimming a structural array (`panels`, `widgets`, `queries`).
  Those describe the dashboard's shape, not data points. The
  allowlist is strict by design — do not add a `default` fallback
  budget that would catch them.
- Modifying any string inside `trim`. The mode is array-cardinality
  only. `content`, panel descriptions, tool arguments — every
  string round-trips byte-identical. Use `shrink` if string
  truncation is wanted.

---

## Definition of Done

- [ ] Corpus resolved to ≥ 2 files with a state line printed.
- [ ] Every file has a fingerprint.
- [ ] Drift report produced (clusters listed, outlier key paths
      enumerated, severity assigned).
- [ ] If `normalize` or `shrink`: every rewritten file re-parses and
      post-rewrite drift ≤ pre-rewrite drift.
- [ ] Final one-line summary: `N files / M clusters / K drift sites
      (severity HIGH/MED/LOW)`.

---

## Diagnosable

This skill declares a diagnostic surface at
[`rules/diagnostic-surface.md`](./rules/diagnostic-surface.md) — phase
model, failure taxonomy (F-novel-seeded), existing-guards table, and
hard invariants. Run `/create-skill diagnose optimize-mock-data` after
a failed or unsatisfactory run to get a confidence-gated unified diff
that hardens the skill against the same failure class.
