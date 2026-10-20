---
title: 'Snapshot mode (opt-in)'
impact: LOW
tags:
  - plan
  - versioning
---

# Snapshot mode (opt-in)

Read when the arg is exactly `snapshot` or `--snapshot`.
In every other case `aw-create-plan` writes only `plan.md` and this file does not apply.

## Resolve the mode

Snapshot mode is on if and only if the trimmed arg is exactly `snapshot` or `--snapshot` (case-insensitive, one bare token).
Every other arg — empty, or a multi-line `plan.md` body such as the one `/fix-bug` passes — is default mode.

```text
✓ Skill("aw-create-plan", "snapshot")              → snapshot mode
✓ Skill("aw-create-plan", "--SNAPSHOT")            → snapshot mode
✗ Skill("aw-create-plan", "# Plan: …\n## Task …")  → default mode (a plan body, not a flag)
✗ Skill("aw-create-plan", "snapshot please")       → default mode (not one bare token)
```

## Compute the next version

```bash
BRANCH=$(git branch --show-current)
DIR=".agent/${BRANCH}"
NEXT=$(ls "${DIR}" 2>/dev/null \
  | sed -n 's/^plan\.v\([0-9][0-9]*\)\.md$/\1/p' \
  | sort -n | tail -1)
NEXT=$(( ${NEXT:-0} + 1 ))
echo "VERSIONED=${DIR}/plan.v${NEXT}.md"
```

Never hardcode or guess `N`.

## Write

1. Write `plan.md` as in default mode.
2. Write `${VERSIONED}` with content byte-identical to `plan.md`.
3. Name the snapshot in the Progress Log entry: `- [{TIMESTAMP}] Phase 1: plan.v{N}.md created — {reason}`.

## Invariants

- `plan.md` always mirrors the newest `plan.vN.md`.
- Never edit or delete an existing `plan.v*.md`, and never reuse a version number.
- Every snapshot carries the full Progress Log of the versions before it, so each file is self-contained.

**Why:** the snapshot chain is an audit trail that is rarely re-read, so it is opt-in — see [`../references/brief-rationale.md`](../references/brief-rationale.md#why-snapshots-are-opt-in).
