# UX Review Report Template

Use this structure for every review output.

````
## UX Review: [Component/File Name]

**Platform**: Web | React Native (iOS) | React Native (Android) | Cross-platform
**Files reviewed**: [list with paths]
**Rules applied**: [core-principles, accessibility, visual-design, etc.]

---

### Critical (must fix — blocks users or breaks accessibility)

1. **[file:line]** — [Short finding title]
   - **Principle**: [e.g., WCAG 2.2 SC 2.5.8 Target Size, Fitts's Law]
   - **Issue**: [What's wrong and why it hurts UX]
   - **Fix**:
   ```tsx
   // suggested code change
   ```

### High (should fix — significant UX degradation)

[same structure]

### Medium (recommended — missed best practice)

[same structure]

### Low (nice to have — polish and delight)

[same structure]

---

### UX Writing Review

| Location | Current Copy | Issue | Suggested Copy |
|----------|-------------|-------|----------------|
| [file:line] | "Submit" | Generic, doesn't describe action | "Create account" |

---

### Positive Patterns

- [Things the code already does well — reinforce good practices]

---

### Summary

[1-2 sentence overall assessment]
**Top priority**: [single most impactful change to make first]
````
