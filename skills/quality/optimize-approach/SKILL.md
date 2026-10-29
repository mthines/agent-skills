---
name: optimize-approach
description: >
  Judges whether a change or plan takes the best approach for its intent
  (codebase-fit, simplicity, performance, robustness) and proposes at most two
  materially better ones; says nothing when the approach is already sound.
  Slash-invoked: "/optimize-approach [<files>|<plan path>]".
disable-model-invocation: true
argument-hint: '[<files> | <plan.md path>] [--base <ref>]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: advisory
  tags: [review, optimality, approach, reuse, simplicity]
---

# Optimize approach

Answer one question: is this the best **approach** for what the change is trying to do — and if not, what is?
Judge the shape of the solution, not its lines.
Report only; never edit files.

Lens-eligible for the `pr-reviewer` agent: [`lens.md`](./lens.md) auto-loads on `deep` reviews.

## Step 0 — Scope

1. Target: the named files or `plan.md`; else the branch diff (`git diff <base>...HEAD`, base default `origin/main`).
2. Intent: one or two lines from the plan, the PR title and body, or the commit messages.
3. Split the target into **approach units** — one cohesive way of solving one sub-goal. Judge each unit separately.
4. Read every unit in full, plus its callers and any existing utility or pattern an alternative would reuse (`grep` before you claim one exists).

## Step 1 — Score the four axes

| Axis | A better approach would… | Look for |
| --- | --- | --- |
| Codebase-fit | reuse a utility, hook, or pattern the change reinvents | a hand-rolled helper duplicating an export; a bespoke pattern next to a shared one |
| Simplicity | remove a structural layer the goal does not need | a class where a function suffices; premature generality; needless indirection |
| Performance | change complexity or cut work the current shape forces | O(n²) where O(n) is natural; per-item queries where one batch works |
| Robustness | pick a shape that cannot hit a failure class the current one invites | invariants kept by hand that a type or DB constraint would enforce; a race the shape allows |

No axis fires → the unit is `optimal`.

## Step 2 — Drop what another lens owns

Drop the candidate (the unit stays `optimal`) when any of these holds:

1. **Mechanical tidy** — a rename, guard-clause flip, dead-code removal, or constant extraction. That is `/polish`.
2. **Failure mode without a better shape** — "this could fail because X" with no approach that structurally avoids X. That is `/critical`.
3. **Wrong behaviour** — the change does not do what it claims, or breaks a caller. That is a review finding, not an approach.
4. **Taste** — the alternative is equally good, just different.

## Step 3 — The materiality bar

Propose only when the alternative is all three:

- **Material** — a namable win: a reused util, a complexity class dropped, a race removed.
- **Grounded** — stated in two sentences with `file:line` evidence you read, not a guess.
- **Worth the switch** — the win outweighs the blast radius of changing approach now.

When in doubt, say nothing: silence on a sound approach costs nothing; a weak "better way" costs trust.

```text
✗ Wrong — "`const timeoutMs = 5000` could be a named constant"     (mechanical tidy → /polish)
✓ Right — "src/api/client.ts:40 adds retryWithBackoff; src/lib/retry.ts:12 already exports
          withRetry with the same semantics. Reuse it: one call site, removes a duplicate."
```

## Output

At most two proposals, strongest first.
Every unit `optimal` → print exactly `Approach: optimal — no materially better approach found.` and stop.

```markdown
### <unit> — <axis>
**Now:** <the current approach, one line, with file:line>
**Better:** <the alternative, one or two lines, with the file:line it reuses or the constraint it relies on>
**Why it wins:** <the material gain>
**Cost:** <files touched, risk>
```
