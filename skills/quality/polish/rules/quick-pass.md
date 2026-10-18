# Pass C — `quick` (mode: quick only)

Load when the resolved mode is `quick`.

The light mechanical pass. Invoke code-quality in **review** mode against the branch diff, then auto-apply only the mechanical subset:

```
Skill("code-quality", "review")
```

**Auto-apply** a finding only when it meets **all three**:

- Footprint stays inside files already in the branch diff (no new files, no edits outside the diff).
- The fix is mechanical, not a judgment call: removing/rewriting a plain inline comment that explains WHAT or references the current task; renaming a local variable to a domain noun; dropping `else` after `return`/`throw`; extracting a magic number to a named constant; deleting unreachable/dead code introduced on this branch; flipping a single guard clause to an early return.
- The fix does not change behaviour observable from a test or a caller.

**Docstring / JSDoc / TSDoc / Python-docstring blocks attached to a function, method, class, type, or exported constant are a special case.**
Never delete the block as noise removal — IDE hover, type strippers, and doc generators read it.
Instead apply code-quality recipe **R35 step 4**: trim verbose prose to a one-sentence summary plus the structured tags (`@param`, `@returns`, `@throws`, `@deprecated`, `@since`, `@example`, `@see`, `@internal`, `@experimental`).
Keep the summary line and every contract-bearing tag; drop only the restated-WHAT prose.
If the block would be empty after trimming, surface it as a judgment-required finding instead of removing it.
License / SPDX headers and linter pragmas (`eslint-disable-next-line`, `@ts-expect-error`, `# noqa`) are never removed.

**Surface but do not auto-apply** (out of scope for `quick` — that is what `simplify` is for): structural refactors, type-driven design changes, anything that expands blast radius into files outside the diff, anything where a sibling test would need updating.
