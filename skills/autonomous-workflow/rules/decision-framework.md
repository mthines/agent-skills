---
title: 'Decision Framework'
impact: HIGH
tags:
  - decisions
  - branch-naming
  - testing
  - documentation
---

# Decision Framework

## Overview

Decision trees for common autonomous workflow decisions.
Use these frameworks when making choices during execution.

## Branch Naming

```
Is this a new feature?
├─ Yes → feat/<feature-name>
└─ No ↓

Is this fixing a bug?
├─ Yes → fix/<bug-description>
└─ No ↓

Is this refactoring?
├─ Yes → refactor/<scope>
└─ No ↓

Is this documentation only?
├─ Yes → docs/<doc-name>
└─ No ↓

Is this testing only?
├─ Yes → test/<test-scope>
└─ No → chore/<tool-name>
```

**Examples:**

- `feat/dark-mode-toggle`
- `fix/login-validation-error`
- `refactor/api-client-structure`
- `docs/api-reference-update`
- `test/user-service-coverage`
- `chore/upgrade-typescript-5`

## Test Strategy Selection

```
What changed?

Pure functions/utilities?
→ Unit tests (Jest/Vitest)
→ Coverage target: >80%

React components?
→ Component tests (Testing Library)
→ Test: rendering, interactions, props

API endpoints?
→ Integration tests (supertest)
→ Test: request/response, errors

Database operations?
→ Integration tests with test DB
→ Test: CRUD, transactions

UI interactions?
→ E2E tests (Playwright/Cypress)
→ Test: user flows, critical paths
```

## Documentation Scope

```
What's the change?

New user-facing feature?
├─ README: Usage example
├─ CHANGELOG: Feature entry
└─ User guide: Detailed walkthrough

New API/function?
├─ JSDoc/TSDoc: API documentation
├─ README: Quick example
└─ API reference: Full details

Configuration change?
├─ Config docs: New options
├─ README: Updated setup
└─ Migration guide (if breaking)

Bug fix?
├─ CHANGELOG: Fixed entry
└─ Tests: Regression coverage

Internal refactoring?
└─ CHANGELOG: Technical note (optional)
```

## Iteration vs Delivery

### When to Iterate

- Tests failing → Iterate (fix and retest)
- Feature incomplete → Iterate (finish implementation)
- Code doesn't follow patterns → Iterate (refactor)
- Documentation insufficient → Iterate (improve docs)

### When to Deliver Partial Work

- Blocker requires user input
  → Commit what's done
  → Document blocker
  → Create draft PR with notes
  → Ask user for help

- External dependency unavailable
  → Implement what's possible
  → Document missing piece
  → Deliver with action items

- Fundamental approach wrong
  → Stop implementation
  → Explain issue to user
  → Request new direction

### Never Stop For

- Test failures (iterate until passing)
- Lint errors (fix immediately)
- Unclear code (refactor until clear)
- Missing docs (write them)

## References

- Related rule: [phase-4-testing](./phase-4-testing.md)
- Related rule: [safety-guardrails](./safety-guardrails.md)
