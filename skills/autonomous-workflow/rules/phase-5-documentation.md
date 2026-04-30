---
title: 'Phase 5: Documentation'
impact: MEDIUM
tags:
  - documentation
  - phase-5
  - update-claude
---

# Phase 5: Documentation

## Overview

Bring the project's documentation in sync with the changes made in Phase 3 — README, CHANGELOG, API docs, and project-level agent guidance (`CLAUDE.md` and `.claude/rules/`). The phase ends with a mandatory `update-claude` invocation that closes the self-improving doc loop so future autonomous runs start with sharper context.

Gate: documentation reflects the changes; `Skill("update-claude")` has run.

## Core Principles

- **Document user-facing changes**: README, guides, examples that a new user would search for.
- **Update CHANGELOG**: every change gets an entry.
- **Test code examples**: examples must actually compile/run.
- **Read as a new user**: validate clarity before moving on.
- **Always close the doc loop**: `update-claude` runs in both Full and Lite Mode.

## Procedure

### Step 1: Identify Documentation Needs

| Change Type         | Documentation                          |
| ------------------- | -------------------------------------- |
| User-facing feature | README, user guides                    |
| API changes         | JSDoc/TSDoc, API reference             |
| Configuration       | Config docs, setup instructions        |
| Breaking changes    | CHANGELOG, migration guide             |
| Agent-relevant      | `CLAUDE.md`, `.claude/rules/*`         |
| All changes         | CHANGELOG entry                        |

### Step 2: Update README (If Applicable)

```markdown
### Dark Mode

The app now supports dark mode!

#### Using the UI

Click the theme toggle in the navigation bar.

#### Programmatically

\`\`\`typescript
import { useTheme } from '@/contexts/ThemeContext';

function MyComponent() {
  const { theme, setTheme } = useTheme();
  setTheme(theme === 'light' ? 'dark' : 'light');
}
\`\`\`
```

**Validation:**

- Is it clear how to use the feature?
- Are code examples correct?
- Is it easy to find?

### Step 3: Update API Documentation

```typescript
/**
 * Theme context providing theme state and controls.
 *
 * @example
 * \`\`\`tsx
 * const { theme, setTheme } = useTheme();
 * \`\`\`
 */
export function useTheme(): ThemeContextValue {
  // ...
}
```

### Step 4: Update CHANGELOG

```markdown
## [Unreleased]

### Added

- Dark mode toggle in navigation bar (#123)
  - Respects system preference
  - Persists user choice to localStorage

### Changed

- Theme context exported from `@/contexts/ThemeContext`
```

### Step 5: Self-Validation

Read your documentation with fresh eyes:

| Check         | Question                                          |
| ------------- | ------------------------------------------------- |
| Clarity       | Can a new user understand this without context?   |
| Completeness  | Are all new features and edge cases documented?   |
| Accuracy      | Do code examples actually run? Paths correct?     |
| Consistency   | Does style/tone match existing docs?              |

### Step 6: Commit Documentation

```bash
git add README.md CHANGELOG.md docs/
git commit -m "docs(feature): document dark mode toggle

- Add usage examples to README
- Update CHANGELOG
- Document theme context API"
```

## Claude MD Trigger

ALWAYS invoke `update-claude` at the end of Phase 5. This is the always-on self-improving doc loop — it keeps `CLAUDE.md` and `.claude/rules/` aligned with what the code now does, so future autonomous runs (and other agents working in this repo) start with better context instead of stale guidance.

```
Skill("update-claude")
```

| Property                   | Value                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| Runs in Full Mode          | Yes                                                                  |
| Runs in Lite Mode          | **Yes** — small changes still drift docs; the loop must stay closed  |
| Skips silently if missing  | Yes — if companion is not installed, log and continue                |
| Disable                    | Remove this section (not recommended; breaks the self-improving loop)|

After invocation, log to the `plan.md` Progress Log (Full Mode) or in-conversation (Lite Mode):

```markdown
- [TIMESTAMP] Phase 5: update-claude — invoked (CLAUDE.md and 2 rule files updated)
```

If the companion is not available:

```markdown
- [TIMESTAMP] Phase 5: update-claude — not available, continuing
```

If `update-claude` modifies files, commit them in a follow-up commit:

```bash
git add CLAUDE.md .claude/rules/
git commit -m "docs(claude): sync agent guidance with feature changes"
```

## Documentation Checklist

- [ ] Documentation scope identified
- [ ] README updated (if applicable)
- [ ] API docs updated (if applicable)
- [ ] CHANGELOG entry added
- [ ] Code examples tested
- [ ] Self-validated for clarity
- [ ] Style consistent with project
- [ ] `Skill("update-claude")` invoked (or logged as not available)
- [ ] Any `update-claude` changes committed
- [ ] Ready for PR creation

**Update Progress Log (Full Mode):**

```markdown
- [TIMESTAMP] Phase 5: Documentation updated (README, CHANGELOG, CLAUDE.md)
```

## References

- Related rule: [phase-4-testing](./phase-4-testing.md)
- Related rule: [phase-6-pr-creation](./phase-6-pr-creation.md)
- Companion registry: [companion-skills.md](./companion-skills.md)
- Related skill: [update-claude](../../update-claude/SKILL.md)
