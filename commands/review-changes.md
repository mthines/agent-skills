---
name: review-changes
description: Review branch changes or PR for code quality, tests, documentation, and commit hygiene
---

Dispatch to the reviewer agent:

```
Agent(subagent_type: "reviewer", prompt: "Review changes. Arguments: $ARGUMENTS")
```

**Usage:**
- `/review-changes` — review and auto-fix simple issues (default)
- `/review-changes --report` — report only, no auto-fixes
- `/review-changes --comments` — review current branch's PR, propose line-level GitHub comments
- `/review-changes --comments 123` — review PR #123, propose line-level GitHub comments
- `/review-changes --report --comments` — report and propose PR comments without local fixes
