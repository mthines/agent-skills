# Contract sweep (Phase 5 and before each commit)

Load at Phase 5 when an `apply` comment flags one row or cell of a table in an agent prompt doc: a parse, disposition, availability, or status table, or any table a gate reads.
The unit of repair is the whole contract, not the flagged cell: the table, every rule file that restates it, and every consumer of its values (rendering templates, status values, the steps that parse its fields).
**Why:** a fix to one cell leaves the same defect in its sibling rows and restatements, and the reviewer flags the next one on the following pass.

## Procedure

1. Read the whole table the comment points at, not only the flagged row.
2. Grep the gate's vocabulary (its field names, disposition values, status words, and count names) across `agents/` and the skill's own `rules/` and `templates/`, and list every hit.
3. Check every row and every hit against the five defects below.
4. Widen the comment's pack entry: list every file the sweep must change under **Path:Line** and add each edit to **Proposed edit**, so the one commit for this comment carries the whole repair.
5. Before the commit (worker step 3c), re-run the step 2 grep on the edited tree and confirm no hit still shows one of the five defects.

| # | Defect | Example |
| --- | --- | --- |
| a | A field set narrower than a downstream rule mandates | the parse table reads `severity, path` but a rule renders `line` too |
| b | An owning step with no parsed variable | Step 4 "decides by `status`", and no step parses `status` |
| c | A row that can never take its disposition | `resolved` is reachable only when the thread is open, and the fetch already filters open threads |
| d | An emitted count, status, or line with no slot in the rendering template | the gate emits `Answered: N` and the report template has no `Answered` column |
| e | A governing rule file still carrying a flat gate the table replaced | `validation-gates.md` still says "apply at ≥ 90 %" after the table split it by `nit` / `actionable` |

```text
# ✗ Wrong — the comment flagged the `question` row's disposition; only that cell changed
rules/resolve-all.md  | question → reply + resolve

# ✓ Right — the sweep found the same contract in three more places; one commit fixes all four
rules/resolve-all.md           | question → reply + resolve
rules/handoff.md               | step 6 lists `question` → the answer
templates/suggestion-pack.md   | Reply-only entry gains `disposition: answer`
SKILL.md § Phase 7             | report gains the `Answered` column the count is emitted into
```

## Limits

- The sweep is advisory to the gates: it widens an `apply` entry's files, and never turns a `surface` or `skip` into `apply`, never lowers a `/confidence` threshold, and never drops a `/critical` **Must-fix** override.
- A defect the sweep finds outside the flagged contract is surfaced in the Phase 7 report, not fixed.
