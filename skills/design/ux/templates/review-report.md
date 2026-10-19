# UX report template

Order findings by impact on the primary task; severity is a label on each finding.
In `plan` mode, put **Flow plan** first and the audit sections after it.

````markdown
## UX: <page or component>

**Job:** <one sentence>
**Primary task:** <step → step → step>
**Platform:** Web | React Native | Cross-platform · **Files:** <paths>

### Flow plan  <!-- plan mode only -->
1. <step> — <what the user sees, does, and needs>
2. …

### Findings (by impact on the task)

1. **Critical** — <title> · `<file:line>`
   - User experiences: <what goes wrong on the path>
   - Evidence: <handler / option / value that proves it>
   - Fix:
     ```tsx
     // concrete change
     ```

2. **Medium (unverified)** — <title> · `<file:line>`
   - Confirm by: <the check that settles it>

### Copy  <!-- when strings were reviewed -->
| Location | Current | Problem | Suggested |
| --- | --- | --- | --- |

### What works (keep)
- <pattern> · `<file:line>`

### Plan
1. <first move — the fix that unblocks the task>
2. <second>
3. <third>

### How we'll know it worked
| Item | Signal |
| --- | --- |
| <plan item 1> | <measurable signal, e.g. setup-to-first-event completion rate, filter-removal undo rate, axe violations on the page = 0> |
````
