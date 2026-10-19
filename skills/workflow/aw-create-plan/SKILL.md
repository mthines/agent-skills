---
name: aw-create-plan
description: >
  Writes the plan artifact in `.agent/{branch}/` — `plan.md` as a brief (task, guardrails,
  definition of done, turn cap, file changes) plus `checks.yaml`, its executable acceptance
  checks, sealed for `run-checks.mjs`. Use after planning and on every plan iteration;
  triggers on create plan, write plan artifact, regenerate plan, iterate on plan.
license: MIT
disable-model-invocation: false
argument-hint: '[snapshot]'
metadata:
  author: mthines
  version: '3.0.0'
  workflow_type: advisory
---

# Create Plan Artifact

Write `.agent/{branch}/plan.md` — the brief the executor runs from cold — and `.agent/{branch}/checks.yaml`, the executable Definition of Done.
A new session must be able to execute from `plan.md` alone; keep everything else out of it.

## Contents

- [Modes](#modes)
- [Prerequisites](#prerequisites)
- [Procedure](#procedure)
- [The brief (Core)](#the-brief-core)
- [checks.yaml](#checksyaml)
- [Validation](#validation)
- [Common failures](#common-failures)

## Modes

| Arg | Mode | Writes |
| --- | --- | --- |
| empty, or a full `plan.md` body (as `/fix-bug` passes) | default | `plan.md`, `checks.yaml`, `checks.lock` |
| exactly `snapshot` / `--snapshot` | snapshot | the above plus an immutable `plan.v{N}.md` |

Snapshot mode: [`rules/snapshot-mode.md`](rules/snapshot-mode.md) — read when the arg is exactly `snapshot` or `--snapshot`.

## Prerequisites

1. Phase 0 is complete: requirements confirmed with the user.
2. Phase 1 is complete: the codebase is analyzed and the approach chosen.
3. The worktree exists — write inside it, never on `main`.

## Procedure

### Step 1: Resolve paths

```bash
BRANCH=$(git branch --show-current)
DIR=".agent/${BRANCH}"
mkdir -p "${DIR}"
echo "PLAN=${DIR}/plan.md CHECKS=${DIR}/checks.yaml"
```

Never hardcode or guess the branch name.
Read the existing `version:` from `plan.md` when it exists; the new write uses that value plus 1, or `1` on a fresh plan.

### Step 2: Write `plan.md`

1. Write the Core brief per [The brief (Core)](#the-brief-core) — always, in that order.
2. On a Full-tier plan, or when File Changes has a `create` row, add Extended sections per [`rules/extended-sections.md`](rules/extended-sections.md) — read when the tier is Full or a `create` row exists.
3. On an iteration, append a Progress Log entry naming the new version: `- [{TIMESTAMP}] Phase 4: plan version 3 written (auto-replan after re-trace)`.

### Step 3: Derive and seal `checks.yaml`

Write one entry per `AC-{n}` per [checks.yaml](#checksyaml), then seal the immutable fields:

```bash
node "${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}/scripts/run-checks.mjs" "${DIR}/checks.yaml" --seal
```

`AW_SKILL_DIR` is the directory `Skill("autonomous-workflow")` loaded from.
Re-derive and re-seal on every iteration; statuses reset to `pending`.
Skip `checks.yaml` only when the caller authors a plan whose criteria carry no `AC-{n}` IDs (the `/fix-bug` fast lane, whose repro contract fills this role).

### Step 4: Validate

Run [Validation](#validation) and fix every failure before returning.

## The brief (Core)

All timestamps are ISO 8601 with time: `2026-03-07T14:30:00Z`, never `2026-03-07`.

````markdown
---
created: {TIMESTAMP}
version: {N}
branch: {BRANCH}
task: {TASK_DESCRIPTION}
tier: {Lite | Full}
complexity: {LOW | MEDIUM | HIGH}
turn_cap: {N}
status: approved
approved: true
---

# Plan: {TASK_DESCRIPTION}

## Task

{1–3 sentences: what changes, why, and what a reviewer will see when it is done.}

## Requirements

1. {requirement} — [user-stated | inferred]

### Out of Scope

1. {item} — {reason}

## Guardrails

Every file not listed in File Changes is out of bounds.

- Do not modify: `{path or glob}` — {why}
- Keep unchanged: {public API, behaviour, output format, or config} — {why}
- Never: {forbidden move, e.g. weaken or skip a test, add a dependency, edit checks.yaml definitions}

## Acceptance Criteria (Definition of Done)

- [ ] AC-1 (covers: R1) — When {trigger}, the system shall {observable response}.
- [ ] AC-2 (covers: R2) — {concrete, testable criterion}

- **After editing**: `{fast check, e.g. pnpm tsc --noEmit}`
- **Before PR**: `{full suite, e.g. pnpm test && pnpm lint}`

Done when `run-checks.mjs` prints `CHECKS {M}/{M} PASS (<sha>)` and the draft PR URL is printed.

## Turn Cap

{N} turns — {why this budget}.

## File Changes

| Action | File   | Change                  | Reason |
| ------ | ------ | ----------------------- | ------ |
| create | {path} | {purpose / key exports} | {why}  |
| modify | {path} | {specific change}       | {why}  |
````

Section rules:

| Section | Rule |
| --- | --- |
| Task | 1–3 sentences a reviewer can agree or disagree with in under a minute |
| Requirements | Numbered by position (R1, R2, …); every item tagged `[user-stated]` or `[inferred]`; Out of Scope items are not numbered |
| Guardrails | At least one concrete line besides the default; each names a path, an interface, or a forbidden move — never "be careful" |
| Acceptance Criteria | Each carries a unique `AC-{n}` and `(covers: R{m})`; every `[user-stated]` requirement is covered; prefer EARS "When …, the system shall …"; the After-editing and Before-PR commands contain no `{` `}` placeholders |
| Turn Cap | An integer from the table below, or a different integer with a one-clause reason |
| File Changes | Every file the executor may touch, docs included; nothing else may change |

| Tier | Default turn cap |
| --- | --- |
| Micro | 5 |
| Lite | 12 |
| Full | 30 |

The turn cap feeds the paste-ready `/goal` line defined in the `autonomous-workflow` skill's `rules/goal-emission.md`.

```markdown
<!-- ✗ Wrong — a guardrail nobody can check -->
- Be careful not to break anything.

<!-- ✓ Right — names the area and the reason -->
- Do not modify: `src/api/public/**` — external consumers pin this contract.
```

The two compatibility headings (`## Requirements`, `## Acceptance Criteria (Definition of Done)`) are load-bearing for `confidence(plan)` and `checks.yaml` derivation — do not rename them.
**Why:** [`references/brief-rationale.md`](references/brief-rationale.md).

## checks.yaml

```yaml
# .agent/{branch}/checks.yaml — the executable Definition of Done.
# Derived from plan.md by aw-create-plan and sealed in checks.lock.
# Executor: only `status:` may change freely; `run:`/`setup:` only with a
# check-run-amended Progress Log entry. id/requirement/ears/kind/expect are sealed.
- id: AC-1
  requirement: R1
  ears: "When the token is expired, GET /me shall return 401"
  kind: command                  # command | grep | judge
  setup: "none"                  # or a shell command that must exit 0
  run: "curl -s -o /dev/null -w '%{http_code}' localhost:3000/me -H 'Authorization: Bearer expired'"
  expect: "401"                  # exact stdout | `exit <n>` | `re:<pattern>` | `re/<flags>:<pattern>`
  status: pending                # pending | pass | fail | unsatisfiable
```

1. One entry per `AC-{n}`, same IDs as the plan, no orphans in either direction (`confidence(plan)` rule #11).
2. Pin the contract, not the implementation: `ears` and `expect` are exact; `run` is a first draft the executor may make runnable.
3. Prefer `command` and `grep`; use `judge` only where no command can decide (visual direction, copy tone). A judge check never gates alone.
4. No `{` `}` placeholders in `run:`.

```yaml
# ✗ Wrong — "works" is not checkable, and the braces never resolve
- id: AC-2
  run: "{run the tests}"
  expect: "works"

# ✓ Right — a runnable command and an exact expectation
- id: AC-2
  kind: command
  setup: none
  run: "pnpm vitest run src/auth --reporter=dot"
  expect: "exit 0"
  status: pending
```

## Validation

Every item must hold; fix failures before returning.

```bash
P=".agent/$(git branch --show-current)/plan.md"
grep -cE '^## (Task|Requirements|Guardrails|Acceptance Criteria|Turn Cap|File Changes)' "$P"   # must print 6
grep -cE '^- \[ \] AC-[0-9]+ \(covers: R[0-9]' "$P"                                           # ≥ 1
node "${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}/scripts/run-checks.mjs" --self-test
```

- [ ] Files are inside the worktree at `.agent/{branch}/`.
- [ ] Frontmatter has `created`, `version`, `branch`, `task`, `tier`, `complexity`, `turn_cap`, `status`, `approved`; `version` is exactly one above the previous value.
- [ ] The six Core headings are present, in order.
- [ ] Every Core section passes its row in the section-rules table.
- [ ] `checks.yaml` has one `pending` entry per `AC-{n}`, and `checks.lock` was written by `--seal` after the last edit.
- [ ] Extended sections are present only where [`rules/extended-sections.md`](rules/extended-sections.md) triggers them, and pass its validation table.

## Common failures

| Failure | Fix |
| --- | --- |
| Guardrails only restate "files outside File Changes" | Add the specific areas, interfaces, and moves that must not change |
| `## TL;DR` / `## Verification` written as Core sections | Use `## Task` and the commands inside Acceptance Criteria — the brief replaced them |
| Empty Extended heading or `N/A` body | Omit the section |
| AC without `AC-{n}` or `covers:` | Add both — rule #9 fails on an uncovered `[user-stated]` requirement |
| `create` row without an Existing Code Survey | Run the reuse searches and add the section — rule #10 |
| `checks.yaml` edited after sealing | Re-run `--seal`; the runner fails every check whose sealed fields changed |
| Runner prints `CHECKS 0/0 FAIL: checks.lock missing` | Step 3 skipped `--seal`; re-derive and seal — the runner refuses an unsealed `checks.yaml` (exit 2) |
| Most checks are `kind: judge` | Rewrite the criteria toward EARS trigger→response so a command decides them |
