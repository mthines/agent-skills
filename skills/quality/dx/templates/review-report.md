# DX Review Report Template

Use this structure for every review output.

````
## DX Review: [Tool/Script Name]

**Type**: Compiled CLI | Shell Script | Build Tool | Hybrid
**Files reviewed**: [list with paths]
**Rules applied**: [core-principles, error-handling, output-and-formatting, etc.]

---

### Critical (must fix — blocks usage, security risk, or causes data loss)

1. **[file:line]** — [Short finding title]
   - **Principle**: [e.g., clig.dev: Error Handling, 12 Factor CLI: #3 Stderr]
   - **Issue**: [What's wrong and why it hurts DX]
   - **Fix**:
   ```bash
   # suggested code change
   ```

### High (should fix — significant DX degradation)

[same structure]

### Medium (recommended — missed best practice)

[same structure]

### Low (nice to have — polish and delight)

[same structure]

---

### Developer Writing Review

| Location | Current Text | Issue | Suggested Text |
|----------|-------------|-------|----------------|
| [file:line] | "Error occurred" | Generic, no actionable guidance | "Can't read config at ~/.toolrc. Run `tool init` to create one." |

---

### Composability Review

| Check | Status | Notes |
|-------|--------|-------|
| stdout/stderr separation | ✓/✗ | |
| Exit codes correct | ✓/✗ | |
| --json output | ✓/✗/N/A | |
| Pipe-friendly output | ✓/✗ | |
| stdin support | ✓/✗/N/A | |
| Signal handling (Ctrl-C) | ✓/✗ | |
| NO_COLOR respected | ✓/✗ | |
| TTY detection | ✓/✗ | |

---

### Positive Patterns

- [Things the tool already does well — reinforce good DX practices]

---

### Summary

[1-2 sentence overall assessment]
**Top priority**: [single most impactful change to make first]
````
