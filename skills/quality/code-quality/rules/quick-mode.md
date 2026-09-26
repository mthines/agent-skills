---
title: Quick mode — light mechanical cleanup of a branch diff
impact: MEDIUM
tags:
  - quick
  - mechanical
  - comments
  - naming
  - dead-code
---

# Quick mode

`Skill("code-quality", "quick")` is the lightest pass this skill runs: the review pass over the
branch diff, then **auto-apply only the mechanical subset** — comments, local names, dead code,
trivial control flow. No structural refactor, no confidence gate, no reviewer.
Use `simplify` when the change deserves Class M refactors behind the confidence gate.

It replaced `polish quick` when the `polish` wrapper was removed; the rules below are that pass,
unchanged in substance.

## Procedure

1. Scope to the branch diff: `git diff --name-only "$(git merge-base HEAD origin/HEAD)"...HEAD`.
   An empty or non-code-only diff (docs, lockfiles, generated files, binary assets — judged from
   the file list) ends the pass with `quick: nothing to do (<reason>)`.
2. Run the review pass ([`procedure.md`](./procedure.md) § review) over those files.
3. Auto-apply a finding only when it meets **all three**:
   - Its footprint stays inside files already in the branch diff — no new files, no edits outside
     the diff.
   - The fix is mechanical, not a judgement call: removing or rewriting a plain inline comment that
     explains WHAT or references the current task; renaming a local variable to a domain noun;
     dropping `else` after `return`/`throw`; extracting a magic number to a named constant;
     deleting unreachable or dead code introduced on this branch; flipping a single guard clause to
     an early return.
   - The fix changes no behaviour observable from a test or a caller.
4. Surface everything else as a finding, unapplied: structural refactors, type-driven design
   changes, anything that widens the blast radius past the diff, anything whose sibling test would
   need updating.

**Docstring / JSDoc / TSDoc / Python-docstring blocks are a special case.** Never delete one as
noise — IDE hover, type strippers, and doc generators read it. Apply
[`refactor-recipes.md`](./refactor-recipes.md) recipe **R35 step 4** instead: trim verbose prose to
a one-sentence summary plus the contract-bearing tags (`@param`, `@returns`, `@throws`,
`@deprecated`, `@since`, `@example`, `@see`, `@internal`, `@experimental`). If the block would be
empty after trimming, surface it rather than remove it. License / SPDX headers and linter pragmas
(`eslint-disable-next-line`, `@ts-expect-error`, `# noqa`) are never removed.

```text
❌ WRONG — structural, outside quick's contract
extract a shared helper from two files and update both call sites

✅ RIGHT — mechanical, inside one diffed file, no observable change
if (!user) { return null; } else { return render(user); }  →  if (!user) return null; return render(user);
```

## It does not commit

Like `simplify`, quick mode edits the working tree and stops. The **caller** owns the commit, so
the change stays revertible as its own unit:

```bash
git diff --quiet || { git add -u && git commit -m "chore: code-quality quick pass (comments, naming, dead code)"; }
```

## Report

```text
code-quality quick on <branch>
  Applied:  <one line per mechanical fix, or "none">
  Surfaced: <one line per finding left for a human, or "none">
```

## Hard rules

- Never weaken a test, a lint rule, or a type to make the diff look clean.
- Never change a public API or an exported type — always a surfaced finding.
- Never stash, reset, or discard uncommitted work.
- One pass per invocation; do not loop.
