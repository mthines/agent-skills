# `.claude/rules/<topic>.md` Template

A path-scoped or repo-wide rule file loaded by Claude Code on demand.
Stays out of the hot path until a file matching `paths:` is touched.

Required frontmatter and section shape:

---

```markdown
---
description: <One-line description of what this rule covers — surfaces in rule listings>
paths:
  - "<glob 1>"
  - "<glob 2>"
---

# <Title>

- <Concise, actionable rule 1>
- <Concise, actionable rule 2>
- <Concise, actionable rule 3>
```

---

## Frontmatter rules

| Field         | Required | Notes                                                                                  |
| ------------- | -------- | -------------------------------------------------------------------------------------- |
| `description` | yes      | One line, ≤ 120 chars. Visible when Claude lists rules.                                |
| `paths`       | only if path-scoped | YAML sequence (not a comma-separated string). Omit for truly repo-wide rules. |

## Body rules

- One concern per file. Do not mix testing rules with API rules.
- Body ≤ 500 lines. Most rule files are 30 – 100 lines.
- Use the agent-readable pattern: prescriptive bullets, decision tables,
  code examples (correct + incorrect).
- No narrative ("we picked this because…") — that belongs in `docs/explanation/`.

## Worked examples

### Path-scoped rule — API handlers

```markdown
---
description: API route conventions
paths:
  - "src/api/**/*.ts"
---

# API Routes

- Every route validates input via `zod` before any database call.
- Return errors as `{ ok: false, error: { code, message } }`.
- Document each handler with an OpenAPI comment.

## Anti-patterns

- Inline schema definitions — extract to `src/api/schemas/`.
- Catch-all error handlers that swallow the error type.
- `any` in request or response types.
```

### Pattern rule — every `bindings.ts`

```markdown
---
description: Conventions for bindings.ts files
paths:
  - "**/bindings.ts"
---

# bindings.ts

- Every `bindings.ts` re-exports its types from `./types`.
- Schema validators live alongside the binding, not in `schemas/`.
- Tests sit next to the binding as `bindings.test.ts`.
```

### Repo-wide rule — no `paths:`

```markdown
---
description: Project-wide security rules
---

# Security

- Never log sensitive data (tokens, passwords, PII).
- Use environment variables for secrets; never commit `.env`.
- Validate all external input at the API boundary.
```

## When NOT to create a new rule file

- The rule only matters for **one subtree** → put it in
  `<dir>/CLAUDE.md` instead (innermost-wins).
- The rule is a one-liner the agent obeys repo-wide → put it in root
  `CLAUDE.md`.
- There are no recurring patterns yet — wait for the second occurrence.
  Premature rules are noise.

## Audit checklist for an existing rule file

- [ ] Frontmatter has `description`.
- [ ] If `paths:` present, every glob is a YAML sequence entry.
- [ ] Every `paths:` glob matches at least one current file.
- [ ] Body ≤ 500 lines.
- [ ] One concern, not three.
- [ ] No "we did this because…" narrative.
- [ ] At least one code example (correct or anti-pattern).
- [ ] Headings sentence-case.
