# Fix Mode — auto-fix after the assessment

Read this only when the arguments contain `fix` (`plan fix`, `code fix`, `analysis fix`, or the deprecated `bug-analysis fix` alias).
After the assessment in [`SKILL.md`](../SKILL.md), address every concern that lowered the score.

## Simple fixes (apply immediately)

Fix these without asking — they are low-risk and mechanical:

- Missing edge case handling with obvious implementation
- Missing null/undefined checks
- Off-by-one errors or incorrect boundary conditions
- Typos in strings, comments, or variable names
- Missing return types or type annotations where the type is clear
- Small logic errors with an unambiguous correction
- (plan mode) Missing sections, incomplete requirements, vague implementation steps

After each fix, note what changed in one line.

## Complex fixes (plan, then apply)

For issues requiring more thought:

- Missing test coverage for uncovered paths
- Incomplete implementations (missing cases, unhandled states)
- Architectural concerns or incorrect abstractions
- (plan mode) Fundamental approach issues, missing technical design

For each, output this block, then execute the plan:

```
### [Issue title]
**Why:** [1-sentence explanation]
**Fix plan:**
1. [Step 1]
2. [Step 2]
**Files involved:** [list]
```

## Post-fix re-assessment

1. Re-run the confidence assessment with updated scores.
2. List what was fixed and how each fix moved the score.
3. If confidence is still below 90%, list the remaining concerns that could not be auto-fixed.
